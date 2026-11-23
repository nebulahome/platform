/**
 * The calendars' ICS sources: an address read every hour, or a loaded file read again each day
 * (docs/calendar.md 7.2, D11).
 *
 * An address is downloaded with the last success's ETag and Last-Modified, so an unchanged one
 * costs a 304; once a day it is downloaded whole all the same, since the window of occurrences
 * kept (a year back, two on) moves with the days and a 304 brings no text to expand again. A file
 * never changes, so it is only expanded again once a day. Each read writes the occurrences and the
 * source's state (`persistence/calendar-store.ts`); a read that fails keeps the occurrences of the
 * last success and says why in the state, which shows them greyed.
 *
 * Read at once, besides: a source never tried (just given to a calendar), a source whose
 * calendar's models changed (its occurrences take a model by name), and a source somebody asked
 * to refresh. A test reads an address or a loaded file and says what it holds, writing nothing.
 * The same hourly round sweeps the files tested and never attached, a day on.
 */
import { Cron } from 'croner';

import type { BusClient } from '@nebulahome/bus';
import {
  busSubjects,
  DAY_MS,
  type CalendarIcsState,
  type CalendarIcsTestReply,
  type CalendarIcsTestRequest,
} from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import {
  parseIcs,
  summarizeIcs,
  type IcsInstance,
  type IcsModel,
} from '../domain/calendar/ics-parse.js';
import {
  icsStateOf,
  readCalendarModels,
  readIcsFile,
  readIcsSources,
  sweepTestedFiles,
  writeIcsRead,
  type IcsSource,
} from '../persistence/calendar-store.js';

import { downloadIcs } from './ics-download.js';

/** What the fetcher needs. */
export type IcsFetcherOptions = {
  readonly db: Database;

  /** Where `library_event` is told after a read brought events in. */
  readonly client: Pick<BusClient, 'publish'>;
  readonly logger: PlatformLogger;

  /** The clock. */
  readonly now?: () => Date;

  /** `fetch`, replaceable in tests. */
  readonly fetch?: typeof fetch;

  /** Told after reads that changed a calendar's events or whether its source fails. */
  readonly onImported?: () => Promise<unknown>;
};

/** What a read of one source came to. */
type ReadOutcome = {
  readonly state: CalendarIcsState;

  /** Whether the calendar's events, or whether its source fails, changed. */
  readonly changed: boolean;
};

/** At the turn of each hour, in the house's zone. */
const ROUND_PATTERN = '0 * * * *';

/** How old a success may be and still save the next read: a day, less the round's hour. */
const FULL_READ_MS = DAY_MS - 3_600_000;

/** No validators: the whole text. */
const NONE = { etag: null, lastModified: null };

/**
 * The names of a calendar's models, in one string: a change of it reads the source again.
 *
 * @param models - The models.
 * @returns Their names, sorted.
 */
function modelsKey(models: readonly IcsModel[]): string {
  return models
    .map((model) => model.name)
    .toSorted()
    .join('\n');
}

/** The calendars' ICS sources, read on the hour and on demand. */
export class IcsFetcher {
  readonly #options: IcsFetcherOptions;
  readonly #now: () => Date;
  #zone = 'UTC';
  #job: Cron | undefined;

  /** The reads going on, by calendar and source: a second ask for one joins it. */
  readonly #reading = new Map<string, Promise<ReadOutcome>>();

  /** The models each source's occurrences were last matched against. */
  readonly #modelKeys = new Map<string, string>();

  /**
   * Builds the fetcher without starting it.
   *
   * @param options - The database, the bus, the clock and what to tell after a read.
   */
  public constructor(options: IcsFetcherOptions) {
    this.#options = options;
    this.#now = options.now ?? ((): Date => new Date());
  }

  /**
   * Starts the hourly round in the house's zone, and reads the sources never tried.
   *
   * @param timeZone - The house's zone.
   */
  public start(timeZone: string): void {
    this.sync(timeZone);
    void this.syncCalendars();
  }

