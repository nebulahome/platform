/**
 * The house's Modbus broker: the devices the owner added, the templates they are read through, and
 * the network search that finds servers to add.
 *
 * A device is a template at an address. The broker hands each one to discovery with its template
 * resolved - one of the owner's, read by the platform's `modbus/generic`, or an integration's
 * driver of kind `modbus` - and discovery adds it at once, as MQTT's mappings are. The polling
 * itself is the `modbus` transport's, through the {@link ModbusPool} every Modbus request of the
 * hub goes through.
 *
 * The search knocks on port 502 of the owner's ranges, or of the networks the hub is on, on a
 * timer and whenever the owner saves the settings with it on. It never knocks on a server a device
 * of the house already reaches - one held by a poll counts as answering - and it recognises nothing
 * on its own: a server is named only by an integration whose `discovery.json` `modbus` rules read
 * it and match, and asked again whenever the integrations change.
 */
import {
  ConflictError,
  MODBUS_GENERIC_KIND,
  MODBUS_PORT,
  MODBUS_VENDOR,
  modbusWordOf,
  NotFoundError,
  ValidationError,
  withModbusEntityIds,
  type BrokerState,
  type JsonObject,
  type ModbusCapability,
  type ModbusClaim,
  type ModbusDevice,
  type ModbusDeviceInput,
  type ModbusEntity,
  type ModbusFound,
  type ModbusRead,
  type ModbusSearchRun,
  type ModbusSettings,
  type ModbusStatus,
  type ModbusTarget,
  type ModbusTemplate,
  type ModbusTemplateRecord,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';
import {
  associateBroker,
  encodeModbusWrite,
  matchesBroker,
  modbusKeyOf,
  modbusRawOf,
  modbusReadValueOf,
  modbusSizeOf,
  modbusValueOf,
  planModbusBlocks,
  type LoadedVendor,
  type ModbusDeviceSnapshot,
  type ModbusWordOrder,
} from '@nebulahome/package-runtime';

import type { TakenDevices } from '../domain/taken.js';
import { UUID_PATTERN, type ModbusStore, type StoredModbusDevice } from '../persistence/modbus.js';

import { hexOf, ModbusException, type ModbusAddress, type ModbusPool } from './client.js';
import { hostsOfRanges, isOpen, lanHosts, sweep } from './network.js';

/** How long a request of the editor's tests and of identification may take. */
const TEST_TIMEOUT_MS = 3000;

/** A device the broker hands discovery: its key, and the device whole. */
export type ModbusSighting = {
  readonly deviceKey: string;
  readonly device: ModbusDeviceSnapshot;
};

/** What the broker needs. */
export type ModbusBrokerOptions = {
  readonly store: ModbusStore;
  readonly pool: ModbusPool;
  readonly logger: PlatformLogger;

  /** The vendors loaded: their `modbus` rules, and the templates their drivers ship. */
  readonly vendors: () => readonly LoadedVendor[];

  /** The addresses the house's devices reach, which a search never knocks on. */
  readonly takenHosts: () => Promise<ReadonlySet<string>>;

  /** Whether the network is searched on a timer; on unless a test says. */
  readonly isSearchTimed?: boolean;

  /** The port a search knocks on; 502 unless a test says. */
  readonly searchPort?: number;
};

/** How a device's last poll went. */
type PollNote = { readonly at: Date; readonly error: string | null };

/** A template resolved: its document, and the driver it is read as. */
type Resolved = {
  readonly document: ModbusTemplate;
  readonly kind: string;
  readonly vendorId: string | null;
};

/**
 * The key a device is handed over and identified by.
 *
 * @param id - Its row.
 * @returns `modbus-<row>`.
 */
export function modbusDeviceKeyOf(id: string): string {
  return `modbus-${id}`;
}

/**
 * The row a device key names.
 *
 * @param deviceKey - The key.
 * @returns The row's id, or undefined for a key that is not a Modbus device's.
 */
function idOfKey(deviceKey: string): string | undefined {
  return deviceKey.startsWith('modbus-') ? deviceKey.slice('modbus-'.length) : undefined;
}

/**
 * A failure in a sentence, for the page.
 *
 * @param error - Whatever was thrown.
 * @returns Its message, cut.
 */
function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}

