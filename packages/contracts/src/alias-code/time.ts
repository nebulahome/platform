/**
 * Wall-clock fields of an instant in the house's time zone, and back.
 *
 * Built on `Intl.DateTimeFormat`, which both Node and the browser carry, so the server and a
 * trial in the editor read the same local time. Nothing here depends on the machine's own zone.
 */
import { CodeRunError } from './errors.js';

/** The local fields of an instant. */
export type ZonedFields = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;

  /** 0 is Monday, as Python's `weekday()`. */
  readonly weekday: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * The formatter for a zone, made once.
 *
 * @param zone - An IANA time zone.
 * @returns The formatter.
 * @throws {CodeRunError} When the zone is unknown.
 */
function formatterFor(zone: string): Intl.DateTimeFormat {
  const known = formatters.get(zone);

  if (known !== undefined) {
    return known;
  }

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });

    formatters.set(zone, formatter);
    return formatter;
  } catch {
    throw new CodeRunError(`unknown time zone '${zone}'`);
  }
}

/**
 * The local fields of an instant.
 *
 * @param ms - The instant, in Unix milliseconds.
 * @param zone - The house's IANA time zone.
 * @returns Year, month, day, hour, minute, second and weekday there.
 */
export function zonedFields(ms: number, zone: string): ZonedFields {
  const fields = new Map<string, number>();

  for (const part of formatterFor(zone).formatToParts(new Date(ms))) {
    fields.set(part.type, Number(part.value));
  }

  const year = fields.get('year') ?? 1970;
  const month = fields.get('month') ?? 1;
  const day = fields.get('day') ?? 1;

  return {
    year,
    month,
    day,
    hour: fields.get('hour') ?? 0,
    minute: fields.get('minute') ?? 0,
    second: fields.get('second') ?? 0,
    weekday: (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7,
  };
}

/**
 * How far the zone's clock is ahead of UTC at an instant.
 *
 * @param ms - The instant.
 * @param zone - The zone.
 * @returns Minutes; +60 for Rome in winter.
 */
export function zonedOffsetMinutes(ms: number, zone: string): number {
  const whole = Math.floor(ms / 1000) * 1000;
  const fields = zonedFields(whole, zone);
  const asUtc = Date.UTC(
    fields.year,
    fields.month - 1,
    fields.day,
    fields.hour,
    fields.minute,
    fields.second,
  );

  return Math.round((asUtc - whole) / 60_000);
}

/**
 * The instant a local wall-clock time names in a zone.
 *
 * A time the clock skips in spring lands after the jump; a time it shows twice in autumn takes
 * the second showing.
 *
 * @param fields - Local year, month, day, hour, minute and second.
 * @param zone - The zone.
 * @returns Unix milliseconds.
 */
export function zonedToEpoch(fields: Omit<ZonedFields, 'weekday'>, zone: string): number {
  const asUtc = Date.UTC(
    fields.year,
    fields.month - 1,
    fields.day,
    fields.hour,
    fields.minute,
    fields.second,
  );
  const first = asUtc - zonedOffsetMinutes(asUtc, zone) * 60_000;
  const second = zonedOffsetMinutes(first, zone);

  return asUtc - second * 60_000;
}

/**
 * Two digits.
 *
 * @param value - A number below 100.
 * @returns It, zero-padded.
 */
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * The ISO 8601 form of an instant in a zone, as Python's `isoformat()` of an aware datetime.
 *
 * @param ms - The instant.
 * @param zone - The zone.
 * @param separator - Between date and time: `T`, or a space for `str()`.
 * @returns For example `2026-11-09T14:30:00+01:00`.
 */
export function isoFormat(ms: number, zone: string, separator = 'T'): string {
  const fields = zonedFields(ms, zone);
  const offset = zonedOffsetMinutes(ms, zone);
  const sign = offset < 0 ? '-' : '+';
  const absolute = Math.abs(offset);
  const date = `${String(fields.year).padStart(4, '0')}-${pad(fields.month)}-${pad(fields.day)}`;
  const time = `${pad(fields.hour)}:${pad(fields.minute)}:${pad(fields.second)}`;

  return `${date}${separator}${time}${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}
