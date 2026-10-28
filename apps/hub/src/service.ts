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
import path from 'node:path';

import type { BusConnection } from '@nebulahome/bus';
import { BusClient } from '@nebulahome/bus';
import { resolveDataLayout } from '@nebulahome/config';
import {
  BLUETOOTH_VENDOR,
  busSubjects,
  ConflictError,
  CORE_DEVICE_INFO_METHOD,
  CORE_SERVICE,
  deviceEventSchema,
  deviceInfoReplySchema,
  dockerStatusSchema,
  INFRARED_TRANSPORT,
  INFRARED_VENDOR,
  MATTER_TRANSPORT,
  MATTER_VENDOR,
  MODBUS_TRANSPORT,
  MODBUS_VENDOR,
  MQTT_HOUSE_TRANSPORT,
  MQTT_VENDOR,
  NotFoundError,
  serialDeviceConfigSchema,
  SUPERVISOR_METHODS,
  SUPERVISOR_SERVICE,
  supervisorAcknowledgementSchema,
  type DeviceEventPayload,
  type DeviceInfoRequest,
  type EntityId,
  type DiscoverReply,
  type DiscoveryEventPayload,
  type ForgetReply,
  type JsonObject,
  type ReloadReply,
  type BundleFailureView,
  type VendorLoadReply,
  type VendorLoadRequest,
} from '@nebulahome/contracts';
import { secretsKeyFrom, type Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';
import {
  findVendorFolder,
  Registry,
  type DeviceInfo,
  type Integration,
  type PlatformServices,
  type StreamSource,
  type Transport,
  type TransportConnection,
  type TransportInbound,
  type TransportStatus,
} from '@nebulahome/package-runtime';

import { BluetoothBroker } from './bluetooth/broker.js';
import { createBluezHost } from './bluetooth/host.js';
import {
  developmentBundleDirectories,
  platformMqttOf,
  RUNTIME_VERSION,
  SERVICE_NAME,
  type HubConfig,
} from './config.js';
import { createMdnsSource, type MdnsSource } from './discovery/mdns-source.js';
import { DeviceBook } from './domain/devices.js';
import { planSubscriptions } from './domain/subscriptions.js';
import { withVendorSettings } from './domain/vendors.js';
import { InfraredBroker } from './infrared/broker.js';
import { MatterBroker } from './matter/broker.js';
import type { OpenMatterFabric } from './matter/fabric.js';
import { ModbusBroker } from './modbus/broker.js';
import { ModbusPool } from './modbus/client.js';
import { MqttBroker } from './mqtt/broker.js';
import { databaseAccountStore } from './persistence/accounts.js';
import { databaseBluetoothStore, loadBluetoothInstances } from './persistence/bluetooth.js';
import { loadBinding, loadDeviceName, loadExternalId } from './persistence/devices.js';
import { databaseInfraredStore } from './persistence/infrared.js';
import {
  loadInstance,
  loadInstances,
  openInstance,
  readStatus,
  recordListening,
  recordStatus,
  type IntegrationInstance,
} from './persistence/instances.js';
import { databaseMatterNetworksStore } from './persistence/matter.js';
import { databaseModbusStore } from './persistence/modbus.js';
import { databaseSerialStore, loadSerialInstances } from './persistence/serial.js';
import { loadTakenDevices } from './persistence/taken.js';
import { databaseThreadStore } from './persistence/thread.js';
import { loadVendorSettings } from './persistence/vendors.js';
import { SerialBroker } from './serial/broker.js';
import { createLinuxSerialHost } from './serial/host.js';
import { withAccountLookups } from './services/account-lookups.js';
import { AccountService } from './services/accounts.js';
import { serveBluetooth } from './services/bluetooth-management.js';
import {
  loadBundles,
  loadVendor,
  mergeBundleResults,
  type BundleFailure,
  type BundleOrigin,
  type LoadBundlesOptions,
  type LoadBundlesResult,
  type LoadedVendor,
} from './services/bundles.js';
import { CameraService, type CameraOwner } from './services/cameras.js';
import { ConnectionPool } from './services/connections.js';
import { DiscoveryService, type Detected } from './services/discovery.js';
import { IdentificationService, type Identified } from './services/identification.js';
import { ImageStore } from './services/images.js';
import { serveInfrared } from './services/infrared-management.js';
import { publishReports, startInstanceServices } from './services/instance.js';
import { ManagementService } from './services/management.js';
import { serveMatter } from './services/matter-management.js';
import { serveModbus } from './services/modbus-management.js';
import { serveMqtt } from './services/mqtt-management.js';
import { PackageWatch, type WatchedVendor } from './services/package-watch.js';
import {
  platformBluetoothVendor,
  platformInfraredVendor,
  platformMatterVendor,
  platformModbusVendor,
  platformMqttVendor,
} from './services/platform-vendors.js';
import { serveSerial } from './services/serial-management.js';
import { serveThread } from './services/thread-management.js';
import { VendorContainersService } from './services/vendor-containers.js';
import { ThreadBroker } from './thread/broker.js';
import { createLinuxThreadHost } from './thread/host.js';
import { createBluetoothTransport } from './transports/bluetooth.js';
import { createInfraredTransport } from './transports/infrared.js';
import { createMatterTransport } from './transports/matter.js';
import { createModbusTransport } from './transports/modbus.js';
import { createMqttHouseTransport } from './transports/mqtt-house.js';

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

  /**
   * Opens the house's Matter fabric; no Matter when not given.
   *
   * Injected like the transports: a test runs the hub without a fabric, and the one deployment
   * that holds one says so in `main`.
   */
  readonly matter?: OpenMatterFabric;
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

/**
 * What a reply about a vendor says of the copy that runs.
 *
 * @param vendor - The copy, or undefined for none.
 * @returns Whether one runs, its version and where it was read from.
 */
function replyOf(
  vendor: LoadedVendor | undefined,
): Pick<VendorLoadReply, 'isLoaded' | 'version' | 'origin'> {
  return {
    isLoaded: vendor !== undefined,
    version: vendor?.manifest.version ?? null,
    origin: vendor?.origin ?? null,
  };
}

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
  readonly #accounts: AccountService;
  readonly #images: ImageStore;
  readonly #vendorContainers: VendorContainersService;
  readonly #packages: PackageWatch;
  readonly #matter: MatterBroker;
  readonly #mqtt: MqttBroker;
  readonly #modbus: ModbusBroker;
  readonly #serial: SerialBroker;
  readonly #bluetooth: BluetoothBroker;
  readonly #infrared: InfraredBroker;
  readonly #thread: ThreadBroker;

  /** Every Modbus socket of the hub: the polls', the tests', the search's and the vendors'. */
  readonly #modbusPool = new ModbusPool();
  readonly #secretsKey: Buffer;

  /** The stream sources the vendors ship, by id: `bambulab/camera`. */
  readonly #streams = new Map<string, StreamSource>();
  readonly #cameras: CameraService;

  /** The vendor of each instance forgotten and not yet removed by `core`, by instance id. */
  readonly #forgotten = new Map<string, string>();
  #management: { unsubscribe: () => void }[] = [];
  #discovery: DiscoveryService | undefined;

  /** What the platform runs that bundle code may use: its broker, as it stands when asked. */
  readonly #platform: PlatformServices;

  /** What could not be loaded, by vendor: what its page says, and a list of vendors cannot. */
  readonly #failures = new Map<string, readonly BundleFailure[]>();

  /** Vendors swapped while `hub` runs, one after another, the start's loading first. */
  #swaps: Promise<unknown> = Promise.resolve();

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

    this.#mqtt = new MqttBroker({
      storageDir: resolveDataLayout(options.config).mqtt,
      port: options.config.HUB_MQTT_PORT,
      logger: options.logger,
    });
    this.#transports.register(createMqttHouseTransport(this.#mqtt));

    this.#modbus = new ModbusBroker({
      store: databaseModbusStore(options.db),
      pool: this.#modbusPool,
      logger: options.logger,

      /**
       * Every vendor loaded: their `modbus` rules, and the templates their drivers ship.
       *
       * @returns Them.
       */
      vendors: () => this.#vendorList(),

      /**
       * The addresses the house's devices reach, which a search never knocks on: a server a
       * vendor's own code polls may take one client at a time.
       *
       * @returns Them.
       */
      takenHosts: async () =>
        new Set(
          [...(await loadTakenDevices(options.db)).hosts].map((key) =>
            key.slice(key.indexOf('\n') + 1),
          ),
        ),
    });
    this.#transports.register(createModbusTransport(this.#modbus, this.#modbusPool));
    this.#modbus.onSaved((deviceKeys) => {
      void this.#reloadModbus(deviceKeys);
    });

    this.#serial = new SerialBroker({
      store: databaseSerialStore(options.db),
      host: createLinuxSerialHost(),
      logger: options.logger,

      /**
       * Every vendor loaded: their `serial` rules.
       *
       * @returns Them.
       */
      vendors: () => this.#vendorList(),

      /**
       * Reads the devices whose config names a port.
       *
       * @returns Them.
       */
      instances: async () => loadSerialInstances(options.db),

      /**
       * Reads the devices the managed containers are given.
       *
       * @returns Them.
       */
      containerPorts: async () => this.#vendorContainers.devices(),

      /**
       * Asks the supervisor whether Docker runs in Docker Desktop, which passes no USB.
       *
       * @returns True when it says so.
       */
      isDesktop: async () =>
        (
          await this.#client.request(
            busSubjects.service(SUPERVISOR_SERVICE, SUPERVISOR_METHODS.status),
            {},
            dockerStatusSchema,
            { timeoutMs: 5000 },
          )
        ).isDesktop === true,
    });
    this.#bluetooth = new BluetoothBroker({
      store: databaseBluetoothStore(options.db),
      host: createBluezHost(),
      logger: options.logger,

      /**
       * Every vendor loaded: their `bluetooth` rules, and the profiles that declare proxies.
       *
       * @returns Them.
       */
      vendors: () => this.#vendorList(),

      /**
       * Reads the instances of the house.
       *
       * @returns Them.
       */
      instances: async () => loadBluetoothInstances(options.db),
      roles: {
        /**
         * Sends an op to a device over its instance's connection, as a command would go.
         *
         * @param deviceId - The device.
         * @param op - The op.
         * @param args - Its arguments.
         * @param timeoutMs - How long it may take.
         * @returns What the device answered.
         */
        send: async (deviceId, op, args, timeoutMs) =>
          this.#sendRole(deviceId, op, args, timeoutMs),

        /**
         * Finds the device a scanner names.
         *
         * @param connectionKey - Its connection.
         * @param deviceKey - The device, as that connection names it.
         * @returns Its instance, when one running is it.
         */
        deviceOf: (connectionKey, deviceKey) =>
          [...this.#running.values()].find(
            (running) =>
              running.connection.key === connectionKey &&
              running.book.claims().some((claim) => claim.deviceKey === deviceKey),
          )?.instance.id,
      },

      /**
       * Asks the supervisor whether Docker runs in Docker Desktop, which passes no D-Bus.
       *
       * @returns True when it says so.
       */
      isDesktop: async () =>
        (
          await this.#client.request(
            busSubjects.service(SUPERVISOR_SERVICE, SUPERVISOR_METHODS.status),
            {},
            dockerStatusSchema,
            { timeoutMs: 5000 },
          )
        ).isDesktop === true,
    });
    this.#transports.register(createBluetoothTransport(this.#bluetooth));

    this.#infrared = new InfraredBroker({
      store: databaseInfraredStore(options.db),
      logger: options.logger,

      /**
       * Every vendor loaded: the profiles that declare blasters.
       *
       * @returns Them.
       */
      vendors: () => this.#vendorList(),

      /**
       * Reads the instances of the house: the blasters, and the remotes' devices.
       *
       * @returns Them.
       */
      instances: async () => loadBluetoothInstances(options.db),
      roles: {
        /**
         * Sends an op to a blaster over its instance's connection, as a command would go.
         *
         * @param deviceId - The blaster.
         * @param op - The op.
         * @param args - Its arguments.
         * @param timeoutMs - How long it may take.
         * @returns What the blaster answered.
         */
        send: async (deviceId, op, args, timeoutMs) =>
          this.#sendRole(deviceId, op, args, timeoutMs),
      },
    });
    this.#transports.register(createInfraredTransport(this.#infrared));
    this.#infrared.onSaved((deviceIds) => {
      void this.#reloadAll(deviceIds, 'its remote changed');
    });

    this.#thread = new ThreadBroker({
      store: databaseThreadStore(options.db),
      host: createLinuxThreadHost({ configDir: resolveDataLayout(options.config).thread }),
      serial: this.#serial,
      supervisor: {
        /**
         * Asks the supervisor how the platform runs: its network, and Docker Desktop.
         *
         * @returns What it says.
         */
        status: async () =>
          this.#client.request(
            busSubjects.service(SUPERVISOR_SERVICE, SUPERVISOR_METHODS.status),
            {},
            dockerStatusSchema,
            { timeoutMs: 5000 },
          ),

        /**
         * Has the supervisor start, stop or restart the border router.
         *
         * @param action - Which.
         * @returns Once done; a stop once the service is down.
         */
        service: async (action) => {
          await this.#client.request(
            busSubjects.service(SUPERVISOR_SERVICE, SUPERVISOR_METHODS.platformService),
            { service: 'otbr', action },
            supervisorAcknowledgementSchema,
            // The supervisor waits up to 20 s for the service to go down.
            { timeoutMs: 30_000 },
          );
        },
      },
      mdns: createMdnsSource({ logger: options.logger }),
      logger: options.logger,

      /**
       * The Matter fabric's network: its Thread nodes, their roles and links.
       *
       * @returns It.
       */
      matterNetwork: () => this.#matter.network(),

      /**
       * Reads the instances of the house: the Matter devices among them.
       *
       * @returns Them.
       */
      instances: async () => loadBluetoothInstances(options.db),

      /** Opens the Matter controller again with Thread's diagnostics, or without. */
      onChange: () => {
        void this.#matter.refresh();
      },
    });

    this.#matter = new MatterBroker({
      open: options.config.HUB_MATTER_ENABLED ? options.matter : undefined,
      storageDir: resolveDataLayout(options.config).matter,
      logger: options.logger,
      version: options.config.NEBULA_PLATFORM_VERSION,
      isLanReachable: options.config.HUB_DISCOVERY_ENABLED,

      /**
       * Reads which Matter devices the house has.
       *
       * @returns Their external ids.
       */
      inHouse: async () => new Set((await loadTakenDevices(options.db)).matter.keys()),
      bluetooth: this.#bluetooth,
      networks: databaseMatterNetworksStore(options.db, this.#secretsKey),
      thread: {
        /**
         * Whether Thread is set up.
         *
         * @returns True with a border router.
         */
        isSetUp: () => this.#thread.isSetUp(),

        /**
         * The dataset a new Thread device is given.
         *
         * @returns The TLV hex, or null.
         */
        dataset: async () => this.#thread.matterDataset(),

        /**
         * The network Matter's Settings show.
         *
         * @returns Its name and channel, or null.
         */
        network: async () => this.#thread.matterNetwork(),
      },
    });
    this.#transports.register(createMatterTransport(this.#matter));

    this.#serial.onPlugged((port) => {
      // A device's port came back: started again, its code opens it again.
      if (port.holderIntegrationId !== null) {
        void this.reloadInstance(port.holderIntegrationId).catch((error: unknown) => {
          options.logger.warn({ err: error, portId: port.id }, 'Could not start a device again');
        });
      }
    });

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

      /**
       * Finds the account a connection is for.
       *
       * @param vendorId - The transport's vendor.
       * @param accountId - The account its configuration names.
       * @returns The account, or undefined.
       */
      accountOf: async (vendorId: string, accountId: string) =>
        this.#accounts.handleFor(vendorId, accountId),

      /**
       * Marks the entities reached over a connection that dropped as unreachable.
       *
       * Only the drop is acted on. When the connection comes back the devices say for themselves
       * that they are there - the transport reads them again, a broker hands its retained
       * messages back - and saying it for them would call a device reachable that is not.
       *
       * @param key - The connection.
       * @param status - Whether it is up or down.
       */
      onStatus: (key: string, status: TransportStatus): void => {
        if (status === 'down') {
          this.#connectionDropped(key);
        }
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
      vendors: (): readonly LoadedVendor[] => this.#vendorList(),

      /**
       * Lists what discovery proposes; nothing before it has started.
       *
       * @returns Every device heard and not yet added.
       */
      discovered: () => this.#discovery?.list() ?? [],

      /**
       * Sets found devices aside, or brings them back; nothing before discovery has started.
       *
       * @param ids - Which.
       * @param isDismissed - Which way.
       * @returns How many discovery still had.
       */
      dismiss: (ids, isDismissed) => this.#discovery?.dismiss(ids, isDismissed) ?? 0,

      /**
       * Says how a vendor's devices are being heard; nothing before discovery has started.
       *
       * @param vendorId - The vendor.
       * @returns What its listener says, and the devices heard and not added.
       */
      hearing: (vendorId: string) =>
        this.#discovery?.hearingOf(vendorId) ?? { listener: null, passedOver: [] },

      /**
       * Says what a vendor waits for.
       *
       * @param vendorId - The vendor.
       * @returns The packages it needs that do not run, in sentences.
       */
      packageProblems: (vendorId: string) => this.#packages.problemsOf(vendorId),

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
      vendorChanged: async (vendorId: string): Promise<boolean> => {
        const isLoaded = await this.#vendorContainers.vendorChanged(vendorId);

        // A container's settings name the port it is given.
        await this.#serial.refresh();

        return isLoaded;
      },

      /**
       * Says what could not be loaded.
       *
       * @returns Every failure, each with its vendor.
       */
      failures: (): BundleFailureView[] => this.#failureViews(),

      /**
       * Makes the vendor that runs match the data directory.
       *
       * @param request - Which vendor, and which build.
       * @returns What runs of it now.
       */
      vendorLoad: async (request: VendorLoadRequest): Promise<VendorLoadReply> =>
        this.loadVendor(request),
    });

    this.#images = new ImageStore({ logger: options.logger });

    this.#accounts = new AccountService({
      client: this.#client,
      store: databaseAccountStore(options.db, this.#secretsKey),
      logger: options.logger,
      secretsKey: this.#secretsKey,

      /**
       * Lists the vendors loaded.
       *
       * @returns Every loaded vendor.
       */
      vendors: (): readonly LoadedVendor[] => this.#vendorList(),

      /**
       * Starts a vendor's instances again, and has its listener look now, once an account of it
       * signed in or out.
       *
       * @param vendorId - The vendor.
       * @returns Once they are started again.
       */
      onSignedInOrOut: async (vendorId: string): Promise<void> =>
        this.#restartVendor(vendorId, 'an account of it signed in or out'),
    });

    const external = platformMqttOf(options.config);
    const mqtt = this.#mqtt;

    this.#platform = {
      /**
       * The house's broker as the bundles reach it: the one the environment names, or the hub's
       * own with the hub's username - given while it is still coming up, as a session retries.
       *
       * @returns It, or null while the hub's own has no username yet.
       */
      get mqtt() {
        return external ?? mqtt.hubConnection();
      },
    };
    this.#packages = new PackageWatch({
      client: this.#client,
      logger: options.logger,
      platformVersion: options.config.NEBULA_PLATFORM_VERSION,

      /**
       * Starts the instances of the vendors whose packages started or stopped again: they can
       * connect now, or say which package they wait for.
       *
       * @param vendorIds - The vendors whose standing changed.
       */
      onChange: (vendorIds: readonly string[]): void => {
        void (async () => {
          for (const vendorId of vendorIds) {
            // One vendor after another: the order they were told in.
            // eslint-disable-next-line no-await-in-loop -- see above
            await this.#restartVendor(vendorId, 'a package it needs started or stopped');
          }
        })();
      },
    });
    this.#vendorContainers = new VendorContainersService({
      client: this.#client,
      logger: options.logger,

      /**
       * Lists the vendors loaded.
       *
       * @returns Every loaded vendor.
       */
      vendors: (): readonly LoadedVendor[] => this.#vendorList(),

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
    let discovering: Promise<void> = Promise.resolve();

    // Held until discovery is built: a vendor installed meanwhile is swapped in after, rather than
    // into a hub half started.
    await this.#serialised(async () => {
      // No broker throws: one that cannot start says why on the Brokers page.
      await this.#mqtt.start();

      const bundles = await this.#loadAll();

      for (const failure of bundles.failures) {
        logger.error({ directory: failure.directory }, failure.message);
      }

      for (const vendor of bundles.vendors) {
        this.#registerVendor(vendor);
      }

      // The platform's own, after the bundles: no bundle may call itself `matter`, `mqtt`,
      // `modbus` or `bluetooth`.
      this.#registerVendor(platformMatterVendor(config.NEBULA_PLATFORM_VERSION, RUNTIME_VERSION));
      this.#registerVendor(platformMqttVendor(config.NEBULA_PLATFORM_VERSION, RUNTIME_VERSION));
      this.#registerVendor(platformModbusVendor(config.NEBULA_PLATFORM_VERSION, RUNTIME_VERSION));
      this.#registerVendor(
        platformBluetoothVendor(config.NEBULA_PLATFORM_VERSION, RUNTIME_VERSION),
      );
      this.#registerVendor(platformInfraredVendor(config.NEBULA_PLATFORM_VERSION, RUNTIME_VERSION));

      // After the vendors: a device read through an integration's template needs its driver.
      await this.#modbus.start();
      // Before the instances: a device claims its port as it starts.
      await this.#serial.start();
      // After the vendors: what is heard is recognised by their rules, proxies by their profiles.
      await this.#bluetooth.start();
      await this.#thread.start();
      // After Bluetooth and Thread: the controller opens with what they offer it - pairing over
      // the server's adapter, the border routers to look for - rather than open twice.
      await this.#matter.start();
      // After the vendors: blasters are the devices whose profiles declare one.
      await this.#infrared.start();

      this.#recordFailures(bundles.failures);
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

      this.#management = [
        ...this.#managementService.serve(),
        ...this.#accounts.serve(),
        this.#images.serve(this.#client),
        ...this.#cameras.serve(),
        ...serveMatter({
          client: this.#client,
          broker: this.#matter,

          /**
           * Discovery, once it has started.
           *
           * @returns It, or undefined.
           */
          discovery: () => this.#discovery,

          /**
           * Reads what is added.
           *
           * @returns Every instance's ids, the Matter devices among them.
           */
          taken: async () => loadTakenDevices(db),
        }),
        ...serveModbus({
          client: this.#client,
          broker: this.#modbus,

          /**
           * Reads what is added.
           *
           * @returns Every instance's ids, the Modbus devices among them.
           */
          taken: async () => loadTakenDevices(db),
        }),
        ...serveSerial(this.#client, this.#serial),
        ...serveBluetooth(this.#client, this.#bluetooth),
        ...serveInfrared(this.#client, this.#infrared),
        ...serveThread(this.#client, this.#thread),
        ...serveMqtt({
          client: this.#client,
          broker: this.#mqtt,

          /**
           * Discovery, once it has started.
           *
           * @returns It, or undefined.
           */
          discovery: () => this.#discovery,

          /**
           * Reads what is added.
           *
           * @returns Every instance's ids, the MQTT devices among them.
           */
          taken: async () => loadTakenDevices(db),
        }),
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

      // Not awaited: a supervisor that is not up yet is asked again every minute, and nothing
      // here waits on the containers - an instance whose container is still being pulled simply
      // fails to connect until it runs, as it would against any device that is not up. After the
      // methods above, which the supervisor asks a container's broker username of.
      void this.#vendorContainers.reconcile();

      // Before the instances: a vendor that waits for a package is not started against it.
      await this.#packages.start(this.#watchedVendors());

      this.#discovery = this.#createDiscovery();
      // Off the house's network - a container on a bridge - only a vendor that listens on a
      // broker can hear its devices, and it still does.
      discovering = this.#discovery.start({ lan: config.HUB_DISCOVERY_ENABLED });
    });

    const instances = await loadInstances(db);

    // Started in parallel: one instance waiting on a broker that is not answering must not hold
    // up the others, and there is no ordering between them to preserve. Discovery starts beside
    // them rather than after: it reads what is added from the registry, not from the instances,
    // and a house with one unreachable device would otherwise find nothing new until that one
    // had given up.
    await Promise.all([
      ...instances.map(async (instance) => this.#startInstance(instance)),
      discovering,
    ]);
  }

  /**
   * What the loader is asked for one directory of vendors.
   *
   * @param directory - The directory.
   * @param origin - Which of the two places it is.
   * @returns The options.
   */
  #bundleOptions(directory: string, origin: BundleOrigin): LoadBundlesOptions {
    return {
      directory,
      origin,
      runtimeVersion: RUNTIME_VERSION,
      logger: this.#options.logger,
      platform: this.#platform,
      modbus: this.#modbusPool,
      serial: this.#serial,
      bluetooth: this.#bluetooth,
    };
  }

  /**
   * Reads every vendor: the data directory always, and outside production the directories under
   * development, which stand in for the integrations index - the later directory winning, and an
   * installed vendor over all of them.
   *
   * @returns The vendors, and what did not load.
   */
  async #loadAll(): Promise<LoadBundlesResult> {
    const { config, logger } = this.#options;
    const none: LoadBundlesResult = { vendors: [], loaded: [], failures: [] };
    const [installed, development] = await Promise.all([
      loadBundles(this.#bundleOptions(resolveDataLayout(config).integrations, 'installed')),
      Promise.all(
        developmentBundleDirectories(config).map(async (directory) =>
          loadBundles(this.#bundleOptions(directory, 'development')),
        ),
      ),
    ]);
    const underDevelopment = development.reduce<LoadBundlesResult>(
      (merged, next) => mergeBundleResults(merged, next, logger),
      none,
    );

    return mergeBundleResults(underDevelopment, installed, logger);
  }

  /**
   * Makes a vendor's transports, stream sources and drivers available to run.
   *
   * @param vendor - The vendor.
   */
  #registerVendor(vendor: LoadedVendor): void {
    this.#vendors.set(vendor.manifest.id, vendor);

    // A vendor's own transports first: its drivers name them, and a driver is only as loadable
    // as the transport it opens.
    for (const transport of vendor.ownTransports) {
      this.#transports.register(
        withAccountLookups(transport, async (vendorId, accountId) =>
          this.#accounts.handleFor(vendorId, accountId),
        ),
      );
    }

    for (const source of vendor.streams) {
      this.#streams.set(source.id, source);
    }

    for (const driver of vendor.drivers) {
      this.#integrations.register(driver.integration);
    }
  }

  /**
   * Takes a vendor's transports, stream sources and drivers out, so another copy can go in.
   *
   * @param vendor - The vendor.
   */
  #unregisterVendor(vendor: LoadedVendor): void {
    for (const transport of vendor.ownTransports) {
      this.#transports.unregister(transport.id);
    }

    for (const source of vendor.streams) {
      this.#streams.delete(source.id);
    }

    for (const driver of vendor.drivers) {
      this.#integrations.unregister(driver.integration.id);
    }

    this.#vendors.delete(vendor.manifest.id);
  }

  /**
   * Keeps what did not load, by vendor, in place of what was kept for the same vendors.
   *
   * @param failures - The failures.
   * @param vendorIds - The vendors read again, whose old failures go; every vendor when absent.
   */
  #recordFailures(failures: readonly BundleFailure[], vendorIds?: readonly string[]): void {
    if (vendorIds === undefined) {
      this.#failures.clear();
    } else {
      for (const vendorId of vendorIds) {
        this.#failures.delete(vendorId);
      }
    }

    for (const failure of failures) {
      const vendorId = failure.vendorId ?? '';

      this.#failures.set(vendorId, [...(this.#failures.get(vendorId) ?? []), failure]);
    }
  }

  /**
   * What did not load, as the catalogue serves it: each path relative to the directory of
   * vendors it is in, which says nothing of the server's disk.
   *
   * @returns The failures.
   */
  #failureViews(): BundleFailureView[] {
    const { config } = this.#options;
    const roots = [resolveDataLayout(config).integrations, ...developmentBundleDirectories(config)];

    return [...this.#failures.values()].flat().map((failure) => {
      const relative = roots
        .map((root) => path.relative(root, failure.directory))
        .find((candidate) => !candidate.startsWith('..') && !path.isAbsolute(candidate));

      return {
        vendorId: failure.vendorId ?? null,
        path: (relative ?? path.basename(failure.directory)).split(path.sep).join('/'),
        message: failure.message.slice(0, 2048),
      };
    });
  }

  /**
   * The vendors loaded, with what each needs, as the package watch follows them.
   *
   * @returns The vendors.
   */
  #watchedVendors(): WatchedVendor[] {
    return [...this.#vendors.values()].map((vendor) => ({
      id: vendor.manifest.id,
      name: vendor.manifest.name,
      requires: vendor.manifest.requires,
    }));
  }

  /**
   * Runs one swap after the ones before it have finished.
   *
   * @param task - The swap.
   * @returns What it returns.
   */
  async #serialised<TResult>(task: () => Promise<TResult>): Promise<TResult> {
    const run = this.#swaps.then(task, task);

    this.#swaps = run.catch(() => undefined);

    return run;
  }

  /**
   * Makes the vendor `hub` runs match the data directory: what the packet-manager asks once it has
   * unpacked a build of a vendor, or removed one.
   *
   * The build asked for is loaded beside the copy that runs, which keeps running meanwhile; a
   * build that does not load replaces nothing, and the reply says why. One that loads is swapped
   * in: the vendor's instances, its discovery and its camera streams stop, the old copy lets go
   * of what its code opened, the new one goes in, and its instances start again in the
   * background - the reply does not wait on devices that may not answer. A vendor whose folder is
   * gone is let go of; a copy under development it stood in for comes back when `hub` restarts,
   * its code being loaded already.
   *
   * @param request - Which vendor, and the build unpacked when it is not marked current yet.
   * @returns What runs of the vendor now.
   */
  public async loadVendor(request: VendorLoadRequest): Promise<VendorLoadReply> {
    return this.#serialised(async () => this.#loadVendor(request));
  }

  /**
   * See {@link loadVendor}.
   *
   * @param request - Which vendor, and which build.
   * @returns What runs of the vendor now.
   */
  async #loadVendor(request: VendorLoadRequest): Promise<VendorLoadReply> {
    const { config, logger } = this.#options;
    const { vendorId } = request;
    const found = await loadVendor(
      this.#bundleOptions(resolveDataLayout(config).integrations, 'installed'),
      vendorId,
      request.install,
    );
    const current = this.#vendors.get(vendorId);

    if (found === null) {
      this.#recordFailures([], [vendorId]);

      if (current?.origin !== 'installed') {
        return { ...replyOf(current), failures: [], isRestartNeeded: false };
      }

      await this.#swapVendor(vendorId, null);
      logger.info({ vendorId }, 'An installed integration was let go of');

      return {
        ...replyOf(undefined),
        failures: [],
        isRestartNeeded: await this.#hasDevelopmentCopy(vendorId),
      };
    }

    if (found.vendor === null) {
      // It did not load: what ran before runs on. A build only tried is not recorded, since the
      // packet-manager takes it away; the folder as it stands is.
      for (const failure of found.failures) {
        logger.warn({ vendorId, directory: failure.directory }, failure.message);
      }

      if (request.install === undefined) {
        this.#recordFailures(found.failures, [vendorId]);
      }

      return {
        ...replyOf(current),
        failures: found.failures.map((failure) => failure.message.slice(0, 2048)),
        isRestartNeeded: false,
      };
    }

    const loaded = found.vendor;
    // From the swap until every instance runs again its entities say so, and commands to them
    // wait in core instead of failing.
    const updating = (await loadInstances(this.#options.db))
      .filter((instance) => instance.kind.startsWith(`${vendorId}/`))
      .map((instance) => instance.id);

    this.#announceUpdate(updating, 'start');

    try {
      await this.#swapVendor(vendorId, loaded);
    } catch (error: unknown) {
      this.#announceUpdate(updating, 'end');
      throw error;
    }

    this.#recordFailures(found.failures, [vendorId]);
    logger.info(
      { vendorId, version: loaded.manifest.version, build: request.install?.build },
      'An installed integration was loaded',
    );

    // Not awaited: an instance waits on its device, and the packet-manager on this reply.
    void this.#restartVendor(vendorId, 'its bundle was installed')
      .catch((error: unknown) => {
        logger.warn({ err: error, vendorId }, 'Could not start a vendor again');
      })
      .finally(() => {
        this.#announceUpdate(updating, 'end');
      });

    return {
      ...replyOf(loaded),
      failures: found.failures.map((failure) => failure.message.slice(0, 2048)),
      isRestartNeeded: false,
    };
  }

  /**
   * Says a vendor's instances start or stop being updated (`nebula.v1.event.update`).
   *
   * @param instanceIds - The instances, which are the sources core routes their commands by.
   * @param phase - Which.
   */
  #announceUpdate(instanceIds: readonly string[], phase: 'start' | 'end'): void {
    if (instanceIds.length > 0) {
      this.#client.publish(busSubjects.updateEvent(), { sources: [...instanceIds], phase });
    }
  }

  /**
   * Swaps the copy of a vendor that runs for another, or for none.
   *
   * @param vendorId - The vendor.
   * @param next - The copy to run, loaded; null to run none.
   * @returns Once the new copy is registered and discovery listens again.
   */
  async #swapVendor(vendorId: string, next: LoadedVendor | null): Promise<void> {
    const { config, db, logger } = this.#options;
    const current = this.#vendors.get(vendorId);

    // First, while the old copy's sockets are still open: discovery listens with them.
    await this.#discovery?.stop();

    if (current !== undefined) {
      const instances = (await loadInstances(db)).filter((instance) =>
        instance.kind.startsWith(`${vendorId}/`),
      );

      // One after another: they may share one connection.
      for (const instance of instances) {
        // eslint-disable-next-line no-await-in-loop -- see above
        await this.#stopInstance(instance.id);
      }

      this.#cameras.endVendor(vendorId);
      this.#accounts.forgetFlowsOf(vendorId);
      this.#unregisterVendor(current);
      await current.release().catch((error: unknown) => {
        logger.warn({ err: error, vendorId }, 'Could not release a replaced vendor');
      });
    }

    if (next !== null) {
      this.#registerVendor(next);
    }

    this.#discovery = this.#createDiscovery();
    void this.#discovery.start({ lan: config.HUB_DISCOVERY_ENABLED }).catch((error: unknown) => {
      logger.warn({ err: error }, 'Discovery did not start again');
    });
    await this.#packages.setVendors(this.#watchedVendors());
    void this.#vendorContainers.reconcile();

    // What an integration added or removed recognises the servers found differently. A port's
    // suggestions are matched when asked; the containers a vendor declares may hold ports.
    void this.#modbus.reidentify().catch((error: unknown) => {
      logger.warn({ err: error }, 'Could not ask the Modbus servers found again');
    });
    void this.#serial.refresh();
    this.#bluetooth.reidentify();
    // A blaster comes and goes with its integration's profile.
    void this.#infrared.refresh();
  }

  /**
   * Whether a directory under development holds a vendor.
   *
   * @param vendorId - The vendor.
   * @returns True when one does.
   */
  async #hasDevelopmentCopy(vendorId: string): Promise<boolean> {
    const found = await Promise.all(
      developmentBundleDirectories(this.#options.config).map(async (directory) => {
        const result = await findVendorFolder(directory, vendorId).catch(() => null);

        return result !== null;
      }),
    );

    return found.includes(true);
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
    const platformMatter = this.#vendors.get(MATTER_VENDOR);
    const platformMqtt = this.#vendors.get(MQTT_VENDOR);
    const platformModbus = this.#vendors.get(MODBUS_VENDOR);
    const platformBluetooth = this.#vendors.get(BLUETOOTH_VENDOR);
    const platformInfrared = this.#vendors.get(INFRARED_VENDOR);

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
       * Reads a vendor's accounts signed in to.
       *
       * @param vendorId - The vendor.
       * @returns The accounts.
       */
      vendorAccounts: async (vendorId: string) => this.#accounts.handlesOf(vendorId),

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
      ...(platformMatter?.discovery === undefined
        ? {}
        : {
            matter: {
              /**
               * Lists the fabric's devices not removed from the house.
               *
               * @returns Them.
               */
              devices: () => this.#matter.devices(),

              /**
               * Follows the nodes coming and going.
               *
               * @param listener - Called when they change.
               * @returns What stops following.
               */
              onChange: (listener: () => void) => this.#matter.onNodes(listener),
              vendor: { id: MATTER_VENDOR, discovery: platformMatter.discovery },
            },
          }),
      ...(platformMqtt?.discovery === undefined
        ? {}
        : {
            mqtt: {
              /**
               * Lists the devices the broker hears, not removed from the house.
               *
               * @returns Them.
               */
              devices: () => this.#mqtt.devices(),

              /**
               * Follows the devices coming, going and changing.
               *
               * @param listener - Called when they change.
               * @returns What stops following.
               */
              onChange: (listener: () => void) => this.#mqtt.onDevices(listener),
              vendor: { id: MQTT_VENDOR, discovery: platformMqtt.discovery },
            },
          }),
      ...(platformModbus?.discovery === undefined
        ? {}
        : {
            modbus: {
              /**
               * Lists the devices the owner added whose template is there.
               *
               * @returns Them.
               */
              devices: () => this.#modbus.devices(),

              /**
               * Follows the devices being added, saved and removed.
               *
               * @param listener - Called when they change.
               * @returns What stops following.
               */
              onChange: (listener: () => void) => this.#modbus.onDevices(listener),
              vendor: { id: MODBUS_VENDOR, discovery: platformModbus.discovery },
            },
          }),
      ...(platformBluetooth?.discovery === undefined
        ? {}
        : {
            bluetooth: {
              /**
               * Lists the addresses the owner is adding.
               *
               * @returns Them, each as the driver it is added as.
               */
              devices: () => this.#bluetooth.sightings(),

              /**
               * Follows the addresses being added.
               *
               * @param listener - Called when they change.
               * @returns What stops following.
               */
              onChange: (listener: () => void) => this.#bluetooth.onDevices(listener),
              vendor: { id: BLUETOOTH_VENDOR, discovery: platformBluetooth.discovery },
            },
          }),
      ...(platformInfrared?.discovery === undefined
        ? {}
        : {
            infrared: {
              /**
               * Lists the remotes the owner made, each with its buttons.
               *
               * @returns Them.
               */
              devices: () => this.#infrared.devices(),

              /**
               * Follows the remotes being saved and removed.
               *
               * @param listener - Called when they change.
               * @returns What stops following.
               */
              onChange: (listener: () => void) => this.#infrared.onDevices(listener),
              vendor: { id: INFRARED_VENDOR, discovery: platformInfrared.discovery },
            },
          }),
    });
  }

  /**
   * Every vendor loaded, the platform's own among them.
   *
   * @returns Them, read when asked.
   */
  #vendorList(): readonly LoadedVendor[] {
    return [...this.#vendors.values()];
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
    this.#packages.stop();
    this.#cameras.stop();
    this.#images.stop();
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
    await this.#matter.stop();
    await this.#mqtt.stop();
    this.#modbus.stop();
    this.#modbusPool.closeAll();
    await this.#serial.stop();
    await this.#bluetooth.stop();
    this.#infrared.stop();
    await this.#thread.stop();

    // Whatever the vendors' own code holds - a UDP port - is let go of with them.
    await Promise.all([...this.#vendors.values()].map(async (vendor) => vendor.release()));
    await this.#client.drain();
  }

  /**
   * Sends one of the ops a device plays a broker's role with - a Bluetooth proxy's, an IR
   * blaster's - over its instance's connection, as a command would go.
   *
   * @param deviceId - The device.
   * @param op - The op.
   * @param args - Its arguments.
   * @param timeoutMs - How long it may take.
   * @returns What the device answered.
   * @throws {ConflictError} When the device is not running.
   */
  async #sendRole(
    deviceId: string,
    op: string,
    args: JsonObject,
    timeoutMs: number,
  ): Promise<unknown> {
    const running = this.#running.get(deviceId);
    const deviceKey = running?.book.claims()[0]?.deviceKey;

    if (running === undefined || deviceKey === undefined) {
      throw new ConflictError(`${deviceId} is not running`, { details: { deviceId } });
    }

    return running.connection.send({ deviceKey, op, args }, AbortSignal.timeout(timeoutMs));
  }

  /**
   * Starts some instances again, one after another, so they are identified anew.
   *
   * @param ids - The instances.
   * @param why - What changed, for the log.
   * @returns Once they started again; a failure is logged.
   */
  async #reloadAll(ids: readonly string[], why: string): Promise<void> {
    for (const id of ids) {
      try {
        // One after another: they share the one connection.
        // eslint-disable-next-line no-await-in-loop -- see above
        await this.reloadInstance(id);
      } catch (error: unknown) {
        this.#options.logger.warn(
          { err: error, instanceId: id, why },
          'Could not start a device again',
        );
      }
    }
  }

  /**
   * Starts again the instances of Modbus devices that were saved, or whose template was, so they
   * read the template as it is now.
   *
   * @param deviceKeys - The devices.
   * @returns Once they started again; a failure is logged.
   */
  async #reloadModbus(deviceKeys: readonly string[]): Promise<void> {
    try {
      const taken = await loadTakenDevices(this.#options.db);

      for (const deviceKey of deviceKeys) {
        const added = taken.modbus.get(deviceKey);

        if (added !== undefined) {
          // One after another: they share the one connection.
          // eslint-disable-next-line no-await-in-loop -- see above
          await this.reloadInstance(added.instanceId);
        }
      }
    } catch (error: unknown) {
      this.#options.logger.warn({ err: error }, 'Could not start the saved Modbus devices again');
    }
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
   * Starts every instance of a vendor again and has its listener look now: an account of it
   * signed in or out, or a package it needs started or stopped, so its devices can connect, or
   * cannot any more.
   *
   * @param vendorId - The vendor.
   * @param why - What changed, for the log.
   * @returns Once they are started again; a failure is in each instance's own status.
   */
  async #restartVendor(vendorId: string, why: string): Promise<void> {
    const instances = (await loadInstances(this.#options.db)).filter((instance) =>
      instance.kind.startsWith(`${vendorId}/`),
    );

    for (const instance of instances) {
      try {
        // One after another: they may share one connection.
        // eslint-disable-next-line no-await-in-loop -- see above
        await this.reloadInstance(instance.id);
      } catch (error: unknown) {
        this.#options.logger.warn(
          { err: error, instanceId: instance.id, why },
          'Could not start an instance again',
        );
      }
    }

    this.#discovery?.rescan(vendorId);
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

    const instance = this.#running.get(id)?.instance ?? (await loadInstance(this.#options.db, id));

    await this.#stopInstance(id);

    if (instance?.transport === MATTER_TRANSPORT || instance?.transport === MQTT_HOUSE_TRANSPORT) {
      const deviceKey = await loadExternalId(this.#options.db, id);

      if (deviceKey !== null && instance.transport === MATTER_TRANSPORT) {
        await this.#matter.release(deviceKey);
      } else if (deviceKey !== null) {
        this.#mqtt.release(deviceKey);
      }
    }

    if (instance?.transport === MODBUS_TRANSPORT || instance?.transport === INFRARED_TRANSPORT) {
      const deviceKey = await loadExternalId(this.#options.db, id);

      // Its row goes, or discovery would add the device straight back.
      if (deviceKey !== null && instance.transport === MODBUS_TRANSPORT) {
        await this.#modbus.release(deviceKey);
      } else if (deviceKey !== null) {
        await this.#infrared.release(deviceKey);
      }
    }

    // Its port goes free: the database frees it with the instance's row, the broker's copy here.
    await this.#serial.releaseInstance(id);
    // A proxy's row goes with the instance's; the broker's copy here.
    this.#bluetooth.releaseInstance(id);
    // A blaster's remotes let go of it with the instance's row; the broker's copy here.
    this.#infrared.releaseInstance(id);

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
    // Its code closes its port with the connection; a port it left open is closed here.
    await this.#serial.stopped(id);

    const sharing = [...this.#running.values()].find(
      (other) => other.connection.key === running.connection.key,
    );

    if (sharing !== undefined) {
      await this.#applySubscriptions(sharing.instance.id);
    }

    await recordStatus(this.#options.db, id, 'stopped');
    // A blaster stopped: its remotes' buttons cannot be sent.
    void this.#infrared.refresh();
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
      const serial = serialDeviceConfigSchema.safeParse(instance.transportConfig['serial']);

      // A device on a serial port holds it before its code opens it; one held by another stays
      // with it, and the device's code is refused it (the page shows the two as a conflict).
      if (serial.success) {
        await this.#serial.claim(instance.id, serial.data);
      }

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

      // A Modbus device or a remote is identified again on every start, never bound from the kept
      // claim: the claim holds its template or its buttons, which the owner may have changed since.
      if (instance.transport === MODBUS_TRANSPORT || instance.transport === INFRARED_TRANSPORT) {
        await recordStatus(db, instance.id, 'identifying');
        this.#listen(this.#running.get(instance.id), await loadExternalId(db, instance.id));

        return;
      }

      // The device it identified last time, bound again from the claim that was kept for it.
      // After the instance is in `#running`, because applying the subscriptions reads it there.
      const restored = await loadBinding(db, instance.id, integration, instance.options);

      if (restored.status === 'bound') {
        book.bind(restored.binding);
        await this.#applySubscriptions(instance.id);
        await recordStatus(db, instance.id, 'running');
        // A blaster runs: its remotes' buttons can be sent.
        void this.#infrared.refresh();
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
      // A blaster that failed cannot send, whatever its row said before the hub started.
      void this.#infrared.refresh();
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
      // A blaster runs, or a remote is in the house: the Infrared broker reads them again.
      void this.#infrared.refresh();
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
      // A blaster that failed cannot send, whatever its row said before the hub started.
      void this.#infrared.refresh();
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

    const waits = this.#packages.problemsOf(vendorId);

    if (waits.length > 0) {
      throw new Error(waits.join('; '));
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
   * Says every entity reached over a connection that dropped is unreachable until it reports.
   *
   * @param key - The connection.
   */
  #connectionDropped(key: string): void {
    for (const running of this.#running.values()) {
      if (running.connection.key !== key) {
        continue;
      }

      const reports = running.book.withAvailability(false);

      if (reports.length > 0) {
        publishReports(running.client, reports);
      }
    }
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

      const reports = this.#images.take(
        running.book.ingest(running.integration, running.instance.options, message),
        (report) => {
          publishReports(running.client, [report]);
        },
      );

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
