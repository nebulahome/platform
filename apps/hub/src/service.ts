/**
 * Assembling and tearing down `hub`.
 *
 * The order in `start` is not arbitrary. Bundles are loaded before instances, because an instance
 * names the bundle it runs; connections are opened before subjects are served, because a command
 * arriving for an instance with no connection has nowhere to go.
 *
 * **One instance failing never stops another.** A missing bundle, an unknown transport, settings
 * the transport will not accept - each of those leaves that instance in `failed` with the reason
 * recorded, and the rest of the house carries on. The alternative, refusing to start, means one
 * bad row in a configuration table takes every light offline.
 *
 * **Each instance speaks on the bus as itself.** `core` resolves the owner of an adopted entity
 * to the instance that adopted it - that is the token a command to it is addressed on - and
 * accepts a state report only from its owner. A report signed `hub` is a report from nobody
 * `core` knows, and is dropped with a warning, every three seconds, forever. So every instance
 * gets a client of its own whose `source` is the instance id; the transport underneath is the
 * one connection, and a client is a few fields over it.
 */
import type { BusConnection } from '@nebula-home/bus';
import { BusClient } from '@nebula-home/bus';
import { NotFoundError, type ReloadReply } from '@nebula-home/contracts';
import { secretsKeyFrom, type Database } from '@nebula-home/db';
import type { PlatformLogger } from '@nebula-home/logging';
import {
  Registry,
  type Integration,
  type Transport,
  type TransportConnection,
  type TransportInbound,
} from '@nebula-home/package-runtime';

import { RUNTIME_VERSION, SERVICE_NAME, type HubConfig } from './config.js';
import { DeviceBook } from './domain/devices.js';
import { planSubscriptions } from './domain/subscriptions.js';
import { withVendorSettings } from './domain/vendors.js';
import { loadBindings } from './persistence/devices.js';
import {
  loadInstance,
  loadInstances,
  openInstance,
  readStatus,
  recordStatus,
  type IntegrationInstance,
} from './persistence/instances.js';
import { loadVendorSettings } from './persistence/vendors.js';
import { loadBundles, type LoadedVendor } from './services/bundles.js';
import { ConnectionPool } from './services/connections.js';
import { DiscoveryService, type DiscoverableInstance } from './services/discovery.js';
import { publishReports, startInstanceServices } from './services/instance.js';
import { ManagementService } from './services/management.js';

/** What the service needs. */
export type HubServiceOptions = {
  readonly config: HubConfig;
  readonly db: Database;
  readonly bus: BusConnection;
  readonly logger: PlatformLogger;

  /**
   * Transports available to open.
   *
   * Injected rather than imported so that a test can supply one without a network, and so that
   * the set is a deployment decision rather than an import graph.
   */
  readonly transports?: readonly Transport[];
};

/** One instance that started. */
type RunningInstance = {
  readonly instance: IntegrationInstance;
  readonly integration: Integration;
  readonly book: DeviceBook;
  readonly connection: TransportConnection;

  /** Publishes and answers as the instance, which is who `core` expects to hear from. */
  readonly client: BusClient;

  readonly subscriptions: { unsubscribe: () => void }[];
};

/** Everything `hub` runs. */
export class HubService {
  readonly #options: HubServiceOptions;
  readonly #integrations = new Registry<Integration>('integration');
  readonly #transports = new Registry<Transport>('transport');
  readonly #vendors = new Map<string, LoadedVendor>();
  readonly #running = new Map<string, RunningInstance>();
  readonly #client: BusClient;
  readonly #pool: ConnectionPool;
  readonly #discovery: DiscoveryService;
  readonly #managementService: ManagementService;
  readonly #secretsKey: Buffer;
  #management: { unsubscribe: () => void }[] = [];

