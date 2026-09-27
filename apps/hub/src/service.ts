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
 * **An instance is a device.** It starts, binds the device it identified last time from what
 * the registry kept about it, and runs; or, the first time, it listens for the device it was
 * added for and asks `core` to complete the row before it runs. That listening is detached from
 * the start: the API is waiting on the other end of a reload, and a printer that is switched
 * off must not hold it.
 *
 * **Each instance speaks on the bus as itself.** `core` resolves the owner of an entity to the
 * instance that identified it - that is the token a command to it is addressed on - and
 * accepts a state report only from its owner. A report signed `hub` is a report from nobody
 * `core` knows, and is dropped with a warning, every three seconds, forever. So every instance
 * gets a client of its own whose `source` is the instance id; the transport underneath is the
 * one connection, and a client is a few fields over it.
 *
 * **Discovery starts last.** It proposes the devices that announce themselves and nobody has
 * added, so it needs the bundles to know what to listen for and the instances to know what is
 * already added; it is told again whenever an instance is added, removed or identified.
 */
import type { BusConnection } from '@nebula-home/bus';
import { BusClient } from '@nebula-home/bus';
import { resolveDataLayout } from '@nebula-home/config';
import {
  busSubjects,
  CORE_DEVICE_INFO_METHOD,
  CORE_SERVICE,
  deviceEventSchema,
  deviceInfoReplySchema,
  NotFoundError,
  type DeviceEventPayload,
  type DeviceInfoRequest,
  type EntityId,
  type DiscoverReply,
  type DiscoveryEventPayload,
  type ForgetReply,
  type JsonObject,
  type ReloadReply,
} from '@nebula-home/contracts';
import { secretsKeyFrom, type Database } from '@nebula-home/db';
import type { PlatformLogger } from '@nebula-home/logging';
import {
  Registry,
  type DeviceInfo,
  type Integration,
  type StreamSource,
  type Transport,
  type TransportConnection,
  type TransportInbound,
} from '@nebula-home/package-runtime';

import {
  developmentBundleDirectory,
  platformMqttOf,
  RUNTIME_VERSION,
  SERVICE_NAME,
  type HubConfig,
} from './config.js';
import { createMdnsSource, type MdnsSource } from './discovery/mdns-source.js';
import { DeviceBook } from './domain/devices.js';
import { planSubscriptions } from './domain/subscriptions.js';
import { withVendorSettings } from './domain/vendors.js';
import { loadBinding, loadDeviceName } from './persistence/devices.js';
import {
  loadInstance,
  loadInstances,
  openInstance,
  readStatus,
  recordListening,
  recordStatus,
  type IntegrationInstance,
} from './persistence/instances.js';
import { loadTakenDevices } from './persistence/taken.js';
import { loadVendorSettings } from './persistence/vendors.js';
import { loadBundles, mergeBundleResults, type LoadedVendor } from './services/bundles.js';
import { CameraService, type CameraOwner } from './services/cameras.js';
import { ConnectionPool } from './services/connections.js';
import { DiscoveryService, type Detected } from './services/discovery.js';
import { IdentificationService, type Identified } from './services/identification.js';
import { publishReports, startInstanceServices } from './services/instance.js';
import { ManagementService } from './services/management.js';
import { VendorContainersService } from './services/vendor-containers.js';

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

  /**
   * The mDNS browser discovery listens with; the platform's own when not given.
   *
   * Injected so that a test can announce devices without a multicast network.
   */
  readonly mdns?: MdnsSource;
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

