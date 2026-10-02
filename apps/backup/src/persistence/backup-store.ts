/**
 * What the backup service reads and writes as its own role: the settings, the locations and
 * their outcome, the runs, and the processor's load it learns the quiet hours from.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import {
  backupFrequencySchema,
  backupRetentionSchema,
  backupScheduleSchema,
  backupSectionsSchema,
  type BackupFrequency,
  type BackupLocationKind,
  type BackupRetention,
  type BackupRunStatus,
  type BackupSchedule,
  type BackupSection,
  type BackupSections,
  type JsonObject,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';

import type { LoadCell } from '../domain/quietest.js';

const { backupLocations, backupRuns, settings } = schema.system;

/** The backup settings, validated. */
export type BackupSettings = {
  readonly isEnabled: boolean;
  readonly sections: BackupSections;
  readonly schedule: BackupSchedule;
  readonly frequency: BackupFrequency;
};

/** What the settings are when a row is missing or does not parse: backups off, the defaults. */
const FALLBACK: BackupSettings = {
  isEnabled: false,
  sections: { history: true, packages: true },
  schedule: { mode: 'quietest', time: '03:00', timezone: 'UTC' },
  frequency: { mode: 'daily' },
};

/**
 * Reads the backup settings.
 *
 * @param db - The service's connection.
 * @returns The settings; the defaults for any that do not parse.
 */
export async function readBackupSettings(db: Database): Promise<BackupSettings> {
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(
      inArray(settings.key, [
        'backup.enabled',
        'backup.sections',
        'backup.schedule',
        'backup.frequency',
      ]),
    );
  /**
   * One setting's value.
   *
   * @param key - The setting.
   * @returns Its value, or undefined.
   */
  const value = (key: string): unknown => rows.find((row) => row.key === key)?.value;
  const enabled = value('backup.enabled');
  const sections = backupSectionsSchema.safeParse(value('backup.sections'));
  const schedule = backupScheduleSchema.safeParse(value('backup.schedule'));
  const frequency = backupFrequencySchema.safeParse(value('backup.frequency'));

  return {
    isEnabled: enabled === true,
    sections: sections.success ? sections.data : FALLBACK.sections,
    schedule: schedule.success ? schedule.data : FALLBACK.schedule,
    frequency: frequency.success ? frequency.data : FALLBACK.frequency,
  };
}

/**
 * The sections a backup with these settings takes.
 *
 * @param sections - The optional ones chosen.
 * @returns The configuration, and the optional ones chosen.
 */
export function sectionsOf(sections: BackupSections): BackupSection[] {
  return [
    'configuration',
    ...(sections.history ? (['history'] as const) : []),
    ...(sections.packages ? (['packages'] as const) : []),
  ];
}

/** A location as stored: its settings still sealed. */
export type StoredLocation = {
  readonly id: string;
  readonly name: string;
  readonly kind: BackupLocationKind;
  readonly config: JsonObject;
  readonly isEnabled: boolean;
  readonly retention: BackupRetention;
};

/**
 * Reads the locations.
 *
 * @param db - The service's connection.
 * @param options - Which.
 * @param options.onlyEnabled - Only those enabled.
 * @returns The locations, the system one first.
 */
export async function readLocations(
  db: Database,
  options: { readonly onlyEnabled: boolean },
): Promise<StoredLocation[]> {
  const rows = await db
    .select()
    .from(backupLocations)
    .where(options.onlyEnabled ? eq(backupLocations.isEnabled, true) : undefined)
    .orderBy(sql`${backupLocations.kind} <> 'system'`, backupLocations.createdAt);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind as BackupLocationKind,
    config: row.config as JsonObject,
    isEnabled: row.isEnabled,
    retention: backupRetentionSchema.parse({ mode: row.retentionMode, value: row.retentionValue }),
  }));
}

/**
 * Reads one location.
 *
 * @param db - The service's connection.
 * @param id - Its id.
 * @returns It, or null when there is none.
 */
export async function readLocation(db: Database, id: string): Promise<StoredLocation | null> {
  const all = await readLocations(db, { onlyEnabled: false });

  return all.find((location) => location.id === id) ?? null;
}

