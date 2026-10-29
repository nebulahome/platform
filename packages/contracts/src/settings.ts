/**
 * Runtime settings: configuration an owner changes from the interface, as opposed to environment
 * variables, which are fixed for the life of a process.
 *
 * Each key names the schema that validates its value, so `system.settings.value` is never
 * written unvalidated. The retention keys carry hard minimums in their schemas rather than in a
 * check somewhere else, because the failure they prevent is silent and permanent.
 *
 * Defined in DATABASE.md 7 and 10.
 */
import { z } from 'zod';

import {
  backupFrequencySchema,
  backupScheduleSchema,
  backupSectionsSchema,
  timeZoneSchema,
} from './backup.js';
import { DEFAULT_LOCALE, supportedLocaleSchema } from './locale.js';
import type { LOG_LEVELS } from './log-level.js';
import { updateChannelSchema, updateWindowSchema } from './updates.js';

/** The shape of a setting key. Mirrors `settings_key_format` in DATABASE.md. */
export const SETTING_KEY_PATTERN = /^[a-z][a-z0-9_.]{1,63}$/;

/**
 * A retention duration in whole days, or `null` for "keep forever".
 *
 * @param minimumDays - The shortest value that is safe for this level.
 * @returns A schema accepting that many days or more, or `null`.
 */
function retentionDaysSchema(minimumDays: number): z.ZodType<number | null> {
  return z.union([z.int().min(minimumDays), z.null()]);
}

/**
 * The minimum retention each telemetry level must keep, in days.
 *
 * These are not tuning parameters. Each continuous aggregate refreshes by looking a fixed
 * distance back into its source (DATABASE.md 9), so a source kept for less than that window has
 * its rows dropped **before** the aggregate above has read them. The data is then gone from
 * every level at once, and TimescaleDB raises no error - the aggregate simply has a hole in it.
 * The margin below is deliberate: the minimum is several times the refresh window, not equal
 * to it.
 */
export const RETENTION_MINIMUM_DAYS = {
  /** `telemetry_1m` looks back 3 hours. */
  raw: 1,

  /** `telemetry_1h` looks back 1 day. */
  tier1m: 7,

  /** `telemetry_1d` looks back 7 days. */
  tier1h: 30,

  /** Nothing is built from the daily level, so it has no lower bound. */
  tier1d: 1,
} as const;

/**
 * Converts a retention value into something comparable.
 *
 * `null` means keep forever, so it has to sort **last**. Comparing it as a number would make it
 * sort first and reject every valid ladder that keeps daily buckets indefinitely - which is the
 * default configuration.
 *
 * @param value - A retention duration in days, or `null` for forever.
 * @returns The duration in days, with `null` mapped to infinity.
 */
function retentionAsDays(value: number | null): number {
  return value ?? Number.POSITIVE_INFINITY;
}

/** The four telemetry retention settings, which have to be validated together. */
export const retentionLadderSchema = z
  .object({
    rawRetentionDays: retentionDaysSchema(RETENTION_MINIMUM_DAYS.raw),
    tier1mRetentionDays: retentionDaysSchema(RETENTION_MINIMUM_DAYS.tier1m),
    tier1hRetentionDays: retentionDaysSchema(RETENTION_MINIMUM_DAYS.tier1h),
    tier1dRetentionDays: retentionDaysSchema(RETENTION_MINIMUM_DAYS.tier1d),
  })
  .refine(
    (ladder) =>
      retentionAsDays(ladder.rawRetentionDays) <= retentionAsDays(ladder.tier1mRetentionDays) &&
      retentionAsDays(ladder.tier1mRetentionDays) <= retentionAsDays(ladder.tier1hRetentionDays) &&
      retentionAsDays(ladder.tier1hRetentionDays) <= retentionAsDays(ladder.tier1dRetentionDays),
    {
      message:
        'Retention must not decrease as resolution coarsens: raw <= 1m <= 1h <= 1d, null last',
    },
  );

/** The four telemetry retention settings. */
export type RetentionLadder = z.output<typeof retentionLadderSchema>;

/**
 * The four retention keys, and the field each one occupies in the ladder.
 *
 * Declared here because both sides need it and it is a mapping between two things this file
 * already owns. A map rather than a naming convention: the ladder's field names are chosen for
 * reading in TypeScript and the keys are chosen for reading in SQL, and deriving either from the
 * other would be a rule that holds right up until somebody adds a fifth tier.
 */
export const RETENTION_LADDER_FIELDS = {
  'history.telemetry.raw_retention_days': 'rawRetentionDays',
  'history.telemetry.tier_1m_retention_days': 'tier1mRetentionDays',
  'history.telemetry.tier_1h_retention_days': 'tier1hRetentionDays',
  'history.telemetry.tier_1d_retention_days': 'tier1dRetentionDays',
} as const satisfies Readonly<Record<string, keyof RetentionLadder>>;

/** One entry in the settings catalogue. */
export type SettingDefinition = {
  /** The primary key in `system.settings`. */
  readonly key: string;

  /** The schema `value` is validated against before it is written. */
  readonly schema: z.ZodType;

  /** The value seeded by the initial migration. */
  readonly defaultValue: unknown;

  /** What the setting controls, in English. */
  readonly description: string;
};

/**
 * Every setting the initial migration seeds, with its schema and default.
 *
 * The retention ladder comes first because it is the only group where a wrong value destroys
 * data rather than merely misbehaving.
 */
