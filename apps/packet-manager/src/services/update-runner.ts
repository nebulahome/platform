/**
 * Rounds of updates, and the automatic ones (docs/releases-and-updates.md 4).
 *
 * One round at a time, whether the owner started it (Update, Update all) or the schedule did:
 * a backup first when the settings say - skipped when one finished minutes ago - then the
 * packages, the integrations, and Nebula Home last, since the supervisor's update restarts
 * everything. A failed backup stops the round; a failed item does not stop the others.
 *
 * The schedule runs each day at the window's time: the fixed one, or the quietest core learned
 * (`sensor.system_quiet_time`), read again just after midnight. It updates only the kinds whose
 * automatic updates are on, and never Nebula Home.
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
  type UpdateItem,
  type UpdateRound,
} from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import { isRecentBackupEnough } from '../domain/backup-first.js';
import type { IntegrationManager } from '../integrations/integration-manager.js';
import {
  readQuietTime,
  readUpdateSettings,
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
};

/** Who asked. */
type Requester = { readonly id: string; readonly username: string } | null;

/** A backup can take a while on a big history. */
const BACKUP_TIMEOUT_MS = 2 * 60 * 60_000;

/** The supervisor answers once the updater container is started, after the pull. */
const CORE_TIMEOUT_MS = 15 * 60_000;

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

/** Rounds of updates, one at a time, and the automatic ones. */
export class UpdateRunner {
  readonly #options: UpdateRunnerOptions;
  readonly #now: () => Date;
  #round: UpdateRound | null = null;
  #jobs: Cron[] = [];

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

  /** Reads the settings again and plans the automatic updates by them. */
  public async reload(): Promise<void> {
    this.stop();

    const { db, logger } = this.#options;
    const settings = await this.#settings();

    // Just after midnight core has learned the quietest time again: plan by it.
    this.#jobs.push(
      new Cron('10 0 * * *', { timezone: settings.timezone, protect: true }, () => {
        void this.reload().catch((error: unknown) => {
          logger.error({ err: error }, 'Could not plan the automatic updates');
        });
      }),
    );

    if (!settings.autoPackages && !settings.autoIntegrations) {
      logger.info('Automatic updates are off');

      return;
    }

