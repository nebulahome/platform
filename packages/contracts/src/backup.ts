/**
 * Backups: what is taken, when, where to, and how an archive is brought back.
 *
 * A backup is always full - never incremental - and always encrypted, with a key the
 * installation generated on its first start and the owner downloads. It is one file per run,
 * written to every enabled location: the system location in the data directory and the ones the
 * owner adds - a folder on the machine, an SMB share, an FTP server, an NFS export - each keeping
 * as many archives, or as many days of them, as it is told.
 *
 * The `backup` service does the work; `api` is its gateway. What crosses the bus between them and
 * what `api` answers the browser are both declared here. See ARCHITECTURE.md 14 and DATABASE.md 15.
 */
import { z } from 'zod';

import { DAYS_OF_WEEK } from './automation-meta.js';
import { timestampSchema } from './timestamp.js';

// ---------------------------------------------------------------------------------------------
// What is taken
// ---------------------------------------------------------------------------------------------

/**
 * The parts of an installation a backup takes.
 *
 * `configuration` - users, devices, automations, settings, the audit log, the installed
 * integrations and the certificate - is always taken: an archive without it restores nothing a
 * person could use. `history` and `packages` are the owner's choice, being the large parts.
 */
export const BACKUP_SECTIONS = ['configuration', 'history', 'packages'] as const;

/** One part of a backup. */
export type BackupSection = (typeof BACKUP_SECTIONS)[number];

/** The parts the owner may leave out. */
export const OPTIONAL_BACKUP_SECTIONS = ['history', 'packages'] as const;

/** The value of `backup.sections`: which of the optional parts are taken. */
export const backupSectionsSchema = z.strictObject({
  history: z.boolean(),
  packages: z.boolean(),
});

/** Which of the optional parts are taken. */
export type BackupSections = z.output<typeof backupSectionsSchema>;

// ---------------------------------------------------------------------------------------------
// When
// ---------------------------------------------------------------------------------------------

/** A time of day, `HH:MM` on a 24-hour clock. */
export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/u, 'Must be HH:MM on a 24-hour clock');

/**
 * Whether a string names a time zone this runtime knows.
 *
 * @param value - The name, such as `Europe/Rome`.
 * @returns True when `Intl` accepts it.
 */
function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });

    return true;
  } catch {
    return false;
  }
}

/** An IANA time zone, such as `Europe/Rome`. */
export const timeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isTimeZone, { message: 'Must be an IANA time zone, such as Europe/Rome' });

/**
 * How the time of day is chosen: the one the owner set, or the quietest the machine has been,
 * learned from its processor load over the last weeks.
 */
export const BACKUP_SCHEDULE_MODES = ['fixed', 'quietest'] as const;

/** How the time of day is chosen. */
export type BackupScheduleMode = (typeof BACKUP_SCHEDULE_MODES)[number];

/**
 * The value of `backup.schedule`.
 *
 * `time` is the time a fixed schedule runs at, and the one a learning schedule uses until it has
 * learned. `timezone` is the one the time is meant in: the interface sets it to the browser's
 * when the time is changed, so 03:00 is three in the morning where the owner is.
 */
export const backupScheduleSchema = z.strictObject({
  mode: z.enum(BACKUP_SCHEDULE_MODES),
  time: timeOfDaySchema,
  timezone: timeZoneSchema,
});

/** When in the day a backup runs. */
export type BackupSchedule = z.output<typeof backupScheduleSchema>;

/** How often: every day, one day a week, or the days the owner picked. */
export const BACKUP_FREQUENCY_MODES = ['daily', 'weekly', 'custom'] as const;

/** The value of `backup.frequency`. */
export const backupFrequencySchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('daily') }),
  z.strictObject({ mode: z.literal('weekly'), day: z.enum(DAYS_OF_WEEK) }),
  z.strictObject({
    mode: z.literal('custom'),
    days: z
      .array(z.enum(DAYS_OF_WEEK))
      .min(1)
      .max(7)
      .refine((days) => new Set(days).size === days.length, 'Each day once'),
  }),
]);

