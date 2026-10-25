/**
 * The quietest time of day, as `sensor.system_quiet_time` on the system device
 * (docs/releases-and-updates.md 4).
 *
 * Learned from the house's activity at start and just after midnight in the house's zone, when
 * the day that ended is in the history, and handed to the ingest pipeline like any other reading:
 * backups and updates read it when set to "Quietest", and an automation can start at it. The time
 * already in use is kept unless another is clearly quieter (`domain/quietest.ts`).
 */
import { Cron } from 'croner';

import {
  parseEntityId,
  QUIET_TIME_ENTITY_ID,
  QUIET_TIME_FALLBACK,
  QUIET_TIME_WINDOW_MINUTES,
  quietTimeAttributes,
  quietTimeFromState,
  type QuietTime,
} from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import { zonedParts } from '../domain/automation/house-time.js';
import { quietestTime } from '../domain/quietest.js';
import { readActivity } from '../persistence/activity-load.js';

import { ingestReport, type StateIngestOptions } from './state-ingest.js';

/** What the monitor needs. */
export type QuietTimeMonitorOptions = {
  readonly db: Database;

  /** The ingest pipeline the reading goes through, with its directory, registry and cache. */
  readonly ingest: StateIngestOptions;

  readonly logger: PlatformLogger;
  readonly newTraceId: () => string;

  /** The clock. */
  readonly now?: () => Date;
};

/** How many days of activity it is learned from. */
const LEARNING_DAYS = 28;

/** Just after midnight, once the day that ended is in the per-minute aggregate. */
const RELEARN_PATTERN = '2 0 * * *';

/**
 * A moment as the day it is in a zone.
 *
 * @param date - The moment.
 * @param timeZone - The zone.
 * @returns `YYYY-MM-DD`.
 */
function dayIn(date: Date, timeZone: string): string {
  const { year, month, day } = zonedParts(date, timeZone);

  return `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * What is known when the activity cannot be read.
 *
 * @param reason - Why.
 * @returns The fallback time, unavailable.
 */
function unavailable(reason: string): QuietTime {
  return {
    state: 'unavailable',
    time: QUIET_TIME_FALLBACK,
    quietFrom: null,
    quietTo: null,
    daysOfData: 0,
    daysNeeded: 3,
    profile: [],
    reason,
  };
}

/** The quietest time's entity, learned again each day. */
export class QuietTimeMonitor {
  readonly #options: QuietTimeMonitorOptions;
  readonly #now: () => Date;
  #timeZone = 'UTC';
  #job: Cron | undefined;

  /**
   * Builds the monitor without starting it.
   *
   * @param options - The database, the ingest pipeline and the clock.
   */
  public constructor(options: QuietTimeMonitorOptions) {
    this.#options = options;
    this.#now = options.now ?? ((): Date => new Date());
  }

  /**
   * Learns the time now, and again after each midnight of the house.
   *
   * @param timeZone - The house's zone.
   */
  public async start(timeZone: string): Promise<void> {
    await this.sync(timeZone);
  }

  /**
   * Follows the house's zone: learns again in it and moves the daily run to its midnight.
   *
   * @param timeZone - The house's zone.
   */
  public async sync(timeZone: string): Promise<void> {
    this.#timeZone = timeZone;
    this.#job?.stop();
    this.#job = new Cron(RELEARN_PATTERN, { timezone: timeZone, protect: true }, () => {
      void this.publish();
    });

    await this.publish();
  }

  /** Learns the time and reports it. A failure is logged, never thrown. */
  public async publish(): Promise<void> {
    const { ingest, logger, newTraceId } = this.#options;

    try {
      const record = ingest.directory.get(parseEntityId(QUIET_TIME_ENTITY_ID));

      if (record?.isEnabled !== true) {
        return;
      }

      const current = ingest.registry.get(record.entityId);
      const previous = quietTimeFromState(current?.state, current?.attributes);
      const quiet = await this.#learn(previous?.timezone === this.#timeZone ? previous.time : null);

      ingestReport(
        ingest,
        record,
        {
          entityId: record.entityId,
          state: { sensor_text: { value: quiet.time } },
          isAvailable: true,
          attributes: quietTimeAttributes({ ...quiet, timezone: this.#timeZone }),
        },
        newTraceId(),
      );
    } catch (error: unknown) {
      logger.warn({ err: error }, 'Could not report the quietest time');
    }
  }

  /** Stops learning. */
  public stop(): void {
    this.#job?.stop();
    this.#job = undefined;
  }

  /**
   * Learns the quietest time from the house's activity.
   *
   * @param previousTime - The time in use now, kept unless another is clearly quieter.
   * @returns What was learned.
   */
  async #learn(previousTime: string | null): Promise<QuietTime> {
    const { db, logger } = this.#options;
    const timezone = this.#timeZone;

    try {
      return quietestTime({
        cells: await readActivity(db, { days: LEARNING_DAYS, timezone }),
        today: dayIn(this.#now(), timezone),
        durationMinutes: QUIET_TIME_WINDOW_MINUTES,
        previousTime,
        fallbackTime: QUIET_TIME_FALLBACK,
      });
    } catch (error: unknown) {
      logger.warn({ err: error }, 'Could not learn the quietest time');

      return unavailable("The house's activity could not be read");
    }
  }
}
