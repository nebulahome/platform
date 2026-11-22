/**
 * The live channel.
 *
 * Authentication is the first message, not a query parameter. A token in a URL is written to
 * proxy access logs and to browser history, and RULES.md 16 does not allow credentials in either.
 * The socket therefore opens unauthenticated and closes itself after
 * {@link WS_AUTH_TIMEOUT_MS} if nothing valid arrives.
 *
 * A socket also closes when the access token behind it expires. It is a fifteen-minute
 * credential; a connection that outlives it would be a way to hold a revoked session open
 * indefinitely by never making another HTTP request.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';

import {
  busSubjects,
  WS_AUTH_TIMEOUT_MS,
  WS_CLIENT_MESSAGES_PER_SECOND,
  WS_CLOSE_TOKEN_EXPIRED,
  WS_CLOSE_UNAUTHENTICATED,
  WS_HEARTBEAT_INTERVAL_MS,
  WS_MAX_CLIENT_MESSAGE_BYTES,
  WS_MAX_PACKAGE_TOPICS,
  wsClientMessageSchema,
  type GrantedPermission,
  type Identity,
  type PackageLiveInbox,
  type WsClientMessage,
  type WsServerMessage,
  type WsTopic,
} from '@nebulahome/contracts';

import { isPermitted } from '../auth/permissions.js';
import { verifyAccessToken } from '../auth/tokens.js';
import type { ApiContext } from '../context.js';
import { readableEntityIds } from '../services/entities.js';
import { liveKey } from '../services/events.js';

/** What one open socket is doing. */
type SocketState = {
  /** Who it belongs to, once authenticated. */
  identity: Identity | undefined;

  /** Which entity identifiers its permissions let it read. */
  permitted: Set<string>;

  /** Which entity identifiers it is told about: the permitted, narrowed by what it asked for. */
  readable: Set<string>;

  /** The entities it asked to be narrowed to, when it asked. */
  requested: Set<string> | undefined;

  /** Which topics it asked for. */
  readonly topics: Set<WsTopic>;

  /** Which packages' live topics it follows. */
  readonly packageTopics: Set<string>;

  /** How many messages it may still send now, and when that was last worked out. */
  readonly budget: { tokens: number; at: number };

  /** Removes it from the fan-out. */
  detach: (() => void) | undefined;
};

/** A message about a package's live channel. */
export type PackageLiveRequest = Extract<
  WsClientMessage,
  { type: 'package_subscribe' | 'package_unsubscribe' | 'package_send' }
>;

/** The socket a package live request came on, as {@link handlePackageLive} needs it. */
export type PackageLiveSocket = {
  /** Who it belongs to. */
  readonly identity: Identity;

  /** Which packages' live topics it follows, changed in place. */
  readonly packageTopics: Set<string>;

  /** Sends it one message. */
  readonly send: (message: WsServerMessage) => void;

  /** The trace id of its upgrade. */
  readonly traceId: string;
};

/**
 * Follows, leaves or sends to one of a package's live topics, for whoever may read packages: the
 * same permission its methods' reads take.
 *
 * @param context - The bus to send on, and the fan-out that keeps retained messages.
 * @param socket - The socket that asked.
 * @param message - What it asked.
 */
export function handlePackageLive(
  context: Pick<ApiContext, 'bus' | 'events'>,
  socket: PackageLiveSocket,
  message: PackageLiveRequest,
): void {
  const { identity, packageTopics, send } = socket;
  const key = liveKey(message.packageId, message.topic);

  if (message.type === 'package_unsubscribe') {
    packageTopics.delete(key);

    return;
  }

  if (!isPermitted(identity.permissions, 'package:read')) {
    send({ type: 'error', code: 'PERMISSION', message: 'Reading packages is not permitted' });

    return;
  }

  if (message.type === 'package_send') {
    if (context.bus === undefined) {
      send({ type: 'error', code: 'INTERNAL', message: 'The bus is not connected' });

      return;
    }

    // Who sent it is the socket's identity, never what the message says.
    const inbox: PackageLiveInbox = {
      topic: message.topic,
      data: message.data,
      caller: { userId: identity.userId, username: identity.username, role: identity.role },
    };

    context.bus.publish(busSubjects.packageLiveInbox(message.packageId), inbox, {
      traceId: socket.traceId,
    });

    return;
  }

  if (!packageTopics.has(key) && packageTopics.size >= WS_MAX_PACKAGE_TOPICS) {
    send({
      type: 'error',
      code: 'VALIDATION',
      message: `A socket follows at most ${String(WS_MAX_PACKAGE_TOPICS)} package topics`,
    });

    return;
  }

  packageTopics.add(key);

  const retained = context.events.retained(message.packageId, message.topic);

  if (retained !== undefined) {
    send({
      type: 'package_message',
      packageId: message.packageId,
      topic: message.topic,
      data: retained,
    });
  }
}

