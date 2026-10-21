/**
 * The house's MQTT broker, as the hub runs it: the server on port 1883, who may connect, what it
 * carries, and the devices that come of it.
 *
 * It starts with the hub - and the hub starts without it when it cannot, the Brokers page then
 * saying why. A port another program holds (the `mqtt` package of an older installation, another
 * broker) leaves it failed and trying again every few seconds, so that it takes the port the
 * moment it is let go.
 *
 * It hands the rest of the hub what it needs: the hub's own username for `sdk.platform.mqtt`, a
 * container's for the supervisor, every device it hears for discovery to propose - announced,
 * mapped by the owner, and the broker's own two readings - and each device's topics as they
 * change for the `mqtt-house` transport.
 *
 * **Removed is remembered.** A device the owner removes from the house is still heard - its
 * announcement is retained - so the broker remembers it as removed, and discovery does not add it
 * back on its own; the Brokers page offers it back.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  ConflictError,
  DeviceUnavailableError,
  MQTT_PLATFORM_PREFIX,
  type BrokerState,
  type MqttClientAddRequest,
  type MqttMapping,
  type MqttMappingInput,
  type MqttSettings,
  type MqttStatus,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';
import {
  mqttEntityOfMapping,
  readAnnouncement,
  type MqttAnnouncedDevice,
  type MqttDeviceSnapshot,
  type MqttEntity,
  type PlatformMqtt,
} from '@nebulahome/package-runtime';

import { clientAccess, FULL_ACCESS } from './acl.js';
import { MqttHouse } from './house.js';
import { PrincipalStore, type Principal } from './principals.js';
import { MqttServer, type Session } from './server.js';
import { MqttStore } from './store.js';
import { textOfPayload, TopicLog, type TopicEntry } from './topics.js';

/** How long a burst of announcements is let settle before discovery is told. */
const SETTLE_MS = 750;

/** How often the broker's own two readings are reported. */
const BROKER_REPORT_MS = 10_000;

/** How often a broker that could not listen tries again. */
const RETRY_MS = 10_000;

/** The file the usernames, the mappings, the removed devices and the settings are kept in. */
const STATE_FILE = 'state.sqlite';

/** The file aedes keeps its retained messages and sessions in. */
const PERSISTENCE_FILE = 'broker.sqlite';

/** Where the broker's two readings are kept, under `$SYS`: no client may publish there. */
const CLIENTS_TOPIC = '$SYS/nebulahome/clients';
const MESSAGES_TOPIC = '$SYS/nebulahome/messages';

/** The broker's own device. */
const BROKER_DEVICE: MqttAnnouncedDevice = {
  id: 'nebulahome-broker',
  name: 'MQTT broker',
  manufacturer: 'NebulaHome',
  model: 'aedes',
  identifiers: [],
  macAddresses: [],
};

/** The broker's two readings: the clients connected, and the messages a second. */
const BROKER_ENTITIES: readonly MqttEntity[] = [
  {
    key: 'broker:clients',
    origin: 'broker',
    component: 'sensor',
    name: 'MQTT clients online',
    objectId: 'clients',
    device: BROKER_DEVICE,
    config: { state_topic: CLIENTS_TOPIC, state_class: 'measurement' },
  },
  {
    key: 'broker:messages',
    origin: 'broker',
    component: 'sensor',
    name: 'MQTT messages per second',
    objectId: 'messages',
    device: BROKER_DEVICE,
    config: {
      state_topic: MESSAGES_TOPIC,
      state_class: 'measurement',
      unit_of_measurement: 'msg/s',
      suggested_display_precision: 1,
    },
  },
];

/** A device the broker hears, as discovery is told it. */
export type MqttSighting = {
  readonly deviceKey: string;
  readonly device: MqttDeviceSnapshot;
};

/** One username, as the page lists it, with its connections. */
export type MqttClient = Principal & { readonly sessions: readonly Session[] };

/** What the broker needs. */
export type MqttBrokerOptions = {
  /** Where the broker keeps its files. */
  readonly storageDir: string;

  /** The TCP port it listens on; 0 lets the system pick one, for a test. */
  readonly port: number;

  readonly logger: PlatformLogger;

  /** How often it tries again when it cannot listen; ten seconds when not said. */
  readonly retryMs?: number;
};

/**
 * Hears a device's topics change.
 *
 * @param deviceKey - The device.
 * @param changed - The topics that changed, or null for all of them.
 */
type DeviceListener = (deviceKey: string, changed: readonly string[] | null) => void;

