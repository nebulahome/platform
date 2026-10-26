/**
 * What the Modbus broker keeps: the owner's settings, templates and devices, and the servers the
 * owner ignores, in the registry's `modbus_*` tables.
 *
 * `hub` is their only writer: the owner's changes reach it over the bus through `api`. Behind an
 * interface, so the broker's tests keep them in memory.
 */
import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import {
  ConflictError,
  modbusSettingsSchema,
  modbusTemplateSchema,
  NotFoundError,
  type ModbusFraming,
  type ModbusSearchRun,
  type ModbusSettings,
  type ModbusTemplate,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';

/** The settings, and how the last search went. */
export type StoredModbusSettings = {
  readonly settings: ModbusSettings;
  readonly lastRun: ModbusSearchRun | null;
};

/** A device: a template at an address. */
export type StoredModbusDevice = {
  readonly id: string;
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly unitId: number;
  readonly framing: ModbusFraming;

  /** One of the owner's templates by uuid, or an integration's driver by `vendor/driver`. */
  readonly template: string;
  readonly pollSeconds: number | null;
};

/** One of the owner's templates. */
export type StoredModbusTemplate = {
  readonly id: string;
  readonly document: ModbusTemplate;
  readonly updatedAt: Date;
};

/** A server the owner ignores. */
export type StoredModbusIgnored = {
  readonly host: string;
  readonly port: number;
  readonly at: Date;
};

/** A device to save: new when it has no id. */
type NewDevice = Omit<StoredModbusDevice, 'id'> & { readonly id?: string | undefined };

/** What the broker keeps. */
export type ModbusStore = {
  settings: () => Promise<StoredModbusSettings>;
  saveSettings: (settings: ModbusSettings) => Promise<void>;
  recordSearch: (run: ModbusSearchRun) => Promise<void>;
  devices: () => Promise<StoredModbusDevice[]>;

  /**
   * Saves a device, new when it has no id.
   *
   * @throws {ConflictError} When another device is at the same address and unit.
   */
  saveDevice: (device: NewDevice) => Promise<StoredModbusDevice>;
  removeDevice: (id: string) => Promise<boolean>;
  templates: () => Promise<StoredModbusTemplate[]>;
  saveTemplate: (id: string | undefined, document: ModbusTemplate) => Promise<StoredModbusTemplate>;
  removeTemplate: (id: string) => Promise<boolean>;
  ignored: () => Promise<StoredModbusIgnored[]>;
  setIgnored: (host: string, port: number, isIgnored: boolean) => Promise<void>;
};

/** Whether a string is a uuid: one of the owner's templates, rather than a driver. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** PostgreSQL's `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

/**
 * Whether a failure is PostgreSQL refusing a duplicate, however deep the driver wrapped it.
 *
 * @param error - Whatever was thrown.
 * @returns True for a unique violation.
 */
function isDuplicate(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    if ('code' in current && current.code === UNIQUE_VIOLATION) {
      return true;
    }

    current = 'cause' in current ? current.cause : undefined;
  }

  return false;
}

/**
 * The refusal of a second device at one address and unit.
 *
 * @param device - The device refused.
 * @param device.host - Its address.
 * @param device.port - Its port.
 * @param device.unitId - Its unit.
 * @returns The error.
 */
function duplicateError(device: { host: string; port: number; unitId: number }): ConflictError {
  return new ConflictError(
    `A device is already at ${device.host}:${String(device.port)} unit ${String(device.unitId)}`,
    { details: { host: device.host, port: device.port, unitId: device.unitId } },
  );
}

const devices = schema.registry.modbusDevices;
const templates = schema.registry.modbusTemplates;
const ignored = schema.registry.modbusIgnored;
const settings = schema.registry.modbusSettings;

/**
 * Reads a device row.
 *
 * @param row - The row.
 * @returns The device.
 */
function deviceOf(row: typeof devices.$inferSelect): StoredModbusDevice {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    unitId: row.unitId,
    framing: row.framing === 'rtu' ? 'rtu' : 'tcp',
    template: row.templateId ?? row.templateKind ?? '',
    pollSeconds: row.pollSeconds,
  };
}

/**
 * Reads a template row; one the contract no longer takes is left out, not a failure of all.
 *
 * @param row - The row.
 * @returns The template, or undefined.
 */
function templateOf(row: typeof templates.$inferSelect): StoredModbusTemplate | undefined {
  const parsed = modbusTemplateSchema.safeParse(row.document);

  return parsed.success
    ? { id: row.id, document: parsed.data, updatedAt: row.updatedAt }
    : undefined;
}

/** The broker's tables in the registry. */
class DatabaseModbusStore implements ModbusStore {
  readonly #db: Database;

  /**
   * Keeps the handle.
   *
   * @param db - A connected database handle.
   */
  constructor(db: Database) {
    this.#db = db;
  }

