/**
 * The backup service: its schedule, the one run it does at a time, and everything it answers.
 *
 * One run at a time - a backup or a restore - and a second is refused while one runs. The
 * schedule is rebuilt whenever the settings change (`svc.backup.reload`, sent by `api`), at start,
 * and once a day just after midnight, when the quietest time is learned again from the day that
 * just ended. A backup the machine was off for is taken a few minutes after it starts again.
 */
import { access, constants, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { Cron } from 'croner';

import type { BusClient, BusSubscription } from '@nebulahome/bus';
import { resolveDataLayout } from '@nebulahome/config';
import {
  ConflictError,
  NotFoundError,
  SUPERVISOR_METHODS,
  SUPERVISOR_SERVICE,
  supervisorAcknowledgementSchema,
  volumesExportReplySchema,
  volumesImportReplySchema,
  ValidationError,
  busSubjects,
  localPathProblem,
  type BackupArchive,
  type BackupBrowseResult,
  type BackupKeyFile,
  type BackupLocationTest,
  type BackupLocationTestResult,
  type BackupPhase,
  type BackupRunStatus,
  type BackupStatus,
  type MaintenanceState,
  type QuietTime,
} from '@nebulahome/contracts';
import {
  openSecret,
  openSecrets,
  readSchemaVersion,
  sealSecret,
  type Database,
} from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import { MAX_HEADER_LENGTH, readArchiveHeader } from './archive/stream-cipher.js';
import { adminDatabaseUrl, type BackupConfig } from './config.js';
import { parseArchiveName } from './domain/archive-name.js';
import { quietestTime } from './domain/quietest.js';
import { cronPatternFor, daysOf, isBackupOwed } from './domain/schedule.js';
import { loadBackupKey, parseKeyFile, type BackupKey } from './key/backup-key.js';
import {
  finishRun,
  hasProcessorLoad,
  interruptLeftoverRuns,
  readBackupHistory,
  readBackupSettings,
  readLocation,
  readLocations,
  readProcessorLoad,
  sectionsOf,
  startRun,
  type BackupSettings,
} from './persistence/backup-store.js';
import {
  takeBackup,
  destinationJson,
  messageOf,
  type BackupJobOutcome,
} from './services/backup-job.js';
import {
  EstimateCache,
  estimateSections,
  measureOnDisk,
  type OnDisk,
} from './services/estimates.js';
import { recordRestore, restoreArchive } from './services/restore-job.js';
import { Supervisor } from './services/supervisor.js';
import { mountProblem } from './transports/mount.js';
import {
  openLocation,
  targetOf,
  type LocationTarget,
  type OpenDependencies,
} from './transports/open-location.js';

/**
 * How long the supervisor has to stop or start the containers that keep their data in the data
 * directory: one at a time, each given up to 20 s to stop. One that is away answers at once.
 */
const SUPERVISOR_TIMEOUT_MS = 300_000;

/** How long the supervisor has to copy the named volumes out or back: they can be gigabytes. */
const VOLUMES_TIMEOUT_MS = 2 * 60 * 60 * 1000;
/** How many days of load the quietest time is learned from. */
const LEARNING_DAYS = 28;

/** How long a backup is assumed to take before one has been timed, in minutes. */
const DEFAULT_DURATION_MINUTES = 10;

/** The most folders the folder picker lists at once. */
const BROWSE_LIMIT = 500;

/** The phases during which `api` answers 503: the database is about to change under it. */
const MAINTENANCE_PHASES: readonly BackupPhase[] = [
  'restoring_database',
  'reconciling',
  'switching',
  'starting_services',
  'finishing',
];

/** The run in progress. */
type ActiveRun = {
  readonly runId: string;
  readonly kind: 'backup' | 'restore';
  readonly startedAt: Date;
  readonly abort: AbortController;
  phase: BackupPhase;
  bytesDone: number;
  bytesTotal: number | null;
};

/** What the service needs. */
export type BackupServiceOptions = {
  readonly config: BackupConfig;
  readonly db: Database;
  readonly client: BusClient;
  readonly logger: PlatformLogger;
  readonly now?: () => Date;
};

/** The state of no maintenance, and no restore to speak of. */
const NORMAL: MaintenanceState = {
  state: 'normal',
  runId: null,
  phase: null,
  percent: null,
  outcome: null,
  message: null,
  tokensInvalidBefore: null,
};

/**
 * A date as the day it is in a time zone.
 *
 * @param date - The moment.
 * @param timezone - The zone.
 * @returns `YYYY-MM-DD`.
 */
function dayIn(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * A date as the time of day it is in a time zone.
 *
 * @param date - The moment.
 * @param timezone - The zone.
 * @returns `HH:MM`.
 */
function timeIn(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  /**
   * One part of the formatted time.
   *
   * @param type - Which: `hour` or `minute`.
   * @returns Its digits.
   */
  const part = (type: string): string => parts.find((each) => each.type === type)?.value ?? '00';

  return `${part('hour')}:${part('minute')}`;
}

/**
 * The middle of some numbers.
 *
 * @param values - The numbers.
 * @returns Their median, or null for none.
 */
function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** The backup service. */
export class BackupService {
  readonly #config: BackupConfig;
  readonly #db: Database;
  readonly #client: BusClient;
  readonly #logger: PlatformLogger;
  readonly #now: () => Date;
  readonly #layout: ReturnType<typeof resolveDataLayout>;
  readonly #supervisor: Supervisor;
  readonly #estimates = new EstimateCache();
  readonly #secretsKey: Buffer;
  #key: BackupKey | null = null;
  #settings: BackupSettings | null = null;
  #quietTime: QuietTime | null = null;
  #jobs: Cron[] = [];
  #catchUp: NodeJS.Timeout | null = null;
  #active: ActiveRun | null = null;
  #maintenance: MaintenanceState = NORMAL;
  #subscriptions: BusSubscription[] = [];

  /**
   * @param options - See {@link BackupServiceOptions}.
   */
  public constructor(options: BackupServiceOptions) {
    this.#config = options.config;
    this.#db = options.db;
    this.#client = options.client;
    this.#logger = options.logger;
    this.#now = options.now ?? ((): Date => new Date());
    this.#layout = resolveDataLayout(options.config);
    this.#supervisor = new Supervisor(options.config.BACKUP_SERVICE_DIR);
    this.#secretsKey = Buffer.from(options.config.NEBULA_SECRETS_KEY, 'hex');
  }

  /**
   * The key, once loaded.
   *
   * @returns The key.
   * @throws {Error} Before `start` loaded it.
   */
  get #backupKey(): BackupKey {
    if (this.#key === null) {
      throw new Error('The backup key is not loaded yet');
    }

    return this.#key;
  }

  /**
   * Starts: the key, what a previous process left behind, the schedule.
   *
   * @param subscriptions - The bus methods, started by the caller once this is ready.
   */
  public async start(subscriptions: () => BusSubscription[]): Promise<void> {
    const key = await loadBackupKey({
      secretsDir: this.#layout.secrets,
      environmentKey: this.#config.NEBULA_BACKUP_KEY,
      now: this.#now,
    });

    this.#key = key;

    if (key.isNew) {
      this.#logger.info(
        { keyId: key.keyId },
        'Generated the backup key: download it from Settings, Backup',
      );
    }

    const interrupted = await interruptLeftoverRuns(this.#db, this.#now());

    if (interrupted > 0) {
      this.#logger.warn(
        { runs: interrupted },
        'Runs a previous process left unfinished were marked interrupted',
      );
    }

    await rm(path.join(this.#layout.backups, '.staging'), { recursive: true, force: true });
    await this.reload();
    this.#subscriptions = subscriptions();
  }

  /** Stops the schedule and whatever backup is running. */
  public stop(): void {
    for (const subscription of this.#subscriptions) {
      subscription.unsubscribe();
    }

    this.#subscriptions = [];
    this.#stopJobs();

    if (this.#active?.kind === 'backup') {
      this.#active.abort.abort();
    }
  }

  /** Stops the schedule's jobs and the pending catch-up. */
  #stopJobs(): void {
    for (const job of this.#jobs) {
      job.stop();
    }

    this.#jobs = [];

    if (this.#catchUp !== null) {
      clearTimeout(this.#catchUp);
      this.#catchUp = null;
    }
  }

  /**
   * Reads the settings again, learns the quietest time again, and rebuilds the schedule.
   */
  public async reload(): Promise<void> {
    const settings = await readBackupSettings(this.#db);

    this.#settings = settings;
    this.#quietTime = await this.#learnQuietTime(settings);
    this.#stopJobs();

    const { timezone } = settings.schedule;

    // Once a day, just after midnight: the day that ended is in the load now.
    this.#jobs.push(
      new Cron('5 0 * * *', { timezone, protect: true }, () => {
        void this.reload().catch((error: unknown) => {
          this.#logger.error({ err: error }, 'Could not rebuild the backup schedule');
        });
      }),
    );

    if (!settings.isEnabled) {
      this.#logger.info('Backups are off');

      return;
    }

    const time = this.#effectiveTime(settings);
    const job = new Cron(
      cronPatternFor(settings.frequency, time),
      { timezone, protect: true },
      (self: Cron) => {
        void this.#startRun('schedule', null, self.currentRun()).catch((error: unknown) => {
          this.#logger.error({ err: error }, 'The scheduled backup did not start');
        });
      },
    );

    this.#jobs.push(job);
    this.#logger.info(
      { time, timezone, nextRunAt: job.nextRun()?.toISOString() ?? null },
      'Backups scheduled',
    );

    const previous = job.previousRuns(1)[0] ?? null;
    const history = await readBackupHistory(this.#db);

    if (isBackupOwed(previous, history.lastStartedAt) && history.lastStartedAt !== null) {
      this.#catchUp = setTimeout(() => {
        this.#catchUp = null;
        void this.#startRun('catch_up', null, previous).catch((error: unknown) => {
          this.#logger.error({ err: error }, 'The missed backup did not start');
        });
      }, this.#config.BACKUP_CATCH_UP_DELAY_MS);
    }
  }

  /**
   * The time of day backups start at, by the settings.
   *
   * @param settings - The settings.
   * @returns `HH:MM`.
   */
  #effectiveTime(settings: BackupSettings): string {
    return settings.schedule.mode === 'fixed' || this.#quietTime === null
      ? settings.schedule.time
      : this.#quietTime.time;
  }

  /**
   * Learns the quietest time of day from the processor's load.
   *
   * @param settings - The settings.
   * @returns What was learned.
   */
  async #learnQuietTime(settings: BackupSettings): Promise<QuietTime> {
    const { timezone, time } = settings.schedule;

    try {
      if (!(await hasProcessorLoad(this.#db))) {
        return {
          state: 'unavailable',
          time,
          meanLoadPercent: null,
          daysOfData: 0,
          daysNeeded: 3,
          profile: [],
          reason: 'The processor load is not being recorded',
        };
      }

      const [cells, history] = await Promise.all([
        readProcessorLoad(this.#db, { days: LEARNING_DAYS, timezone }),
        readBackupHistory(this.#db),
      ]);

      return quietestTime({
        cells,
        today: dayIn(this.#now(), timezone),
        weekdays: daysOf(settings.frequency),
        durationMinutes: median(history.recentDurationsMinutes) ?? DEFAULT_DURATION_MINUTES,
        previousTime:
          history.lastScheduledAt === null ? null : timeIn(history.lastScheduledAt, timezone),
        fallbackTime: time,
      });
    } catch (error: unknown) {
      this.#logger.warn({ err: error }, 'Could not learn the quietest time');

      return {
        state: 'unavailable',
        time,
        meanLoadPercent: null,
        daysOfData: 0,
        daysNeeded: 3,
        profile: [],
        reason: 'The processor load could not be read',
      };
    }
  }

  /**
   * What opening a location needs.
   *
   * @returns The folders, the mount root and the timeout.
   */
  get #openDependencies(): OpenDependencies {
    return {
      systemDirectory: this.#layout.backups,
      dataDirectory: this.#layout.root,
      mountRoot: this.#config.BACKUP_MOUNT_ROOT,
      timeoutMs: this.#config.BACKUP_LOCATION_TIMEOUT_MS,
    };
  }

  /**
   * Counts what is on disk, at most every ten minutes.
   *
   * @returns What the parts take.
   */
  async #onDisk(): Promise<OnDisk> {
    return this.#estimates.onDisk(
      async () => measureOnDisk(adminDatabaseUrl(this.#config), this.#layout.root),
      this.#now().getTime(),
    );
  }

  /**
   * The service's state.
   *
   * @returns See {@link BackupStatus}.
   */
  public async status(): Promise<BackupStatus> {
    const settings = this.#settings ?? (await readBackupSettings(this.#db));
    const history = await readBackupHistory(this.#db);
    const job = this.#jobs[1];
    const problems: BackupStatus['problems'] = [];
    let estimates: BackupStatus['estimates'] = null;

    try {
      const onDisk = await this.#onDisk();
      const last = history.lastArchive;
      const measured = last?.sectionBytes;

      estimates = estimateSections(
        onDisk,
        measured?.['disk_database_configuration'] === undefined
          ? null
          : {
              sectionBytes: measured,
              onDisk: {
                database: {
                  configuration: measured['disk_database_configuration'] ?? 0,
                  history: measured['disk_database_history'] ?? 0,
                },
                files: {
                  configuration: measured['disk_files_configuration'] ?? 0,
                  packages: measured['disk_files_packages'] ?? 0,
                },
              },
            },
        this.#now(),
      );
    } catch (error: unknown) {
      problems.push({
        code: 'database',
        message: `The database could not be measured: ${messageOf(error)}`,
      });
    }

    if (!this.#supervisor.isAvailable()) {
      problems.push({
        code: 'not-in-container',
        message: 'Restoring needs the NebulaHome container, which stops and starts the services',
      });
    }

    const key = this.#backupKey;

    return {
      isEnabled: settings.isEnabled,
      schedule: {
        mode: settings.schedule.mode,
        time: this.#effectiveTime(settings),
        timezone: settings.schedule.timezone,
        nextRunAt: settings.isEnabled ? (job?.nextRun() ?? null) : null,
      },
      // Learned again when it could not be: the processor's sensor may have appeared since.
      quietTime:
        this.#quietTime === null || this.#quietTime.state === 'unavailable'
          ? (this.#quietTime = await this.#learnQuietTime(settings))
          : this.#quietTime,
      estimates,
      lastBackup:
        history.lastArchive === null
          ? null
          : {
              runId: history.lastArchive.runId,
              status: history.lastArchive.status,
              archiveBytes: history.lastArchive.archiveBytes,
              finishedAt: history.lastArchive.finishedAt,
            },
      active:
        this.#active === null
          ? null
          : {
              runId: this.#active.runId,
              kind: this.#active.kind,
              phase: this.#active.phase,
              startedAt: this.#active.startedAt,
              bytesDone: this.#active.bytesDone,
              bytesTotal: this.#active.bytesTotal,
            },
      key: { keyId: key.keyId, source: key.source, createdAt: key.createdAt },
      capabilities: { canMount: mountProblem() === null, mountProblem: mountProblem() },
      problems,
      maintenance: this.#maintenance,
      canRestore: this.#supervisor.isAvailable(),
    };
  }

  /**
   * Starts a backup, unless something is running.
   *
   * @param trigger - Why.
   * @param requestedBy - Who asked, for a manual one.
   * @param scheduledFor - The moment the schedule came round, for a scheduled one.
   * @returns The run's id.
   * @throws {ConflictError} When a backup or a restore is running.
   */
  async #startRun(
    trigger: 'schedule' | 'catch_up' | 'manual',
    requestedBy: { readonly id: string } | null,
    scheduledFor: Date | null,
  ): Promise<string> {
    if (this.#active !== null) {
      throw new ConflictError('A backup or a restore is already running', {
        details: { reason: 'busy', activeRunId: this.#active.runId },
      });
    }

    const settings = this.#settings ?? (await readBackupSettings(this.#db));
    const sections = sectionsOf(settings.sections);
    const runId = await startRun(this.#db, {
      kind: 'backup',
      trigger,
      sections,
      requestedBy: requestedBy?.id ?? null,
      scheduledFor,
    });
    const active: ActiveRun = {
      runId,
      kind: 'backup',
      startedAt: this.#now(),
      abort: new AbortController(),
      phase: 'preparing',
      bytesDone: 0,
      bytesTotal: null,
    };

    this.#active = active;
    this.#logger.info({ runId, trigger, sections }, 'Backup started');
    this.#announceRun(active, 'running');

    void this.#runBackup(active, sections)
      .then((outcome) => {
        this.#announceRun(active, outcome.status, null);
      })
      .catch((error: unknown) => {
        this.#logger.error({ err: error, runId }, 'The backup ended badly');
        this.#announceRun(active, 'failure', null);
      })
      .finally(() => {
        this.#active = null;
        this.#estimates.invalidate();
        void this.reload().catch(() => undefined);
      });

    return runId;
  }

  /**
   * Runs a backup and records how it ended.
   *
   * @param active - The run.
   * @param sections - The parts it takes.
   * @returns How it ended.
   */
  async #runBackup(
    active: ActiveRun,
    sections: ReturnType<typeof sectionsOf>,
  ): Promise<BackupJobOutcome> {
    const outcome = await takeBackup(
      {
        db: this.#db,
        logger: this.#logger,
        now: this.#now,
        adminUrl: adminDatabaseUrl(this.#config),
        pgBinDir: this.#config.BACKUP_PG_BIN_DIR,
        dataDir: this.#layout.root,
        backupsDir: this.#layout.backups,
        platformVersion: this.#config.NEBULA_VERSION,
        key: this.#backupKey,
        secretsKey: this.#secretsKey,
        instanceKeys: {
          secretsKey: this.#config.NEBULA_SECRETS_KEY.toLowerCase(),
          totpKey: this.#config.API_TOTP_ENCRYPTION_KEY?.toLowerCase() ?? null,
        },
        open: this.#openDependencies,
        /**
         * Counts what is on disk.
         *
         * @returns What the parts take.
         */
        measureOnDisk: async (): Promise<OnDisk> => this.#onDisk(),
        /**
         * Has the supervisor copy the named volumes.
         *
         * @param folder - Where, under the data directory.
         * @returns What it copied.
         */
        exportVolumes: async (folder) =>
          this.#client.request(
            busSubjects.service(SUPERVISOR_SERVICE, SUPERVISOR_METHODS.exportVolumes),
            { folder },
            volumesExportReplySchema,
            { timeoutMs: VOLUMES_TIMEOUT_MS },
          ),
        /**
         * Keeps the run's progress for the status.
         *
         * @param phase - What it does now.
         * @param bytesDone - How far along.
         * @param bytesTotal - Out of how much.
         */
        progress: (phase, bytesDone, bytesTotal): void => {
          const isNewPhase = active.phase !== phase;

          active.phase = phase;
          active.bytesDone = bytesDone ?? 0;
          active.bytesTotal = bytesTotal ?? null;

          // Once per phase: the bytes of an upload are read from the status while it runs.
          if (isNewPhase) {
            this.#announceRun(active, 'running');
          }
        },
        signal: active.abort.signal,
      },
      { runId: active.runId, sections },
    );

    await finishRun(
      this.#db,
      active.runId,
      {
        status: outcome.status,
        archiveName: outcome.archiveName,
        archiveBytes: outcome.archiveBytes,
        sectionBytes: outcome.sectionBytes,
        keyId: this.#backupKey.keyId,
        destinations: outcome.destinations.map(destinationJson),
        error: outcome.error,
      },
      this.#now(),
    );
    this.#logger.info(
      { runId: active.runId, status: outcome.status, bytes: outcome.archiveBytes },
      'Backup finished',
    );

    return outcome;
  }

  /**
   * Starts a backup now.
   *
   * @param requestedBy - Who asked.
   * @returns The run's id.
   */
  public async run(requestedBy: { readonly id: string } | null): Promise<string> {
    return this.#startRun('manual', requestedBy, null);
  }

  /**
   * Cancels the run in progress, if it is that one and still can be.
   *
   * @param runId - The run.
   * @throws {NotFoundError} When that run is not running.
   * @throws {ConflictError} When it is a restore past the point of no return.
   */
  public cancel(runId: string): void {
    if (this.#active?.runId !== runId) {
      throw new NotFoundError('That run is not running');
    }

    if (this.#active.kind === 'restore' && MAINTENANCE_PHASES.includes(this.#active.phase)) {
      throw new ConflictError('The restore is past the point where it can be cancelled');
    }

    this.#active.abort.abort();
  }

  /**
   * Tries a location: connects, writes, reads, removes, and says how it went.
   *
   * @param request - The target, and the saved location whose password to use when none is typed.
   * @returns What was found.
   */
  public async testLocation(request: BackupLocationTest): Promise<BackupLocationTestResult> {
    let target: LocationTarget = request.target;

    if (
      request.locationId !== undefined &&
      'password' in request.target &&
      (request.target.password === undefined || request.target.password === '')
    ) {
      const stored = await readLocation(this.#db, request.locationId);
      const password =
        stored === null ? undefined : openSecrets(stored.config, this.#secretsKey)['password'];

      if (typeof password === 'string') {
        target = { ...request.target, password };
      }
    }

    try {
      const session = await openLocation(target, this.#openDependencies);

      try {
        await session.probe();

        const [archives, freeBytes] = await Promise.all([session.list(), session.freeBytes()]);

        return { isReachable: true, message: null, freeBytes, archiveCount: archives.length };
      } finally {
        await session.close();
      }
    } catch (error: unknown) {
      return { isReachable: false, message: messageOf(error), freeBytes: null, archiveCount: null };
    }
  }

  /**
   * Lists the folders in a folder of this machine, for the local location's picker.
   *
   * @param folder - The folder; the top when absent.
   * @returns Its folders.
   */
  public async browse(folder: string | undefined): Promise<BackupBrowseResult> {
    const target = folder === undefined ? '/' : path.posix.normalize(folder);
    let names: string[];

    try {
      names = (await readdir(target, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));
    } catch (error: unknown) {
      throw new ValidationError(`That folder cannot be read: ${messageOf(error)}`);
    }

    let isWritable = localPathProblem(target, this.#layout.root) === null;

    if (isWritable) {
      isWritable = await access(target, constants.W_OK).then(
        () => true,
        () => false,
      );
    }

    return {
      path: target,
      parent: target === '/' ? null : path.posix.dirname(target),
      directories: names.slice(0, BROWSE_LIMIT),
      isTruncated: names.length > BROWSE_LIMIT,
      isWritable,
    };
  }

  /**
   * The archives in every enabled location, with what their headers say.
   *
   * @returns The archives, newest first, and the locations that could not be read.
   */
  public async archives(): Promise<{
    items: BackupArchive[];
    problems: { locationId: string; name: string; message: string }[];
  }> {
    const locations = await readLocations(this.#db, { onlyEnabled: true });
    const schema = await readSchemaVersion(this.#db);
    const items: BackupArchive[] = [];
    const problems: { locationId: string; name: string; message: string }[] = [];

    for (const location of locations) {
      try {
        // eslint-disable-next-line no-await-in-loop -- one location at a time: some mount.
        const session = await openLocation(
          targetOf(location, this.#secretsKey),
          this.#openDependencies,
        );

        try {
          // eslint-disable-next-line no-await-in-loop -- as above.
          for (const file of await session.list()) {
            const createdAt = parseArchiveName(file.name)?.createdAt;

            if (createdAt === undefined || items.length >= 500) {
              continue;
            }

            let restorable: BackupArchive['restorable'] = 'unreadable';
            let sections: BackupArchive['sections'] = [];
            let keyId: string | null = null;
            let platformVersion: string | null = null;

            try {
              // eslint-disable-next-line no-await-in-loop -- one header at a time.
              const stream = await session.read(file.name, MAX_HEADER_LENGTH);
              const chunks: Buffer[] = [];

              // eslint-disable-next-line no-await-in-loop -- as above.
              for await (const chunk of stream) {
                chunks.push(Buffer.from(chunk as Buffer));
              }

              const header = readArchiveHeader(Buffer.concat(chunks));
              const publicData = header.public as {
                sections?: BackupArchive['sections'];
                platformVersion?: string;
                schema?: { version?: number; latestHash?: string | null };
              };

              keyId = header.keyId;
              sections = publicData.sections ?? [];
              platformVersion = publicData.platformVersion ?? null;
              restorable =
                publicData.schema?.version !== schema.version ||
                publicData.schema.latestHash !== schema.latestHash
                  ? 'schema-mismatch'
                  : header.keyId === this.#backupKey.keyId
                    ? 'ok'
                    : 'needs-key';
            } catch {
              restorable = 'unreadable';
            }

            items.push({
              locationId: location.id,
              locationName: location.name,
              name: file.name,
              createdAt,
              bytes: file.bytes,
              sections,
              keyId,
              platformVersion,
              restorable,
            });
          }
        } finally {
          // eslint-disable-next-line no-await-in-loop -- as above.
          await session.close();
        }
      } catch (error: unknown) {
        problems.push({ locationId: location.id, name: location.name, message: messageOf(error) });
      }
    }

    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return { items, problems };
  }

  /**
   * The key file, sealed with the instance's secrets key, as it crosses the bus.
   *
   * @returns The sealed text.
   */
  public sealedKeyFile(): string {
    return sealSecret(JSON.stringify(this.#backupKey.file), this.#secretsKey).$sealed;
  }

  /**
   * Starts restoring an archive.
   *
   * @param request - Which archive, the key it needs, whether to back up first, who asked.
   * @param request.locationId - The location it is in.
   * @param request.archiveName - Its name.
   * @param request.sealedKeyFile - The uploaded key file, sealed, when it needs another key.
   * @param request.takeSafetyBackup - Whether to back up what is here now, first.
   * @param request.requestedBy - Who asked.
   * @returns The run's id.
   */
  public async restore(request: {
    readonly locationId: string;
    readonly archiveName: string;
    readonly sealedKeyFile?: string | undefined;
    readonly takeSafetyBackup: boolean;
    readonly requestedBy: { readonly id: string } | null;
  }): Promise<string> {
    if (!this.#supervisor.isAvailable()) {
      throw new ConflictError(
        'Restoring needs the NebulaHome container, which stops and starts the services',
        {
          details: { reason: 'not-in-container' },
        },
      );
    }

    if (this.#active !== null) {
      throw new ConflictError('A backup or a restore is already running', {
        details: { reason: 'busy', activeRunId: this.#active.runId },
      });
    }

    const location = await readLocation(this.#db, request.locationId);

    if (location === null || parseArchiveName(request.archiveName) === null) {
      throw new NotFoundError('There is no such archive');
    }

    let uploadedKey: BackupKeyFile | null = null;

    if (request.sealedKeyFile !== undefined) {
      try {
        uploadedKey = parseKeyFile(
          openSecret({ $sealed: request.sealedKeyFile }, this.#secretsKey),
        );
      } catch (error: unknown) {
        throw new ValidationError(messageOf(error));
      }
    }

    const settings = this.#settings ?? (await readBackupSettings(this.#db));
    const runId = await startRun(this.#db, {
      kind: 'restore',
      trigger: 'manual',
      sections: sectionsOf(settings.sections),
      requestedBy: request.requestedBy?.id ?? null,
      scheduledFor: null,
      source: {
        locationId: location.id,
        locationName: location.name,
        archiveName: request.archiveName,
      },
    });
    const active: ActiveRun = {
      runId,
      kind: 'restore',
      startedAt: this.#now(),
      abort: new AbortController(),
      phase: 'downloading',
      bytesDone: 0,
      bytesTotal: 100,
    };

    this.#active = active;
    this.#logger.info({ runId, archive: request.archiveName }, 'Restore started');

    void this.#runRestore(active, {
      runId,
      location,
      archiveName: request.archiveName,
      uploadedKey,
      takeSafetyBackup: request.takeSafetyBackup,
    }).finally(() => {
      this.#active = null;
      this.#estimates.invalidate();
      void this.reload().catch(() => undefined);
    });

    return runId;
  }

  /**
   * Asks the supervisor to stop or start the containers that keep their data in the data
   * directory, without letting a supervisor that is away hold the restore up.
   *
   * @param method - Which.
   */
  async #askSupervisor(
    method: typeof SUPERVISOR_METHODS.suspendManaged | typeof SUPERVISOR_METHODS.resumeManaged,
  ): Promise<void> {
    try {
      await this.#client.request(
        busSubjects.service(SUPERVISOR_SERVICE, method),
        {},
        supervisorAcknowledgementSchema,
        { timeoutMs: SUPERVISOR_TIMEOUT_MS },
      );
    } catch (error: unknown) {
      this.#logger.warn(
        { err: error, method },
        'The supervisor did not answer; the containers were left as they were',
      );
    }
  }

  /**
   * Runs a restore, announces its end, and records it.
   *
   * @param active - The run.
   * @param request - What to restore.
   */
  async #runRestore(
    active: ActiveRun,
    request: Parameters<typeof restoreArchive>[1],
  ): Promise<void> {
    const settings = this.#settings ?? (await readBackupSettings(this.#db));
    const result = await restoreArchive(
      {
        db: this.#db,
        logger: this.#logger,
        now: this.#now,
        adminUrl: adminDatabaseUrl(this.#config),
        pgBinDir: this.#config.BACKUP_PG_BIN_DIR,
        dataDir: this.#layout.root,
        backupsDir: this.#layout.backups,
        secretsDir: this.#layout.secrets,
        apiUrl: this.#config.BACKUP_API_URL,
        key: this.#backupKey,
        secretsKey: this.#secretsKey,
        currentKeys: {
          secretsKey: this.#config.NEBULA_SECRETS_KEY.toLowerCase(),
          totpKey: this.#config.API_TOTP_ENCRYPTION_KEY?.toLowerCase() ?? null,
        },
        open: this.#openDependencies,
        supervisor: this.#supervisor,
        managedContainers: {
          /**
           * Stops the containers that keep their data in the data directory.
           *
           * @returns Once the supervisor answered, or was given up on.
           */
          suspend: async () => this.#askSupervisor(SUPERVISOR_METHODS.suspendManaged),

          /**
           * Starts them again.
           *
           * @returns Once the supervisor answered, or was given up on.
           */
          resume: async () => this.#askSupervisor(SUPERVISOR_METHODS.resumeManaged),

          /**
           * Writes the named volumes back.
           *
           * @param folder - Where their tars are, under the data directory.
           */
          importVolumes: async (folder): Promise<void> => {
            await this.#client.request(
              busSubjects.service(SUPERVISOR_SERVICE, SUPERVISOR_METHODS.importVolumes),
              { folder },
              volumesImportReplySchema,
              { timeoutMs: VOLUMES_TIMEOUT_MS },
            );
          },
        },
        /**
         * Keeps the restore's progress, and announces maintenance once the database is about to
         * change.
         *
         * @param phase - What it does now.
         * @param percent - How far along.
         */
        progress: (phase, percent): void => {
          active.phase = phase;
          active.bytesDone = percent ?? active.bytesDone;

          if (MAINTENANCE_PHASES.includes(phase)) {
            this.#announce({
              ...NORMAL,
              state: 'restoring',
              runId: active.runId,
              phase,
              percent,
            });
          }
        },
        /**
         * Announces a maintenance state.
         *
         * @param state - The state.
         */
        announce: (state): void => {
          this.#announce(state);
        },
        /**
         * Backs up what is here now, before the restore.
         *
         * @returns How it went.
         */
        safetyBackup: async (): Promise<BackupJobOutcome> => {
          const safetyId = await startRun(this.#db, {
            kind: 'backup',
            trigger: 'pre_restore',
            sections: sectionsOf(settings.sections),
            requestedBy: null,
            scheduledFor: null,
          });

          return this.#runBackup(
            { ...active, runId: safetyId, kind: 'backup' },
            sectionsOf(settings.sections),
          );
        },
        /**
         * Makes an uploaded key the installation's own.
         *
         * @param file - The key file, already written to `secrets/`.
         */
        adoptKey: async (file): Promise<void> => {
          this.#key = await loadBackupKey({
            secretsDir: this.#layout.secrets,
            environmentKey: this.#config.NEBULA_BACKUP_KEY,
            now: this.#now,
          }).catch(() => ({
            key: Buffer.from(file.key, 'hex'),
            keyId: file.keyId,
            source: 'file' as const,
            createdAt: new Date(file.createdAt),
            file,
            isNew: false,
          }));
        },
        signal: active.abort.signal,
      },
      request,
    );

    await recordRestore(this.#db, active.runId, result, this.#now()).catch((error: unknown) => {
      this.#logger.error({ err: error }, 'The restore was not recorded');
    });
    this.#announce({
      ...NORMAL,
      runId: active.runId,
      outcome: result.outcome,
      message: result.message,
      tokensInvalidBefore: result.outcome === 'restored' ? result.switchedAt : null,
    });
    this.#logger.info({ runId: active.runId, outcome: result.outcome }, 'Restore finished');
  }

  /**
   * Publishes the maintenance state.
   *
   * @param state - The state.
   */
  #announce(state: MaintenanceState): void {
    this.#maintenance = state;
    this.#client.publish(busSubjects.maintenanceEvent(), state);
  }

  /**
   * Announces that a backup began, went on to another phase, or ended, so a page watching the
   * backups follows it at once - a scheduled one included - rather than at its next poll.
   *
   * @param active - The run.
   * @param status - `running`, or how it ended.
   * @param phase - The phase it is in; null once it ended.
   */
  #announceRun(
    active: ActiveRun,
    status: BackupRunStatus,
    phase: BackupPhase | null = active.phase,
  ): void {
    this.#client.publish(busSubjects.backupEvent(), {
      runId: active.runId,
      kind: active.kind,
      phase,
      status,
    });
  }
}
