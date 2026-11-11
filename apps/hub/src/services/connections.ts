/**
 * The connections `hub` holds open, shared between the instances that need them.
 *
 * Two instances configured against the same MQTT broker get one session, not two. The transport
 * decides what "the same" means - {@link Transport.connectionKey} - because the answer differs by
 * protocol: MQTT shares by broker, HTTP shares nothing.
 *
 * Reference counted by holder rather than by a count, so that releasing the same instance twice
 * is harmless and a holder that never connected can still be released on shutdown. A bare count
 * would drift the first time either happened, and a drifted count either leaks a socket forever
 * or closes one somebody is still using.
 */
import type { JsonObject } from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';
import type {
  AccountHandle,
  Registry,
  Transport,
  TransportConnection,
  TransportInbound,
  TransportStatus,
} from '@nebulahome/package-runtime';

/** What the pool needs. */
export type ConnectionPoolOptions = {
  /** The transports available to open. */
  readonly transports: Registry<Transport>;

  /** Passed to each connection, which is the thing with something to say. */
  readonly logger: PlatformLogger;

  /** Told about every unsolicited message, tagged with the connection it arrived on. */
  readonly onInbound?: (message: TransportInbound) => void;

  /** Told when a connection comes up or goes down. */
  readonly onStatus?: (key: string, status: TransportStatus) => void;

  /**
   * Finds the account a connection is for, when its configuration names one (`account`) of the
   * transport's own vendor - `ecovacs/cloud` for an ECOVACS account.
   *
   * @param vendorId - The transport's vendor: what comes before the slash of its id.
   * @param accountId - What the configuration names.
   * @returns The account, or undefined when there is none by that id.
   */
  readonly accountOf?: (vendorId: string, accountId: string) => Promise<AccountHandle | undefined>;
};

/**
 * One connection, open or still opening, and who is holding it. Kept as the promise so that an
 * instance asking while another is still connecting joins that attempt instead of opening its own.
 */
type Entry = {
  readonly opening: Promise<TransportConnection>;
  connection?: TransportConnection;
  readonly holders: Set<string>;
};

/** The connections `hub` holds open, shared between the instances that need them. */
export class ConnectionPool {
  readonly #entries = new Map<string, Entry>();
  readonly #options: ConnectionPoolOptions;

  /**
   * Creates an empty pool.
   *
   * @param options - The transports, the logger, and where inbound messages go.
   */
  public constructor(options: ConnectionPoolOptions) {
    this.#options = options;
  }

  /**
   * Opens a connection, or joins the one already open for the same place.
   *
   * @param transportId - Which transport.
   * @param config - The owner's connection settings, straight from the registry.
   * @param holder - The instance asking, which is what releases it later.
   * @returns The connection.
   * @throws {NotFoundError} When no such transport is registered.
   * @throws {Error} When the settings are not what the transport accepts. Validating here means a
   * wrong configuration fails the instance with a message naming it, instead of the transport
   * failing later somewhere that names none of it.
   */
  public async acquire(
    transportId: string,
    config: JsonObject,
    holder: string,
  ): Promise<TransportConnection> {
    const transport = this.#options.transports.require(transportId);
    const key = transport.connectionKey(config);
    const existing = this.#entries.get(key);

    if (existing !== undefined) {
      existing.holders.add(holder);

      return existing.opening;
    }

    // Registered before the first await: instances started together on one broker would
    // otherwise each open their own connection, and every message would be taken in once per copy.
    const entry: Entry = {
      opening: this.#open(transport, transportId, config, key),
      holders: new Set([holder]),
    };

    this.#entries.set(key, entry);

    try {
      entry.connection = await entry.opening;
    } catch (error: unknown) {
      if (this.#entries.get(key) === entry) {
        this.#entries.delete(key);
      }

      throw error;
    }

    return entry.connection;
  }

  /**
   * Opens one connection.
   *
   * @param transport - The transport.
   * @param transportId - Its id, whose vendor an account is looked up under.
   * @param config - The owner's connection settings.
   * @param key - What the connection is shared under.
   * @returns The connection.
   * @throws {Error} When it cannot be opened.
   */
  async #open(
    transport: Transport,
    transportId: string,
    config: JsonObject,
    key: string,
  ): Promise<TransportConnection> {
    const vendorId = transportId.includes('/')
      ? transportId.slice(0, transportId.indexOf('/'))
      : null;
    const accountId = config['account'];
    const account =
      vendorId === null || typeof accountId !== 'string'
        ? undefined
        : await this.#options.accountOf?.(vendorId, accountId);

    return transport.connect(config, {
      logger: this.#options.logger,
      ...(account === undefined ? {} : { account }),

      /**
       * Passes on a message the connection delivered. A message that throws on its way in is
       * dropped and logged: one odd frame from one device must not take the hub and every other
       * device down with it.
       *
       * @param message - What arrived.
       */
      deliver: (message: TransportInbound): void => {
        try {
          this.#options.onInbound?.(message);
        } catch (error: unknown) {
          this.#options.logger.error(
            { err: error, connectionKey: key },
            'A message from a device could not be taken in and was dropped',
          );
        }
      },

      /**
       * Passes on a change in the connection's health.
       *
       * @param status - Whether it is usable.
       */
      report: (status: TransportStatus): void => {
        this.#options.onStatus?.(key, status);
      },
    });
  }

  /**
   * Lets go of everything one holder was holding.
   *
   * @param holder - The instance letting go.
   * @returns A promise that settles once anything it was the last holder of is closed. Failures
   * are settled rather than thrown: a shutdown that stops at the first stuck socket leaves the
   * rest open.
   */
  public async release(holder: string): Promise<void> {
    const closing: Promise<void>[] = [];

    for (const [key, entry] of [...this.#entries]) {
      if (!entry.holders.delete(holder) || entry.holders.size > 0) {
        continue;
      }

      this.#entries.delete(key);
      closing.push(closeEntry(entry));
    }

    await Promise.allSettled(closing);
  }

  /**
   * Looks up an open connection.
   *
   * @param key - What it is shared under.
   * @returns The connection, or undefined when nothing is open under that key.
   */
  public get(key: string): TransportConnection | undefined {
    return this.#entries.get(key)?.connection;
  }

  /**
   * Closes everything.
   *
   * @returns A promise that settles once every connection is closed.
   */
  public async closeAll(): Promise<void> {
    const closing = [...this.#entries.values()].map(closeEntry);

    this.#entries.clear();
    await Promise.allSettled(closing);
  }
}

/**
 * Closes one connection, waiting for it to open first when it is still opening: one let go of
 * while connecting would otherwise come up afterwards with nobody left to close it.
 *
 * @param entry - The connection.
 * @returns A promise that settles once it is closed; rejects when it never opened.
 */
async function closeEntry(entry: Entry): Promise<void> {
  const connection = entry.connection ?? (await entry.opening);

  await connection.close();
}
