/**
 * The broker: aedes on a TCP port, its retained messages and sessions in SQLite.
 *
 * Every connection is asked for a username and password - the platform's, a device's the owner
 * added - unless the owner let anonymous clients in, and is then held to what its principal may
 * publish and subscribe to. What the broker carries is handed on as it goes: to the topic
 * explorer, and to the house, which turns it into devices.
 *
 * The persistence is `aedes-persistence-sqlite`'s store with its asynchronous persistence, which
 * aedes 1 speaks: the package's own export still wraps it in the callbacks aedes 0 spoke.
 */
import net from 'node:net';

import { Aedes, type AedesPublishPacket, type Client } from 'aedes';
import AsyncPersistence from 'aedes-persistence-sqlite/asyncPersistence.js';
import SqliteStore from 'aedes-persistence-sqlite/sqliteStore.js';

import { FULL_ACCESS, mayPublish, maySubscribe, type Access } from './acl.js';
import type { PrincipalStore } from './principals.js';

/** Who a connection is. */
export type Session = {
  readonly clientId: string;
  readonly username: string | null;
  readonly address: string | null;
  readonly connectedAt: string;
};

/** What the broker needs. */
export type BrokerOptions = {
  /** The TCP port. */
  readonly port: number;

  /** Where its retained messages and sessions are kept: a file, or `:memory:`. */
  readonly persistenceFile: string;

  readonly principals: PrincipalStore;

  /** Whether a client may connect without a username. */
  readonly allowAnonymous: boolean;

  /**
   * Hears every message it carries, the broker's own `$SYS` aside.
   *
   * @param topic - Where.
   * @param payload - What.
   * @param isRetained - Whether it is kept for the next subscriber.
   */
  readonly onMessage: (topic: string, payload: Buffer, isRetained: boolean) => void;

  /** Hears a client come or go. */
  readonly onSessionsChanged?: () => void;
};

/** An authentication refusal, as aedes takes one. */
type AuthError = Error & { returnCode: number };

/** aedes' "bad username or password". */
const BAD_USERNAME_OR_PASSWORD = 4;

/** aedes' "not authorised". */
const NOT_AUTHORIZED = 5;

/**
 * A refusal to connect.
 *
 * @param message - Why.
 * @param returnCode - The MQTT return code.
 * @returns The error.
 */
function refusal(message: string, returnCode: number): AuthError {
  return Object.assign(new Error(message), { returnCode });
}

/** A persistence that can stream what it retained. */
type RetainedStreaming = {
  readonly createRetainedStream: (pattern: string) => AsyncIterable<AedesPublishPacket>;
};

/** The house's MQTT broker. */
export class Broker {
  readonly #options: BrokerOptions;
  readonly #access = new WeakMap<Client, Access>();
  readonly #usernames = new WeakMap<Client, string>();
  readonly #sessions = new Map<string, Session>();
  #aedes: Aedes | undefined;
  #server: net.Server | undefined;

  /**
   * Keeps the options.
   *
   * @param options - See {@link BrokerOptions}.
   */
  public constructor(options: BrokerOptions) {
    this.#options = options;
  }

