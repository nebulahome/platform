/**
 * What the owner says of the broker, kept in its SQLite file beside the usernames: the devices
 * mapped by hand, the devices removed from the house that the broker still hears, and the
 * settings.
 *
 * A mapping is a device that does not announce itself, read from the topic it publishes on - a
 * sensor from `tele/garden/SENSOR`'s `AM2301.Temperature`, a switch from `stat/pump/POWER`,
 * commanded on `cmnd/pump/POWER` - and is read into the same entity an announcement is. A removed
 * device is remembered so that the house does not add it back on its own the moment it is heard
 * again; the Brokers page offers it back.
 */
import type { DatabaseSync } from 'node:sqlite';

import {
  mqttMappingSchema,
  mqttSettingsSchema,
  type MqttMapping,
  type MqttMappingInput,
  type MqttSettings,
} from '@nebulahome/contracts';
import { slugOf } from '@nebulahome/package-runtime';

/** A mapping's row, as SQLite answers it. */
type MappingRow = { readonly id: string; readonly document: string };

/** The settings' one row, as SQLite answers it. */
type SettingsRow = { readonly document: string };

/** The owner's mappings, removals and settings. */
export class MqttStore {
  readonly #db: DatabaseSync;

  /**
   * Makes the tables the first time.
   *
   * @param db - The broker's file, open; its owner closes it.
   */
  public constructor(db: DatabaseSync) {
    this.#db = db;
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS mappings (id TEXT PRIMARY KEY, document TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS removed (device_key TEXT PRIMARY KEY) STRICT;
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), document TEXT NOT NULL) STRICT;
    `);
  }

  /**
   * Every mapping.
   *
   * @returns Them, by name.
   */
  public mappings(): MqttMapping[] {
    const rows = this.#db
      .prepare('SELECT id, document FROM mappings')
      .all() as unknown as MappingRow[];

    return rows
      .flatMap((row) => {
        const read = mqttMappingSchema.safeParse({
          ...(JSON.parse(row.document) as object),
          id: row.id,
        });

        return read.success ? [read.data] : [];
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /**
   * Saves a mapping, new or changed.
   *
   * @param mapping - What the page sent, checked.
   * @returns It, with its id.
   */
  public saveMapping(mapping: MqttMappingInput): MqttMapping {
    const id =
      mapping.id ??
      `${slugOf(mapping.name).replaceAll('_', '-').slice(0, 24)}-${Date.now().toString(36)}`;
    const saved: MqttMapping = { ...mapping, id };

    this.#db
      .prepare('INSERT OR REPLACE INTO mappings (id, document) VALUES (?, ?)')
      .run(id, JSON.stringify(saved));

    return saved;
  }

  /**
   * Removes a mapping.
   *
   * @param id - Which.
   * @returns Whether there was one.
   */
  public removeMapping(id: string): boolean {
    return Number(this.#db.prepare('DELETE FROM mappings WHERE id = ?').run(id).changes) > 0;
  }

  /**
   * The devices removed from the house that the broker may still hear.
   *
   * @returns Their keys.
   */
  public removed(): Set<string> {
    const rows = this.#db.prepare('SELECT device_key FROM removed').all() as unknown as {
      readonly device_key: string;
    }[];

    return new Set(rows.map((row) => row.device_key));
  }

  /**
   * Remembers a device as removed from the house, or forgets that it was.
   *
   * @param deviceKey - The device.
   * @param isRemoved - Whether it is.
   * @returns Whether that changed anything.
   */
  public setRemoved(deviceKey: string, isRemoved: boolean): boolean {
    const result = isRemoved
      ? this.#db.prepare('INSERT OR IGNORE INTO removed (device_key) VALUES (?)').run(deviceKey)
      : this.#db.prepare('DELETE FROM removed WHERE device_key = ?').run(deviceKey);

    return Number(result.changes) > 0;
  }

  /**
   * The owner's settings, the defaults for what was never saved.
   *
   * @returns Them.
   */
  public settings(): MqttSettings {
    const row = this.#db.prepare('SELECT document FROM settings WHERE id = 1').get() as
      SettingsRow | undefined;
    let saved: unknown = {};

    try {
      saved = row === undefined ? {} : (JSON.parse(row.document) as unknown);
    } catch {
      // A file someone edited by hand: the defaults stand.
    }

    const read = mqttSettingsSchema.safeParse(saved);

    return read.success ? read.data : mqttSettingsSchema.parse({});
  }

  /**
   * Saves the owner's settings.
   *
   * @param settings - Them, checked.
   */
  public saveSettings(settings: MqttSettings): void {
    this.#db
      .prepare('INSERT OR REPLACE INTO settings (id, document) VALUES (1, ?)')
      .run(JSON.stringify(settings));
  }
}
