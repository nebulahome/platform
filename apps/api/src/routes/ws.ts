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
import {
  WS_AUTH_TIMEOUT_MS,
  WS_CLOSE_TOKEN_EXPIRED,
  WS_CLOSE_UNAUTHENTICATED,
  WS_HEARTBEAT_INTERVAL_MS,
  wsClientMessageSchema,
  type Identity,
  type WsServerMessage,
  type WsTopic,
} from '@nebula-home/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';

import { verifyAccessToken } from '../auth/tokens.js';
import type { ApiContext } from '../context.js';
import { readableEntityIds } from '../services/entities.js';

/** What one open socket is doing. */
type SocketState = {
  /** Who it belongs to, once authenticated. */
  identity: Identity | undefined;

  /** Which entity identifiers it may be told about. */
  readable: Set<string>;

  /** Which topics it asked for. */
  readonly topics: Set<WsTopic>;

  /** Removes it from the fan-out. */
  detach: (() => void) | undefined;
};

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
        readable: new Set<string>(),
        topics: new Set<WsTopic>(),
        detach: undefined,
      };

      /**
       * Sends one message.
       *
       * @param message - What to send.
       */
      const send = (message: WsServerMessage): void => {
        socket.send(JSON.stringify(message));
      };

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
          let parsed: unknown;

          try {
            parsed = JSON.parse(String(raw));
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
            if (state.identity !== undefined) {
              send({ type: 'error', code: 'CONFLICT', message: 'Already authenticated' });

              return;
            }

            try {
              const claims = await verifyAccessToken(message.data.accessToken, context.jwtSecret);
              const identity = await context.authenticator.authenticate(message.data.accessToken);

              state.identity = identity;
              state.readable = await readableEntityIds(context.db, identity);
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
                send,
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

          if (message.data.type === 'subscribe') {
            // A filter only ever narrows what the identity may already see: the readable set was
            // computed from permissions when the socket authenticated, and intersecting with it
            // is what stops a client subscribing itself to a room it cannot read.
            if (message.data.topic === 'state' && message.data.filter?.entityIds !== undefined) {
              const requested = new Set<string>(message.data.filter.entityIds);

              state.readable = new Set(
                [...state.readable].filter((entityId) => requested.has(entityId)),
              );
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