/** Which days a backup runs on. */
export type BackupFrequency = z.output<typeof backupFrequencySchema>;

// ---------------------------------------------------------------------------------------------
// Where to
// ---------------------------------------------------------------------------------------------

/**
 * The kinds of location. `system` is the one in the data directory, which always exists and
 * cannot be removed; the others are added by the owner.
 */
export const BACKUP_LOCATION_KINDS = ['system', 'local', 'smb', 'ftp', 'nfs'] as const;

/** A kind of location. */
export type BackupLocationKind = (typeof BACKUP_LOCATION_KINDS)[number];

/** The kinds the owner adds. */
export const USER_BACKUP_LOCATION_KINDS = ['local', 'smb', 'ftp', 'nfs'] as const;

/** How a location decides which archives to keep: the newest few, or the last so many days. */
export const BACKUP_RETENTION_MODES = ['count', 'days'] as const;

/** How many archives, or days, a location keeps. */
export const backupRetentionSchema = z.strictObject({
  mode: z.enum(BACKUP_RETENTION_MODES),
  value: z.int().min(1).max(3650),
});

/** How many archives, or days, a location keeps. */
export type BackupRetention = z.output<typeof backupRetentionSchema>;

/**
 * A host: a name or an address, and nothing else.
 *
 * Strict because it reaches a mount command's arguments: no comma, slash, backslash, space or
 * quote can be in it, so it cannot carry an option of its own.
 */
export const backupHostSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, 'Must be a host name or an IP address');

/**
 * A path inside a share, a server or an export: folders separated by `/`, none of them `..`.
 *
 * Empty for the top. Leading and trailing slashes are allowed and mean nothing.
 */
export const backupRemotePathSchema = z
  .string()
  .max(255)
  .regex(/^[^\\,\p{Cc}]*$/u, 'Must not contain a backslash, a comma or a control character')
  .refine((value) => !value.split('/').includes('..'), 'Must not climb out of the folder with ..');

/** An absolute path on the machine the platform runs on. */
export const backupLocalPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^\/\P{Cc}*$/u, 'Must be an absolute path, starting with /')
  .refine((value) => !value.split('/').includes('..'), 'Must not contain ..');

/** Where on the machine a local location may not be: the system's own trees. */
const FORBIDDEN_LOCAL_ROOTS = [
  '/proc',
  '/sys',
  '/dev',
  '/run',
  '/etc',
  '/bin',
  '/sbin',
  '/usr',
  '/lib',
];

/**
 * Says why a folder cannot be a local location, if it cannot.
 *
 * Not inside the data directory - a backup would be backed up into itself, and its `backups/` is
 * the system location already - nor in the system's own trees.
 *
 * @param folder - An absolute path.
 * @param dataDir - The data directory.
 * @returns Why not, in English, or null when it can.
 */
export function localPathProblem(folder: string, dataDir: string): string | null {
  /**
   * A path without its trailing slashes.
   *
   * @param value - The path.
   * @returns It, or `/` for the root.
   */
  const clean = (value: string): string => value.replace(/\/+$/u, '') || '/';
  const target = clean(folder);
  const data = clean(dataDir);
  /**
   * Says whether the folder is a root or inside it.
   *
   * @param root - The root.
   * @returns True when it is.
   */
  const isUnder = (root: string): boolean => target === root || target.startsWith(`${root}/`);

  if (target === '/') {
    return 'Choose a folder, not the whole file system';
  }

  if (isUnder(data)) {
    return 'The data directory is backed up itself: choose a folder outside it';
  }

  if (FORBIDDEN_LOCAL_ROOTS.some(isUnder)) {
    return 'A system folder cannot hold backups: choose a disk or a folder of your own';
  }

  return null;
}

/** An SMB share's name. */
export const backupShareSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[^\\/,:*?"<>|\p{Cc}]+$/u, 'Must be a share name, without slashes');

/** An NFS export: the absolute path the server exports. */
export const backupExportSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^\/[^\\,\p{Cc}]*$/u, 'Must be an absolute path, starting with /')
  .refine((value) => !value.split('/').includes('..'), 'Must not contain ..');