  /**
   * Reads the settings and the last search.
   *
   * @returns Them; the defaults when the row is missing.
   */
  async settings(): Promise<StoredModbusSettings> {
    const [row] = await this.#db.select().from(settings).where(eq(settings.id, 1));

    return {
      settings: modbusSettingsSchema.parse({
        isSearchEnabled: row?.isSearchEnabled ?? false,
        ranges: row?.searchRanges ?? [],
        intervalMinutes: row?.searchIntervalMinutes ?? 120,
      }),
      lastRun:
        row?.lastSearchAt === null || row?.lastSearchAt === undefined
          ? null
          : {
              at: row.lastSearchAt,
              durationMs: row.lastSearchMs ?? 0,
              addresses: row.lastSearchAddresses ?? 0,
              answered: row.lastSearchAnswered ?? 0,
            },
    };
  }

  /**
   * Saves the settings.
   *
   * @param next - The settings.
   * @returns Once saved.
   */
  async saveSettings(next: ModbusSettings): Promise<void> {
    const values = {
      isSearchEnabled: next.isSearchEnabled,
      searchRanges: [...next.ranges],
      searchIntervalMinutes: next.intervalMinutes,
    };

    await this.#db
      .insert(settings)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: settings.id, set: values });
  }

  /**
   * Records how a search went.
   *
   * @param run - The search.
   * @returns Once recorded.
   */
  async recordSearch(run: ModbusSearchRun): Promise<void> {
    await this.#db
      .update(settings)
      .set({
        lastSearchAt: run.at,
        lastSearchMs: run.durationMs,
        lastSearchAddresses: run.addresses,
        lastSearchAnswered: run.answered,
      })
      .where(eq(settings.id, 1));
  }

  /**
   * Reads every device.
   *
   * @returns The devices.
   */
  async devices(): Promise<StoredModbusDevice[]> {
    return (await this.#db.select().from(devices)).map(deviceOf);
  }

  /**
   * Saves a device, new when it has no id.
   *
   * @param device - The device.
   * @returns It, saved.
   * @throws {ConflictError} When another device is at the same address and unit.
   * @throws {NotFoundError} When the device to change is not there.
   */
  async saveDevice(device: NewDevice): Promise<StoredModbusDevice> {
    const isOwn = UUID_PATTERN.test(device.template);
    const values = {
      name: device.name,
      host: device.host,
      port: device.port,
      unitId: device.unitId,
      framing: device.framing,
      templateId: isOwn ? device.template : null,
      templateKind: isOwn ? null : device.template,
      pollSeconds: device.pollSeconds,
    };
    let row: typeof devices.$inferSelect | undefined;

    try {
      [row] =
        device.id === undefined
          ? await this.#db.insert(devices).values(values).returning()
          : await this.#db.update(devices).set(values).where(eq(devices.id, device.id)).returning();
    } catch (error: unknown) {
      throw isDuplicate(error) ? duplicateError(device) : error;
    }

    if (row === undefined) {
      throw new NotFoundError(`There is no Modbus device ${device.id ?? ''}`, {
        details: { id: device.id ?? null },
      });
    }

    return deviceOf(row);
  }

  /**
   * Removes a device.
   *
   * @param id - Its row.
   * @returns Whether there was one.
   */
  async removeDevice(id: string): Promise<boolean> {
    const removed = await this.#db
      .delete(devices)
      .where(eq(devices.id, id))
      .returning({ id: devices.id });

    return removed.length > 0;
  }

  /**
   * Reads the owner's templates.
   *
   * @returns Every one the contract takes.
   */
  async templates(): Promise<StoredModbusTemplate[]> {
    return (await this.#db.select().from(templates)).flatMap((row) => templateOf(row) ?? []);
  }

  /**
   * Saves one of the owner's templates.
   *
   * @param id - Its id; a new one when undefined.
   * @param document - The template.
   * @returns It, saved.
   * @throws {NotFoundError} When the template to change is not there.
   */
  async saveTemplate(
    id: string | undefined,
    document: ModbusTemplate,
  ): Promise<StoredModbusTemplate> {
    const [row] =
      id === undefined
        ? await this.#db.insert(templates).values({ document }).returning()
        : await this.#db
            .update(templates)
            .set({ document })
            .where(eq(templates.id, id))
            .returning();
    const saved = row === undefined ? undefined : templateOf(row);

    if (saved === undefined) {
      throw new NotFoundError(`There is no Modbus template ${id ?? ''}`, {
        details: { id: id ?? null },
      });
    }

    return saved;
  }

  /**
   * Removes one of the owner's templates.
   *
   * @param id - The template.
   * @returns Whether there was one.
   */
  async removeTemplate(id: string): Promise<boolean> {
    const removed = await this.#db
      .delete(templates)
      .where(eq(templates.id, id))
      .returning({ id: templates.id });

    return removed.length > 0;
  }

  /**
   * Reads the servers the owner ignores.
   *
   * @returns Them.
   */
  async ignored(): Promise<StoredModbusIgnored[]> {
    return (await this.#db.select().from(ignored)).map((row) => ({
      host: row.host,
      port: row.port,
      at: row.createdAt,
    }));
  }

  /**
   * Ignores a server, or stops ignoring it.
   *
   * @param host - Its address.
   * @param port - Its port.
   * @param isIgnored - Whether it is ignored now.
   * @returns Once saved.
   */
  async setIgnored(host: string, port: number, isIgnored: boolean): Promise<void> {
    await (isIgnored
      ? this.#db.insert(ignored).values({ host, port }).onConflictDoNothing()
      : this.#db.delete(ignored).where(and(eq(ignored.host, host), eq(ignored.port, port))));
  }
}