/**
 * Records how a location took the last archive.
 *
 * @param db - The service's connection.
 * @param id - The location.
 * @param outcome - Success, or the error.
 * @param outcome.error - What went wrong, or null when nothing did.
 * @param at - When.
 */
export async function recordLocationResult(
  db: Database,
  id: string,
  outcome: { readonly error: string | null },
  at: Date,
): Promise<void> {
  await db
    .update(backupLocations)
    .set(
      outcome.error === null
        ? { lastResult: 'success', lastError: null, lastSuccessAt: at }
        : { lastResult: 'failure', lastError: outcome.error.slice(0, 4000) },
    )
    .where(eq(backupLocations.id, id));
}

/** A run's opening facts. */
export type NewRun = {
  readonly kind: 'backup' | 'restore';
  readonly trigger: 'schedule' | 'catch_up' | 'manual' | 'pre_restore';
  readonly sections: readonly BackupSection[];
  readonly requestedBy: string | null;
  readonly scheduledFor: Date | null;
  readonly source?: JsonObject | undefined;
};

/**
 * Records a run as started.
 *
 * @param db - The service's connection.
 * @param run - What it is.
 * @returns Its id.
 */
export async function startRun(db: Database, run: NewRun): Promise<string> {
  const [row] = await db
    .insert(backupRuns)
    .values({
      kind: run.kind,
      trigger: run.trigger,
      sections: [...run.sections],
      requestedBy: run.requestedBy,
      scheduledFor: run.scheduledFor,
      source: run.source ?? null,
    })
    .returning({ id: backupRuns.id });

  if (row === undefined) {
    throw new Error('The run was not recorded');
  }

  return row.id;
}

/** How a run ended. */
export type RunOutcome = {
  readonly status: Exclude<BackupRunStatus, 'running'>;
  readonly archiveName?: string | null;
  readonly archiveBytes?: number | null;
  readonly sectionBytes?: Readonly<Record<string, number>>;
  readonly keyId?: string | null;
  readonly destinations?: readonly JsonObject[];
  readonly error?: string | null;
};

/**
 * Records how a run ended.
 *
 * @param db - The service's connection.
 * @param id - The run.
 * @param outcome - How it ended.
 * @param at - When.
 */
export async function finishRun(
  db: Database,
  id: string,
  outcome: RunOutcome,
  at: Date,
): Promise<void> {
  await db
    .update(backupRuns)
    .set({
      status: outcome.status,
      finishedAt: at,
      ...(outcome.archiveName === undefined ? {} : { archiveName: outcome.archiveName }),
      ...(outcome.archiveBytes === undefined ? {} : { archiveBytes: outcome.archiveBytes }),
      ...(outcome.sectionBytes === undefined ? {} : { sectionBytes: { ...outcome.sectionBytes } }),
      ...(outcome.keyId === undefined ? {} : { keyId: outcome.keyId }),
      ...(outcome.destinations === undefined ? {} : { destinations: [...outcome.destinations] }),
      ...(outcome.error === undefined ? {} : { error: outcome.error?.slice(0, 4000) ?? null }),
    })
    .where(eq(backupRuns.id, id));
}

/**
 * Marks the runs a previous process left running as interrupted.
 *
 * @param db - The service's connection.
 * @param at - When.
 * @returns How many there were.
 */
export async function interruptLeftoverRuns(db: Database, at: Date): Promise<number> {
  const rows = await db
    .update(backupRuns)
    .set({ status: 'interrupted', finishedAt: at, error: 'The backup service stopped during it' })
    .where(eq(backupRuns.status, 'running'))
    .returning({ id: backupRuns.id });

  return rows.length;
}

/** What the last backups say about the next one. */
export type BackupHistory = {
  /** The last backup that made an archive. */
  readonly lastArchive: {
    readonly runId: string;
    readonly status: BackupRunStatus;
    readonly archiveBytes: number | null;
    readonly finishedAt: Date | null;
    readonly sectionBytes: Readonly<Record<string, number>>;
  } | null;

  /** When the last backup of any kind started. */
  readonly lastStartedAt: Date | null;

  /** When the last scheduled backup started, for the quiet time in use. */
  readonly lastScheduledAt: Date | null;

  /** How long the last successful backups took, in minutes. */
  readonly recentDurationsMinutes: readonly number[];
};

