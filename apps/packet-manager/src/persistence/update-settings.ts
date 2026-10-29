/**
 * What a round of updates reads (docs/releases-and-updates.md 4): the update settings, the parts
 * a backup takes, the house's zone, and the quietest time core learned.
 */
import { inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  backupSectionsSchema,
  QUIET_TIME_ENTITY_ID,
  quietTimeFromState,
  updateWindowSchema,
  type BackupSection,
  type QuietTime,
  type UpdateWindow,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';

/** The settings a round and the schedule go by. */
export type UpdateSettings = {
  readonly autoPackages: boolean;
  readonly autoIntegrations: boolean;
  readonly window: UpdateWindow;
  readonly backupFirst: boolean;

  /** The parts a backup takes now: what a recent one must have taken to count. */
  readonly backupSections: readonly BackupSection[];
  readonly timezone: string;
};

/** The keys read, and how each is read when its row is missing or wrong. */
const KEYS = [
  'updates.auto.packages',
  'updates.auto.integrations',
  'updates.window',
  'updates.backup_first',
  'backup.sections',
  'house.timezone',
] as const;

/**
 * Reads the settings.
 *
 * @param db - The service's connection.
 * @returns Them, a default for any that cannot be read.
 */
export async function readUpdateSettings(db: Database): Promise<UpdateSettings> {
  const rows = await db
    .select({ key: schema.system.settings.key, value: schema.system.settings.value })
    .from(schema.system.settings)
    .where(inArray(schema.system.settings.key, [...KEYS]));
  const value = new Map(rows.map((row) => [row.key, row.value]));
  /**
   * Reads one switch.
   *
   * @param key - Its key.
   * @param fallback - What it is when its row is missing or wrong.
   * @returns Whether it is on.
   */
  const flag = (key: string, fallback: boolean): boolean =>
    z.boolean().catch(fallback).parse(value.get(key));
  const sections = backupSectionsSchema
    .catch({ history: true, packages: true, containers: true })
    .parse(value.get('backup.sections'));

  return {
    autoPackages: flag('updates.auto.packages', false),
    autoIntegrations: flag('updates.auto.integrations', false),
    window: updateWindowSchema
      .catch({ mode: 'quietest', time: '03:00' })
      .parse(value.get('updates.window')),
    backupFirst: flag('updates.backup_first', true),
    backupSections: [
      'configuration',
      ...(sections.history ? (['history'] as const) : []),
      ...(sections.packages ? (['packages'] as const) : []),
      ...(sections.containers ? (['containers'] as const) : []),
    ],
    timezone: z.string().min(1).catch('UTC').parse(value.get('house.timezone')),
  };
}

/**
 * Reads the quietest time core learned, `sensor.system_quiet_time`.
 *
 * @param db - The service's connection.
 * @returns What was learned, or null while the entity has no state.
 */
export async function readQuietTime(db: Database): Promise<QuietTime | null> {
  const rows = await db.execute<{ state: unknown; attributes: unknown }>(sql`
    SELECT s.state, s.attributes
    FROM registry.entity_states s
    JOIN registry.entities e ON e.id = s.entity_id
    WHERE e.entity_id = ${QUIET_TIME_ENTITY_ID}`);
  const row = rows[0];

  return row === undefined ? null : quietTimeFromState(row.state, row.attributes);
}