  /**
   * Prepares the service without starting anything.
   *
   * @param options - Its collaborators.
   */
  public constructor(options: HubServiceOptions) {
    this.#options = options;
    this.#secretsKey = secretsKeyFrom(options.config.NEBULA_SECRETS_KEY);

    for (const transport of options.transports ?? []) {
      this.#transports.register(transport);
    }

    this.#client = new BusClient({
      transport: options.bus.transport,
      source: SERVICE_NAME,
      logger: options.logger,
      requestTimeoutMs: options.config.HUB_COMMAND_TIMEOUT_MS,
    });

    this.#pool = new ConnectionPool({
      transports: this.#transports,
      logger: options.logger,

      /**
       * Routes one inbound message to whichever instances share the connection.
       *
       * Every instance on the connection is offered it, and each one's book ignores what is not
       * its own. That is cheaper and less fragile than `hub` keeping its own index of which
       * device belongs to whom, which would be a second copy of what the book already knows.
       *
       * @param message - What arrived.
       */
      onInbound: (message: TransportInbound): void => {
        this.#ingest(message);
      },
    });

    this.#discovery = new DiscoveryService({
      client: this.#client,
      transports: this.#transports,
      logger: options.logger,
      defaultTimeoutMs: options.config.HUB_DISCOVERY_TIMEOUT_MS,

      /**
       * Lists the instances a scan may use.
       *
       * Read when a scan starts rather than captured once, so that an instance started or
       * stopped since the last scan is included or left out without discovery tracking it.
       *
       * @returns The running instances.
       */
      instances: (): DiscoverableInstance[] =>
        [...this.#running.values()].map((running) => ({
          instanceId: running.instance.id,
          integration: running.integration,
          options: running.instance.options,
          transportId: running.instance.transport,
          transportConfig: running.instance.transportConfig,
          book: running.book,
        })),

      /**
       * Tells a connection what a newly adopted device needs carried.
       *
       * @param instanceId - The instance that gained a device.
       * @returns A promise that settles once the transport has been told.
       */
      onAdopted: async (instanceId: string): Promise<void> => this.#applySubscriptions(instanceId),
    });

    this.#managementService = new ManagementService({
      client: this.#client,
      transports: this.#transports,
      logger: options.logger,
      secretsKey: this.#secretsKey,

      /**
       * Lists the vendors loaded, read when asked.
       *
       * @returns Every loaded vendor, drivers included.
       */
      vendors: (): readonly LoadedVendor[] => [...this.#vendors.values()],

      /**
       * Matches one instance to its registry row.
       *
       * @param integrationId - Which instance.
       * @returns Where it ended up.
       */
      reload: async (integrationId: string): Promise<ReloadReply> =>
        this.reloadInstance(integrationId),
    });
  }

  /**
   * The instances currently running.
   *
   * @returns Each running instance by id, exposed for tests and diagnostics.
   */
  public get running(): ReadonlyMap<string, { readonly book: DeviceBook }> {
    return this.#running;
  }

  /**
   * Loads everything and starts every enabled instance.
   *
   * @returns A promise that settles once every instance has either started or been recorded as
   * failed. It does not reject for an instance that failed: that is a state, not an exception.
   */
  public async start(): Promise<void> {
    const { config, db, logger } = this.#options;

    const bundles = await loadBundles({
      directory: config.HUB_BUNDLE_DIR,
      runtimeVersion: RUNTIME_VERSION,
    });

    for (const failure of bundles.failures) {
      logger.error({ directory: failure.directory }, failure.message);
    }

    for (const vendor of bundles.vendors) {
      this.#vendors.set(vendor.manifest.id, vendor);

      for (const driver of vendor.drivers) {
        this.#integrations.register(driver.integration);
      }
    }

    logger.info(
      {
        vendors: this.#vendors.size,
        drivers: this.#integrations.size,
        transports: this.#transports.size,
      },
      'Loaded integration bundles',
    );

    this.#management = [...this.#discovery.serve(), ...this.#managementService.serve()];

    const instances = await loadInstances(db);

    // Started in parallel: one instance waiting on a broker that is not answering must not hold
    // up the others, and there is no ordering between them to preserve.
    await Promise.all(instances.map(async (instance) => this.#startInstance(instance)));
  }

  /**
   * Stops everything.
   *
   * @returns A promise that settles once every subscription is dropped and every connection is
   * closed.
   */
  public async stop(): Promise<void> {
    for (const running of this.#running.values()) {
      for (const subscription of running.subscriptions) {
        subscription.unsubscribe();
      }
    }

    for (const subscription of this.#management) {
      subscription.unsubscribe();
    }

    this.#management = [];
    this.#running.clear();
    await this.#pool.closeAll();
    await this.#client.drain();
  }

  /**
   * Re-reads one instance from the registry and makes what is running match it.
   *
   * What the API asks for after it has written a row: the instance is stopped if it was running
   * and started again from the row as it now stands - so a changed address takes effect, an
   * instance switched off goes quiet, and one switched on comes up - without the service being
   * restarted. The answer is where it ended up, read back from the row the start recorded it in.
   *
   * @param id - Which instance.
   * @returns Its state and last error, as the interface will show them.
   * @throws {NotFoundError} When no row has that id. Whatever was running under it is stopped
   * first: a row that is gone is an instance that should not be.
   */
  public async reloadInstance(id: string): Promise<ReloadReply> {
    const instance = await loadInstance(this.#options.db, id);

    await this.#stopInstance(id);

    if (instance === undefined) {
      throw new NotFoundError('No integration has that id', { details: { id } });
    }

    await this.#startInstance(instance);

    return readStatus(this.#options.db, id);
  }

  /**
   * Stops one instance, if it is running.
   *
   * The instance's own subscriptions are dropped and its hold on the connection released; the
   * connection itself closes only if nobody else holds it, and if somebody does, that somebody's
   * subscription set is applied whole so the transport stops carrying what the stopped instance
   * asked for. Nothing is drained: the per-instance client shares the bus connection with
   * everything else in the service.
   *
   * @param id - Which instance.
   * @returns A promise that settles once the instance is gone and the row says `stopped`.
   */
  async #stopInstance(id: string): Promise<void> {
    const running = this.#running.get(id);

    if (running === undefined) {
      return;
    }

    for (const subscription of running.subscriptions) {
      subscription.unsubscribe();
    }

    this.#running.delete(id);
    await this.#pool.release(id);

    const sharing = [...this.#running.values()].find(
      (other) => other.connection.key === running.connection.key,
    );

    if (sharing !== undefined) {
      await this.#applySubscriptions(sharing.instance.id);
    }

    await recordStatus(this.#options.db, id, 'stopped');
    this.#options.logger.info({ instanceId: id }, 'Integration instance stopped');
  }

  /**
   * Starts one instance, or records why it could not start.
   *
   * @param stored - What the owner configured, as read from the registry.
   * @returns A promise that settles once it is running or recorded as failed.
   */
  async #startInstance(stored: IntegrationInstance): Promise<void> {
    const { db, logger } = this.#options;

    if (!stored.isEnabled) {
      await recordStatus(db, stored.id, 'disabled');

      return;
    }

    try {
      await recordStatus(db, stored.id, 'starting');

      // Opened here, inside the catch: a key that no longer opens this instance's secrets fails
      // this instance with a message naming the key, and nothing else.
      const instance = await this.#withVendorSettings(openInstance(stored, this.#secretsKey));
      const integration = this.#integrations.require(instance.kind);
      const connection = await this.#pool.acquire(
        instance.transport,
        instance.transportConfig,
        instance.id,
      );

      const book = new DeviceBook();
      const client = new BusClient({
        transport: this.#options.bus.transport,
        source: instance.id,
        logger,
        requestTimeoutMs: this.#options.config.HUB_COMMAND_TIMEOUT_MS,
      });
      const subscriptions = startInstanceServices({
        instanceId: instance.id,
        options: instance.options,
        integration,
        book,
        client,
        connection,
        commandTimeoutMs: this.#options.config.HUB_COMMAND_TIMEOUT_MS,
      });

      this.#running.set(instance.id, {
        instance,
        integration,
        book,
        connection,
        client,
        subscriptions,
      });

      // The devices it adopted last time, bound again from the claims adoption kept for them.
      // After the instance is in `#running`, because applying the subscriptions reads it there.
      const restored = await loadBindings(db, instance.id, integration, instance.options);

      for (const binding of restored.bindings) {
        book.bind(binding);
      }

      for (const device of restored.skipped) {
        logger.warn(
          { instanceId: instance.id, externalId: device.externalId, reason: device.reason },
          'An adopted device could not be restored and will not be watched until adopted again',
        );
      }

      if (restored.bindings.length > 0) {
        await this.#applySubscriptions(instance.id);
      }

      await recordStatus(db, instance.id, 'running');
      logger.info(
        { instanceId: instance.id, kind: instance.kind, devices: restored.bindings.length },
        'Integration instance started',
      );
    } catch (error: unknown) {
      // Recorded rather than thrown. An owner who mistyped a broker address should see that one
      // instance red in the interface, not a service that will not come up.
      const message = error instanceof Error ? error.message : String(error);

      await this.#pool.release(stored.id);
      await recordStatus(db, stored.id, 'failed', message);
      logger.error({ instanceId: stored.id, kind: stored.kind }, message);
    }
  }

  /**
   * Puts the vendor's shared settings under an instance's own.
   *
   * The kind names the vendor; the vendor's `setup.json` says whether anything is required of
   * the owner; the row, if any, holds what they answered. An instance of a vendor that asks for
   * a key nobody has given cannot connect, and says so as its failure rather than as a
   * transport error about a missing header three layers down.
   *
   * @param instance - As read from the registry and opened.
   * @returns The instance with the vendor's values beneath its own.
   * @throws {Error} When the vendor is not loaded, or needs setting up first.
   */
  async #withVendorSettings(instance: IntegrationInstance): Promise<IntegrationInstance> {
    const [vendorId = ''] = instance.kind.split('/');
    const vendor = this.#vendors.get(vendorId);

    if (vendor === undefined) {
      throw new Error(
        `No loaded integration bundle is by the vendor ${vendorId}, so ${instance.kind} has no driver`,
      );
    }

    const saved = await loadVendorSettings(this.#options.db, vendorId, this.#secretsKey);

    return withVendorSettings(instance, vendor.manifest.name, vendor.setup, saved);
  }

  /**
   * Tells a connection everything the instances on it now need carried.
   *
   * Recomputed from scratch and applied whole, rather than added to. A connection is shared, so
   * the transport has no way to know which of its standing requests belonged to which instance -
   * and asking it to work that out is how a stopped instance ends up either still being polled or
   * taking somebody else's subscription down with it.
   *
   * @param instanceId - The instance whose connection changed.
   * @returns A promise that settles once the transport has applied the set.
   */
  async #applySubscriptions(instanceId: string): Promise<void> {
    const changed = this.#running.get(instanceId);

    if (changed === undefined) {
      return;
    }

    const sharing = [...this.#running.values()].filter(
      (running) => running.connection.key === changed.connection.key,
    );

    await changed.connection.apply(
      planSubscriptions(
        sharing.map((running) =>
          running.integration.subscriptions(running.book.claims(), running.instance.options),
        ),
      ),
    );
  }

  /**
   * Offers one inbound message to every instance sharing the connection it arrived on.
   *
   * @param message - What arrived.
   */
  #ingest(message: TransportInbound): void {
    for (const running of this.#running.values()) {
      if (running.connection.key !== message.connectionKey) {
        continue;
      }

      const reports = running.book.ingest(running.integration, running.instance.options, message);

      if (reports.length > 0) {
        publishReports(running.client, reports);
      }
    }
  }
}