  /**
   * Starts listening, and hands on what was retained before this start.
   *
   * @returns Once it listens.
   */
  public async start(): Promise<void> {
    const { principals, allowAnonymous } = this.#options;
    const persistence = new AsyncPersistence(new SqliteStore(this.#options.persistenceFile));
    const aedes = await Aedes.createBroker({
      persistence,

      /**
       * Checks who connects.
       *
       * @param client - The connection.
       * @param username - What it sent.
       * @param password - What it sent with it.
       * @param done - Called with the verdict.
       */
      authenticate: (client, username, password, done): void => {
        if (username === undefined || username === '') {
          if (allowAnonymous) {
            this.#access.set(client, FULL_ACCESS);
            done(null, true);
          } else {
            done(refusal('A username and password are needed', NOT_AUTHORIZED), false);
          }

          return;
        }

        principals
          .verify(username, password?.toString('utf8') ?? '')
          .then((principal) => {
            if (principal === null) {
              done(refusal('Bad username or password', BAD_USERNAME_OR_PASSWORD), false);

              return;
            }

            this.#access.set(client, principal.access);
            this.#usernames.set(client, principal.username);
            done(null, true);
          })
          .catch((error: unknown) => {
            done(refusal(String(error), BAD_USERNAME_OR_PASSWORD), false);
          });
      },

      /**
       * Holds a publish to what the client may do.
       *
       * @param client - Who publishes; null for the broker itself.
       * @param packet - What.
       * @param callback - Called with the verdict.
       */
      authorizePublish: (client, packet, callback): void => {
        if (client === null) {
          callback(null);

          return;
        }

        const access = this.#access.get(client);

        callback(
          access !== undefined && mayPublish(access, packet.topic)
            ? null
            : new Error(`${client.id} may not publish to ${packet.topic}`),
        );
      },

      /**
       * Holds a subscription to what the client may read.
       *
       * @param client - Who subscribes.
       * @param subscription - What.
       * @param callback - Called with the subscription, or null to refuse it.
       */
      authorizeSubscribe: (client, subscription, callback): void => {
        const access = this.#access.get(client);

        callback(
          null,
          access !== undefined && maySubscribe(access, subscription.topic) ? subscription : null,
        );
      },
    });

    aedes.on('publish', (packet, client) => {
      // The broker's heartbeats are its own business.
      if (client === null && packet.topic.startsWith('$SYS')) {
        return;
      }

      this.#options.onMessage(packet.topic, Buffer.from(packet.payload), packet.retain);
    });
    aedes.on('clientReady', (client) => {
      const address = (client.conn as net.Socket).remoteAddress ?? null;

      this.#sessions.set(client.id, {
        clientId: client.id,
        username: this.#usernames.get(client) ?? null,
        address,
        connectedAt: new Date().toISOString(),
      });
      this.#options.onSessionsChanged?.();
    });
    aedes.on('clientDisconnect', (client) => {
      this.#sessions.delete(client.id);
      this.#options.onSessionsChanged?.();
    });

    this.#aedes = aedes;
    this.#server = net.createServer(aedes.handle);

    await new Promise<void>((resolve, reject) => {
      this.#server?.once('error', reject);
      this.#server?.listen(this.#options.port, () => {
        this.#server?.off('error', reject);
        resolve();
      });
    });

    // What was retained before this start - announcements above all - is what the house is
    // made of: it is handed on as if it had just been published.
    for await (const packet of (persistence as unknown as RetainedStreaming).createRetainedStream(
      '#',
    )) {
      this.#options.onMessage(packet.topic, Buffer.from(packet.payload), true);
    }
  }

  /**
   * Stops listening and closes every connection.
   *
   * @returns Once closed.
   */
  public async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (this.#server === undefined) {
        resolve();

        return;
      }

      this.#server.close(() => {
        resolve();
      });
    });
    await new Promise<void>((resolve) => {
      if (this.#aedes === undefined) {
        resolve();

        return;
      }

      this.#aedes.close(() => {
        resolve();
      });
    });
    this.#sessions.clear();
  }

  /**
   * Publishes a message as the broker.
   *
   * @param topic - Where.
   * @param payload - What.
   * @param isRetained - Whether it is kept for the next subscriber.
   * @returns Once it is on its way.
   */
  public async publish(topic: string, payload: string, isRetained = false): Promise<void> {
    const aedes = this.#aedes;

    if (aedes === undefined) {
      throw new Error('The broker is not running');
    }

    await new Promise<void>((resolve, reject) => {
      aedes.publish(
        {
          cmd: 'publish',
          topic,
          payload: Buffer.from(payload),
          qos: 0,
          retain: isRetained,
          dup: false,
        },
        (error?: Error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        },
      );
    });
  }

  /**
   * The clients connected now.
   *
   * @returns Them.
   */
  public sessions(): Session[] {
    return [...this.#sessions.values()];
  }
}