  /**
   * Follows the house's zone: the round, today and floating times are read in it.
   *
   * @param timeZone - The house's zone.
   */
  public sync(timeZone: string): void {
    this.#zone = timeZone;
    this.#job?.stop();
    this.#job = new Cron(ROUND_PATTERN, { timezone: timeZone, protect: true }, async () => {
      await this.round();
    });
  }

  /** Stops the round. */
  public stop(): void {
    this.#job?.stop();
    this.#job = undefined;
  }

  /**
   * Reads, after the API wrote the calendars, the sources never tried and the ones whose
   * calendar's models changed. Never throws: a failure is logged.
   *
   * @returns A promise that settles once those reads are done.
   */
  public async syncCalendars(): Promise<void> {
    try {
      const due = (await readIcsSources(this.#options.db)).filter((source) => {
        const key = modelsKey(source.models);
        const known = this.#modelKeys.get(source.calendarId);

        this.#modelKeys.set(source.calendarId, key);

        return source.state.lastAttemptAt === null || (known !== undefined && known !== key);
      });

      await this.#readAll(due, true);
    } catch (error: unknown) {
      this.#options.logger.warn({ err: error }, 'Could not read the calendar sources');
    }
  }

  /**
   * The hourly round: sweeps the tested files, reads every address, and the files not read today.
   * Never throws: a failure is logged.
   *
   * @returns A promise that settles once the round is done.
   */
  public async round(): Promise<void> {
    const { db, logger } = this.#options;
    const now = this.#now().getTime();

    try {
      const swept = await sweepTestedFiles(db, new Date(now - DAY_MS));

      if (swept > 0) {
        logger.info({ swept }, 'Removed calendar files tested and never used');
      }

      const due = (await readIcsSources(db)).filter(
        (source) =>
          source.url !== null ||
          source.state.lastSuccessAt === null ||
          now - source.state.lastSuccessAt.getTime() >= FULL_READ_MS,
      );

      await this.#readAll(due, false);
    } catch (error: unknown) {
      logger.warn({ err: error }, 'The hourly read of the calendar sources failed');
    }
  }

  /**
   * Reads one calendar's source now.
   *
   * @param calendarId - The calendar.
   * @returns Its source's state after the read; as it was, for a calendar that reads none.
   */
  public async refresh(calendarId: string): Promise<CalendarIcsState> {
    const [source] = await readIcsSources(this.#options.db, calendarId);

    if (source === undefined) {
      return icsStateOf({});
    }

    const outcome = await this.#read(source, false);

    if (outcome.changed) {
      await this.#imported();
    }

    return outcome.state;
  }

  /**
   * Reads an address or a loaded file and says what it holds, writing nothing.
   *
   * @param request - The address or the file, and the calendar whose models to match.
   * @returns What it holds, or why it cannot be read.
   */
  public async test(request: CalendarIcsTestRequest): Promise<CalendarIcsTestReply> {
    const { db } = this.#options;
    let text: string;

    if ('url' in request) {
      const download = await downloadIcs(request.url, NONE, this.#options.fetch);

      if (download.kind !== 'body') {
        return download.kind === 'error'
          ? { kind: 'error', code: download.code, detail: download.detail.slice(0, 300) }
          : { kind: 'error', code: 'unreachable', detail: 'Not modified, with nothing asked' };
      }

      text = download.text;
    } else {
      const body = await readIcsFile(db, request.fileId);

      if (body === null) {
        return { kind: 'error', code: 'not_found', detail: 'No such file' };
      }

      text = body;
    }

    const now = this.#now();
    const models =
      request.calendarId === undefined ? [] : await readCalendarModels(db, request.calendarId);
    const parsed = parseIcs(text, { now, zone: this.#zone, models });

    if (parsed.kind === 'error') {
      return parsed;
    }

    return {
      kind: 'ok',
      ...('fileId' in request ? { fileId: request.fileId } : {}),
      ...summarizeIcs(parsed.instances, now, this.#zone),
      calendarName: parsed.calendarName,
      allPast: parsed.allPast,
    };
  }

  /**
   * Reads some sources side by side, then tells what changed once.
   *
   * @param sources - The sources.
   * @param isFull - Whether to read every text whole, sending no validators.
   */
  async #readAll(sources: readonly IcsSource[], isFull: boolean): Promise<void> {
    const outcomes = await Promise.allSettled(
      sources.map(async (source) => this.#read(source, isFull)),
    );

    for (const [index, outcome] of outcomes.entries()) {
      if (outcome.status === 'rejected') {
        this.#options.logger.warn(
          { err: outcome.reason, calendarId: sources[index]?.calendarId },
          'Could not read a calendar source',
        );
      }
    }

    if (outcomes.some((outcome) => outcome.status === 'fulfilled' && outcome.value.changed)) {
      await this.#imported();
    }
  }

  /**
   * Reads one source, or joins the read of it going on.
   *
   * @param source - The source.
   * @param isFull - Whether to read its text whole.
   * @returns What the read came to.
   */
  async #read(source: IcsSource, isFull: boolean): Promise<ReadOutcome> {
    // A source changed while the old one is read is a read of its own, not the old one's.
    const key = `${source.calendarId} ${source.url ?? source.fileId ?? ''}`;
    const going = this.#reading.get(key);

    if (going !== undefined) {
      return going;
    }

    const reading = this.#readSource(source, isFull).finally(() => {
      this.#reading.delete(key);
    });

    this.#reading.set(key, reading);

    return reading;
  }

  /**
   * Downloads or loads one source, expands it and writes what it brought.
   *
   * @param source - The source.
   * @param isFull - Whether to send no validators.
   * @returns The state written and whether the calendar changed.
   */
  async #readSource(source: IcsSource, isFull: boolean): Promise<ReadOutcome> {
    const { db, logger } = this.#options;
    const now = this.#now();
    const previous = source.state;
    let state: CalendarIcsState = { ...previous, lastAttemptAt: now };
    let text: string | null = null;

    if (source.url === null) {
      text = source.fileId === null ? null : await readIcsFile(db, source.fileId);
      state =
        text === null ? { ...state, error: { code: 'not_found', detail: 'No such file' } } : state;
    } else {
      const isRecent =
        !isFull &&
        previous.lastSuccessAt !== null &&
        now.getTime() - previous.lastSuccessAt.getTime() < FULL_READ_MS;
      const download = await downloadIcs(
        source.url,
        isRecent ? { etag: previous.etag, lastModified: previous.lastModified } : NONE,
        this.#options.fetch,
      );

      if (download.kind === 'not_modified') {
        state = { ...state, lastSuccessAt: now, error: null };
      } else if (download.kind === 'error') {
        state = { ...state, error: { code: download.code, detail: download.detail.slice(0, 300) } };
      } else {
        text = download.text;
        state = { ...state, etag: download.etag, lastModified: download.lastModified };
      }
    }

    let instances: readonly IcsInstance[] | undefined;

    if (text !== null) {
      const parsed = parseIcs(text, { now, zone: this.#zone, models: source.models });

      if (parsed.kind === 'error') {
        state = { ...state, error: { code: parsed.code, detail: parsed.detail } };
      } else {
        const { eventCount, rangeFrom, rangeTo, matchedModels } = summarizeIcs(
          parsed.instances,
          now,
          this.#zone,
        );

        instances = parsed.instances;
        state = {
          ...state,
          eventCount,
          rangeFrom,
          rangeTo,
          matchedModels,
          lastSuccessAt: now,
          error: null,
        };
      }
    }

    const isWritten = await writeIcsRead(db, source, state, instances);

    this.#modelKeys.set(source.calendarId, modelsKey(source.models));

    if (state.error !== null) {
      logger.info(
        { calendarId: source.calendarId, code: state.error.code, detail: state.error.detail },
        'A calendar source could not be read',
      );
    }

    return {
      state,
      changed:
        isWritten &&
        (instances !== undefined || (previous.error === null) !== (state.error === null)),
    };
  }

  /** Reads the calendars again and tells the pages, after reads brought something in. */
  async #imported(): Promise<void> {
    try {
      await this.#options.onImported?.();
    } catch (error: unknown) {
      this.#options.logger.warn({ err: error }, 'Could not read the calendars again');
    }

    this.#options.client.publish(busSubjects.libraryEvent(), { kind: 'calendar' });
  }
}