export const SETTINGS = [
  {
    key: 'history.telemetry.raw_retention_days',
    schema: retentionDaysSchema(RETENTION_MINIMUM_DAYS.raw),
    defaultValue: 30,
    description: 'How long raw readings are kept at full resolution',
  },
  {
    key: 'history.telemetry.tier_1m_retention_days',
    schema: retentionDaysSchema(RETENTION_MINIMUM_DAYS.tier1m),
    defaultValue: 365,
    description: 'How long one-minute buckets are kept',
  },
  {
    key: 'history.telemetry.tier_1h_retention_days',
    schema: retentionDaysSchema(RETENTION_MINIMUM_DAYS.tier1h),
    defaultValue: 1825,
    description: 'How long one-hour buckets are kept',
  },
  {
    key: 'history.telemetry.tier_1d_retention_days',
    schema: retentionDaysSchema(RETENTION_MINIMUM_DAYS.tier1d),
    defaultValue: null,
    description: 'How long daily buckets are kept. Null means forever',
  },
  {
    key: 'history.state_history.retention_days',
    schema: retentionDaysSchema(1),
    defaultValue: 365,
    description: 'How long entity state changes are kept',
  },
  {
    key: 'history.automation_runs.retention_days',
    schema: retentionDaysSchema(1),
    defaultValue: 30,
    description: 'How long automation execution traces are kept',
  },
  {
    key: 'history.logs.retention_days',
    schema: retentionDaysSchema(1),
    defaultValue: 14,
    description: 'How long application logs are kept',
  },
  {
    key: 'history.logs.min_level',
    schema: z.int().min(10).max(60),
    defaultValue: 20,
    description: 'Records below this pino level are dropped at ingest, not stored',
  },
  {
    key: 'system.audit_log.retention_days',
    schema: retentionDaysSchema(1),
    defaultValue: null,
    description: 'How long audit records are kept. Null means forever',
  },
  {
    key: 'ui.default_theme',
    schema: z.enum(['light', 'dark', 'system']),
    defaultValue: 'system',
    description: 'Theme applied to a user who has not chosen one',
  },
  {
    key: 'units.temperature',
    schema: z.enum(['celsius', 'fahrenheit']),
    defaultValue: 'celsius',
    description: 'Unit temperatures are displayed in',
  },
  {
    key: 'house.timezone',
    schema: timeZoneSchema,
    defaultValue: 'UTC',
    description:
      'The time zone the house keeps: time triggers, time windows and days are read in it',
  },
  {
    key: 'house.locale',
    schema: supportedLocaleSchema,
    defaultValue: DEFAULT_LOCALE,
    description:
      'The language the house speaks: the sign-in screen, and everyone who has not chosen their own',
  },
  {
    key: 'security.session_lifetime_hours',
    schema: z.int().min(1).max(8760),
    defaultValue: 720,
    description: 'How long a session stays valid before requiring a new sign-in',
  },
  {
    key: 'backup.enabled',
    schema: z.boolean(),
    defaultValue: false,
    description: 'Whether backups are taken on their schedule',
  },
  {
    key: 'backup.sections',
    schema: backupSectionsSchema,
    defaultValue: { history: true, packages: true, containers: true },
    description: 'Which of the optional parts a backup takes; the configuration is always taken',
  },
  {
    key: 'backup.schedule',
    schema: backupScheduleSchema,
    defaultValue: { mode: 'quietest', time: '03:00', timezone: 'UTC' },
    description: 'The time of day a backup runs at: a fixed one, or the quietest learned',
  },
  {
    key: 'backup.frequency',
    schema: backupFrequencySchema,
    defaultValue: { mode: 'daily' },
    description: 'The days a backup runs on',
  },
  {
    key: 'updates.auto.packages',
    schema: z.boolean(),
    defaultValue: false,
    description: 'Whether packages update by themselves, at the time below',
  },
  {
    key: 'updates.auto.integrations',
    schema: z.boolean(),
    defaultValue: false,
    description: 'Whether integrations update by themselves, at the time below',
  },
  {
    key: 'updates.window',
    schema: updateWindowSchema,
    defaultValue: { mode: 'quietest', time: '03:00' },
    description: 'When automatic updates run: a fixed time, or the quietest learned',
  },
  {
    key: 'updates.backup_first',
    schema: z.boolean(),
    defaultValue: true,
    description: 'A backup before each round of updates, unless one finished minutes ago',
  },
  {
    key: 'updates.channel.core',
    schema: updateChannelSchema,
    defaultValue: 'stable',
    description: 'Which releases of Nebula Home are offered: stable, betas too, or dev builds too',
  },
  {
    key: 'updates.channel.packages',
    schema: updateChannelSchema,
    defaultValue: 'stable',
    description: 'Which releases of packages are offered; betas are not published yet',
  },
  {
    key: 'updates.channel.integrations',
    schema: updateChannelSchema,
    defaultValue: 'stable',
    description: 'Which releases of integrations are offered; betas are not published yet',
  },
  {
    key: 'webhooks.allow_internet',
    schema: z.boolean(),
    defaultValue: true,
    description: 'Through remote access. Off: webhooks marked Internet answer 404 from outside',
  },
  {
    key: 'webhooks.rate_per_minute',
    schema: z.int().min(1).max(600),
    defaultValue: 30,
    description: 'Calls a minute one webhook takes; above it they get 429 and start nothing',
  },
] as const satisfies readonly SettingDefinition[];

/** Every setting key the platform knows about. */
export type SettingKey = (typeof SETTINGS)[number]['key'];

/** The pino numeric level for each severity, as stored in `history.logs.level`. */
export const PINO_LEVEL_BY_NAME = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
} as const satisfies Record<(typeof LOG_LEVELS)[number], number>;