/** One search for an instance's device, and how to end it. */
type Listening = {
  readonly abort: AbortController;
  readonly done: Promise<void>;
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
  readonly #identification: IdentificationService;
  readonly #listening = new Map<string, Listening>();
  readonly #managementService: ManagementService;
  readonly #vendorContainers: VendorContainersService;
  readonly #secretsKey: Buffer;

  /** The stream sources the vendors ship, by id: `bambu-lab/camera`. */
  readonly #streams = new Map<string, StreamSource>();
  readonly #cameras: CameraService;

  /** The vendor of each instance forgotten and not yet removed by `core`, by instance id. */
  readonly #forgotten = new Map<string, string>();
  #management: { unsubscribe: () => void }[] = [];
  #discovery: DiscoveryService | undefined;

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

    this.#identification = new IdentificationService({
      client: this.#client,
      transports: this.#transports,
      logger: options.logger,
      attemptTimeoutMs: options.config.HUB_IDENTIFY_TIMEOUT_MS,
      retryMs: options.config.HUB_IDENTIFY_RETRY_MS,
    });

    this.#cameras = new CameraService({
      client: this.#client,
      logger: options.logger,

      /**
       * Finds a stream source the vendors ship.
       *
       * @param id - `<vendor>/<name>`.
       * @returns The source, when one is loaded.
       */
      sourceOf: (id: string): StreamSource | undefined => this.#streams.get(id),

      /**
       * Finds the running instance that owns a camera.
       *
       * @param entityId - The camera.
       * @returns Its owner, when an instance running now does.
       */
      ownerOf: (entityId: EntityId): CameraOwner | undefined => {
        for (const running of this.#running.values()) {
          if (running.book.byEntityId(entityId) !== undefined) {
            return {
              integration: running.integration,
              book: running.book,
              options: running.instance.options,
              transportConfig: running.instance.transportConfig,
            };
          }
        }

        return undefined;
      },
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
       * Lists what discovery proposes; nothing before it has started.
       *
       * @returns Every device heard and not yet added.
       */
      discovered: () => this.#discovery?.list() ?? [],

      /**
       * Asks discovery to look now; nothing when it is not listening.
       *
       * @param vendorId - The vendor.
       * @returns The vendor being looked for, and for how long.
       */
      rescan: (vendorId: string): DiscoverReply =>
        this.#discovery?.rescan(vendorId) ?? { vendors: [], lookingForMs: 0 },

      /**
       * Says which driver and model a configuration being tried reaches.
       *
       * @param kind - The driver the form is on.
       * @param transportConfig - The configuration, secrets opened.
       * @returns The driver and model, or undefined when discovery cannot tell.
       */
      detect: async (kind: string, transportConfig: JsonObject): Promise<Detected | undefined> =>
        this.#discovery?.detect(kind, transportConfig),

      /**
       * Matches one instance to its registry row.
       *
       * @param integrationId - Which instance.
       * @returns Where it ended up.
       */
      reload: async (integrationId: string): Promise<ReloadReply> =>
        this.reloadInstance(integrationId),

      /**
       * Stops one instance and drops it.
       *
       * @param integrationId - Which instance.
       * @returns Whether it was running.
       */
      forget: async (integrationId: string): Promise<ForgetReply> =>
        this.forgetInstance(integrationId),

      /**
       * Hands the supervisor a vendor's containers again.
       *
       * @param vendorId - The vendor.
       * @returns Whether it is loaded.
       */
      vendorChanged: async (vendorId: string): Promise<boolean> =>
        this.#vendorContainers.vendorChanged(vendorId),
    });

    this.#vendorContainers = new VendorContainersService({
      client: this.#client,
      logger: options.logger,

      /**
       * Lists the vendors loaded.
       *
       * @returns Every loaded vendor.
       */
      vendors: (): readonly LoadedVendor[] => [...this.#vendors.values()],

      /**
       * Reads a vendor's saved settings, secrets opened.
       *
       * @param vendorId - The vendor.
       * @returns What the owner saved, or undefined.
       */
      settings: async (vendorId: string) =>
        loadVendorSettings(options.db, vendorId, this.#secretsKey),
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

    // The data directory always; the repository's bundles under development only outside
    // production, where they stand in for the integrations catalogue.
    const platform = { mqtt: platformMqttOf(config) };
    const installed = await loadBundles({
      directory: resolveDataLayout(config).integrations,
      origin: 'installed',
      runtimeVersion: RUNTIME_VERSION,
      logger,
      platform,
    });
    const developmentDirectory = developmentBundleDirectory(config);
    const bundles =
      developmentDirectory === undefined
        ? installed
        : mergeBundleResults(
            await loadBundles({
              directory: developmentDirectory,
              origin: 'development',
              runtimeVersion: RUNTIME_VERSION,
              logger,
              platform,
            }),
            installed,
            logger,
          );

    for (const failure of bundles.failures) {
      logger.error({ directory: failure.directory }, failure.message);
    }

    for (const vendor of bundles.vendors) {
      this.#vendors.set(vendor.manifest.id, vendor);

      // A vendor's own transports first: its drivers name them, and a driver is only as
      // loadable as the transport it opens.
      for (const transport of vendor.ownTransports) {
        this.#transports.register(transport);
      }

      for (const source of vendor.streams) {
        this.#streams.set(source.id, source);
      }

      for (const driver of vendor.drivers) {
        this.#integrations.register(driver.integration);
      }
    }

    logger.info(
      {
        vendors: this.#vendors.size,
        installed: bundles.vendors.filter((vendor) => vendor.origin === 'installed').length,
        development: bundles.vendors.filter((vendor) => vendor.origin === 'development').length,
        drivers: this.#integrations.size,
        transports: this.#transports.size,
      },
      'Loaded integration bundles',
    );

    // Not awaited: a supervisor that is not up yet is asked again every minute, and nothing here
    // waits on the containers - an instance whose container is still being pulled simply fails
    // to connect until it runs, as it would against any device that is not up.
    void this.#vendorContainers.reconcile();

    this.#management = [
      ...this.#managementService.serve(),
      ...this.#cameras.serve(),
      this.#client.subscribe(
        busSubjects.deviceEvent('removed'),
        deviceEventSchema,

        /**
         * Shows a removed device to discovery again.
         *
         * `core` publishes this once the rows are gone, which is the first moment the device
         * is no longer added: asked any earlier, discovery would read it still there.
         *
         * @param payload - Which device went.
         */
        (payload): void => {
          const vendorId = this.#forgotten.get(payload.deviceId);

          this.#forgotten.delete(payload.deviceId);
          void this.#releaseDiscovery(vendorId);
        },
      ),
    ];

    const instances = await loadInstances(db);

    this.#discovery = this.#createDiscovery();

    // Started in parallel: one instance waiting on a broker that is not answering must not hold
    // up the others, and there is no ordering between them to preserve. Discovery starts beside
    // them rather than after: it reads what is added from the registry, not from the instances,
    // and a house with one unreachable device would otherwise find nothing new until that one
    // had given up.
    await Promise.all([
      ...instances.map(async (instance) => this.#startInstance(instance)),
      // Off the house's network - a container on a bridge - only a vendor that listens on a
      // broker can hear its devices, and it still does.
      this.#discovery.start({ lan: config.HUB_DISCOVERY_ENABLED }),
    ]);
  }

  /**
   * Builds discovery over what was loaded.
   *
   * Built whether or not it listens: the add form's Test asks it which model answered, which
   * needs no multicast.
   *
   * @returns Discovery, not yet listening.
   */
  #createDiscovery(): DiscoveryService {
    const { config, db, logger } = this.#options;

    return new DiscoveryService({
      vendors: [...this.#vendors.values()].flatMap((vendor) =>
        vendor.discovery === undefined
          ? []
          : [{ id: vendor.manifest.id, discovery: vendor.discovery }],
      ),
      mdns: this.#options.mdns ?? createMdnsSource({ logger }),
      transports: this.#transports,
      integrations: this.#integrations,
      logger,

      /**
       * Reads a vendor's saved settings, secrets opened.
       *
       * @param vendorId - The vendor.
       * @returns What the owner saved for its connections; empty when nothing.
       */
      vendorSettings: async (vendorId: string): Promise<JsonObject> =>
        (await loadVendorSettings(db, vendorId, this.#secretsKey))?.transportConfig ?? {},

      /**
       * Reads what is already added.
       *
       * @returns Every instance's id and address.
       */
      taken: async () => loadTakenDevices(db),

      /**
       * Tells whoever is listening that the proposals changed.
       *
       * @param count - How many devices are proposed now.
       */
      publishChanged: (count: number): void => {
        const payload: DiscoveryEventPayload = { count };

        this.#client.publish(busSubjects.discoveryEvent('changed'), payload);
      },
      queryIntervalMs: config.HUB_DISCOVERY_QUERY_INTERVAL_MS,
      ttlMs: config.HUB_DISCOVERY_TTL_MS,
      probeIntervalMs: config.HUB_DISCOVERY_QUERY_INTERVAL_MS,
    });
  }

  /**
   * Tells discovery that what is added changed, without letting its failure reach the caller.
   *
   * @returns A promise that settles once discovery has read it again, or failed to.
   */
  async #refreshDiscovery(): Promise<void> {
    try {
      await this.#discovery?.refresh();
    } catch (error: unknown) {
      this.#options.logger.warn({ err: error }, 'Discovery could not read what is added');
    }
  }

  /**
   * Tells discovery that a device was removed, without letting its failure reach the caller.
   *
   * @param vendorId - The vendor it was of, when known.
   * @returns A promise that settles once discovery has read it again and asked the network.
   */
  async #releaseDiscovery(vendorId: string | undefined): Promise<void> {
    try {
      await this.#discovery?.release(vendorId);
    } catch (error: unknown) {
      this.#options.logger.warn({ err: error }, 'Discovery could not read what is added');
    }
  }

  /**
   * Stops everything.
   *
   * @returns A promise that settles once every subscription is dropped and every connection is
   * closed.
   */
  public async stop(): Promise<void> {
    this.#cameras.stop();
    this.#vendorContainers.stop();
    await this.#discovery?.stop();
    this.#discovery = undefined;
    await this.#stopListening([...this.#listening.keys()]);

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

    // Whatever the vendors' own code holds - a UDP port - is let go of with them.
    await Promise.all([...this.#vendors.values()].map(async (vendor) => vendor.release()));
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
      await this.#refreshDiscovery();

      throw new NotFoundError('No integration has that id', { details: { id } });
    }

    await this.#startInstance(instance);
    await this.#refreshDiscovery();

    return readStatus(this.#options.db, id);
  }

  /**
   * Stops one instance and drops it, without reading the registry.
   *
   * What the API asks for just before `core` deletes the instance's rows: nothing is re-read,
   * because there will be nothing to read, and nothing is started. The row is still there at
   * this point, so the stop records `stopped` on it as usual; if the owner's delete then fails
   * halfway, the row says exactly what is true, and a second delete asks this again to no
   * effect. Asked for an instance that is not running - or was never loaded - it says so and
   * does nothing, so the API's retry costs nothing.
   *
   * @param id - Which instance.
   * @returns Whether there was anything running to stop.
   */
  public async forgetInstance(id: string): Promise<ForgetReply> {
    const wasRunning = this.#running.has(id) || this.#listening.has(id);
    const kind = this.#running.get(id)?.instance.kind;

    if (kind !== undefined) {
      const [vendorId = ''] = kind.split('/');

      this.#forgotten.set(id, vendorId);
    }

    await this.#stopInstance(id);

    // Not refreshed here: the rows are still there until `core` deletes them, and the device
    // would be offered again only to be taken away. `core` says when they are gone, and
    // discovery is told then.
    return { wasRunning };
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
    await this.#stopListening([id]);

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

      // The device it identified last time, bound again from the claim that was kept for it.
      // After the instance is in `#running`, because applying the subscriptions reads it there.
      const restored = await loadBinding(db, instance.id, integration, instance.options);

      if (restored.status === 'bound') {
        book.bind(restored.binding);
        await this.#applySubscriptions(instance.id);
        await recordStatus(db, instance.id, 'running');
        logger.info(
          { instanceId: instance.id, kind: instance.kind, externalId: restored.externalId },
          'Integration instance started',
        );

        return;
      }

      if (restored.status === 'unrestorable') {
        logger.warn(
          { instanceId: instance.id, externalId: restored.externalId, reason: restored.reason },
          'The device could not be bound from its row and will be identified again',
        );
      } else if (restored.status === 'adopted') {
        logger.info(
          { instanceId: instance.id, externalId: restored.externalId },
          'Listening for the device it was adopted as',
        );
      } else if (restored.status === 'missing') {
        logger.warn(
          { instanceId: instance.id },
          'No device row for this instance: it was not created through the API',
        );
      }

      await recordStatus(db, instance.id, 'identifying');
      this.#listen(
        this.#running.get(instance.id),
        restored.status === 'unrestorable' || restored.status === 'adopted'
          ? restored.externalId
          : null,
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
   * Starts listening for an instance's device, detached from whoever started the instance.
   *
   * @param running - The instance, as it is running.
   * @param expectedExternalId - What the row says the device is, when it was identified before.
   */
  #listen(running: RunningInstance | undefined, expectedExternalId: string | null): void {
    if (running === undefined) {
      return;
    }

    const id = running.instance.id;
    const abort = new AbortController();
    const done = this.#identify(running, expectedExternalId, abort.signal).finally(() => {
      if (this.#listening.get(id)?.abort === abort) {
        this.#listening.delete(id);
      }
    });

    this.#listening.set(id, { abort, done });
  }

  /**
   * Ends the search for some instances' devices, and waits until each has ended.
   *
   * Waited for, not just signalled: a reply from `core` landing after the instance was stopped
   * would bind a device to an instance that is gone, and a reload must not overlap the search
   * it replaces.
   *
   * @param ids - Which instances.
   * @returns A promise that settles once none of them is listening.
   */
  async #stopListening(ids: readonly string[]): Promise<void> {
    await Promise.all(
      ids.map(async (id): Promise<void> => {
        const listening = this.#listening.get(id);

        if (listening !== undefined) {
          listening.abort.abort();
          await listening.done;
        }
      }),
    );
  }

  /**
   * Listens until the device is identified, then binds it and reports the instance running.
   *
   * Never rejects: the search logs its own failures, and whatever else goes wrong is recorded
   * against the instance the way a failed start is.
   *
   * @param running - The instance, as it is running.
   * @param expectedExternalId - What the row says the device is, when it was identified before.
   * @param signal - Ends the search.
   * @returns A promise that settles once the search has ended, one way or the other.
   */
  async #identify(
    running: RunningInstance,
    expectedExternalId: string | null,
    signal: AbortSignal,
  ): Promise<void> {
    const { db, logger } = this.#options;
    const id = running.instance.id;

    try {
      const found: Identified | undefined = await this.#identification.identify(
        {
          instanceId: id,
          integration: running.integration,
          options: running.instance.options,
          transportId: running.instance.transport,
          transportConfig: running.instance.transportConfig,
          expectedExternalId,
        },
        signal,

        /**
         * Writes why the device is not identified yet next to the state, where the interface
         * shows it, and says so to whoever is showing it.
         *
         * @param reason - Why, in an owner's words.
         */
        (reason: string): void => {
          if (signal.aborted) {
            return;
          }

          void recordListening(db, id, reason)
            .then(async () => this.#announceUpdated(id))
            .catch((error: unknown) => {
              logger.warn({ err: error, instanceId: id }, 'Could not record why it is listening');
            });
        },
      );

      // Stopped, or replaced by a reload while the search was out: whatever was found belongs
      // to an instance that is no longer this one.
      if (found === undefined || signal.aborted || this.#running.get(id) !== running) {
        return;
      }

      running.book.bind(found.binding);
      await this.#applySubscriptions(id);
      await recordStatus(db, id, 'running');
      await this.#announceUpdated(id);
      await this.#refreshDiscovery();
      logger.info(
        {
          instanceId: id,
          kind: running.instance.kind,
          externalId: found.externalId,
          entities: found.entityIds.length,
        },
        'Integration instance started',
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      await recordStatus(db, id, 'failed', message);
      await this.#announceUpdated(id);
      logger.error({ instanceId: id, kind: running.instance.kind }, message);
    }
  }

  /**
   * Tells whoever shows the device that something on its row changed without anyone editing it:
   * its state, why it is still listening, its firmware.
   *
   * Never rejects: a list that is not told is a list that is read again on the next change, and
   * the change itself is already written.
   *
   * @param instanceId - The instance, which is the device's id.
   * @returns A promise that settles once the event is published, or could not be.
   */
  async #announceUpdated(instanceId: string): Promise<void> {
    try {
      const name = (await loadDeviceName(this.#options.db, instanceId)) ?? instanceId;
      const payload: DeviceEventPayload = {
        deviceId: instanceId,
        source: instanceId,
        name,
        entityIds: [],
      };

      this.#client.publish(busSubjects.deviceEvent('updated'), payload);
    } catch (error: unknown) {
      this.#options.logger.debug({ err: error, instanceId }, 'Could not announce a device change');
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

      const info = running.book.infoOf(running.integration, running.instance.options, message);

      if (info !== undefined) {
        void this.#reportInfo(running.instance.id, info);
      }
    }
  }

  /**
   * Tells `core` which firmware a running device reports now, which `core` writes down - and
   * announces - only when it differs from the row.
   *
   * @param instanceId - The instance, which is the device's id.
   * @param info - What the device says.
   * @returns A promise that settles once `core` answered, or did not.
   */
  async #reportInfo(instanceId: string, info: DeviceInfo): Promise<void> {
    const request: DeviceInfoRequest = {
      integrationId: instanceId,
      ...(info.swVersion === undefined ? {} : { swVersion: info.swVersion.slice(0, 64) }),
      ...(info.hwVersion === undefined ? {} : { hwVersion: info.hwVersion.slice(0, 64) }),
    };

    try {
      await this.#client.request(
        busSubjects.service(CORE_SERVICE, CORE_DEVICE_INFO_METHOD),
        request,
        deviceInfoReplySchema,
      );
    } catch (error: unknown) {
      this.#options.logger.debug({ err: error, instanceId }, 'Could not report a device firmware');
    }
  }
}
