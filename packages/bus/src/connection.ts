/**
 * Getting connected, and staying connected.
 *
 * ARCHITECTURE.md 7.4 is explicit that a broker being unreachable must not cascade into a full
 * platform restart: a service retries with backoff and jitter, reports itself unhealthy, and
 * keeps running. So nothing here exits the process, and the retry loop is interruptible - a
 * SIGTERM arriving while a service is waiting for a broker that will never come back has to be
 * able to end it.
 */
import { connect, Events, type NatsConnection } from 'nats';

import { withTraceId, type PlatformLogger } from '@nebulahome/logging';

import { backoffDelayMs, delay, type BackoffOptions } from './backoff.js';
import { newTraceId } from './client.js';
import { fromNatsConnection, type BusTransport } from './transport.js';

/** Default reconnection schedule: a quarter of a second, doubling to half a minute. */
const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 250, maxMs: 30_000 };

/** How long one connection attempt may take before it is abandoned and retried. */
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;

/** How a service attaches to the broker. */
export type ConnectBusOptions = {
  /** The `nats://` or `tls://` URL, from the validated `NATS_URL` variable. */
  readonly url: string;

  /**
   * Client name.
   *
   * Reported by the broker's monitoring endpoint, so `nats-top` names the service holding a
   * connection instead of listing anonymous clients.
   */
  readonly name: string;

  /** Where connection and reconnection events are reported. */
  readonly logger: PlatformLogger;

  /** Ends the retry loop, so a shutdown during startup is not blocked by an absent broker. */
  readonly signal: AbortSignal;

  /** Ceiling on one attempt. */
  readonly connectTimeoutMs?: number;

  /** The retry schedule. */
  readonly backoff?: BackoffOptions;
};

/** A connection, plus the two things a service does with one. */
export type BusConnection = {
  /** What {@link BusClient} publishes and subscribes through. */
  readonly transport: BusTransport;

  /**
   * The underlying NATS client.
   *
   * Exposed only for JetStream, which needs the client itself rather than the four operations
   * the transport exposes. Nothing else should reach through this.
   */
  readonly connection: NatsConnection;

  /**
   * Reports whether the connection is currently usable.
   *
   * @returns False while the client is disconnected or reconnecting, which is what a readiness
   * endpoint reports as degraded.
   */
  readonly isConnected: () => boolean;

  /**
   * Closes the connection and stops watching its status.
   *
   * @returns A promise that settles once the connection is closed.
   */
  readonly close: () => Promise<void>;
};

/**
 * How many reconnection attempts have failed since the last success.
 *
 * Held in a box rather than a closure variable because two functions need it: the delay handler
 * increments it, and the status watcher resets it once a reconnect succeeds. Without the reset,
 * a service that survived one long outage would go straight to the maximum delay on the next
 * brief one.
 */
type ReconnectState = {
  /** Failed attempts since the last successful connection. */
  attempt: number;
};

/**
 * Reports connection lifecycle events for as long as the connection lives.
 *
 * NATS reconnects on its own; without this the only visible symptom of a broker that keeps
 * dropping the connection is that things intermittently take five seconds and time out.
 *
 * @param connection - The connected client.
 * @param logger - Where the events are reported.
 * @param state - The reconnection counter, reset when a reconnect succeeds.
 */
function watchStatus(
  connection: NatsConnection,
  logger: PlatformLogger,
  state: ReconnectState,
): void {
  /**
   * Reads the status stream to exhaustion.
   *
   * @returns A promise that settles when the connection closes.
   */
  const pump = async (): Promise<void> => {
    for await (const status of connection.status()) {
      if (status.type === Events.Reconnect) {
        state.attempt = 0;
      }

      logger.warn(
        { event: status.type, server: connection.getServer() },
        'Bus connection status changed',
      );
    }
  };

  // Deliberately not awaited: the status stream lives as long as the connection does.
  void pump().catch((error: unknown) => {
    logger.error({ err: error }, 'Stopped watching the bus connection status');
  });
}

/** Where the broker is, and who to say we are to it. */
export type BrokerAddress = {
  /** The URL without credentials, as it may be logged. */
  readonly server: string;

  /** The user and password the URL carried, when it carried them. */
  readonly user?: string;
  readonly pass?: string;
};

