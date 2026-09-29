/**
 * Devices the owner maps by hand: one that does not announce itself, read from the topic it
 * publishes on - a sensor from `tele/garden/SENSOR`'s `AM2301.Temperature`, a switch from
 * `stat/pump/POWER`, commanded on `cmnd/pump/POWER`.
 *
 * A mapping is kept in the package's SQLite file and read into the same {@link MqttEntity} an
 * announcement is, so it is drawn, reported and commanded by the same code.
 */
import { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

import { slugOf, type MqttEntity } from './discovery.js';

/** What the owner maps: a sensor, a binary sensor or a switch. */
export const MAPPING_COMPONENTS = ['sensor', 'binary_sensor', 'switch'] as const;

/** A topic a client may publish on: no wildcards, no `$`. */
const topicSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[^#+$][^#+]*$/u, 'A topic, without wildcards');

/** One mapping, as the page saves it. */
export const mappingSchema = z.strictObject({
  /** Its id; a new one is given one. */
  id: z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/u)
    .optional(),
  name: z.string().trim().min(1).max(64),
  component: z.enum(MAPPING_COMPONENTS),
  stateTopic: topicSchema,

  /** Where the value is in a JSON payload, dotted: `AM2301.Temperature`. Empty for the payload. */
  valuePath: z
    .string()
    .trim()
    .max(128)
    .regex(/^$|^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/u, 'Keys separated by dots')
    .default(''),
  unit: z.string().trim().max(16).default(''),
  deviceClass: z.string().trim().max(32).default(''),
  commandTopic: topicSchema.optional(),
  payloadOn: z.string().max(64).default('ON'),
  payloadOff: z.string().max(64).default('OFF'),
});

/** One mapping. */
export type Mapping = z.output<typeof mappingSchema> & { readonly id: string };

/**
 * A mapping as an entity.
 *
 * @param mapping - The mapping.
 * @returns The entity.
 */
export function entityOfMapping(mapping: Mapping): MqttEntity {
  const config: Record<string, unknown> = {
    state_topic: mapping.stateTopic,
    payload_on: mapping.payloadOn,
    payload_off: mapping.payloadOff,
    ...(mapping.commandTopic === undefined ? {} : { command_topic: mapping.commandTopic }),
    ...(mapping.unit === '' ? {} : { unit_of_measurement: mapping.unit }),
    ...(mapping.deviceClass === '' ? {} : { device_class: mapping.deviceClass }),
  };

  return {
    key: `mapping:${mapping.id}`,
    origin: 'mapping',
    component: mapping.component,
    name: mapping.name,
    objectId: slugOf(`mapped_${mapping.id}`),
    device: { id: `mapping-${mapping.id}`, name: mapping.name, model: 'Mapped by hand' },
    config,
    value: { kind: 'path', path: mapping.valuePath === '' ? [] : mapping.valuePath.split('.') },
  };
}

/** A row, as SQLite answers it. */
type Row = { readonly id: string; readonly document: string };

/** The mappings, in the package's SQLite file. */
export class MappingStore {
  readonly #db: DatabaseSync;

  /**
   * Opens the file, making the table the first time.
   *
   * @param file - Its path, or `:memory:`.
   */
  public constructor(file: string) {
    this.#db = new DatabaseSync(file);
    this.#db.exec(
      'CREATE TABLE IF NOT EXISTS mappings (id TEXT PRIMARY KEY, document TEXT NOT NULL) STRICT',
    );
  }

  /** Closes the file. */
  public close(): void {
    this.#db.close();
  }

  /**
   * Every mapping.
   *
   * @returns Them, by name.
   */
  public list(): Mapping[] {
    const rows = this.#db.prepare('SELECT id, document FROM mappings').all() as unknown as Row[];

    return rows
      .flatMap((row) => {
        const read = mappingSchema.safeParse(JSON.parse(row.document));

        return read.success ? [{ ...read.data, id: row.id }] : [];
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /**
   * Saves a mapping, new or changed.
   *
   * @param mapping - What the page sent, checked.
   * @returns It, with its id.
   */
  public save(mapping: z.output<typeof mappingSchema>): Mapping {
    const id =
      mapping.id ??
      `${slugOf(mapping.name).replaceAll('_', '-').slice(0, 24)}-${Date.now().toString(36)}`;
    const saved: Mapping = { ...mapping, id };

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
  public remove(id: string): boolean {
    return Number(this.#db.prepare('DELETE FROM mappings WHERE id = ?').run(id).changes) > 0;
  }
}