/**
 * The PDU an exception answer carries, for the test to show.
 *
 * @param error - What the request failed with.
 * @param code - The function asked.
 * @returns The answer's bytes, or null when the unit did not answer.
 */
function exceptionResponse(error: unknown, code: number): string | null {
  return error instanceof ModbusException ? hexOf(Buffer.from([code | 0x80, error.code])) : null;
}

/** The house's Modbus broker. */
export class ModbusBroker {
  readonly #options: ModbusBrokerOptions;

  #state: BrokerState = 'starting';
  #error: string | null = null;
  #startedAt: Date | null = null;
  #settings: ModbusSettings = { isSearchEnabled: false, ranges: [], intervalMinutes: 120 };
  #lastRun: ModbusSearchRun | null = null;
  #devices = new Map<string, StoredModbusDevice>();
  #templates = new Map<string, { readonly document: ModbusTemplate; readonly updatedAt: Date }>();
  #ignored = new Map<string, Date>();
  #found = new Map<string, ModbusFound>();
  readonly #polls = new Map<string, PollNote>();
  readonly #deviceListeners = new Set<() => void>();
  readonly #savedListeners = new Set<(deviceKeys: readonly string[]) => void>();
  #timer: NodeJS.Timeout | undefined;
  #searching: Promise<void> | undefined;

  /**
   * Prepares the broker; nothing is read until it starts.
   *
   * @param options - What it needs.
   */
  constructor(options: ModbusBrokerOptions) {
    this.#options = options;
  }

