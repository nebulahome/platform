/**
 * Rounds of updates, and the automatic ones (docs/releases-and-updates.md 4).
 *
 * One round at a time, whether the owner started it (Update, Update all) or the schedule did:
 * a backup first when the settings say - skipped when one finished minutes ago - then the
 * packages, the integrations, and Nebula Home last, since the supervisor's update restarts
 * everything. A failed backup stops the round; a failed item does not stop the others.
 *
 * Each kind whose automatic updates are on - packages, integrations, never Nebula Home - runs
 * once a day when its window's time comes: the fixed one, or the quietest core learned
 * (`sensor.system_quiet_time`), planned again just after midnight. A clock looks every minute, so
 * a time the change to summer time skips still comes that day and one the change back repeats
 * comes once. Kinds due together share a round; one due while a round runs waits for its end.
 * The day each kind last ran is kept in a file, so a packet-manager that starts after a window it
 * missed runs it then. Each kind has its own Back up first: a round backs up when any kind in it
 * asks to.
 */
import { randomUUID } from 'node:crypto';

import { Cron } from 'croner';
import { z } from 'zod';

import type { BusClient } from '@nebulahome/bus';
import {
  BACKUP_METHODS,
  BACKUP_SERVICE,
  backupEventSchema,
  backupStatusSchema,
  busSubjects,
  ConflictError,
  SUPERVISOR_METHODS,
  SUPERVISOR_SERVICE,
  supervisorAcknowledgementSchema,
  timeZoneSchema,
  type QuietTime,
  type UpdateItem,
  type UpdateRound,
} from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import { isBackupSucceeded, isRecentBackupEnough } from '../domain/backup-first.js';
import type { IntegrationManager } from '../integrations/integration-manager.js';
import {
  readAutomaticRuns,
  writeAutomaticRuns,
  type AutomaticRuns,
} from '../persistence/automatic-runs.js';
import {
  readQuietTime,
  readUpdateSettings,
  type AutoKind,
  type UpdateSettings,
} from '../persistence/update-settings.js';
import type { PacketManager } from '../service.js';

/** What the runner needs. */
export type UpdateRunnerOptions = {
  readonly client: BusClient;
  readonly db: Database;
  readonly packages: Pick<PacketManager, 'available' | 'update'>;
  readonly integrations: Pick<IntegrationManager, 'available' | 'install'>;
  readonly logger: PlatformLogger;

  /** The clock. */
  readonly now?: () => Date;

  /** How long a backup may take before the round gives up on it. */
  readonly backupTimeoutMs?: number;

  /** Where the settings are read: the database unless said. */
  readonly readSettings?: () => Promise<UpdateSettings>;

  /** Where the quietest time is read: the database unless said. */
  readonly readQuietTime?: () => Promise<QuietTime | null>;

  /** The file the day each kind last ran by itself is kept in; none, and no run is made up. */
  readonly runsFile?: string;
};

/** Who asked. */
type Requester = { readonly id: string; readonly username: string } | null;

/** When each kind's window comes, on which zone's clock. */
type Windows = ReadonlyMap<AutoKind, { readonly time: string; readonly timezone: string }>;

/** The automatic updates, as planned. */
type Plan = {
  /** The house's zone, and its day the plan was made on: a new one is made the day after. */
  readonly timezone: string;
  readonly day: string;
  readonly windows: Windows;
};

/** Why a plan is made: the service starting, a new day, or the settings changing. */
type PlanReason = 'start' | 'day' | 'change';

/** A backup can take a while on a big history. */
const BACKUP_TIMEOUT_MS = 2 * 60 * 60_000;

/** The supervisor answers once the updater container is started, after the pull. */
const CORE_TIMEOUT_MS = 15 * 60_000;

/** When a new day's plan is made: once core has learned the quietest time again, at 00:02. */
const REPLAN_TIME = '00:10';