/**
 * The broker's tables in the registry.
 *
 * @param db - A connected database handle.
 * @returns The store.
 */
export function databaseModbusStore(db: Database): ModbusStore {
  return new DatabaseModbusStore(db);
}

/** The broker's tables in memory, for tests. */
class MemoryModbusStore implements ModbusStore {
  #saved: StoredModbusSettings = { settings: modbusSettingsSchema.parse({}), lastRun: null };
  readonly #rows = new Map<string, StoredModbusDevice>();
  readonly #documents = new Map<string, StoredModbusTemplate>();
  readonly #skipped = new Map<string, StoredModbusIgnored>();

  /**
   * Reads the settings and the last search.
   *
   * @returns Them.
   */
  settings(): Promise<StoredModbusSettings> {
    return Promise.resolve(this.#saved);
  }

  /**
   * Saves the settings.
   *
   * @param next - The settings.
   * @returns Once saved.
   */
  saveSettings(next: ModbusSettings): Promise<void> {
    this.#saved = { ...this.#saved, settings: next };

    return Promise.resolve();
  }

  /**
   * Records how a search went.
   *
   * @param run - The search.
   * @returns Once recorded.
   */
  recordSearch(run: ModbusSearchRun): Promise<void> {
    this.#saved = { ...this.#saved, lastRun: run };

    return Promise.resolve();
  }

  /**
   * Reads every device.
   *
   * @returns The devices.
   */
  devices(): Promise<StoredModbusDevice[]> {
    return Promise.resolve([...this.#rows.values()]);
  }

  /**
   * Saves a device, new when it has no id.
   *
   * @param device - The device.
   * @returns It, saved.
   */
  saveDevice(device: NewDevice): Promise<StoredModbusDevice> {
    const id = device.id ?? randomUUID();
    const clash = [...this.#rows.values()].find(
      (row) =>
        row.id !== id &&
        row.host === device.host &&
        row.port === device.port &&
        row.unitId === device.unitId,
    );

    if (clash !== undefined) {
      return Promise.reject(duplicateError(device));
    }

    const row: StoredModbusDevice = {
      id,
      name: device.name,
      host: device.host,
      port: device.port,
      unitId: device.unitId,
      framing: device.framing,
      template: device.template,
      pollSeconds: device.pollSeconds,
    };

    this.#rows.set(id, row);

    return Promise.resolve(row);
  }

  /**
   * Removes a device.
   *
   * @param id - Its row.
   * @returns Whether there was one.
   */
  removeDevice(id: string): Promise<boolean> {
    return Promise.resolve(this.#rows.delete(id));
  }

  /**
   * Reads the owner's templates.
   *
   * @returns Them.
   */
  templates(): Promise<StoredModbusTemplate[]> {
    return Promise.resolve([...this.#documents.values()]);
  }

  /**
   * Saves one of the owner's templates.
   *
   * @param id - Its id; a new one when undefined.
   * @param document - The template.
   * @returns It, saved.
   */
  saveTemplate(id: string | undefined, document: ModbusTemplate): Promise<StoredModbusTemplate> {
    const row = { id: id ?? randomUUID(), document, updatedAt: new Date() };

    this.#documents.set(row.id, row);

    return Promise.resolve(row);
  }

  /**
   * Removes one of the owner's templates.
   *
   * @param id - The template.
   * @returns Whether there was one.
   */
  removeTemplate(id: string): Promise<boolean> {
    return Promise.resolve(this.#documents.delete(id));
  }

  /**
   * Reads the servers the owner ignores.
   *
   * @returns Them.
   */
  ignored(): Promise<StoredModbusIgnored[]> {
    return Promise.resolve([...this.#skipped.values()]);
  }

  /**
   * Ignores a server, or stops ignoring it.
   *
   * @param host - Its address.
   * @param port - Its port.
   * @param isIgnored - Whether it is ignored now.
   * @returns Once saved.
   */
  setIgnored(host: string, port: number, isIgnored: boolean): Promise<void> {
    const key = `${host}:${String(port)}`;

    if (isIgnored) {
      this.#skipped.set(key, { host, port, at: new Date() });
    } else {
      this.#skipped.delete(key);
    }

    return Promise.resolve();
  }
}

/**
 * The broker's tables in memory, for tests.
 *
 * @returns The store.
 */
export function memoryModbusStore(): ModbusStore {
  return new MemoryModbusStore();
}