  /**
   * Reads what is kept and arms the search. Never throws: a failure shows on the Brokers page.
   *
   * @returns Once started, or failed.
   */
  async start(): Promise<void> {
    const { store } = this.#options;

    try {
      const [kept, devices, templates, ignored] = await Promise.all([
        store.settings(),
        store.devices(),
        store.templates(),
        store.ignored(),
      ]);

      this.#settings = kept.settings;
      this.#lastRun = kept.lastRun;
      this.#devices = new Map(devices.map((device) => [device.id, device]));
      this.#templates = new Map(templates.map((each) => [each.id, each]));
      this.#ignored = new Map(
        ignored.map((each) => [`${each.host}:${String(each.port)}`, each.at]),
      );
      this.#state = 'running';
      this.#error = null;
      this.#startedAt = new Date();
      this.#schedule();
      this.#changed();
    } catch (error: unknown) {
      this.#state = 'failed';
      this.#error = messageOf(error);
      this.#options.logger.error({ err: error }, 'The Modbus broker could not read what it keeps');
    }
  }

  /** Stops the search timer; the pool's sockets are the hub's to close. */
  stop(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#state = 'disabled';
  }

  /**
   * Where the broker stands.
   *
   * @returns Its status.
   */
  status(): ModbusStatus {
    const traffic = this.#options.pool.traffic();
    const notes = [...this.#devices.keys()].map((id) => this.#polls.get(modbusDeviceKeyOf(id)));

    return {
      state: this.#state,
      error: this.#error,
      startedAt: this.#startedAt,
      settings: this.#settings,
      search: {
        isRunning: this.#searching !== undefined,
        lastRun: this.#lastRun,
        nextAt: this.#nextAt(),
      },
      devices: {
        total: this.#devices.size,
        online: notes.filter((note) => note?.error === null).length,
      },
      gateways: traffic.gateways,
      requestsPerMinute: traffic.requestsPerMinute,
      averageMs: traffic.averageMs,
    };
  }

  /**
   * Every device whose template is there, as discovery and the transport take it.
   *
   * @returns The devices.
   */
  devices(): ModbusSighting[] {
    return [...this.#devices.values()].flatMap((row) => {
      const resolved = this.#resolve(row.template);

      if (resolved === undefined) {
        return [];
      }

      const deviceKey = modbusDeviceKeyOf(row.id);

      return [
        {
          deviceKey,
          device: {
            deviceKey,
            kind: resolved.kind,
            name: row.name,
            host: row.host,
            port: row.port,
            unitId: row.unitId,
            framing: row.framing,
            pollSeconds: row.pollSeconds ?? resolved.document.pollSeconds,
            template: resolved.document,
          },
        },
      ];
    });
  }

  /**
   * Says when the devices change - one added, saved, removed, or a template they use.
   *
   * @param listener - Called after each change.
   * @returns Stops it.
   */
  onDevices(listener: () => void): () => void {
    this.#deviceListeners.add(listener);

    return () => this.#deviceListeners.delete(listener);
  }

  /**
   * Says which devices were saved, or had their template saved, so their instances read the new
   * template.
   *
   * @param listener - Called with their keys.
   * @returns Stops it.
   */
  onSaved(listener: (deviceKeys: readonly string[]) => void): () => void {
    this.#savedListeners.add(listener);

    return () => this.#savedListeners.delete(listener);
  }

  /**
   * Notes how a device's poll went, for the Brokers page.
   *
   * @param deviceKey - The device.
   * @param error - Why it failed, or null when it answered.
   */
  notePoll(deviceKey: string, error: string | null): void {
    this.#polls.set(deviceKey, { at: new Date(), error });
  }

  /**
   * Every device as the Brokers page lists it.
   *
   * @param taken - What is added, for the device each one is in the house.
   * @returns The devices, by name.
   */
  deviceViews(taken: TakenDevices): ModbusDevice[] {
    return [...this.#devices.values()]
      .map((row): ModbusDevice => {
        const deviceKey = modbusDeviceKeyOf(row.id);
        const resolved = this.#resolve(row.template);
        const note = this.#polls.get(deviceKey);

        return {
          ...row,
          templateName: resolved?.document.name ?? null,
          vendorId: resolved?.vendorId ?? null,
          everySeconds: row.pollSeconds ?? resolved?.document.pollSeconds ?? 10,
          state: note === undefined ? 'waiting' : note.error === null ? 'online' : 'offline',
          lastReadAt: note?.at ?? null,
          lastError: note?.error ?? null,
          deviceId: taken.modbus.get(deviceKey)?.instanceId ?? null,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /**
   * Saves a device, new or changed.
   *
   * @param input - The device.
   * @returns It, as the page lists it.
   * @throws {ValidationError} When its template is not there.
   * @throws {ConflictError} When another device is at the same address and unit.
   */
  async saveDevice(input: ModbusDeviceInput): Promise<StoredModbusDevice> {
    if (this.#resolve(input.template) === undefined) {
      throw new ValidationError(`There is no template ${input.template}`, {
        details: { template: input.template },
      });
    }

    if (input.id !== undefined && !this.#devices.has(input.id)) {
      throw new NotFoundError(`There is no Modbus device ${input.id}`, {
        details: { id: input.id },
      });
    }

    const saved = await this.#options.store.saveDevice(input);

    this.#devices.set(saved.id, saved);
    this.#changed([modbusDeviceKeyOf(saved.id)]);

    return saved;
  }

  /**
   * Removes a device.
   *
   * @param id - Its row.
   * @returns Whether there was one.
   */
  async removeDevice(id: string): Promise<boolean> {
    const isRemoved = await this.#options.store.removeDevice(id);

    this.#devices.delete(id);
    this.#polls.delete(modbusDeviceKeyOf(id));
    this.#changed();

    return isRemoved;
  }

  /**
   * Lets go of a device removed from the house: its row goes, so it is not added back.
   *
   * @param deviceKey - The device.
   * @returns Once gone.
   */
  async release(deviceKey: string): Promise<void> {
    const id = idOfKey(deviceKey);

    if (id !== undefined && this.#devices.has(id)) {
      await this.removeDevice(id);
    }
  }

  /**
   * Every template: the owner's, then the integrations'.
   *
   * @returns The templates, each with whose it is and how many devices use it.
   */
  templates(): ModbusTemplateRecord[] {
    /**
     * How many devices a template is used by.
     *
     * @param template - The template.
     * @returns The count.
     */
    const usedBy = (template: string): number =>
      [...this.#devices.values()].filter((row) => row.template === template).length;
    const own = [...this.#templates.entries()]
      .map(([id, each]): ModbusTemplateRecord => ({
        id,
        vendorId: null,
        vendorName: null,
        document: each.document,
        isReadOnly: false,
        usedBy: usedBy(id),
        updatedAt: each.updatedAt,
      }))
      .sort((left, right) => left.document.name.localeCompare(right.document.name));
    const shipped = this.#options
      .vendors()
      .filter((vendor) => vendor.manifest.id !== MODBUS_VENDOR)
      .flatMap((vendor) =>
        vendor.drivers.flatMap((driver): ModbusTemplateRecord[] =>
          driver.modbusTemplate === undefined
            ? []
            : [
                {
                  id: driver.manifest.id,
                  vendorId: vendor.manifest.id,
                  vendorName: vendor.manifest.name,
                  document: driver.modbusTemplate,
                  isReadOnly: true,
                  usedBy: usedBy(driver.manifest.id),
                  updatedAt: null,
                },
              ],
        ),
      );

    return [...own, ...shipped];
  }

  /**
   * Saves one of the owner's templates; its devices read it at once.
   *
   * @param id - Its id; a new one when undefined.
   * @param document - The template.
   * @returns It, saved.
   * @throws {NotFoundError} When there is no such template.
   */
  async saveTemplate(
    id: string | undefined,
    document: ModbusTemplate,
  ): Promise<ModbusTemplateRecord> {
    if (id !== undefined && !this.#templates.has(id)) {
      throw new NotFoundError(`There is no Modbus template ${id}`, { details: { id } });
    }

    const saved = await this.#options.store.saveTemplate(id, withModbusEntityIds(document));

    this.#templates.set(saved.id, saved);

    const users = [...this.#devices.values()].filter((row) => row.template === saved.id);

    this.#changed(users.map((row) => modbusDeviceKeyOf(row.id)));

    return {
      id: saved.id,
      vendorId: null,
      vendorName: null,
      document: saved.document,
      isReadOnly: false,
      usedBy: users.length,
      updatedAt: saved.updatedAt,
    };
  }

  /**
   * Removes one of the owner's templates no device uses.
   *
   * @param id - The template.
   * @returns Whether there was one.
   * @throws {ConflictError} While a device uses it.
   */
  async removeTemplate(id: string): Promise<boolean> {
    const users = [...this.#devices.values()].filter((row) => row.template === id).length;

    if (users > 0) {
      throw new ConflictError(`The template is used by ${String(users)} devices`, {
        details: { id, usedBy: users },
      });
    }

    const isRemoved = await this.#options.store.removeTemplate(id);

    this.#templates.delete(id);

    return isRemoved;
  }

  /**
   * Saves the owner's settings: a search starts now when it is on.
   *
   * @param settings - The settings.
   * @returns Where the broker stands.
   */
  async saveSettings(settings: ModbusSettings): Promise<ModbusStatus> {
    await this.#options.store.saveSettings(settings);
    this.#settings = settings;

    if (settings.isSearchEnabled) {
      this.search();
    } else {
      this.#schedule();
    }

    return this.status();
  }

  /**
   * Starts a search of the network now, unless one is running; answers at once.
   *
   * @returns Where the broker stands.
   */
  search(): ModbusStatus {
    this.#searching ??= this.#search().finally(() => {
      this.#searching = undefined;
      this.#schedule();
    });

    return this.status();
  }

  /**
   * Waits for the search running now, for tests.
   *
   * @returns Once it ended.
   */
  async searched(): Promise<void> {
    await this.#searching;
  }

  /**
   * The servers the searches found that are not devices of the house, and those ignored.
   *
   * @returns Both.
   */
  found(): { items: ModbusFound[]; ignored: { host: string; port: number; at: Date }[] } {
    const added = new Set(
      [...this.#devices.values()].map((row) => `${row.host}:${String(row.port)}`),
    );

    return {
      items: [...this.#found.entries()]
        .filter(([key]) => !this.#ignored.has(key) && !added.has(key))
        .map(([, found]) => found),
      ignored: [...this.#ignored.entries()].map(([key, at]) => {
        const [host = '', port = ''] = key.split(/:(?=\d+$)/u);

        return { host, port: Number(port), at };
      }),
    };
  }

  /**
   * Ignores a server found, or stops ignoring it.
   *
   * @param host - Its address.
   * @param port - Its port.
   * @param isIgnored - Whether it is ignored now.
   * @returns How many servers are ignored.
   */
  async ignore(host: string, port: number, isIgnored: boolean): Promise<number> {
    await this.#options.store.setIgnored(host, port, isIgnored);

    if (isIgnored) {
      this.#ignored.set(`${host}:${String(port)}`, new Date());
    } else {
      this.#ignored.delete(`${host}:${String(port)}`);
    }

    return this.#ignored.size;
  }

  /**
   * Asks a device whether it answers, and which integrations recognise its server.
   *
   * @param target - The device.
   * @returns Whether it answered, how fast, and who recognises it.
   */
  async identify(target: ModbusTarget): Promise<{
    isAnswering: boolean;
    ms: number | null;
    error: string | null;
    claims: ModbusClaim[];
  }> {
    const startedAt = performance.now();
    let isAnswering: boolean;
    let error: string | null = null;

    try {
      await this.#options.pool.read(target, {
        unitId: target.unitId,
        function: 3,
        address: 0,
        count: 1,
        timeoutMs: TEST_TIMEOUT_MS,
      });
      isAnswering = true;
    } catch (failure: unknown) {
      // A unit that says no is a unit that answers.
      isAnswering = failure instanceof ModbusException;
      error = messageOf(failure);
    }

    const ms = isAnswering ? Math.round(performance.now() - startedAt) : null;

    return { isAnswering, ms, error, claims: await this.#claimsOf(target) };
  }

  /**
   * Asks every server found again which integrations recognise it: what an integration added or
   * removed changes. No address is knocked on that did not answer already.
   *
   * @returns Once every one was asked.
   */
  async reidentify(): Promise<void> {
    for (const [key, found] of this.#found) {
      // One server at a time: they may be behind one gateway that answers one request at a time.
      // eslint-disable-next-line no-await-in-loop -- see above
      const claims = await this.#claimsOf({ host: found.host, port: found.port, framing: 'tcp' });

      this.#found.set(key, { ...found, claims });
    }

    // A device read through an integration's template comes and goes with the integration.
    this.#changed();
  }

  /**
   * Reads one capability's registers from a device, as the editor's test does.
   *
   * @param target - The device.
   * @param read - What to read.
   * @param wordOrder - Which register of a 32-bit value holds the high word.
   * @returns What was sent and got back, raw and as a value.
   */
  async testRead(
    target: ModbusTarget,
    read: ModbusRead,
    wordOrder: ModbusWordOrder,
  ): Promise<{
    request: string;
    response: string | null;
    error: string | null;
    ms: number;
    raw: number[] | null;
    value: number | string | boolean | null;
  }> {
    const address = modbusWordOf(read.address);
    const count = modbusSizeOf(read);
    const request = hexOf(
      Buffer.from([read.function, address >> 8, address & 0xff, count >> 8, count & 0xff]),
    );
    const startedAt = performance.now();

    try {
      const result = await this.#options.pool.read(target, {
        unitId: target.unitId,
        function: read.function,
        address,
        count,
        timeoutMs: TEST_TIMEOUT_MS,
      });
      const registers = Object.fromEntries(
        result.values.map((value, offset) => [modbusKeyOf(read.function, address + offset), value]),
      );

      return {
        request,
        response: hexOf(result.response),
        error: null,
        ms: result.ms,
        raw: result.values,
        value: modbusReadValueOf(read, wordOrder, registers),
      };
    } catch (error: unknown) {
      return {
        request,
        response: exceptionResponse(error, read.function),
        error: messageOf(error),
        ms: Math.round(performance.now() - startedAt),
        raw: null,
        value: null,
      };
    }
  }

  /**
   * Sends one command of an entity to a device, as the editor's test does. A value outside the
   * entity's min and max is refused here and never sent.
   *
   * @param target - The device.
   * @param entity - The entity.
   * @param capability - The capability commanded.
   * @param command - The command.
   * @param wordOrder - Which register of a 32-bit value holds the high word.
   * @returns What was sent and got back.
   */
  async testWrite(
    target: ModbusTarget,
    entity: ModbusEntity,
    capability: ModbusCapability,
    command: Record<string, unknown>,
    wordOrder: ModbusWordOrder,
  ): Promise<{ request: string; response: string | null; error: string | null; ms: number }> {
    let write;

    try {
      write = encodeModbusWrite(entity, capability, command as JsonObject, wordOrder);
    } catch (error: unknown) {
      return { request: '', response: null, error: messageOf(error), ms: 0 };
    }

    const startedAt = performance.now();

    try {
      const result = await this.#options.pool.write(target, {
        unitId: target.unitId,
        function: write.function,
        address: write.address,
        values: write.values,
        timeoutMs: TEST_TIMEOUT_MS,
      });

      return {
        request: hexOf(result.request),
        response: hexOf(result.response),
        error: null,
        ms: result.ms,
      };
    } catch (error: unknown) {
      return {
        request: '',
        response: exceptionResponse(error, write.function),
        error: messageOf(error),
        ms: Math.round(performance.now() - startedAt),
      };
    }
  }

  /**
   * Reads every capability of a template from a device once.
   *
   * @param target - The device.
   * @param document - The template.
   * @returns Each capability's value, or why it could not be read.
   */
  async testTemplate(
    target: ModbusTarget,
    document: ModbusTemplate,
  ): Promise<{
    at: Date;
    ms: number;
    values: {
      entity: number;
      capability: ModbusCapability;
      value: number | string | boolean | null;
      error: string | null;
    }[];
  }> {
    const startedAt = performance.now();
    const registers: Record<string, number> = {};
    const failures: { fn: number; start: number; end: number; error: string }[] = [];

    for (const block of planModbusBlocks(document)) {
      try {
        // One block at a time, by design: the server answers one request at a time.
        // eslint-disable-next-line no-await-in-loop -- see above
        const result = await this.#options.pool.read(target, {
          unitId: target.unitId,
          function: block.function,
          address: block.start,
          count: block.count,
          timeoutMs: TEST_TIMEOUT_MS,
        });

        result.values.forEach((value, offset) => {
          registers[modbusKeyOf(block.function, block.start + offset)] = value;
        });
      } catch (error: unknown) {
        failures.push({
          fn: block.function,
          start: block.start,
          end: block.start + block.count - 1,
          error: messageOf(error),
        });
      }
    }

    const values = document.entities.flatMap((entity, index) =>
      Object.entries(entity.capabilities).flatMap(([name, map]) => {
        const capability = name as ModbusCapability;

        if (map.read === undefined) {
          return [];
        }

        const raw = modbusRawOf(map.read, document.wordOrder, registers);
        const address = modbusWordOf(map.read.address);
        const failure = failures.find(
          (each) => each.fn === map.read?.function && address >= each.start && address <= each.end,
        );

        return [
          {
            entity: index,
            capability,
            value: raw === undefined ? null : modbusValueOf(capability, map, raw),
            error: raw === undefined ? (failure?.error ?? 'Not read') : null,
          },
        ];
      }),
    );

    return { at: new Date(), ms: Math.round(performance.now() - startedAt), values };
  }

  /**
   * Finds a device's template: one of the owner's by uuid, or a loaded driver's by its kind.
   *
   * @param template - What the device names.
   * @returns The template and the driver it is read as; undefined when it is not there.
   */
  #resolve(template: string): Resolved | undefined {
    if (UUID_PATTERN.test(template)) {
      const own = this.#templates.get(template);

      return own === undefined
        ? undefined
        : { document: own.document, kind: MODBUS_GENERIC_KIND, vendorId: null };
    }

    for (const vendor of this.#options.vendors()) {
      const driver = vendor.drivers.find((each) => each.manifest.id === template);

      if (driver?.modbusTemplate !== undefined) {
        return { document: driver.modbusTemplate, kind: template, vendorId: vendor.manifest.id };
      }
    }

    return undefined;
  }

  /**
   * The integrations whose `modbus` rules recognise a server: each one's values read through the
   * pool, then its rules matched.
   *
   * @param server - The server.
   * @returns Each integration that recognises it, with the driver it would be read as.
   */
  async #claimsOf(server: ModbusAddress): Promise<ModbusClaim[]> {
    const claims: ModbusClaim[] = [];

    for (const vendor of this.#options.vendors()) {
      const plan = vendor.discovery?.plan;
      const rules = plan?.discovery.modbus;

      if (plan === undefined || rules === undefined || vendor.manifest.id === MODBUS_VENDOR) {
        continue;
      }

      const values: Record<string, number | string | boolean | null> = {};

      for (const [name, read] of Object.entries(rules.read)) {
        const address = modbusWordOf(read.address);

        try {
          // One read at a time, by design: the server answers one request at a time.
          // eslint-disable-next-line no-await-in-loop -- see above
          const result = await this.#options.pool.read(server, {
            unitId: rules.unitId,
            function: read.function,
            address,
            count: modbusSizeOf(read),
            timeoutMs: TEST_TIMEOUT_MS,
          });

          values[name] = modbusReadValueOf(
            read,
            'high',
            Object.fromEntries(
              result.values.map((value, offset) => [
                modbusKeyOf(read.function, address + offset),
                value,
              ]),
            ),
          );
        } catch {
          values[name] = null;
        }
      }

      const identity = { host: server.host, port: server.port, unitId: rules.unitId, values };

      if (!matchesBroker(plan, 'modbus', identity)) {
        continue;
      }

      const association = associateBroker(plan, 'modbus', identity);

      claims.push({
        vendorId: vendor.manifest.id,
        vendorName: vendor.manifest.name,
        kind: association === null ? null : `${vendor.manifest.id}/${association.driverId}`,
        model: association?.model ?? null,
        unitId: rules.unitId,
      });
    }

    return claims.slice(0, 16);
  }

  /**
   * Searches the network: knocks on port 502 of every address, then asks what answered who it is.
   *
   * @returns Once done; a failure is logged, not thrown.
   */
  async #search(): Promise<void> {
    const startedAt = Date.now();

    try {
      const hosts =
        this.#settings.ranges.length > 0 ? hostsOfRanges(this.#settings.ranges) : lanHosts();
      const taken = await this.#options.takenHosts();
      const added = new Set([...this.#devices.values()].map((row) => row.host));
      const asked = hosts.filter(
        (host) =>
          !taken.has(host) &&
          !added.has(host) &&
          !this.#ignored.has(`${host}:${String(this.#port)}`),
      );
      const answered = await sweep(asked, (host) => {
        const address: ModbusAddress = { host, port: this.#port, framing: 'tcp' };

        return this.#options.pool.isHeld(address)
          ? Promise.resolve(true)
          : isOpen(host, this.#port);
      });
      const found = new Map<string, ModbusFound>();

      for (const host of answered) {
        const key = `${host}:${String(this.#port)}`;

        found.set(key, {
          host,
          port: this.#port,
          foundAt: this.#found.get(key)?.foundAt ?? new Date(),
          // One server at a time, by design: each answers one request at a time.
          // eslint-disable-next-line no-await-in-loop -- see above
          claims: await this.#claimsOf({ host, port: this.#port, framing: 'tcp' }),
        });
      }

      this.#found = found;
      this.#lastRun = {
        at: new Date(startedAt),
        durationMs: Date.now() - startedAt,
        addresses: hosts.length,
        answered: answered.length,
      };
      await this.#options.store.recordSearch(this.#lastRun);
      this.#options.logger.info(
        { addresses: hosts.length, answered: answered.length, ms: this.#lastRun.durationMs },
        'Modbus network search done',
      );
    } catch (error: unknown) {
      this.#options.logger.warn({ err: error }, 'The Modbus network search failed');
    }
  }

  /**
   * The port a search knocks on.
   *
   * @returns 502, unless a test said.
   */
  get #port(): number {
    return this.#options.searchPort ?? MODBUS_PORT;
  }

  /**
   * When the next search starts, while searching is on.
   *
   * @returns The time, or null while it is off.
   */
  #nextAt(): Date | null {
    if (!this.#settings.isSearchEnabled) {
      return null;
    }

    const last = this.#lastRun?.at.getTime();

    return new Date(
      last === undefined ? Date.now() : last + this.#settings.intervalMinutes * 60_000,
    );
  }

  /** Arms the timer for the next search, or disarms it while searching is off. */
  #schedule(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;

    const next = this.#nextAt();

    if (next === null || this.#options.isSearchTimed === false || this.#state === 'disabled') {
      return;
    }

    this.#timer = setTimeout(
      () => {
        this.search();
      },
      Math.max(1000, next.getTime() - Date.now()),
    );
    this.#timer.unref();
  }

  /**
   * Tells the listeners the devices changed, and which were saved.
   *
   * @param saved - The devices saved, whose instances read their template again.
   */
  #changed(saved: readonly string[] = []): void {
    for (const listener of this.#deviceListeners) {
      listener();
    }

    if (saved.length > 0) {
      for (const listener of this.#savedListeners) {
        listener(saved);
      }
    }
  }
}