/** The order a round goes in: Nebula Home last, as it restarts everything. */
const ORDER: Readonly<Record<UpdateItem['kind'], number>> = { package: 0, integration: 1, core: 2 };

/**
 * Says what an error says.
 *
 * @param error - What was thrown.
 * @returns Its message, cut to fit a round.
 */
function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1024);
}

/** Does nothing: the wait's end until the wait is set up. */
function noop(): void {
  // Replaced before anything calls it.
}

/**
 * The day and the time of day an instant is on a zone's clock.
 *
 * @param at - The instant.
 * @param timezone - The zone.
 * @returns `YYYY-MM-DD` and `HH:MM`.
 */
function clockOf(at: Date, timezone: string): { day: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  /**
   * One part of it.
   *
   * @param type - Which.
   * @returns Its digits.
   */
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((each) => each.type === type)?.value ?? '';

  return {
    day: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  };
}

/**
 * Says whether a plan's day is over on the house's clock, and core has learned the new one's
 * quietest time.
 *
 * @param plan - The plan.
 * @param now - The time.
 * @returns True when a new plan is due.
 */
function isNewDay(plan: Plan, now: Date): boolean {
  const { day, time } = clockOf(now, plan.timezone);

  return day !== plan.day && time >= REPLAN_TIME;
}

/** Rounds of updates, one at a time, and the automatic ones. */
export class UpdateRunner {
  readonly #options: UpdateRunnerOptions;
  readonly #now: () => Date;
  #round: UpdateRound | null = null;
  #plan: Plan | null = null;
  #clock: Cron | undefined;

  /** The plans being made, one after another: two side by side could leave the older one. */
  #planning: Promise<void> = Promise.resolve();
  #plansWaiting = 0;

  /** The day, on its window's clock, each kind's window last came or was let go by. */
  readonly #handled = new Map<AutoKind, string>();

  /** The kinds whose window came while a round ran, with the day it came on. */
  readonly #due = new Map<AutoKind, string>();

  /** The day each kind last ran by itself, as the file keeps it. */
  #runs: AutomaticRuns = {};

  /**
   * Builds the runner without planning anything.
   *
   * @param options - The bus, the database, the two managers and the clock.
   */
  public constructor(options: UpdateRunnerOptions) {
    this.#options = options;
    this.#now = options.now ?? ((): Date => new Date());
  }

  /**
   * Reads the settings.
   *
   * @returns Them.
   */
  async #settings(): Promise<UpdateSettings> {
    return (this.#options.readSettings ?? (() => readUpdateSettings(this.#options.db)))();
  }

  /**
   * Reads the quietest time core learned.
   *
   * @returns It, or null while it has none.
   */
  async #quietTime(): Promise<QuietTime | null> {
    return (this.#options.readQuietTime ?? (() => readQuietTime(this.#options.db)))();
  }

  /**
   * The round running or last run.
   *
   * @returns It, or null before the first.
   */
  public status(): UpdateRound | null {
    return this.#round;
  }

  /**
   * Starts a round, answered before it ends.
   *
   * @param items - What to update.
   * @param requestedBy - Who asked; null for the schedule.
   * @param trigger - The owner, or the schedule.
   * @returns The round as it starts.
   * @throws {ConflictError} While another round runs.
   */
  public run(
    items: readonly UpdateItem[],
    requestedBy: Requester,
    trigger: UpdateRound['trigger'] = 'manual',
  ): UpdateRound {
    if (this.#round?.status === 'running') {
      throw new ConflictError('A round of updates is already running', {
        details: { reason: 'busy' },
      });
    }

    const round: UpdateRound = {
      id: randomUUID(),
      trigger,
      startedAt: this.#now(),
      finishedAt: null,
      status: 'running',
      backup: null,
      items: [...items]
        .sort((left, right) => ORDER[left.kind] - ORDER[right.kind])
        .map((item) => ({ item, status: 'pending', error: null })),
    };

    this.#round = round;
    void this.#work(round, requestedBy);

    return round;
  }

