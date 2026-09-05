/**
 * The values a server setting can be given, as a dropdown can offer them.
 *
 * A `<select>` deals in strings and these settings are numbers, strings and nulls, so every list
 * here comes with the pair of functions that crosses that boundary. One place to encode and one
 * to decode, rather than a `Number(...)` at each call site and a `null` special case somebody
 * eventually forgets.
 *
 * The durations are a fixed ladder rather than a free number field, and that is a judgement:
 * nobody needs 43 days of telemetry, and a typed number is how somebody ends up with 3 by
 * meaning 30. The floors come from the catalogue, so a level can never be offered a duration its
 * own schema would refuse.
 */
import { PINO_LEVEL_BY_NAME, type JsonValue } from '@nebula-home/contracts';

/** One option, as a dropdown wants it. */
export type Choice = {
  /** The encoded value. */
  readonly value: string;

  /** What it is called. */
  readonly label: string;
};

/** The durations offered, in days. `null` means keep forever. */
const DURATIONS: readonly (number | null)[] = [1, 7, 14, 30, 90, 180, 365, 730, 1825, null];

/**
 * Encodes a value for a `<select>`.
 *
 * Written out by case rather than through `String(...)`, because a `JsonValue` can be an object
 * or an array and `String({})` is `[object Object]` - which would render as a dropdown that
 * silently shows nothing recognisable rather than as a fault anybody could see. No setting in
 * the catalogue holds one today; the empty string is what a future one would land on, and an
 * option with no value is at least visibly wrong.
 *
 * @param value - The setting's value.
 * @returns Its string form. `null` becomes the word, because an empty option value is
 * indistinguishable from no option at all.
 */
export function encodeChoice(value: JsonValue): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return value;
  }

  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}

/**
 * Reads a setting that should hold one of a fixed set of words.
 *
 * @param value - What the server sent.
 * @param fallback - What to show when it is not a string at all.
 * @returns The word, or the fallback.
 */
export function asWord(value: JsonValue | undefined, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Decodes a number-or-null setting.
 *
 * @param encoded - What the dropdown reported.
 * @returns The number, or null for forever.
 */
export function decodeNumberChoice(encoded: string): number | null {
  return encoded === 'null' ? null : Number(encoded);
}

/**
 * Builds the durations a retention setting may be given.
 *
 * @param minimumDays - The shortest duration its schema allows.
 * @param canBeForever - Whether keeping it indefinitely is offered.
 * @returns The options, shortest first, with forever last.
 */
export function retentionChoices(minimumDays: number, canBeForever = true): Choice[] {
  return DURATIONS.filter((days) => (days === null ? canBeForever : days >= minimumDays)).map(
    (days) => ({
      value: encodeChoice(days),
      label: days === null ? 'Forever' : durationLabel(days),
    }),
  );
}

/**
 * Names a duration in days.
 *
 * @param days - How many.
 * @returns A phrase such as `30 days` or `5 years`.
 */
export function durationLabel(days: number): string {
  if (days % 365 === 0) {
    const years = days / 365;

    return years === 1 ? '1 year' : `${String(years)} years`;
  }

  return days === 1 ? '1 day' : `${String(days)} days`;
}

/**
 * The six log levels, coarsest last.
 *
 * The stored value is pino's number rather than its name, so the label is the name and the value
 * is what the column holds.
 */
export const LOG_LEVEL_CHOICES: readonly Choice[] = Object.entries(PINO_LEVEL_BY_NAME).map(
  ([name, level]) => ({
    value: String(level),
    label: `${name} and above`,
  }),
);

/** How long a session may last, in hours. */
export const SESSION_LIFETIME_CHOICES: readonly Choice[] = [
  { value: '12', label: '12 hours' },
  { value: '24', label: 'A day' },
  { value: '168', label: 'A week' },
  { value: '720', label: 'A month' },
  { value: '2160', label: 'Three months' },
  { value: '8760', label: 'A year' },
];