/**
 * Reads what the last backups say about the next one.
 *
 * @param db - The service's connection.
 * @returns The history.
 */
export async function readBackupHistory(db: Database): Promise<BackupHistory> {
  const recent = await db
    .select()
    .from(backupRuns)
    .where(eq(backupRuns.kind, 'backup'))
    .orderBy(desc(backupRuns.startedAt))
    .limit(20);
  const last = recent.find(
    (run) => run.archiveBytes !== null && (run.status === 'success' || run.status === 'partial'),
  );

  return {
    lastArchive:
      last === undefined
        ? null
        : {
            runId: last.id,
            status: last.status as BackupRunStatus,
            archiveBytes: last.archiveBytes,
            finishedAt: last.finishedAt,
            sectionBytes: last.sectionBytes as Record<string, number>,
          },
    lastStartedAt: recent[0]?.startedAt ?? null,
    lastScheduledAt: recent.find((run) => run.trigger === 'schedule')?.startedAt ?? null,
    recentDurationsMinutes: recent
      .filter((run) => run.status === 'success' && run.finishedAt !== null)
      .slice(0, 5)
      .map((run) => ((run.finishedAt?.getTime() ?? 0) - run.startedAt.getTime()) / 60_000),
  };
}

/**
 * Reads the processor's load, in quarter hours of the schedule's day, leaving out the windows the
 * backups ran in.
 *
 * @param db - The service's connection.
 * @param options - Over how long, and in which time zone.
 * @param options.days - How many days back.
 * @param options.timezone - The schedule's time zone.
 * @returns The cells, one per day and quarter hour that has any load.
 */
export async function readProcessorLoad(
  db: Database,
  options: { readonly days: number; readonly timezone: string },
): Promise<LoadCell[]> {
  const rows = await db.execute<{ day: string; slot: number; load: number }>(sql`
    SELECT to_char(t.bucket AT TIME ZONE ${options.timezone}, 'YYYY-MM-DD') AS day,
           (extract(hour FROM t.bucket AT TIME ZONE ${options.timezone})::int * 4
             + extract(minute FROM t.bucket AT TIME ZONE ${options.timezone})::int / 15) AS slot,
           avg(t.avg_value)::float8 AS load
    FROM history.telemetry_1m t
    WHERE t.entity_id = (SELECT id FROM registry.entities
                         WHERE entity_id = 'sensor.system_cpu_usage')
      AND t.bucket >= now() - make_interval(days => ${options.days})
      AND NOT EXISTS (
        SELECT 1 FROM system.backup_runs r
        WHERE t.bucket BETWEEN r.started_at - interval '10 minutes'
                           AND coalesce(r.finished_at, now()) + interval '10 minutes')
    GROUP BY 1, 2`);

  // The driver hands numbers back as it read them, which for a float is text.
  return rows.map((row) => ({
    day: row.day,
    slot: Number(String(row.slot)),
    load: Number(String(row.load)),
  }));
}

/**
 * Whether the processor's load is being recorded at all.
 *
 * @param db - The service's connection.
 * @returns True when the entity exists.
 */
export async function hasProcessorLoad(db: Database): Promise<boolean> {
  const rows = await db.execute<{ found: boolean }>(
    sql`SELECT EXISTS (SELECT 1 FROM registry.entities WHERE entity_id = 'sensor.system_cpu_usage') AS found`,
  );

  return rows[0]?.found === true;
}

/**
 * The status of one run.
 *
 * @param db - The service's connection.
 * @param id - The run.
 * @returns Its status, or null.
 */
export async function runStatus(db: Database, id: string): Promise<BackupRunStatus | null> {
  const [row] = await db
    .select({ status: backupRuns.status })
    .from(backupRuns)
    .where(and(eq(backupRuns.id, id)));

  return (row?.status as BackupRunStatus | undefined) ?? null;
}
