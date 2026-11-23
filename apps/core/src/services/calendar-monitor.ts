/**
 * The house's calendars as entities: one `calendar.<slug>` per calendar and the two working-day
 * sensors, on the Calendar device (docs/calendar.md 7.1).
 *
 * The times of every calendar, from two days back to 400 days on, are worked out from the rows
 * (`domain/calendar/calendar-times.ts`) and kept here; each entity's state is read from them and
 * handed to the ingest pipeline like any other reading. A timer wakes at the next moment one may
 * change - an event starting or ending, midnight - at most an hour ahead, as the automation
 * engine's timers are. The rows are read again on `sync_calendars`, when the house's zone
 * changes, and each midnight (the window moves, the holidays of a new year come in); the times
 * are worked out again, without the rows, when an entity shown in a calendar changes value.
 *
 * It also answers the automation engine: when a calendar trigger next fires
 * ({@link CalendarMonitor.nextBoundary}).
 */
import {
  addDays,
  busSubjects,
  wallOf,
  type CalendarTrigger,
  type EntityId,
  type StateReport,
} from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import {
  calendarStateOf,
  expandCalendars,
  isWorkingOn,
  nextChange,
  nextEdge,
  type CalendarTime,
} from '../domain/calendar/calendar-times.js';
import type { IngestResult } from '../domain/entity-registry.js';
import {
  CALENDAR_DEVICE_NAME,
  syncCalendarEntities,
  WORKING_TOMORROW_ENTITY_ID,
  type CalendarEntity,
} from '../persistence/calendar-entities.js';
import { readCalendarRows, type CalendarRows } from '../persistence/calendar-store.js';

import { ingestReport, type StateIngestOptions } from './state-ingest.js';

/** What the monitor needs. */
export type CalendarMonitorOptions = {
  readonly db: Database;

  /** The ingest pipeline the states go through, with its directory, registry and cache. */
  readonly ingest: StateIngestOptions;

  readonly logger: PlatformLogger;
  readonly newTraceId: () => string;

  /** The clock. */
  readonly now?: () => Date;

  /** Told each time the times are worked out again: the calendar triggers arm again by them. */
  readonly onChanged?: () => void;
};

/** One time a calendar trigger fires for, as the run records it. */
export type CalendarFire = {
  readonly eventId?: string;
  readonly eventTitle: string;

  /** Its start: an instant, or the day of an all-day one. */
  readonly occurrenceStart: string;
};

/** When a calendar trigger next fires, why it cannot, or null when nothing is coming. */
export type CalendarBoundary =
  | { readonly at: Date; readonly fires: readonly CalendarFire[] }
  | { readonly problem: string }
  | null;

/** How many days back the times are kept: a trigger fires up to a day after an event ends. */
const DAYS_BACK = 2;

/** How many days on. */
const DAYS_ON = 400;

/** How long the timer is set for at most; past it, the next moment is worked out again. */
const MAX_TIMER_MS = 3_600_000;

/** The calendars' entities, kept in step with the rows and the clock. */
export class CalendarMonitor {
  readonly #options: CalendarMonitorOptions;
  readonly #now: () => Date;
  #zone = 'UTC';
  #rows: CalendarRows | undefined;
  #times: CalendarTime[] = [];

  /** The house day the rows were read on: past midnight they are read again. */
  #loadedDay = '';
  #entities: readonly CalendarEntity[] = [];
  #stranded: readonly EntityId[] = [];
  #shown = new Set<string>();
  #timer: NodeJS.Timeout | undefined;

  /** The reads, one after the other: two at once would both write the device. */
  #queue: Promise<unknown> = Promise.resolve();
  #isRecomputeQueued = false;
  #isStopped = false;

  /**
   * Builds the monitor without starting it.
   *
   * @param options - The database, the ingest pipeline and the clock.
   */
  public constructor(options: CalendarMonitorOptions) {
    this.#options = options;
    this.#now = options.now ?? ((): Date => new Date());
  }

  /**
   * Reads the calendars in the house's zone, writes their entities and reports them.
   *
   * @param timeZone - The house's zone.
   * @returns How many calendars there are.
   */
  public async start(timeZone: string): Promise<number> {
    this.#zone = timeZone;
    this.#isStopped = false;

    return this.reload();
  }

  /**
   * Follows the house's zone: days, midnights and floating times are read in it.
   *
   * @param timeZone - The house's zone.
   */
  public async sync(timeZone: string): Promise<void> {
    this.#zone = timeZone;
    await this.reload();
  }

  /**
   * Reads the calendars again: after the API wrote one, a source brought events in, midnight.
   *
   * @returns How many calendars there are.
   */
  public async reload(): Promise<number> {
    const read = this.#queue.then(async () => this.#load());

    this.#queue = read.catch(() => undefined);

    return read;
  }

  /**
   * Takes in a change of an entity: one shown in a calendar moves its time there.
   *
   * @param result - What changed.
   */
  public onStateChanged(result: IngestResult): void {
    if (!result.hasStateChanged || !this.#shown.has(result.entityId) || this.#isRecomputeQueued) {
      return;
    }

    this.#isRecomputeQueued = true;
    queueMicrotask(() => {
      this.#isRecomputeQueued = false;

      try {
        this.#recompute();
      } catch (error: unknown) {
        this.#options.logger.warn({ err: error }, 'Could not work the calendars out again');
      }
    });
  }