/**
 * What following a topic takes: the permission the page that lists the same things takes.
 *
 * Not `devices`: an entity's reader without `device:read` learns of the entities a device brings
 * from its events. Nor `state`, filtered per entity, nor `library` and `system`, which carry no
 * more than a kind of list and a restart that every page shows.
 */
const TOPIC_PERMISSIONS: Partial<Record<WsTopic, string>> = {
  automations: 'automation:read',
  discovery: 'device:read',
  containers: 'container:read',
  backups: 'settings:read',
  packages: 'package:read',
};

/**
 * Says whether someone may follow a topic.
 *
 * @param identity - Who asks.
 * @param topic - The topic.
 * @returns The permission they lack, or undefined when they may.
 */
export function missingTopicPermission(identity: Identity, topic: WsTopic): string | undefined {
  const permission = TOPIC_PERMISSIONS[topic];

  return permission === undefined || isPermitted(identity.permissions, permission)
    ? undefined
    : permission;
}

/**
 * The entities a socket is told about: those it may read, narrowed to those it asked for.
 *
 * @param permitted - What its permissions let it read.
 * @param requested - What it asked for, or undefined for everything.
 * @returns The set.
 */
export function narrowReadable(
  permitted: ReadonlySet<string>,
  requested: ReadonlySet<string> | undefined,
): Set<string> {
  return requested === undefined
    ? new Set(permitted)
    : new Set([...permitted].filter((entityId) => requested.has(entityId)));
}

/** Each message's text, once it has been written for one socket. */
const serialized = new WeakMap<WsServerMessage, string>();

/**
 * The text a message goes out as, written once however many sockets it goes to: one state change
 * fanned out to a hundred sockets is one `JSON.stringify`, not a hundred. Nothing changes a
 * message once it has been sent.
 *
 * @param message - The message.
 * @returns Its JSON.
 */
export function serializeMessage(message: WsServerMessage): string {
  const known = serialized.get(message);

  if (known !== undefined) {
    return known;
  }

  const text = JSON.stringify(message);

  serialized.set(message, text);

  return text;
}

/**
 * The same text for two sets of grants that are the same grants in any order, and a different
 * one for any two that are not: what decides which entities an identity may read.
 *
 * @param permissions - The grants.
 * @returns The text.
 */
export function grantsKey(permissions: readonly GrantedPermission[]): string {
  return JSON.stringify(
    [
      ...new Set(
        permissions.map((grant) => JSON.stringify([grant.effect, grant.key, grant.scope])),
      ),
    ].sort(),
  );
}

/**
 * Shares one read of the entities a set of grants may read among the sockets that ask for it in
 * the same turn of the event loop. A registry change tells every socket at once, and each would
 * otherwise read every entity of the house again, the same rows for each socket with the same
 * grants.
 *
 * Shared only until the microtasks of the turn it was asked in run. A query is sent once it is
 * awaited, which is after that turn's synchronous work, so every socket that shares a read asked
 * for it before its query left - after whatever change made it ask. One that asks later starts
 * its own.
 *
 * @param read - Reads the entities one identity may read.
 * @returns What reads them, sharing a read asked for with the same grants in the same turn.
 */
export function sharedReads(
  read: (identity: Identity) => Promise<Set<string>>,
): (identity: Identity) => Promise<Set<string>> {
  const pending = new Map<string, Promise<Set<string>>>();

  return (identity: Identity): Promise<Set<string>> => {
    const key = grantsKey(identity.permissions);
    const shared = pending.get(key);

    if (shared !== undefined) {
      return shared;
    }

    const started = read(identity);

    pending.set(key, started);
    queueMicrotask(() => {
      pending.delete(key);
    });

    return started;
  };
}

/**
 * Runs a task one at a time: asked again while it runs, it runs once more afterwards, however
 * many times it was asked, so the last run always starts after the last request.
 *
 * @param task - The task.
 * @param onError - Told of a run that failed.
 * @returns What asks for a run.
 */
export function singleFlight(
  task: () => Promise<void>,
  onError: (error: unknown) => void,
): () => void {
  let isRunning = false;
  let isAskedAgain = false;

  /**
   * Runs the task, and once more when it was asked for meanwhile.
   *
   * @returns Once no run is left to do.
   */
  const run = async (): Promise<void> => {
    try {
      await task();
    } catch (error: unknown) {
      onError(error);
    }

    if (isAskedAgain) {
      isAskedAgain = false;
      await run();

      return;
    }

    isRunning = false;
  };

  return (): void => {
    if (isRunning) {
      isAskedAgain = true;

      return;
    }

    isRunning = true;
    void run();
  };
}

