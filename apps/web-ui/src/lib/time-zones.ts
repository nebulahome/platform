/**
 * The time zones a house can be in, as the browser knows them.
 *
 * Shared by the first-run Home step and the server settings, so both offer the same list in the
 * same order: UTC first, then the browser's own zone - there even on a browser that lists none -
 * then every zone it knows.
 */

/** A zone, as a dropdown offers it. */
export type TimeZoneChoice = {
  readonly value: string;
  readonly label: string;
};

/** The browser's own zone: the likeliest answer for a house set up from inside it. */
export const BROWSER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Every zone, UTC and the browser's first. */
export const TIME_ZONES: readonly string[] = [
  ...new Set(['UTC', BROWSER_ZONE, ...Intl.supportedValuesOf('timeZone')]),
];

/**
 * A zone's name as people read it: `America/New_York` reads "America/New York".
 *
 * @param zone - The IANA name.
 * @returns The words.
 */
export function zoneName(zone: string): string {
  return zone.replaceAll('_', ' ');
}

/**
 * How far a zone is from UTC at a moment, as a clock reads it: "UTC+2", "UTC-3:30", "UTC".
 *
 * @param zone - The IANA name.
 * @param at - The moment; summer time moves it.
 * @returns The offset.
 */
export function zoneOffset(zone: string, at: Date = new Date()): string {
  try {
    // Read in English on purpose: the offset is parsed, not shown, and only English says "GMT".
    const part = new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(at)
      .find((entry) => entry.type === 'timeZoneName')?.value;

    const offset = part?.replace('GMT', 'UTC') ?? 'UTC';

    // UTC itself reads as GMT, GMT+0 or UTC+0, by engine: all of them are just UTC.
    return /^UTC(?:[+-]0)?$/u.test(offset) ? 'UTC' : offset;
  } catch {
    return 'UTC';
  }
}

/**
 * The zones as a dropdown offers them, each with its offset now: "Europe/Rome · UTC+2".
 *
 * @param at - The moment the offsets are for.
 * @returns The choices.
 */
export function timeZoneChoices(at: Date = new Date()): TimeZoneChoice[] {
  return TIME_ZONES.map((zone) => ({
    value: zone,
    label: zone === 'UTC' ? 'UTC' : `${zoneName(zone)} · ${zoneOffset(zone, at)}`,
  }));
}