  /**
   * Starts the automatic updates: takes back the update of Nebula Home a round cut short left on
   * every page, reads the day each kind last ran, plans, and looks at the clock every minute.
   *
   * @returns Once planned; a failed plan is tried again the next minute.
   */
  public async start(): Promise<void> {
    // A round lives in memory: one a restart cut short left its screen up, and nothing else takes
    // it back. The supervisor takes back only an update still backing up.
    await this.#announceCore(null, null);

    if (this.#options.runsFile !== undefined) {
      this.#runs = await readAutomaticRuns(this.#options.runsFile);
    }

    this.#clock ??= new Cron('* * * * *', () => {
      this.tick();
    });
    await this.#replan('start');
  }

  /**
   * Reads the settings again and plans the automatic updates by them; a window already behind
   * today waits for tomorrow. A failed read keeps the plan before.
   */
  public async reload(): Promise<void> {
    await this.#replan('change');
  }

  /** Stops looking at the clock; a round running goes on. */
  public stop(): void {
    this.#clock?.stop();
    this.#clock = undefined;
  }

  /**
   * Looks at the clock, every minute: plans a new day once core has learned it, and starts the
   * kinds whose window has come today and that have not run today - in one round, now or once
   * the round running ends.
   */
  public tick(): void {
    const now = this.#now();
    const plan = this.#plan;

    if (this.#plansWaiting === 0 && (plan === null || isNewDay(plan, now))) {
      void this.#replan(plan === null ? 'start' : 'day').catch((error: unknown) => {
        this.#options.logger.error({ err: error }, 'Could not plan the automatic updates');
      });
    }

    for (const [kind, window] of plan?.windows ?? []) {
      const { day, time } = clockOf(now, window.timezone);

      // Its time, or the first minute after it the clock shows; once a day.
      if (time >= window.time && this.#handled.get(kind) !== day) {
        this.#handled.set(kind, day);
        this.#due.set(kind, day);
      }
    }

    this.#startDue();
  }

  /**
   * Makes a plan after the ones asked for before.
   *
   * @param reason - Why.
   */
  async #replan(reason: PlanReason): Promise<void> {
    this.#plansWaiting += 1;

    const made = this.#planning
      .then(async () => this.#makePlan(reason))
      .finally(() => {
        this.#plansWaiting -= 1;
      });

    this.#planning = made.catch(() => undefined);
    await made;
  }

  /**
   * Plans by the settings and the quietest time, both read before anything changes. A window
   * already behind when the plan is made waits for tomorrow - unless it was missed: by a service
   * down at its time (at the start, when the file says the kind last ran on an earlier day), or
   * by a time that moved before the plan of a new day.
   *
   * @param reason - Why.
   */
  async #makePlan(reason: PlanReason): Promise<void> {
    const settings = await this.#settings();
    const kinds = (['package', 'integration'] as const).filter((kind) => settings.auto[kind]);
    const quiet = kinds.some((kind) => settings.window[kind].mode === 'quietest')
      ? await this.#quietTime()
      : null;
    const windows: Windows = new Map(
      kinds.map((kind): [AutoKind, { time: string; timezone: string }] => {
        const window = settings.window[kind];
        const learned = window.mode === 'quietest' ? quiet : null;
        // The zone the quietest time was learned in, when the clock can read it.
        const zone = timeZoneSchema.safeParse(learned?.timezone);

        return [
          kind,
          {
            time: learned?.time ?? window.time,
            timezone: zone.success ? zone.data : settings.timezone,
          },
        ];
      }),
    );
    const now = this.#now();

    for (const [kind, window] of windows) {
      const { day, time } = clockOf(now, window.timezone);
      const ran = this.#runs[kind];
      const isMissed = reason === 'day' || (reason === 'start' && ran !== undefined && ran < day);

      if (time >= window.time && !isMissed) {
        this.#handled.set(kind, day);
      }
    }

    this.#plan = { timezone: settings.timezone, day: clockOf(now, settings.timezone).day, windows };
    this.#options.logger.info(
      { reason, windows: Object.fromEntries(windows) },
      kinds.length === 0 ? 'Automatic updates are off' : 'Automatic updates planned',
    );
  }

  /** Starts the kinds whose window came, in one round, unless a round runs: its end does. */
  #startDue(): void {
    if (this.#due.size === 0 || this.#round?.status === 'running') {
      return;
    }

    const due = new Map(this.#due);

    this.#due.clear();
    void this.#runScheduled(due).catch((error: unknown) => {
      this.#options.logger.error(
        { err: error, kinds: [...due.keys()] },
        'The automatic updates did not start',
      );
    });
  }

  /**
   * Runs the automatic updates of the kinds due: what has one.
   *
   * @param due - Packages, integrations or both, with the day their window came on.
   */
  async #runScheduled(due: ReadonlyMap<AutoKind, string>): Promise<void> {
    const { packages, integrations, logger } = this.#options;
    const kinds = [...due.keys()];

    await this.#recordRuns(due);

    const settings = await this.#settings();
    /**
     * Whether a kind is due and still updates by itself.
     *
     * @param kind - The kind.
     * @returns Whether to look for its updates.
     */
    const wants = (kind: AutoKind): boolean => due.has(kind) && settings.auto[kind];
    const [installed, vendors] = await Promise.all([
      wants('package') ? packages.available() : null,
      wants('integration') ? integrations.available() : null,
    ]);

    for (const error of [installed?.error, vendors?.error]) {
      if (typeof error === 'string') {
        logger.warn({ kinds, error }, 'Automatic updates: an index could not be read');
      }
    }

    const items: UpdateItem[] = [
      ...(installed?.items ?? [])
        .filter((each) => each.hasUpdate)
        .map((each) => ({ kind: 'package' as const, id: each.id })),
      ...(vendors?.items ?? [])
        .filter((each) => each.hasUpdate)
        .map((each) => ({ kind: 'integration' as const, id: each.vendorId })),
    ];

    if (items.length === 0) {
      logger.info({ kinds }, 'Automatic updates: nothing to update');

      return;
    }

    try {
      this.run(items, null, 'schedule');
    } catch (error: unknown) {
      if (!(error instanceof ConflictError)) {
        throw error;
      }

      // A round the owner started meanwhile: these run once it ends.
      for (const [kind, day] of due) {
        this.#due.set(kind, day);
      }
    }
  }

  /**
   * Keeps the day the kinds ran by themselves, for a start that has to tell a missed run.
   *
   * @param due - The kinds, with the day their window came on.
   */
  async #recordRuns(due: ReadonlyMap<AutoKind, string>): Promise<void> {
    const runs: AutomaticRuns = { ...this.#runs };

    for (const [kind, day] of due) {
      runs[kind] = day;
    }

    this.#runs = runs;

    const file = this.#options.runsFile;

    if (file !== undefined) {
      await writeAutomaticRuns(file, runs).catch((error: unknown) => {
        this.#options.logger.warn({ err: error, file }, 'Could not keep the day updates ran');
      });
    }
  }

  /**
   * Runs a round to its end, then the automatic updates that came due meanwhile. Never throws:
   * what failed is in the round.
   *
   * @param round - The round.
   * @param requestedBy - Who asked.
   */
  async #work(round: UpdateRound, requestedBy: Requester): Promise<void> {
    const { logger } = this.#options;
    const core = round.items.find((entry) => entry.item.kind === 'core');

    try {
      const first = await this.#backupFirst(
        round.items.map((entry) => entry.item.kind),
        requestedBy,
        core?.item.kind === 'core' ? core.item.version : null,
      );

      round.backup = first.backup;

      if (round.backup === 'failed') {
        for (const entry of round.items) {
          entry.status = 'skipped';
          entry.error = 'The backup before the updates failed';
        }
      } else {
        // The index of each kind is read again once, for the round's first item of it.
        const read = new Set<UpdateItem['kind']>();

        for (const entry of round.items) {
          entry.status = 'running';

          try {
            // eslint-disable-next-line no-await-in-loop -- one at a time, in order: core is last
            await this.#update(entry.item, requestedBy, !read.has(entry.item.kind), first.bytes);
            entry.status = 'done';
          } catch (error: unknown) {
            entry.status = 'failed';
            entry.error = messageOf(error);
            logger.warn({ err: error, item: entry.item }, 'An update failed');
          }

          read.add(entry.item.kind);
        }
      }
    } catch (error: unknown) {
      logger.error({ err: error }, 'A round of updates stopped');

      // What the round did not reach says why.
      for (const entry of round.items) {
        if (entry.status === 'pending') {
          entry.status = 'skipped';
          entry.error = `The round stopped: ${messageOf(error)}`.slice(0, 1024);
        }
      }
    } finally {
      // The pages were shown the update coming; it never started.
      if (core !== undefined && core.status !== 'done') {
        await this.#announceCore(null, null);
      }

      round.status = round.items.every((entry) => entry.status === 'done') ? 'done' : 'failed';
      round.finishedAt = this.#now();
      logger.info(
        { round: round.id, status: round.status, backup: round.backup },
        'A round of updates ended',
      );
      this.#startDue();
    }
  }

  /**
   * Updates one thing.
   *
   * @param item - What.
   * @param requestedBy - Who asked.
   * @param isIndexReadAgain - Whether its kind's index is read again first.
   * @param backupBytes - The size of the backup taken or reused first; null for none.
   */
  async #update(
    item: UpdateItem,
    requestedBy: Requester,
    isIndexReadAgain: boolean,
    backupBytes: number | null,
  ): Promise<void> {
    const { packages, integrations, client } = this.#options;

    switch (item.kind) {
      case 'package': {
        await packages.update(item.id, isIndexReadAgain);

        return;
      }
      case 'integration': {
        await integrations.install(item.id, undefined, requestedBy?.id, isIndexReadAgain);

        return;
      }
      case 'core': {
        await client.request(
          busSubjects.service(SUPERVISOR_SERVICE, SUPERVISOR_METHODS.updatePlatform),
          { version: item.version, backupBytes },
          supervisorAcknowledgementSchema,
          { timeoutMs: CORE_TIMEOUT_MS },
        );
      }
    }
  }

  /**
   * Takes the backup before a round, unless no kind in it asks for one or one finished minutes
   * ago with every part a backup takes now.
   *
   * @param kinds - The kinds the round updates.
   * @param requestedBy - Who asked, for the backup's record.
   * @param coreVersion - The release of Nebula Home the round updates to, whose screen every page
   *   shows from the backup on; null when the round leaves it alone.
   * @returns What was done, and - for a round that updates Nebula Home - the backup's size.
   */
  async #backupFirst(
    kinds: readonly UpdateItem['kind'][],
    requestedBy: Requester,
    coreVersion: string | null,
  ): Promise<{ backup: NonNullable<UpdateRound['backup']>; bytes: number | null }> {
    const { client, logger } = this.#options;
    const settings = await this.#settings();

    if (!kinds.some((kind) => settings.backupFirst[kind])) {
      return { backup: 'off', bytes: null };
    }

    if (coreVersion !== null) {
      await this.#announceCore(coreVersion, null);
    }

    try {
      const status = await client.request(
        busSubjects.service(BACKUP_SERVICE, BACKUP_METHODS.status),
        {},
        backupStatusSchema,
      );

      // A restore is no backup to wait for, and a house being restored is not updated.
      if (status.active?.kind === 'restore') {
        logger.warn('A restore is running: the round does not update');

        return { backup: 'failed', bytes: null };
      }

      const backup = isRecentBackupEnough(status.lastBackup, settings.backupSections, this.#now())
        ? 'recent'
        : (await this.#backUp(requestedBy))
          ? 'taken'
          : 'failed';
      const bytes =
        coreVersion !== null && backup !== 'failed' ? await this.#lastBackupBytes() : null;

      if (coreVersion !== null && backup !== 'failed') {
        await this.#announceCore(coreVersion, bytes);
      }

      return { backup, bytes };
    } catch (error: unknown) {
      logger.warn({ err: error }, 'The backup before the updates failed');

      return { backup: 'failed', bytes: null };
    }
  }

  /**
   * Tells the supervisor to show every page the update of Nebula Home coming, or to take it back.
   * Never throws: the screen is only a view of the round.
   *
   * @param version - The release; null to take it back.
   * @param backupBytes - The backup's size once taken or reused; null while it runs.
   */
  async #announceCore(version: string | null, backupBytes: number | null): Promise<void> {
    try {
      await this.#options.client.request(
        busSubjects.service(SUPERVISOR_SERVICE, SUPERVISOR_METHODS.announcePlatformUpdate),
        { version, backupBytes },
        supervisorAcknowledgementSchema,
      );
    } catch (error: unknown) {
      this.#options.logger.warn(
        { err: error, version },
        'Could not tell the pages of the update of Nebula Home',
      );
    }
  }

  /**
   * How big the last backup is, for the screen every page shows while Nebula Home updates.
   *
   * @returns Its bytes, or null when they cannot be told.
   */
  async #lastBackupBytes(): Promise<number | null> {
    try {
      const status = await this.#options.client.request(
        busSubjects.service(BACKUP_SERVICE, BACKUP_METHODS.status),
        {},
        backupStatusSchema,
      );
      const bytes = status.lastBackup?.archiveBytes ?? null;

      return bytes === null ? null : Math.round(bytes);
    } catch {
      return null;
    }
  }

  /**
   * Runs a backup and waits for it to end.
   *
   * @param requestedBy - Who asked.
   * @returns True when it made its archive: every location took it, or some did.
   */
  async #backUp(requestedBy: Requester): Promise<boolean> {
    const { client } = this.#options;
    let runId: string | null = null;
    let settle: (status: string) => void = noop;
    const ended = new Promise<string>((resolve) => {
      settle = resolve;
    });
    const early = new Map<string, string>();

    // Listening before asking, so an end announced before the reply is not missed. A restore's
    // runs are not backups: their end ends no wait.
    const subscription = client.subscribe(busSubjects.backupEvent(), backupEventSchema, (event) => {
      if (event.kind === 'backup' && event.status !== 'running') {
        if (runId === null) {
          early.set(event.runId, event.status);
        } else if (event.runId === runId) {
          settle(event.status);
        }
      }

      return Promise.resolve();
    });
    const timeout = setTimeout(() => {
      settle('timed_out');
    }, this.#options.backupTimeoutMs ?? BACKUP_TIMEOUT_MS);

    try {
      runId = await client
        .request(
          busSubjects.service(BACKUP_SERVICE, BACKUP_METHODS.run),
          { requestedBy },
          z.object({ runId: z.uuid() }),
        )
        .then((reply) => reply.runId)
        .catch((error: unknown) => {
          // A backup already running - the schedule's, say - is waited for instead.
          const active = (error as { details?: { activeRunId?: unknown } }).details?.activeRunId;

          if (typeof active === 'string') {
            return active;
          }

          throw error;
        });

      const already = early.get(runId);

      if (already !== undefined) {
        settle(already);
      }

      return isBackupSucceeded(await ended);
    } finally {
      clearTimeout(timeout);
      subscription.unsubscribe();
    }
  }
}