/**
 * Splits a broker URL into where it is and the credentials it carries.
 *
 * The client takes the user and password as options, not from the URL, and a URL with its
 * password in it must never reach a log line: `nats://nebula:secret@127.0.0.1:4223` becomes the
 * server `nats://127.0.0.1:4223` and the user `nebula` with the password `secret`.
 *
 * @param url - The broker's URL, as configured.
 * @returns The server and the credentials.
 */
export function brokerAddressOf(url: string): BrokerAddress {
  const parsed = new URL(url);

  if (parsed.username === '' && parsed.password === '') {
    return { server: url };
  }

  const user = decodeURIComponent(parsed.username);
  const pass = decodeURIComponent(parsed.password);

  parsed.username = '';
  parsed.password = '';

  return { server: parsed.toString().replace(/\/$/u, ''), user, pass };
}

/**
 * Connects to the broker, retrying until it succeeds or the caller gives up.
 *
 * @param options - Broker URL, client identity, logger, cancellation and the retry schedule.
 * @returns The connection, once established.
 * @throws {Error} When the signal aborts before a connection is established. A caller that is
 * shutting down gets an error rather than a connection it would immediately have to close.
 */
export async function connectBus(options: ConnectBusOptions): Promise<BusConnection> {
  const backoff = options.backoff ?? DEFAULT_BACKOFF;
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const logger = withTraceId(options.logger, newTraceId());

  const reconnectState: ReconnectState = { attempt: 0 };
  const address = brokerAddressOf(options.url);

  let attempt = 0;

  while (!options.signal.aborted) {
    attempt += 1;

    try {
      // One attempt at a time is the whole point of a backoff loop; overlapping attempts
      // would defeat the schedule.
      // eslint-disable-next-line no-await-in-loop -- see above
      const connection = await connect({
        servers: address.server,
        ...(address.user === undefined ? {} : { user: address.user, pass: address.pass }),
        name: options.name,
        timeout: connectTimeoutMs,

        // The operating system resolves the hostname, not the client. Left to itself the node
        // transport expands the name with `dns.resolve4` and `dns.resolve6` - real queries to
        // the configured DNS server, which bypass the hosts file - and only falls back to the
        // name once both have failed. `localhost` is in every hosts file and in no DNS, so on a
        // network whose resolver is slow to say NXDOMAIN that fallback arrives after fifty
        // seconds, during which the service is up, the port is not, and everything in front of
        // it reports the platform as down. Measured at 52 s on Windows against a broker that
        // answers in 3 ms. What the expansion buys - trying every address a name has - is for a
        // DNS name fronting a cluster, which a self-hosted installation does not have; the
        // cluster's other addresses still arrive from the server itself once connected.
        resolve: false,

        // The client's own reconnection is left on and unbounded, because a reconnect is far
        // cheaper than tearing this down and rebuilding every subscription on top of it.
        reconnect: true,
        maxReconnectAttempts: -1,

        /**
         * Spreads reconnection attempts, for the reason given in `backoff.ts`.
         *
         * @returns How long to wait before the next attempt.
         */
        reconnectDelayHandler: (): number => {
          reconnectState.attempt += 1;

          return backoffDelayMs(reconnectState.attempt, backoff);
        },
      });

      logger.info({ server: connection.getServer(), attempt }, 'Connected to the bus');
      watchStatus(connection, options.logger, reconnectState);

      return {
        transport: fromNatsConnection(connection),
        connection,

        /**
         * Reports whether the connection is currently usable.
         *
         * @returns True when the client is neither closed nor reconnecting.
         */
        isConnected: (): boolean => !connection.isClosed() && !connection.isDraining(),

        /**
         * Closes the connection.
         *
         * @returns A promise that settles once it is closed.
         */
        close: async (): Promise<void> => {
          await connection.close();
        },
      };
    } catch (error: unknown) {
      const waitMs = backoffDelayMs(attempt, backoff);

      logger.warn(
        { attempt, waitMs, url: address.server, err: error },
        'Cannot reach the bus, retrying',
      );

      // eslint-disable-next-line no-await-in-loop -- the wait is the retry schedule.
      await delay(waitMs, options.signal);
    }
  }

  throw new Error('Aborted before a bus connection was established');
}
