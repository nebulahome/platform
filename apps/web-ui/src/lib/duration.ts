/**
 * Durations as a person writes them: "0 s", "2 min", "1 h 30 min".
 *
 * The document keeps milliseconds - nobody types 300000 - and every duration field in the
 * automation editor shows and reads them through these two functions, so a wait, a hold and a
 * run's limit all look alike.
 */
import { translate } from '@/i18n/messages';

/** Milliseconds in each unit a duration is written in. */
const UNITS: readonly (readonly [unit: string, ms: number])[] = [
  ['ms', 1],
  ['msec', 1],
  ['s', 1_000],
  ['sec', 1_000],
  ['secs', 1_000],
  ['second', 1_000],
  ['seconds', 1_000],
  ['m', 60_000],
  ['min', 60_000],
  ['mins', 60_000],
  ['minute', 60_000],
  ['minutes', 60_000],
  ['h', 3_600_000],
  ['hr', 3_600_000],
  ['hrs', 3_600_000],
  ['hour', 3_600_000],
  ['hours', 3_600_000],
  ['d', 86_400_000],
  ['day', 86_400_000],
  ['days', 86_400_000],
];

/** The units by name. */
const UNIT_MS = new Map(UNITS);

/**
 * The day's unit as the interface writes it: `d` in English, `g` in Italian. Read as a day too
 * when typed, so a duration written back the way it was shown parses.
 *
 * @returns The unit.
 */
function dayUnit(): string {
  return translate('duration.day', 'd');
}

/**
 * Writes a duration the way a person reads it: the largest units that divide it, at most two.
 *
 * @param ms - Milliseconds.
 * @returns `0 s`, `500 ms`, `45 s`, `2 min`, `1 h 30 min`, `2 d`.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '0 s';
  }

  if (ms < 1_000) {
    return `${String(Math.round(ms))} ms`;
  }

  const parts: string[] = [];
  let rest = Math.round(ms / 1_000) * 1_000;

  for (const [unit, size] of [
    [dayUnit(), 86_400_000],
    ['h', 3_600_000],
    ['min', 60_000],
    ['s', 1_000],
  ] as const) {
    if (rest >= size && parts.length < 2) {
      const count = Math.floor(rest / size);

      parts.push(`${String(count)} ${unit}`);
      rest -= count * size;
    } else if (parts.length > 0) {
      // Two units say enough; a third is noise ("1 h 0 min 5 s").
      break;
    }
  }

  return parts.join(' ');
}

/**
 * Reads a duration someone typed: numbers with units, any number of them; a bare number is
 * seconds, which is what a field asking for a duration most often gets.
 *
 * @param text - What was typed: `90`, `90 s`, `2 min`, `1h 30m`, `1:30`.
 * @returns Milliseconds, or null when it is not a duration.
 */
export function parseDuration(text: string): number | null {
  const trimmed = text.trim().toLowerCase();

  if (trimmed === '') {
    return null;
  }

  // "1:30" is minutes and seconds; "1:30:00" hours, minutes, seconds.
  if (/^\d+(:\d{1,2}){1,2}$/u.test(trimmed)) {
    const [first = 0, second = 0, third] = trimmed.split(':').map(Number);

    return third === undefined
      ? (first * 60 + second) * 1_000
      : (first * 3_600 + second * 60 + third) * 1_000;
  }

  if (/^\d+(\.\d+)?$/u.test(trimmed)) {
    return Math.round(Number(trimmed) * 1_000);
  }

  const pattern = /(\d+(?:\.\d+)?)\s*([a-z]+)/gu;
  let total = 0;
  let consumed = '';

  for (const match of trimmed.matchAll(pattern)) {
    const [whole, amount = '0', unit = ''] = match;
    const size = UNIT_MS.get(unit) ?? (unit === dayUnit() ? UNIT_MS.get('d') : undefined);

    if (size === undefined) {
      return null;
    }

    total += Number(amount) * size;
    consumed += whole;
  }

  // Everything typed has to have been read: "2 min and a bit" is not a duration.
  if (consumed.replaceAll(/\s/gu, '') !== trimmed.replaceAll(/\s/gu, '')) {
    return null;
  }

  return Math.round(total);
}