/**
 * Takes one message from a socket's budget: a bucket {@link WS_CLIENT_MESSAGES_PER_SECOND} deep,
 * filled at that rate.
 *
 * @param budget - The socket's budget, changed in place.
 * @param budget.tokens - How many messages it may still send now.
 * @param budget.at - When that was last worked out, in milliseconds.
 * @param now - The moment, in milliseconds.
 * @returns False when the bucket is empty: the message is refused.
 */
export function spend(budget: { tokens: number; at: number }, now: number): boolean {
  budget.tokens = Math.min(
    WS_CLIENT_MESSAGES_PER_SECOND,
    budget.tokens + ((now - budget.at) / 1000) * WS_CLIENT_MESSAGES_PER_SECOND,
  );
  budget.at = now;

  if (budget.tokens < 1) {
    return false;
  }

  budget.tokens -= 1;

  return true;
}

/**
 * Registers the WebSocket endpoint.
 *
 * @param server - The instance to register on, with the websocket plugin already applied.
 * @param context - The service context.
 * @param basePath - The version prefix.
 */
export function registerWebSocket(
  server: FastifyInstance,
  context: ApiContext,
  basePath: string,
): void {
  const readReadable = sharedReads(async (identity) => readableEntityIds(context.db, identity));

  server.get(
    `${basePath}/ws`,
    { websocket: true },

    /**
     * Handles one socket for its whole life.
     *
     * @param socket - The connection.
     * @param request - The upgrade request, for the trace id and the address.
     */
    (socket: WebSocket, request: FastifyRequest): void => {
      const state: SocketState = {
        identity: undefined,
        permitted: new Set<string>(),
        readable: new Set<string>(),
        requested: undefined,
        topics: new Set<WsTopic>(),
        packageTopics: new Set<string>(),
        budget: { tokens: WS_CLIENT_MESSAGES_PER_SECOND, at: context.now().getTime() },
        detach: undefined,
      };

      /**
       * Sends one message.
       *
       * @param message - What to send.
       */
      const send = (message: WsServerMessage): void => {
        socket.send(serializeMessage(message));
      };

      // Set by the close handler. Authenticating awaits more than once before the socket joins
      // the fan-out, and a socket closed meanwhile must not join it: nothing would remove it.
      let isClosed = false;

      /**
       * Says whether the socket has closed, read again after each await as a variable narrowed
       * before it would not be.
       *
       * @returns True once the close handler has run.
       */
      const hasClosed = (): boolean => isClosed;
      // Set before the first await of an authentication, so a second one sent meanwhile is
      // refused rather than joining the fan-out a second time.
      let isAuthenticating = false;

      /**
       * Decides again which entities this socket may hear about.
       *
       * The set is computed once when the socket authenticates, which is the right economy for
       * a state change of every entity for every client - but the registry moves under a socket
       * that stays open. A device adopted after the handshake has entities the set has never
       * heard of, and its readings would be dropped here for as long as the socket lived. So
       * every device event that adds, removes or describes again entities, and every derived
       * entity created, is also the moment this is done over. A filter the client asked for keeps
       * narrowing what the permissions allow, as it did the first time.
       */
      const refreshReadable = async (): Promise<void> => {
        if (state.identity === undefined) {
          return;
        }

        state.permitted = await readReadable(state.identity);
        state.readable = narrowReadable(state.permitted, state.requested);
      };

      // One read at a time, and a burst of registry changes is one more read rather than a read
      // each - which could also finish out of order and leave an older set in place.
      const rereadReadable = singleFlight(refreshReadable, (error: unknown) => {
        context.logger.warn(
          { err: error, traceId: request.traceId },
          'Could not re-read which entities a socket may hear about',
        );
      });

      const authTimer = setTimeout(() => {
        if (state.identity === undefined) {
          socket.close(WS_CLOSE_UNAUTHENTICATED, 'No credentials were presented');
        }
      }, WS_AUTH_TIMEOUT_MS);

      const heartbeat = setInterval(() => {
        socket.ping();
      }, WS_HEARTBEAT_INTERVAL_MS);

      let expiryTimer: NodeJS.Timeout | undefined;

      socket.on('close', () => {
        isClosed = true;
        clearTimeout(authTimer);
        clearInterval(heartbeat);

        if (expiryTimer !== undefined) {
          clearTimeout(expiryTimer);
        }

        state.detach?.();
      });

      socket.on('error', (error: unknown) => {
        context.logger.debug({ err: error, traceId: request.traceId }, 'Socket failed');
      });

      socket.on('message', (raw: unknown) => {
        void (async (): Promise<void> => {
          const text = String(raw);
          let parsed: unknown;

          if (Buffer.byteLength(text) > WS_MAX_CLIENT_MESSAGE_BYTES) {
            send({ type: 'error', code: 'VALIDATION', message: 'That message is too large' });

            return;
          }

          try {
            parsed = JSON.parse(text);
          } catch {
            send({ type: 'error', code: 'VALIDATION', message: 'That was not JSON' });

            return;
          }

          const message = wsClientMessageSchema.safeParse(parsed);

          if (!message.success) {
            send({ type: 'error', code: 'VALIDATION', message: 'Unrecognised message' });

            return;
          }

          if (message.data.type === 'ping') {
            send({ type: 'pong' });

            return;
          }

          if (message.data.type === 'authenticate') {
            if (state.identity !== undefined || isAuthenticating) {
              send({ type: 'error', code: 'CONFLICT', message: 'Already authenticated' });

              return;
            }

            isAuthenticating = true;

            try {
              const claims = await verifyAccessToken(message.data.accessToken, context.jwtSecret);

              if (hasClosed()) {
                return;
              }

              const identity = await context.authenticator.authenticate(message.data.accessToken);

              if (hasClosed()) {
                return;
              }

              state.identity = identity;
              state.permitted = await readReadable(identity);

              if (hasClosed()) {
                return;
              }

              state.readable = narrowReadable(state.permitted, state.requested);
              clearTimeout(authTimer);

              const expiresAt = new Date(claims.exp * 1000);

              expiryTimer = setTimeout(
                () => {
                  socket.close(WS_CLOSE_TOKEN_EXPIRED, 'The access token expired');
                },
                Math.max(0, expiresAt.getTime() - context.now().getTime()),
              );

              state.detach = context.events.add({
                /**
                 * Says whether this socket may hear about one entity.
                 *
                 * @param entityId - The entity a message concerns.
                 * @returns True when the socket's owner may read it.
                 */
                canRead: (entityId: string): boolean => state.readable.has(entityId),
                topics: state.topics,
                packageTopics: state.packageTopics,

                /**
                 * Sends one message, and takes a device event as the cue to look at the
                 * registry again.
                 *
                 * @param message - What to send.
                 */
                send: (message: WsServerMessage): void => {
                  send(message);

                  // A device that only changed its own row - started, failed, a new firmware -
                  // kept its entities: only one added, removed or described again moves them.
                  if (
                    message.type === 'device_event' &&
                    (message.event !== 'updated' || message.payload.described !== undefined)
                  ) {
                    rereadReadable();
                  }
                },
                registryChanged: rereadReadable,
              });

              send({
                type: 'welcome',
                userId: identity.userId,
                traceId: request.traceId,
                expiresAt,
              });
            } catch {
              socket.close(WS_CLOSE_UNAUTHENTICATED, 'Those credentials are not valid');
            }

            return;
          }

          if (state.identity === undefined) {
            send({ type: 'error', code: 'AUTHENTICATION', message: 'Authenticate first' });

            return;
          }

          // Messages on a socket pass no HTTP rate limit: this is what stops one flooding a
          // package's process through it.
          if (!spend(state.budget, context.now().getTime())) {
            send({ type: 'error', code: 'RATE_LIMITED', message: 'Too many messages' });

            return;
          }

          if (
            message.data.type === 'package_subscribe' ||
            message.data.type === 'package_unsubscribe' ||
            message.data.type === 'package_send'
          ) {
            handlePackageLive(
              context,
              {
                identity: state.identity,
                packageTopics: state.packageTopics,
                send,
                traceId: request.traceId,
              },
              message.data,
            );

            return;
          }

          const missing =
            message.data.type === 'subscribe'
              ? missingTopicPermission(state.identity, message.data.topic)
              : undefined;

          if (missing !== undefined) {
            // What a topic says is for those who may read the page that lists the same things.
            send({
              type: 'error',
              code: 'PERMISSION',
              message: `Following this topic requires ${missing}`,
            });

            return;
          }

          if (message.data.type === 'subscribe') {
            // A filter only ever narrows what the identity may already see, and is applied to
            // that rather than to the last filter, so a wider one, or none, widens it again.
            if (message.data.topic === 'state') {
              const entityIds = message.data.filter?.entityIds;

              state.requested = entityIds === undefined ? undefined : new Set<string>(entityIds);
              state.readable = narrowReadable(state.permitted, state.requested);
            }

            state.topics.add(message.data.topic);
            send({ type: 'subscribed', topic: message.data.topic });

            return;
          }

          state.topics.delete(message.data.topic);
          send({ type: 'unsubscribed', topic: message.data.topic });
        })();
      });
    },
  );
}
