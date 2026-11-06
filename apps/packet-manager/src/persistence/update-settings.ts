/**
 * What a round of updates reads (docs/releases-and-updates.md 4): the update settings, the parts
 * a backup takes, the house's zone, and the quietest time core learned.
 */
import { inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  backupSectionsSchema,
  channelIn,
  QUIET_TIME_ENTITY_ID,
  quietTimeFromState,
  timeZoneSchema,
  updateChannelSchema,
  updateWindowSchema,
  type BackupSection,
  type QuietTime,
  type UpdateChannel,
  type UpdateItem,
  type UpdateWindow,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';

/** The kinds that update by themselves, each on its own schedule. */
export type AutoKind = 'package' | 'integration';

/** The settings a round and the schedule go by, each kind's own. */
export type UpdateSettings = {
  readonly auto: Readonly<Record<AutoKind, boolean>>;
  readonly window: Readonly<Record<AutoKind, UpdateWindow>>;
  readonly backupFirst: Readonly<Record<UpdateItem['kind'], boolean>>;

  /** The parts a backup takes now: what a recent one must have taken to count. */
  readonly backupSections: readonly BackupSection[];
  readonly timezone: string;
};

/** The keys read, and how each is read when its row is missing or wrong. */
const KEYS = [
  'updates.auto.packages',
  'updates.auto.integrations',
  'updates.window.packages',
  'updates.window.integrations',
  'updates.backup_first.core',
  'updates.backup_first.packages',
  'updates.backup_first.integrations',
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
  /**
   * Reads one window.
   *
   * @param key - Its key.
   * @returns It; the quietest time when its row is missing or wrong.
   */
  const window = (key: string): UpdateWindow =>
    updateWindowSchema.catch({ mode: 'quietest', time: '03:00' }).parse(value.get(key));
  const sections = backupSectionsSchema
    .catch({ history: true, packages: true, containers: true })
    .parse(value.get('backup.sections'));

  return {
    auto: {
      package: flag('updates.auto.packages', false),
      integration: flag('updates.auto.integrations', false),
    },
    window: {
      package: window('updates.window.packages'),
      integration: window('updates.window.integrations'),
    },
    backupFirst: {
      core: flag('updates.backup_first.core', true),
      package: flag('updates.backup_first.packages', true),
      integration: flag('updates.backup_first.integrations', true),
    },
    backupSections: [
      'configuration',
      ...(sections.history ? (['history'] as const) : []),
      ...(sections.packages ? (['packages'] as const) : []),
      ...(sections.containers ? (['containers'] as const) : []),
    ],
    // A zone the clock cannot read would stop every plan: UTC then.
    timezone: timeZoneSchema.catch('UTC').parse(value.get('house.timezone')),
  };
}

/**
 * Reads the release channel a kind follows, `updates.channel.<kind>`: which index of the Hub its
 * releases come from, and what the Hub's search shows. Dev is offered only in developer mode:
 * without it a Dev channel is read as Beta.
 *
 * @param db - The service's connection.
 * @param kind - Packages or integrations.
 * @returns The channel; stable when its row is missing or wrong.
 */
export async function readChannel(
  db: Database,
  kind: 'packages' | 'integrations',
): Promise<UpdateChannel> {
  const rows = await db
    .select({ key: schema.system.settings.key, value: schema.system.settings.value })
    .from(schema.system.settings)
    .where(
      inArray(schema.system.settings.key, [`updates.channel.${kind}`, 'system.developer_mode']),
    );
  const value = new Map(rows.map((row) => [row.key, row.value]));

  return channelIn(
    updateChannelSchema.catch('stable').parse(value.get(`updates.channel.${kind}`)),
    value.get('system.developer_mode') === true,
  );
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