/** The house's MQTT broker. */
export class MqttBroker {
  readonly #options: MqttBrokerOptions;
  readonly #topics = new TopicLog();
  readonly #house = new MqttHouse();
  readonly #deviceListeners = new Set<DeviceListener>();
  readonly #devicesListeners = new Set<() => void>();
  readonly #stateListeners = new Set<(state: BrokerState) => void>();
  #db: DatabaseSync | undefined;
  #principals: PrincipalStore | undefined;
  #store: MqttStore | undefined;
  #server: MqttServer | undefined;
  #settings: MqttSettings | undefined;
  #hub: { readonly username: string; readonly password: string } | undefined;
  #state: BrokerState = 'starting';
  #error: string | null = null;
  #port: number;
  #startedAt: Date | null = null;
  #removed = new Set<string>();
  #retry: NodeJS.Timeout | undefined;
  #reporting: NodeJS.Timeout | undefined;
  #settle: NodeJS.Timeout | undefined;
  #isStopped = false;

  /**
   * Keeps the options; nothing opens until {@link MqttBroker.start}.
   *
   * @param options - See {@link MqttBrokerOptions}.
   */
  public constructor(options: MqttBrokerOptions) {
    this.#options = options;
    this.#port = options.port;
    this.#house.onChange((deviceKey, changed) => {
      for (const listener of this.#deviceListeners) {
        listener(deviceKey, changed);
      }

      if (changed === null) {
        this.#settleDevices();
      }
    });
  }

  /**
   * Opens the broker's files and starts listening. A broker that cannot listen is left failed,
   * with why, trying again; the hub runs on.
   *
   * @returns Once it listens, or has failed for now.
   */
  public async start(): Promise<void> {
    const { storageDir, logger } = this.#options;

    try {
      await mkdir(storageDir, { recursive: true });

      const db = new DatabaseSync(path.join(storageDir, STATE_FILE));

      this.#db = db;
      this.#principals = new PrincipalStore(db);
      this.#store = new MqttStore(db);
      this.#settings = this.#store.settings();
      this.#removed = this.#store.removed();
      this.#hub = await this.#principals.platformCredentials(
        `${MQTT_PLATFORM_PREFIX}hub`,
        'hub',
        'The hub',
        FULL_ACCESS,
      );

      for (const entity of BROKER_ENTITIES) {
        this.#house.put(entity, undefined, () => undefined);
      }

      this.#readMappings();
    } catch (error: unknown) {
      this.#fail(error);
      logger.error({ err: error }, 'The MQTT broker could not open its files; MQTT is off');

      return;
    }

    await this.#listen();
    this.#reporting = setInterval(() => {
      this.#reportBroker();
    }, BROKER_REPORT_MS);
    this.#reporting.unref();
  }

  /**
   * Stops listening and closes the broker's files.
   *
   * @returns Once closed.
   */
  public async stop(): Promise<void> {
    this.#isStopped = true;
    clearTimeout(this.#retry);
    clearInterval(this.#reporting);
    clearTimeout(this.#settle);
    await this.#server?.stop();
    this.#server = undefined;
    this.#db?.close();
    this.#db = undefined;
  }

  /**
   * Where the broker stands.
   *
   * @returns Its state, its settings and what it makes of what it carries.
   */
  public status(): MqttStatus {
    const counts = this.#house.counts();

    return {
      state: this.#state,
      error: this.#error,
      port: this.#port,
      startedAt: this.#startedAt,
      settings: this.#currentSettings(),
      clientsOnline: this.#server?.sessions().length ?? 0,
      messagesPerSecond: this.#topics.rate(),
      discovery: { ...counts, skipped: this.#house.skipped().slice(-50) },
    };
  }

  /**
   * Follows how the broker stands.
   *
   * @param listener - Told each time it changes.
   * @returns What stops following.
   */
  public onState(listener: (state: BrokerState) => void): () => void {
    this.#stateListeners.add(listener);

    return () => {
      this.#stateListeners.delete(listener);
    };
  }

  /**
   * Whether the broker listens.
   *
   * @returns True while it does.
   */
  public get isRunning(): boolean {
    return this.#state === 'running';
  }

  /**
   * The broker as the hub reaches it: its own username, on the house's loopback. Given as soon as
   * the username is known, even while the broker cannot listen yet - a session opened on it
   * retries until it does.
   *
   * @returns It, or null while the broker has no files open.
   */
  public hubConnection(): PlatformMqtt | null {
    if (this.#hub === undefined || this.#port === 0) {
      return null;
    }

    return {
      url: `mqtt://127.0.0.1:${String(this.#port)}`,
      username: this.#hub.username,
      password: this.#hub.password,
    };
  }

  /**
   * A username of its own for a container the platform runs, made the first time.
   *
   * @param owner - Whose container: `vendor:zigbee2mqtt`, `package:nvr`.
   * @param topics - The topics it may use; every topic when not said.
   * @returns Its username and password, and the port.
   * @throws {ConflictError} While the broker does not listen: the container waits for it.
   */
  public async containerCredentials(
    owner: string,
    topics: readonly string[] | undefined,
  ): Promise<{ username: string; password: string; port: number }> {
    const principals = this.#principals;

    if (principals === undefined || this.#state !== 'running') {
      throw this.#notRunning();
    }

    const credentials = await principals.platformCredentials(
      `${MQTT_PLATFORM_PREFIX}${owner.replace(':', '-')}`,
      'container',
      `The ${owner.split(':')[1] ?? owner} container`,
      topics === undefined ? FULL_ACCESS : { publish: [...topics], subscribe: [...topics] },
    );

    return { ...credentials, port: this.#port };
  }

  /**
   * Every username, with its connections now, and the connections without one.
   *
   * @returns Them.
   */
  public clients(): { items: MqttClient[]; anonymous: Session[] } {
    const connected = this.#server?.sessions() ?? [];

    return {
      items: (this.#principals?.list() ?? []).map((principal) => ({
        ...principal,
        sessions: connected.filter((session) => session.username === principal.username),
      })),
      anonymous: connected.filter((session) => session.username === null),
    };
  }

  /**
   * Adds a client.
   *
   * @param request - Its username, label and reach.
   * @returns Its password, this once.
   * @throws {ConflictError} When the username is taken, or the broker has no files open.
   */
  public async addClient(request: MqttClientAddRequest): Promise<string> {
    const principals = this.#principals;

    if (principals === undefined) {
      throw this.#notRunning();
    }

    return principals.addClient(
      request.username,
      request.label === '' ? request.username : request.label,
      clientAccess(request.username, request.access, this.#currentSettings().discoveryPrefix),
    );
  }

  /**
   * Removes a client, and closes its connections now: it may not stay connected on the password
   * it no longer has.
   *
   * @param username - Its username.
   * @returns Whether there was one.
   */
  public removeClient(username: string): boolean {
    const isRemoved = this.#principals?.removeClient(username) ?? false;

    if (isRemoved) {
      this.#server?.disconnect(username);
    }

    return isRemoved;
  }

  /**
   * The last message of every topic under a prefix.
   *
   * @param prefix - Only those under it.
   * @param limit - At most this many.
   * @returns Them, the most recent first, and how many there are.
   */
  public topics(prefix: string, limit: number): { items: TopicEntry[]; total: number } {
    return this.#topics.list(prefix, limit);
  }

  /**
   * The owner's mappings.
   *
   * @returns Them, by name.
   */
  public mappings(): MqttMapping[] {
    return this.#store?.mappings() ?? [];
  }

  /**
   * Saves a mapping, new or changed, and hears it at once.
   *
   * @param input - What the page sent, checked.
   * @returns The mapping, with its id.
   * @throws {ConflictError} While the broker has no files open.
   */
  public saveMapping(input: MqttMappingInput): MqttMapping {
    const store = this.#store;

    if (store === undefined) {
      throw this.#notRunning();
    }

    const saved = store.saveMapping(input);

    this.#readMappings();

    return saved;
  }

  /**
   * Removes a mapping, and with it the device it made.
   *
   * @param id - Which.
   * @returns Whether there was one.
   */
  public removeMapping(id: string): boolean {
    const isRemoved = this.#store?.removeMapping(id) ?? false;

    this.#store?.setRemoved(`mapping-${id}`, false);
    this.#removed.delete(`mapping-${id}`);
    this.#readMappings();

    return isRemoved;
  }

  /**
   * Saves the owner's settings and starts listening again with them: what was announced under
   * another prefix is read again from what was retained.
   *
   * @param settings - Them, checked.
   * @returns Where the broker stands then.
   * @throws {ConflictError} While the broker has no files open.
   */
  public async saveSettings(settings: MqttSettings): Promise<MqttStatus> {
    const store = this.#store;

    if (store === undefined) {
      throw this.#notRunning();
    }

    store.saveSettings(settings);
    this.#settings = settings;
    this.#house.retain('discovery', new Set());
    clearTimeout(this.#retry);
    await this.#server?.stop();
    this.#server = undefined;
    await this.#listen();

    return this.status();
  }

  /**
   * Every device the broker hears that is not removed from the house.
   *
   * @returns Them, for discovery to propose.
   */
  public devices(): MqttSighting[] {
    return this.heard().flatMap((device) =>
      this.#removed.has(device.deviceKey) ? [] : [{ deviceKey: device.deviceKey, device }],
    );
  }

  /**
   * Every device the broker hears, removed from the house or not.
   *
   * @returns Them.
   */
  public heard(): MqttDeviceSnapshot[] {
    return this.#house.devices();
  }

  /**
   * One device the broker hears.
   *
   * @param deviceKey - Which.
   * @returns It, or undefined.
   */
  public device(deviceKey: string): MqttDeviceSnapshot | undefined {
    return this.#house.device(deviceKey);
  }

  /**
   * The last text of every topic a device reads.
   *
   * @param device - The device.
   * @returns Each topic that carried text.
   */
  public textsOf(device: MqttDeviceSnapshot): Record<string, string> {
    return this.#house.textsOf(device);
  }

  /**
   * Whether a device was removed from the house.
   *
   * @param deviceKey - The device.
   * @returns True when it was.
   */
  public isRemoved(deviceKey: string): boolean {
    return this.#removed.has(deviceKey);
  }

  /**
   * Remembers a device as removed from the house, so that it is not added back on its own.
   *
   * @param deviceKey - The device.
   */
  public release(deviceKey: string): void {
    this.#store?.setRemoved(deviceKey, true);
    this.#removed.add(deviceKey);
    this.#tellDevices();
  }

  /**
   * Brings back a device removed from the house that the broker still hears.
   *
   * @param deviceKey - The device.
   * @returns Whether it was removed, and is now offered again.
   */
  public restore(deviceKey: string): boolean {
    if (!this.#removed.has(deviceKey) || this.#house.device(deviceKey) === undefined) {
      return false;
    }

    this.#store?.setRemoved(deviceKey, false);
    this.#removed.delete(deviceKey);
    this.#tellDevices();

    return true;
  }

  /**
   * Follows the devices coming, going and changing what they are.
   *
   * @param listener - Told, once a burst of announcements has settled.
   * @returns What stops following.
   */
  public onDevices(listener: () => void): () => void {
    this.#devicesListeners.add(listener);

    return () => {
      this.#devicesListeners.delete(listener);
    };
  }

  /**
   * Follows each device's topics.
   *
   * @param listener - Told a device's topics changed, and which.
   * @returns What stops following.
   */
  public onDevice(listener: DeviceListener): () => void {
    this.#deviceListeners.add(listener);

    return () => {
      this.#deviceListeners.delete(listener);
    };
  }

  /**
   * Publishes messages as the broker: what a command says.
   *
   * @param messages - The topics and payloads, in order.
   * @returns Once they are on their way.
   * @throws {DeviceUnavailableError} While the broker does not listen.
   */
  public async publish(
    messages: readonly { readonly topic: string; readonly payload: string }[],
  ): Promise<void> {
    const server = this.#server;

    if (server === undefined || this.#state !== 'running') {
      throw new DeviceUnavailableError(
        `The MQTT broker is not running${this.#error === null ? '' : `: ${this.#error}`}`,
      );
    }

    for (const message of messages) {
      // In order: a command's messages are one after another on one topic.
      // eslint-disable-next-line no-await-in-loop -- see above
      await server.publish(message.topic, message.payload);
    }
  }

  /** Starts the server, or fails and tries again later. */
  async #listen(): Promise<void> {
    const { logger } = this.#options;
    const principals = this.#principals;

    if (principals === undefined || this.#isStopped) {
      return;
    }

    const server = new MqttServer({
      port: this.#options.port,
      persistenceFile: path.join(this.#options.storageDir, PERSISTENCE_FILE),
      principals,

      /**
       * Whether a client may connect without a username, as the owner set it now.
       *
       * @returns True when it may.
       */
      allowAnonymous: () => this.#currentSettings().allowAnonymous,

      /**
       * Hands one message on: to the topic log, then to discovery or the house.
       *
       * @param topic - Where.
       * @param payload - What.
       * @param isRetained - Whether it is kept.
       */
      onMessage: (topic, payload, isRetained): void => {
        this.#hear(topic, payload, isRetained);
      },

      /** Reports the clients online again: one came or went. */
      onSessionsChanged: (): void => {
        this.#reportBroker();
      },
    });

    try {
      this.#port = await server.start();
    } catch (error: unknown) {
      this.#fail(error);
      logger.warn(
        { err: error, port: this.#options.port },
        'The MQTT broker cannot listen; trying again',
      );
      this.#retry = setTimeout(() => {
        void this.#listen();
      }, this.#options.retryMs ?? RETRY_MS);
      this.#retry.unref();

      return;
    }

    // The hub may have stopped while the server was starting.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- set across the await
    if (this.#isStopped) {
      await server.stop();

      return;
    }

    this.#server = server;
    this.#error = null;
    this.#startedAt = new Date();
    this.#setState('running');
    this.#reportBroker();
    logger.info(
      {
        port: this.#port,
        discovery: this.#currentSettings().isDiscoveryEnabled
          ? this.#currentSettings().discoveryPrefix
          : null,
      },
      'The MQTT broker is listening',
    );
  }

  /**
   * One message the server carried.
   *
   * @param topic - Where.
   * @param payload - What.
   * @param isRetained - Whether it is kept for the next subscriber.
   */
  #hear(topic: string, payload: Buffer, isRetained: boolean): void {
    this.#topics.record(topic, payload, isRetained);

    const text = textOfPayload(payload);

    if (text === undefined) {
      return;
    }

    const { isDiscoveryEnabled, discoveryPrefix } = this.#currentSettings();

    if (isDiscoveryEnabled && topic.startsWith(`${discoveryPrefix}/`)) {
      const reading = readAnnouncement(discoveryPrefix, topic, text);

      switch (reading.kind) {
        case 'entity':
          this.#house.put(reading.entity, topic, (other) => this.#topics.lastText(other));

          return;
        case 'removed':
          this.#house.remove(topic);

          return;
        case 'skipped':
          this.#house.skip(reading.skipped);

          return;
        case 'ignored':
          break;
      }
    }

    this.#house.hear(topic, text);
  }

  /** Reads the owner's mappings into the house again. */
  #readMappings(): void {
    const kept = new Set<string>();

    for (const mapping of this.#store?.mappings() ?? []) {
      const entity = mqttEntityOfMapping(mapping);

      kept.add(entity.key);
      this.#house.put(entity, undefined, (topic) => this.#topics.lastText(topic));
    }

    this.#house.retain('mapping', kept);
  }

  /** Reports the broker's two readings. */
  #reportBroker(): void {
    this.#house.hear(CLIENTS_TOPIC, String(this.#server?.sessions().length ?? 0));
    this.#house.hear(MESSAGES_TOPIC, String(this.#topics.rate()));
  }

  /** Tells discovery the devices changed, once a burst of them has settled. */
  #settleDevices(): void {
    clearTimeout(this.#settle);
    this.#settle = setTimeout(() => {
      this.#tellDevices();
    }, SETTLE_MS);
    this.#settle.unref();
  }

  /** Tells discovery the devices changed. */
  #tellDevices(): void {
    for (const listener of this.#devicesListeners) {
      listener();
    }
  }

  /**
   * The settings, the defaults before the files are open.
   *
   * @returns Them.
   */
  #currentSettings(): MqttSettings {
    return (
      this.#settings ?? {
        allowAnonymous: false,
        isDiscoveryEnabled: true,
        discoveryPrefix: 'homeassistant',
      }
    );
  }

  /**
   * Notes a failure.
   *
   * @param error - What failed.
   */
  #fail(error: unknown): void {
    const code = (error as { code?: unknown } | null)?.code;

    this.#error =
      code === 'EADDRINUSE'
        ? `Port ${String(this.#options.port)} is in use by another program - the MQTT package, if it is still installed, or another broker`
        : error instanceof Error
          ? error.message
          : String(error);
    this.#setState('failed');
  }

  /**
   * Changes how the broker stands, and says so.
   *
   * @param state - How it stands now.
   */
  #setState(state: BrokerState): void {
    if (this.#state === state) {
      return;
    }

    this.#state = state;

    for (const listener of this.#stateListeners) {
      listener(state);
    }
  }

  /**
   * What is thrown when something is asked of a broker that is not there.
   *
   * @returns The error, saying why.
   */
  #notRunning(): ConflictError {
    return new ConflictError(
      `The MQTT broker is not running${this.#error === null ? '' : `: ${this.#error}`}`,
    );
  }
}