/** A user name for a share or a server. */
const credentialUserSchema = z
  .string()
  .max(128)
  .regex(/^\P{Cc}*$/u, 'Must be one line');

/** A password, as typed. Never returned: a view says only whether there is one. */
const credentialPasswordSchema = z.string().max(256);

/** The SMB dialects that may be asked for; `auto` lets the two sides agree. */
export const SMB_VERSIONS = ['auto', '3.1.1', '3.0', '2.1'] as const;

/** The NFS versions that may be asked for; `auto` lets the two sides agree. */
export const NFS_VERSIONS = ['auto', '4.2', '4.1', '4', '3'] as const;

/** How an FTP connection is protected: not at all, STARTTLS, or TLS from the first byte. */
export const FTP_SECURITY_MODES = ['none', 'explicit', 'implicit'] as const;

/** Where a location writes, as the owner gives it: a password is plain text here. */
export const backupTargetInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('local'), path: backupLocalPathSchema }),
  z.strictObject({
    kind: z.literal('smb'),
    host: backupHostSchema,
    share: backupShareSchema,
    path: backupRemotePathSchema.default(''),
    username: credentialUserSchema.default(''),
    password: credentialPasswordSchema.optional(),
    domain: z
      .string()
      .max(64)
      .regex(/^[A-Za-z0-9._-]*$/u)
      .default(''),
    version: z.enum(SMB_VERSIONS).default('auto'),
  }),
  z.strictObject({
    kind: z.literal('ftp'),
    host: backupHostSchema,
    port: z.int().min(1).max(65_535).nullable().default(null),
    security: z.enum(FTP_SECURITY_MODES).default('explicit'),
    allowSelfSigned: z.boolean().default(false),
    path: backupRemotePathSchema.default(''),
    username: credentialUserSchema.default(''),
    password: credentialPasswordSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal('nfs'),
    host: backupHostSchema,
    export: backupExportSchema,
    path: backupRemotePathSchema.default(''),
    version: z.enum(NFS_VERSIONS).default('auto'),
  }),
]);

/** Where a location writes, as the owner gives it. */
export type BackupTargetInput = z.output<typeof backupTargetInputSchema>;

/** Where a location writes, as it is shown: the password replaced by whether there is one. */
export const backupTargetViewSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('system') }),
  z.strictObject({ kind: z.literal('local'), path: z.string() }),
  z.strictObject({
    kind: z.literal('smb'),
    host: z.string(),
    share: z.string(),
    path: z.string(),
    username: z.string(),
    hasPassword: z.boolean(),
    domain: z.string(),
    version: z.enum(SMB_VERSIONS),
  }),
  z.strictObject({
    kind: z.literal('ftp'),
    host: z.string(),
    port: z.int().nullable(),
    security: z.enum(FTP_SECURITY_MODES),
    allowSelfSigned: z.boolean(),
    path: z.string(),
    username: z.string(),
    hasPassword: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('nfs'),
    host: z.string(),
    export: z.string(),
    path: z.string(),
    version: z.enum(NFS_VERSIONS),
  }),
]);

/** Where a location writes, as it is shown. */
export type BackupTargetView = z.output<typeof backupTargetViewSchema>;

/** How the last backup went at one location. */
export const BACKUP_LOCATION_RESULTS = ['success', 'failure'] as const;

/** One location, as the interface sees it. */
export const backupLocationViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  target: backupTargetViewSchema,
  isEnabled: z.boolean(),
  retention: backupRetentionSchema,
  lastResult: z.enum(BACKUP_LOCATION_RESULTS).nullable(),
  lastError: z.string().nullable(),
  lastSuccessAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

/** One location, as the interface sees it. */
export type BackupLocationView = z.output<typeof backupLocationViewSchema>;

/** A location's name. */
const locationNameSchema = z.string().trim().min(1).max(80);