  /**
   * When a calendar trigger next fires after an instant.
   *
   * @param trigger - The calendar, the edge, the offset and the models.
   * @param after - The instant to look past; the answer is strictly later.
   * @returns The moment and the times it fires for, why it cannot, or null when nothing in the
   *   next 400 days is coming.
   */
  public nextBoundary(
    trigger: Pick<CalendarTrigger, 'calendarId' | 'edge' | 'offsetMinutes' | 'modelIds'>,
    after: Date,
  ): CalendarBoundary {
    if (this.#rows?.calendars.some((calendar) => calendar.id === trigger.calendarId) !== true) {
      return { problem: 'The calendar is not there' };
    }

    const next = nextEdge(
      this.#times,
      { ...trigger, modelIds: trigger.modelIds ?? [] },
      after.getTime(),
    );

    return next === null
      ? null
      : {
          at: new Date(next.at),
          fires: next.times.map((time) => ({
            ...(time.eventId === null ? {} : { eventId: time.eventId }),
            eventTitle: time.title.slice(0, 200),
            occurrenceStart: time.startsAt ?? time.startsOn ?? '',
          })),
        };
  }

  /** Stops the timer. */
  public stop(): void {
    this.#isStopped = true;
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  /**
   * Reads the rows, writes the entities, and works the times out.
   *
   * @returns How many calendars there are.
   */
  async #load(): Promise<number> {
    const { db, ingest, logger } = this.#options;
    const today = wallOf(this.#now().getTime(), this.#zone).day;
    const rows = await readCalendarRows(
      db,
      this.#zone,
      addDays(today, -DAYS_BACK),
      addDays(today, DAYS_ON),
    );
    const outcome = await syncCalendarEntities(db, rows.calendars, logger);
    const before = new Set(this.#entities.map((entity) => entity.entityId));

    for (const entity of outcome.written) {
      ingest.directory.set({
        entityId: entity.entityId,
        rowId: entity.rowId,
        source: 'system',
        isEnabled: entity.isEnabled,
        capabilities: entity.capabilities,
      });
    }

    const removedRows = new Set(outcome.removed.map((entity) => entity.rowId));

    for (const entity of outcome.removed) {
      ingest.directory.remove(entity.entityId);
      ingest.registry.remove(entity.entityId);
    }

    ingest.stateCache.discard((row) => removedRows.has(row.entityId));

    if (
      outcome.removed.length > 0 ||
      outcome.written.some((entity) => !before.has(entity.entityId))
    ) {
      ingest.client.publish(busSubjects.deviceEvent('updated'), {
        deviceId: outcome.deviceId,
        source: 'system',
        name: CALENDAR_DEVICE_NAME,
        entityIds: outcome.written.map((entity) => entity.entityId),
      });
    }

    this.#rows = rows;
    this.#loadedDay = today;
    this.#entities = outcome.written;
    this.#stranded = outcome.stranded;
    this.#shown = new Set(rows.shown.map((entity) => entity.entityId));
    this.#recompute();

    return rows.calendars.length;
  }

  /** Works the times out from the rows and the entities' states, reports, and sets the timer. */
  #recompute(): void {
    const rows = this.#rows;

    if (rows === undefined) {
      return;
    }

    const { registry } = this.#options.ingest;

    this.#times = expandCalendars(
      {
        ...rows,
        entities: rows.shown.map((entity) => ({
          ...entity,
          state: registry.get(entity.entityId as EntityId)?.state,
        })),
      },
      addDays(this.#loadedDay, -DAYS_BACK),
      addDays(this.#loadedDay, DAYS_ON),
      this.#zone,
    );
    this.#publish();
    this.#arm();
    this.#options.onChanged?.();
  }

  /** Reports what each entity says now; one kept for an alias, its calendar gone, unavailable. */
  #publish(): void {
    const rows = this.#rows;
    const { ingest, newTraceId } = this.#options;

    if (rows === undefined) {
      return;
    }

    const traceId = newTraceId();
    const now = this.#now().getTime();
    const today = wallOf(now, this.#zone).day;

    for (const entity of this.#entities) {
      const record = ingest.directory.get(entity.entityId);

      if (record?.isEnabled !== true) {
        continue;
      }

      const { calendarId } = entity;
      const isStale = rows.calendars.some(
        (calendar) => calendar.id === calendarId && calendar.isStale,
      );
      const day = entity.entityId === WORKING_TOMORROW_ENTITY_ID ? addDays(today, 1) : today;
      const report: StateReport = {
        entityId: entity.entityId,
        state:
          calendarId === null
            ? {
                sensor_binary: {
                  isOn: isWorkingOn(day, this.#times, rows.calendars, rows.settings.weekendDays),
                },
              }
            : { calendar: calendarStateOf(this.#times, calendarId, now, isStale) },
        isAvailable: true,
        attributes: {},
      };

      ingestReport(ingest, record, report, traceId);
    }

    for (const entityId of this.#stranded) {
      const record = ingest.directory.get(entityId);

      if (record?.isEnabled === true) {
        ingestReport(
          ingest,
          record,
          { entityId, state: ingest.registry.get(entityId)?.state ?? {}, isAvailable: false },
          traceId,
        );
      }
    }
  }

  /** Sets the timer for the next moment something may change, at most an hour ahead. */
  #arm(): void {
    clearTimeout(this.#timer);

    if (this.#isStopped) {
      return;
    }

    const now = this.#now().getTime();
    const delay = nextChange(this.#times, now, this.#zone) - now;

    this.#timer = setTimeout(
      () => {
        this.#tick();
      },
      Math.min(Math.max(0, delay), MAX_TIMER_MS),
    );
    this.#timer.unref();
  }

  /** The timer's turn: past midnight the rows are read again, otherwise the states only. */
  #tick(): void {
    if (wallOf(this.#now().getTime(), this.#zone).day === this.#loadedDay) {
      this.#publish();
      this.#arm();

      return;
    }

    this.reload().catch((error: unknown) => {
      this.#options.logger.warn({ err: error }, 'Could not read the calendars again');
      this.#arm();
    });
  }
}