    const quiet = settings.window.mode === 'quietest' ? await readQuietTime(db) : null;
    const time = quiet?.time ?? settings.window.time;
    const timezone = quiet?.timezone ?? settings.timezone;
    const [hours = '3', minutes = '0'] = time.split(':');
    const job = new Cron(
      `${String(Number(minutes))} ${String(Number(hours))} * * *`,
      { timezone, protect: true },
      () => {
        void this.#runScheduled().catch((error: unknown) => {
          logger.error({ err: error }, 'The automatic updates did not start');
        });
      },
    );

    this.#jobs.push(job);
    logger.info(
      { time, timezone, nextRunAt: job.nextRun()?.toISOString() ?? null },
      'Automatic updates planned',
    );
  }

  /** Stops planning; a round running goes on. */
  public stop(): void {
    for (const job of this.#jobs) {
      job.stop();
    }

    this.#jobs = [];
  }

  /** Runs the automatic updates: what has one, of the kinds that update by themselves. */
  async #runScheduled(): Promise<void> {
    const { packages, integrations } = this.#options;
    const settings = await this.#settings();
    const [installed, vendors] = await Promise.all([
      settings.autoPackages ? packages.available() : null,
      settings.autoIntegrations ? integrations.available() : null,
    ]);
    const items: UpdateItem[] = [
      ...(installed?.items ?? [])
        .filter((each) => each.hasUpdate)
        .map((each) => ({ kind: 'package' as const, id: each.id })),
      ...(vendors?.items ?? [])
        .filter((each) => each.hasUpdate)
        .map((each) => ({ kind: 'integration' as const, id: each.vendorId })),
    ];

    if (items.length === 0) {
      this.#options.logger.info('Automatic updates: nothing to update');

      return;
    }

    this.run(items, null, 'schedule');
  }

  /**
   * Runs a round to its end. Never throws: what failed is in the round.
   *
   * @param round - The round.
   * @param requestedBy - Who asked.
   */
  async #work(round: UpdateRound, requestedBy: Requester): Promise<void> {
    const { logger } = this.#options;

    try {
      round.backup = await this.#backupFirst(requestedBy);

      if (round.backup === 'failed') {
        for (const entry of round.items) {
          entry.status = 'skipped';
          entry.error = 'The backup before the updates failed';
        }
      } else {
        for (const entry of round.items) {
          entry.status = 'running';

          try {
            // eslint-disable-next-line no-await-in-loop -- one at a time, in order: core is last
            await this.#update(entry.item, requestedBy);
            entry.status = 'done';
          } catch (error: unknown) {
            entry.status = 'failed';
            entry.error = messageOf(error);
            logger.warn({ err: error, item: entry.item }, 'An update failed');
          }
        }
      }
    } catch (error: unknown) {
      logger.error({ err: error }, 'A round of updates stopped');
    } finally {
      round.status = round.items.every((entry) => entry.status === 'done') ? 'done' : 'failed';
      round.finishedAt = this.#now();
      logger.info(
        { round: round.id, status: round.status, backup: round.backup },
        'A round of updates ended',
      );
    }
  }

  /**
   * Updates one thing.
   *
   * @param item - What.
   * @param requestedBy - Who asked.
   */
  async #update(item: UpdateItem, requestedBy: Requester): Promise<void> {
    const { packages, integrations, client } = this.#options;

    switch (item.kind) {
      case 'package': {
        await packages.update(item.id);

        return;
      }
      case 'integration': {
        await integrations.install(item.id, undefined, requestedBy?.id);

        return;
      }
      case 'core': {
        await client.request(
          busSubjects.service(SUPERVISOR_SERVICE, SUPERVISOR_METHODS.updatePlatform),
          { version: item.version },
          supervisorAcknowledgementSchema,
          { timeoutMs: CORE_TIMEOUT_MS },
        );
      }
    }
  }

  /**
   * Takes the backup before a round, unless the settings say not to or one finished minutes ago
   * with every part a backup takes now.
   *
   * @param requestedBy - Who asked, for the backup's record.
   * @returns What was done.
   */
  async #backupFirst(requestedBy: Requester): Promise<NonNullable<UpdateRound['backup']>> {
    const { client, logger } = this.#options;
    const settings = await this.#settings();

    if (!settings.backupFirst) {
      return 'off';
    }

    try {
      const status = await client.request(
        busSubjects.service(BACKUP_SERVICE, BACKUP_METHODS.status),
        {},
        backupStatusSchema,
      );

      if (isRecentBackupEnough(status.lastBackup, settings.backupSections, this.#now())) {
        return 'recent';
      }

      return (await this.#backUp(requestedBy)) ? 'taken' : 'failed';
    } catch (error: unknown) {
      logger.warn({ err: error }, 'The backup before the updates failed');

      return 'failed';
    }
  }

  /**
   * Runs a backup and waits for it to end.
   *
   * @param requestedBy - Who asked.
   * @returns True when it succeeded.
   */
  async #backUp(requestedBy: Requester): Promise<boolean> {
    const { client } = this.#options;
    let runId: string | null = null;
    let settle: (status: string) => void = noop;
    const ended = new Promise<string>((resolve) => {
      settle = resolve;
    });
    const early = new Map<string, string>();

    // Listening before asking, so an end announced before the reply is not missed.
    const subscription = client.subscribe(busSubjects.backupEvent(), backupEventSchema, (event) => {
      if (event.status !== 'running') {
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

      return (await ended) === 'success';
    } finally {
      clearTimeout(timeout);
      subscription.unsubscribe();
    }
  }
}