/** Adding a location. */
export const backupLocationCreateSchema = z.strictObject({
  name: locationNameSchema,
  target: backupTargetInputSchema,
  isEnabled: z.boolean().default(true),
  retention: backupRetentionSchema.default({ mode: 'count', value: 7 }),
});

/** Adding a location. */
export type BackupLocationCreate = z.output<typeof backupLocationCreateSchema>;

/**
 * Changing a location. Every field is optional; a target without a password keeps the stored
 * one. The system location takes only `isEnabled` and `retention`.
 */
export const backupLocationUpdateSchema = z
  .strictObject({
    name: locationNameSchema,
    target: backupTargetInputSchema,
    isEnabled: z.boolean(),
    retention: backupRetentionSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Change at least one field');

/** Changing a location. */
export type BackupLocationUpdate = z.output<typeof backupLocationUpdateSchema>;

/** A list of locations. */
export const backupLocationListSchema = z.object({ items: z.array(backupLocationViewSchema) });

/** Trying a location before it is saved, or again after. */
export const backupLocationTestSchema = z.strictObject({
  target: backupTargetInputSchema,

  /** The saved location being tried, whose password is used when none is typed. */
  locationId: z.uuid().optional(),
});

/** Trying a location. */
export type BackupLocationTest = z.output<typeof backupLocationTestSchema>;

/** What trying a location found. */
export const backupLocationTestResultSchema = z.object({
  isReachable: z.boolean(),

  /** What went wrong, in the transport's own words; null when it worked. */
  message: z.string().nullable(),

  /** The room left there, when the location can say. */
  freeBytes: z.number().nullable(),

  /** How many of our archives are there already. */
  archiveCount: z.int().nullable(),
});

/** What trying a location found. */
export type BackupLocationTestResult = z.output<typeof backupLocationTestResultSchema>;

/** A folder on the machine, for the local location's folder picker. */
export const backupBrowseRequestSchema = z.strictObject({
  /** The folder to list; the top of the file system when absent. */
  path: backupLocalPathSchema.optional(),
});

/** A folder's folders. */
export const backupBrowseResultSchema = z.object({
  path: z.string(),

  /** The folder above; null at the top. */
  parent: z.string().nullable(),

  /** The folders in it, by name, sorted. */
  directories: z.array(z.string()),

  /** Whether there were more than could be listed. */
  isTruncated: z.boolean(),

  /** Whether a backup could be written here. */
  isWritable: z.boolean(),
});

/** A folder's folders. */
export type BackupBrowseResult = z.output<typeof backupBrowseResultSchema>;

// ---------------------------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------------------------

/** What a run did: take a backup, or restore one. */
export const BACKUP_RUN_KINDS = ['backup', 'restore'] as const;

/** Why it ran. */
export const BACKUP_RUN_TRIGGERS = ['schedule', 'catch_up', 'manual', 'pre_restore'] as const;

/** How it went. `partial`: the archive was made, and some locations did not take it. */
export const BACKUP_RUN_STATUSES = [
  'running',
  'success',
  'partial',
  'failure',
  'interrupted',
  'cancelled',
] as const;

/** How a run went. */
export type BackupRunStatus = (typeof BACKUP_RUN_STATUSES)[number];

/** How one location took an archive. */
export const backupDestinationSchema = z.object({
  locationId: z.uuid(),
  name: z.string(),
  kind: z.enum(BACKUP_LOCATION_KINDS),
  status: z.enum(['success', 'failure']),
  error: z.string().nullable(),
  bytes: z.number().nullable(),
  durationMs: z.number(),

  /** How many older archives it removed afterwards, by its retention. */
  pruned: z.int(),
});

/** How one location took an archive. */
export type BackupDestination = z.output<typeof backupDestinationSchema>;

/** One run, as the interface sees it. */
export const backupRunViewSchema = z.object({
  id: z.uuid(),
  kind: z.enum(BACKUP_RUN_KINDS),
  trigger: z.enum(BACKUP_RUN_TRIGGERS),
  status: z.enum(BACKUP_RUN_STATUSES),
  sections: z.array(z.enum(BACKUP_SECTIONS)),
  archiveName: z.string().nullable(),
  archiveBytes: z.number().nullable(),
  destinations: z.array(backupDestinationSchema),
  error: z.string().nullable(),
  startedAt: timestampSchema,
  finishedAt: timestampSchema.nullable(),
  requestedBy: z.object({ id: z.uuid(), username: z.string() }).nullable(),
});

/** One run. */
export type BackupRunView = z.output<typeof backupRunViewSchema>;

/** The latest runs. */
export const backupRunListSchema = z.object({ items: z.array(backupRunViewSchema) });

/** Starting a backup now. */
export const backupRunStartedSchema = z.object({ runId: z.uuid() });

// ---------------------------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------------------------

/** How the quietest time of day is known: learned, still learning, or not at all. */
export const QUIET_TIME_STATES = ['ready', 'learning', 'unavailable'] as const;

/** The quietest time of day, as learned from the processor's load. */
export const quietTimeSchema = z.object({
  state: z.enum(QUIET_TIME_STATES),

  /** The time a backup starts at: the learned one, or the fallback while learning. */
  time: timeOfDaySchema,

  /** The mean load over the run's expected length at that time, in percent. */
  meanLoadPercent: z.number().nullable(),

  /** How many days of load it was learned from, and how many it needs at least. */
  daysOfData: z.int(),
  daysNeeded: z.int(),

  /** The day's load profile, 96 quarter hours from midnight, smoothed; null where unknown. */
  profile: z.array(z.number().nullable()),

  /** Why it is not learned, in English; null when it is. */
  reason: z.string().nullable(),

  /** The zone the time is in, the house's (`sensor.system_quiet_time`); null when not known. */
  timezone: z.string().nullable().optional(),
});

/** The quietest time of day. */
export type QuietTime = z.output<typeof quietTimeSchema>;

/** The size each part of a backup is estimated at. */
export const backupEstimatesSchema = z.object({
  configuration: z.number(),
  history: z.number(),
  packages: z.number(),

  /**
   * What the figures come from: what is on disk now, or the last backup's measured sizes scaled
   * by how much has grown since.
   */
  basis: z.enum(['disk', 'last-backup']),
  measuredAt: timestampSchema,
});

/** The size each part of a backup is estimated at. */
export type BackupEstimates = z.output<typeof backupEstimatesSchema>;

/** What a run is doing now. */
export const BACKUP_PHASES = [
  'preparing',
  'dumping',
  'packing',
  'uploading',
  'pruning',
  'downloading',
  'verifying',
  'safety_backup',
  'restoring_database',
  'reconciling',
  'switching',
  'starting_services',
  'finishing',
] as const;

/** What a run is doing now. */
export type BackupPhase = (typeof BACKUP_PHASES)[number];

/** A run in progress. */
export const backupActiveRunSchema = z.object({
  runId: z.uuid(),
  kind: z.enum(BACKUP_RUN_KINDS),
  phase: z.enum(BACKUP_PHASES),
  startedAt: timestampSchema,
  bytesDone: z.number(),
  bytesTotal: z.number().nullable(),
});

/**
 * What `backup` announces while a run moves - it began, went on to another phase, or ended - so a
 * page watching the backups follows a run without asking every second.
 */
export const backupEventSchema = z.object({
  runId: z.uuid(),
  kind: z.enum(BACKUP_RUN_KINDS),

  /** The phase it is in; null once it ended. */
  phase: z.enum(BACKUP_PHASES).nullable(),

  /** `running` until it ended, then how it ended. */
  status: z.enum(BACKUP_RUN_STATUSES),
});

/** What `backup` announces while a run moves. */
export type BackupEvent = z.output<typeof backupEventSchema>;

/** The backup key, as the interface may know it: never the key itself. */
export const backupKeyInfoSchema = z.object({
  keyId: z.string(),
  source: z.enum(['file', 'environment']),
  createdAt: timestampSchema.nullable(),
});

/** What the service can do on this machine. */
export const backupCapabilitiesSchema = z.object({
  /** Whether SMB and NFS shares can be mounted, and why not when they cannot. */
  canMount: z.boolean(),
  mountProblem: z.string().nullable(),
});

/** The backup service's state, as `svc.backup.status` answers it. */
export const backupStatusSchema = z.object({
  isEnabled: z.boolean(),
  schedule: z.object({
    mode: z.enum(BACKUP_SCHEDULE_MODES),

    /** The time the next run starts at: the fixed one, or the learned one. */
    time: timeOfDaySchema,
    timezone: z.string(),
    nextRunAt: timestampSchema.nullable(),
  }),
  quietTime: quietTimeSchema,
  estimates: backupEstimatesSchema.nullable(),
  lastBackup: z
    .object({
      runId: z.uuid(),
      status: z.enum(BACKUP_RUN_STATUSES),
      archiveBytes: z.number().nullable(),
      finishedAt: timestampSchema.nullable(),

      /** The parts it took: an update backs up first unless a recent one took what it touches. */
      sections: z.array(z.enum(BACKUP_SECTIONS)).default([]),
    })
    .nullable(),
  active: backupActiveRunSchema.nullable(),
  key: backupKeyInfoSchema,
  capabilities: backupCapabilitiesSchema,

  /** What stops backups from working at all, in English. */
  problems: z.array(z.object({ code: z.string(), message: z.string() })),

  /** Whether the installation is being restored, and how the last restore ended. */
  maintenance: z.lazy(() => maintenanceStateSchema),

  /** Whether a restore can be run here: only in the NebulaHome container. */
  canRestore: z.boolean(),
});

/** The backup service's state. */
export type BackupStatus = z.output<typeof backupStatusSchema>;

/** The status as `api` answers it: with when the key was last downloaded, from the audit log. */
export const backupStatusViewSchema = backupStatusSchema.extend({
  key: backupKeyInfoSchema.extend({ downloadedAt: timestampSchema.nullable() }),
});

/** The status as `api` answers it. */
export type BackupStatusView = z.output<typeof backupStatusViewSchema>;

// ---------------------------------------------------------------------------------------------
// The key
// ---------------------------------------------------------------------------------------------

/**
 * The backup key's file: what is generated on the first start, what the owner downloads, and
 * what they upload to restore an archive on another machine.
 */
export const backupKeyFileSchema = z.object({
  format: z.literal('nebulahome-backup-key'),
  version: z.literal(1),
  keyId: z.string().regex(/^[0-9a-f]{32}$/u),
  key: z.string().regex(/^[0-9a-f]{64}$/u),
  createdAt: z.iso.datetime({ offset: true }),
});

/** The backup key's file. */
export type BackupKeyFile = z.output<typeof backupKeyFileSchema>;

/** Downloading the key: the password again, since the key opens every archive. */
export const backupKeyRequestSchema = z.strictObject({ password: z.string().min(1).max(1024) });

// ---------------------------------------------------------------------------------------------
// Archives and restore
// ---------------------------------------------------------------------------------------------

/** Whether an archive can be restored here, and if not, why. */
export const ARCHIVE_RESTORABILITY = [
  'ok',
  'needs-key',
  'schema-mismatch',
  'timescale-mismatch',
  'unreadable',
] as const;

/** What an archive's plain header says, without opening it. */
export const backupArchiveSchema = z.object({
  locationId: z.uuid(),
  locationName: z.string(),
  name: z.string(),
  createdAt: timestampSchema,
  bytes: z.number(),
  sections: z.array(z.enum(BACKUP_SECTIONS)),
  keyId: z.string().nullable(),
  platformVersion: z.string().nullable(),
  restorable: z.enum(ARCHIVE_RESTORABILITY),
});

/** One archive. */
export type BackupArchive = z.output<typeof backupArchiveSchema>;

/** The archives in every enabled location, and the locations that could not be read. */
export const backupArchiveListSchema = z.object({
  items: z.array(backupArchiveSchema),
  problems: z.array(z.object({ locationId: z.uuid(), name: z.string(), message: z.string() })),
});

/** Restoring an archive. */
export const backupRestoreRequestSchema = z.strictObject({
  locationId: z.uuid(),
  archiveName: z.string().min(1).max(255),
  password: z.string().min(1).max(1024),

  /** The key file's text, when the archive was made with another installation's key. */
  keyFile: z.string().max(4096).optional(),

  /** Whether to back up what is here now, first. */
  takeSafetyBackup: z.boolean().default(true),
});

/** Restoring an archive. */
export type BackupRestoreRequest = z.output<typeof backupRestoreRequestSchema>;

// ---------------------------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------------------------

/** How a restore ended. */
export const RESTORE_OUTCOMES = ['restored', 'failed', 'rolled_back', 'manual'] as const;

/**
 * The installation's maintenance state: normal, or being restored - and how the last restore
 * ended. Published by `backup` on every change; `api` answers 503 while it is `restoring`.
 */
export const maintenanceStateSchema = z.object({
  state: z.enum(['normal', 'restoring']),
  runId: z.uuid().nullable(),
  phase: z.enum(BACKUP_PHASES).nullable(),

  /** How far along, 0 to 100, when it can be said. */
  percent: z.number().min(0).max(100).nullable(),
  outcome: z.enum(RESTORE_OUTCOMES).nullable(),

  /** What the owner should know, in English: why it failed, what to do next. */
  message: z.string().nullable(),

  /**
   * Access tokens issued before this moment are no longer accepted: after a restore, the users,
   * roles and sessions are the archive's.
   */
  tokensInvalidBefore: timestampSchema.nullable(),
});

/** The installation's maintenance state. */
export type MaintenanceState = z.output<typeof maintenanceStateSchema>;

// ---------------------------------------------------------------------------------------------
// The bus
// ---------------------------------------------------------------------------------------------

/** The service name backups are asked of on the bus. */
export const BACKUP_SERVICE = 'backup';

/** The methods `backup` answers, each `nebula.v1.svc.backup.<method>`. */
export const BACKUP_METHODS = {
  status: 'status',
  reload: 'reload',
  run: 'run',
  cancel: 'cancel',
  testLocation: 'test_location',
  browse: 'browse',
  archives: 'archives',
  restore: 'restore',
  key: 'key',
} as const;

/** Who asked, for the run's record. */
const requesterSchema = z.object({ id: z.uuid(), username: z.string() }).nullable().default(null);

/** `svc.backup.status`, `svc.backup.reload`, `svc.backup.archives`, `svc.backup.key`. */
export const backupEmptyRequestSchema = z.strictObject({});

/** `svc.backup.run`. */
export const backupRunRequestSchema = z.strictObject({ requestedBy: requesterSchema });

/** `svc.backup.cancel`. */
export const backupCancelRequestSchema = z.strictObject({ runId: z.uuid() });

/** The reply to `svc.backup.reload` and `svc.backup.cancel`. */
export const backupAcknowledgementSchema = z.object({ ok: z.literal(true) });

/**
 * `svc.backup.test_location`: the target as typed, its password in clear on the internal bus,
 * or the saved location's password when none is typed.
 */
export const backupTestRequestSchema = backupLocationTestSchema;

/**
 * `svc.backup.key`'s reply: the key file sealed with the instance's secrets key, so the key is
 * never in clear on the bus.
 */
export const backupKeyReplySchema = z.object({ sealed: z.string() });

/** `svc.backup.restore`. The key file arrives sealed, as the key leaves. */
export const backupRestoreBusRequestSchema = z.strictObject({
  locationId: z.uuid(),
  archiveName: z.string().min(1).max(255),
  sealedKeyFile: z.string().max(8192).optional(),
  takeSafetyBackup: z.boolean(),
  requestedBy: requesterSchema,
});
