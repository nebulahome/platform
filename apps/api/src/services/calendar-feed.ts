/**
 * A share link's calendar file (RFC 5545), as phones and computers at home subscribe to it.
 *
 * The file lists the times themselves, not the rules: each time of a repeating event is a VEVENT
 * of its own with a UID of its own (plan D6). Calendar apps disagree on RRULE, EXDATE and time zone
 * blocks; a list of instants (UTC) and days (all day) reads the same everywhere. Lines end in CRLF,
 * text is escaped, and a line longer than 75 octets is folded without cutting a character in two.
 */

/** One time, as the file carries it. */
export type FeedEvent = {
  /** Stable for the same time of the same event, so a refresh updates it instead of adding one. */
  readonly uid: string;
  readonly title: string;
  readonly notes: string | null;

  /** The event model's name, as a category. */
  readonly category: string | null;
  readonly isAllDay: boolean;

  /** All day: the first and the last day, both included. */
  readonly startsOn: string | null;
  readonly endsOn: string | null;

  /** Timed: ISO 8601 instants. */
  readonly startsAt: string | null;
  readonly endsAt: string | null;
};

/** The longest line, in octets, before the CRLF. */
const LINE_OCTETS = 75;

/**
 * Escapes a text value: backslash, semicolon, comma and line breaks.
 *
 * @param text - The text.
 * @returns It, escaped.
 */
export function escapeText(text: string): string {
  return text
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll(/\r\n|\r|\n/gu, '\\n');
}

/**
 * Folds a content line: the first part at most 75 octets, each next one a space and at most 74.
 *
 * @param line - The line, unfolded.
 * @returns It, folded, joined by CRLF.
 */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let octets = 0;

  for (const character of line) {
    const size = Buffer.byteLength(character, 'utf8');
    const room = parts.length === 0 ? LINE_OCTETS : LINE_OCTETS - 1;

    if (octets + size > room) {
      parts.push(current);
      current = '';
      octets = 0;
    }

    current += character;
    octets += size;
  }

  parts.push(current);

  return parts.join('\r\n ');
}

/**
 * Writes an instant as a UTC date-time.
 *
 * @param iso - ISO 8601.
 * @returns `20261203T174200Z`.
 */
function utcOf(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replaceAll(/[-:]/gu, '')
    .replace(/\.\d{3}/u, '');
}

/**
 * Writes a day as a date value.
 *
 * @param day - `YYYY-MM-DD`.
 * @returns `20261203`.
 */
function dateOf(day: string): string {
  return day.replaceAll('-', '');
}

/**
 * The day after a day.
 *
 * @param day - `YYYY-MM-DD`.
 * @returns The next one.
 */
function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/**
 * Writes the file.
 *
 * @param name - The share link's name, shown as the calendar's name.
 * @param events - The times, in any order.
 * @param now - The time it is written, its DTSTAMP.
 * @returns The file, CRLF line ends.
 */
export function feedFileOf(name: string, events: readonly FeedEvent[], now: Date): string {
  const stamp = utcOf(now.toISOString());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Nebula Home//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
  ];

  for (const event of events) {
    const times =
      event.isAllDay && event.startsOn !== null && event.endsOn !== null
        ? [
            `DTSTART;VALUE=DATE:${dateOf(event.startsOn)}`,
            // DTEND is the day after the last one: the file's end is exclusive.
            `DTEND;VALUE=DATE:${dateOf(nextDay(event.endsOn))}`,
          ]
        : !event.isAllDay && event.startsAt !== null && event.endsAt !== null
          ? [`DTSTART:${utcOf(event.startsAt)}`, `DTEND:${utcOf(event.endsAt)}`]
          : null;

    if (times === null) {
      continue;
    }

    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeText(event.uid)}`,
      `DTSTAMP:${stamp}`,
      ...times,
      `SUMMARY:${escapeText(event.title)}`,
      ...(event.notes === null || event.notes === ''
        ? []
        : [`DESCRIPTION:${escapeText(event.notes)}`]),
      ...(event.category === null ? [] : [`CATEGORIES:${escapeText(event.category)}`]),
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');

  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
