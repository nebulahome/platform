/**
 * The canonical human-readable rendering of a log record.
 *
 * ```
 * [2026-09-04T10:35:19.852Z][core][INFO] Entity registered
 * ```
 *
 * One function produces this everywhere a person reads a log line: the development console, the
 * `logger` service, and the live tail in the web interface. Three renderings of the same record
 * that differ in shape are three things to learn instead of one, and they make a line pasted
 * into an issue impossible to place.
 *
 * **This is a rendering, not the wire format.** Services emit newline-delimited JSON, which is
 * what `logger` parses into the typed columns of `history.logs` and what makes a log searchable
 * by trace identifier or filterable by level. A bracketed line has to be parsed back with a
 * regular expression to recover any of that. Both carry the same three leading fields, so the
 * rendering is always reconstructible from the record and never the other way round.
 *
 * Defined in RULES.md 10.3.
 */
import { PINO_LEVEL_BY_NAME, type LogLevel } from '@nebula-home/contracts';

/** The severity name for each numeric pino level, as stored in `history.logs.level`. */
const LEVEL_NAME_BY_PINO_NUMBER = new Map<number, LogLevel>(
  Object.entries(PINO_LEVEL_BY_NAME).map(([name, number]) => [number, name as LogLevel]),
);

/** Shown in the name bracket when a record identifies neither a service nor a package. */
const UNKNOWN_SOURCE = 'unknown';

/** Shown in the level bracket when a record carries a severity this build does not know. */
const UNKNOWN_LEVEL = 'LOG';

/**
 * The fields the rendering reads.
 *
 * Deliberately loose: a record reaches this function from three places - pino's own output, a
 * row of `history.logs`, and a bus payload - and they disagree about how `level` and `time` are
 * encoded. Normalising here keeps that difference out of all three call sites.
 */
export type RenderableLogRecord = {
  /** ISO 8601 string, epoch milliseconds, or a `Date`. */
  readonly time?: string | number | Date;

  /** A severity name, or the numeric pino level. */
  readonly level?: string | number;

  /** The service that emitted the record. */
  readonly service?: string;

  /** The package that emitted it, when one did. Takes precedence over `service`. */
  readonly packageId?: string;

  /** The message. */
  readonly msg?: string;
};

/**
 * Normalises the timestamp of a record to an ISO 8601 string in UTC.
 *
 * @param time - Whatever the source encoded the timestamp as.
 * @returns The timestamp in ISO 8601, or the current time when the record carries none.
 */
function renderTime(time: string | number | Date | undefined): string {
  if (time === undefined) {
    return new Date().toISOString();
  }

  if (typeof time === 'string') {
    // Already ISO 8601 in the common case, since that is what the logger factory emits.
    return time;
  }

  return new Date(time).toISOString();
}

/**
 * Normalises the severity of a record to its upper-case name.
 *
 * @param level - A severity name, or the numeric pino level from `history.logs`.
 * @returns The name in upper case, or `LOG` for a severity this build does not know.
 */
function renderLevel(level: string | number | undefined): string {
  if (typeof level === 'number') {
    return (LEVEL_NAME_BY_PINO_NUMBER.get(level) ?? UNKNOWN_LEVEL).toUpperCase();
  }

  return level === undefined || level.length === 0 ? UNKNOWN_LEVEL : level.toUpperCase();
}

/**
 * Renders one log record as a line.
 *
 * The name bracket shows the **package** when the record came from one and the service
 * otherwise. A package is what an owner recognises - they installed `nvr`, they never installed
 * `packet-manager` - so showing the supervising service instead would name the wrong thing in
 * exactly the case where someone is trying to find out which package is misbehaving.
 *
 * The level is not padded. A fixed-width level would only align messages if the name bracket
 * were fixed-width too, and it never is: `core` and `packet-manager` differ by ten characters.
 *
 * @param record - The record, from pino, from `history.logs`, or from the bus.
 * @returns The line, without a trailing newline.
 */
export function formatLogLine(record: RenderableLogRecord): string {
  const time = renderTime(record.time);
  const name = record.packageId ?? record.service ?? UNKNOWN_SOURCE;
  const level = renderLevel(record.level);
  const message = record.msg ?? '';

  return `[${time}][${name}][${level}] ${message}`;
}

/**
 * Fields that belong to the line's prefix, or to the process rather than the event, and are
 * therefore never repeated in the context.
 *
 * `version` is excluded because it is identical on every record a process emits, and a constant
 * repeated on every line is noise that pushes the varying part off the right of the terminal.
 */
const PREFIX_FIELDS = new Set(['time', 'level', 'service', 'packageId', 'msg', 'version']);

/**
 * Fields pino adds about the process, which say nothing about what happened.
 */
const PROCESS_FIELDS = new Set(['pid', 'hostname', 'v']);

/**
 * Renders whatever a record carries beyond the line prefix.
 *
 * Separate from {@link formatLogLine} because the two audiences differ: an interface can show
 * the context as an expandable object next to the line, while a terminal has to have it inline
 * or lose it. Keeping them apart lets each caller decide, instead of one of them stripping
 * something the other put there.
 *
 * @param record - The record, including its arbitrary context fields.
 * @returns Compact JSON of the remaining fields, or an empty string when there are none.
 */
export function formatLogContext(record: Readonly<Record<string, unknown>>): string {
  const context = Object.fromEntries(
    Object.entries(record).filter(
      ([key]) => !PREFIX_FIELDS.has(key) && !PROCESS_FIELDS.has(key) && !key.startsWith('_'),
    ),
  );

  return Object.keys(context).length === 0 ? '' : JSON.stringify(context);
}
