import { describe, expect, it } from 'vitest';

import {
  matchModel,
  parseIcs,
  summarizeIcs,
  type IcsInstance,
  type IcsParsed,
} from './ics-parse.js';

const NOW = new Date('2026-11-23T10:00:00Z');
const ROME = 'Europe/Rome';
const GLASS = { id: '00000000-0000-4000-8000-000000000001', name: 'Glass' };
const PAPER = { id: '00000000-0000-4000-8000-000000000002', name: 'Paper' };
const PLASTIC = { id: '00000000-0000-4000-8000-000000000003', name: 'Plastica' };
const PLASTIC_METAL = { id: '00000000-0000-4000-8000-000000000004', name: 'Plastica e metalli' };
const ORGANIC = { id: '00000000-0000-4000-8000-000000000005', name: 'Umido' };

/**
 * A calendar file from its lines, CRLF as RFC 5545 has it.
 *
 * @param lines - The lines between BEGIN and END:VCALENDAR.
 * @returns The file.
 */
function ics(...lines: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR', ''].join('\r\n');
}

/**
 * Parses a file in Rome now, and says it is a calendar.
 *
 * @param text - The file.
 * @returns What it holds.
 * @throws {Error} When it is not read as a calendar.
 */
function readOk(text: string): Extract<IcsParsed, { kind: 'ok' }> {
  const parsed = parseIcs(text, { now: NOW, zone: ROME, models: [GLASS, PAPER] });

  if (parsed.kind !== 'ok') {
    throw new Error(`Not read: ${parsed.detail}`);
  }

  return parsed;
}

/**
 * The start of each occurrence, in order.
 *
 * @param instances - The occurrences.
 * @returns Their starts.
 */
function startsOf(instances: readonly IcsInstance[]): (string | null)[] {
  return instances.map((instance) => instance.startsAt ?? instance.startsOn);
}

// Google: an IANA TZID, a weekly series with an EXDATE and a time moved by a RECURRENCE-ID.
const GOOGLE = ics(
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'X-WR-CALNAME:Scuola',
  'X-WR-TIMEZONE:Europe/Rome',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Rome:20261105T180000',
  'DTEND;TZID=Europe/Rome:20261105T190000',
  'RRULE:FREQ=WEEKLY;BYDAY=TH;COUNT=6',
  'EXDATE;TZID=Europe/Rome:20261119T180000',
  'UID:swim@google.com',
  'SUMMARY:Swimming',
  'DESCRIPTION:Bring a towel',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Rome:20261127T170000',
  'DTEND;TZID=Europe/Rome:20261127T180000',
  'RECURRENCE-ID;TZID=Europe/Rome:20261126T180000',
  'UID:swim@google.com',
  'SUMMARY:Swimming on Friday',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=America/New_York:20270316T090000',
  'DTEND;TZID=America/New_York:20270316T100000',
  'UID:call@google.com',
  'SUMMARY:Call with New York',
  'END:VEVENT',
);

// Outlook: a zone only its VTIMEZONE defines, and an all-day event over three days.
const OUTLOOK = ics(
  'PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN',
  'BEGIN:VTIMEZONE',
  'TZID:W. Europe Standard Time',
  'BEGIN:STANDARD',
  'DTSTART:16011028T030000',
  'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:16010325T020000',
  'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'DTSTART;TZID="W. Europe Standard Time":20270710T090000',
  'DTEND;TZID="W. Europe Standard Time":20270710T103000',
  'UID:040000008200E00074C5B7101A82E008',
  'SUMMARY:Dentist',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261224',
  'DTEND;VALUE=DATE:20261227',
  'UID:040000008200E00074C5B7101A82E009',
  'SUMMARY:Christmas at the lake',
  'END:VEVENT',
);

// iCloud: a floating time, a UTC time, a one-day all-day event with no DTEND, categories.
const ICLOUD = ics(
  'PRODID:-//Apple Inc.//iCloud 1.0//EN',
  'X-WR-CALNAME:Raccolta',
  'BEGIN:VEVENT',
  'DTSTART:20261201T083000',
  'DTEND:20261201T090000',
  'UID:A1B2-floating',
  'SUMMARY:Bins out',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20261202T120000Z',
  'DTEND:20261202T130000Z',
  'UID:A1B2-utc',
  'SUMMARY:Lunch',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261203',
  'UID:A1B2-glass',
  'SUMMARY:Collection',
  'CATEGORIES:glass,recycling',
  'END:VEVENT',
);

describe('parseIcs', () => {
  it('expands a weekly series, leaving out the EXDATE and moving the changed time', () => {
    const swims = readOk(GOOGLE).instances.filter((each) => each.sourceUid.startsWith('swim'));

    // 18:00 in Rome in November is 17:00 UTC; the 19th is excluded, the 26th moved to the 27th.
    expect(startsOf(swims)).toEqual([
      '2026-11-05T17:00:00.000Z',
      '2026-11-12T17:00:00.000Z',
      '2026-11-27T16:00:00.000Z',
      '2026-12-03T17:00:00.000Z',
      '2026-12-10T17:00:00.000Z',
    ]);
    expect(swims[2]).toMatchObject({
      sourceUid: 'swim@google.com#20261126T180000',
      title: 'Swimming on Friday',
      endsAt: '2026-11-27T17:00:00.000Z',
    });
    expect(swims[0]).toMatchObject({ notes: 'Bring a towel', isAllDay: false, startsOn: null });
  });

  it('reads a time in an IANA zone the file does not define', () => {
    const call = readOk(GOOGLE).instances.find((each) => each.sourceUid === 'call@google.com');

    // 9:00 in New York on 16 March 2027, after its change of the clocks, is 13:00 UTC.
    expect(call).toMatchObject({
      startsAt: '2027-03-16T13:00:00.000Z',
      endsAt: '2027-03-16T14:00:00.000Z',
    });
  });

  it('takes the name the calendar gives itself', () => {
    expect(readOk(GOOGLE).calendarName).toBe('Scuola');
    expect(readOk(OUTLOOK).calendarName).toBeNull();
  });

  it('reads a zone only the VTIMEZONE defines', () => {
    const dentist = readOk(OUTLOOK).instances.find((each) => each.title === 'Dentist');

    // 9:00 in summer time, +2.
    expect(dentist).toMatchObject({
      startsAt: '2027-07-10T07:00:00.000Z',
      endsAt: '2027-07-10T08:30:00.000Z',
    });
  });

  it('keeps an all-day event as days, the last one included', () => {
    const lake = readOk(OUTLOOK).instances.find((each) => each.title === 'Christmas at the lake');

    expect(lake).toMatchObject({
      isAllDay: true,
      startsOn: '2026-12-24',
      endsOn: '2026-12-26',
      startsAt: null,
      endsAt: null,
    });
  });

  it("reads a floating time in the house's zone, and a UTC one as it is", () => {
    const [bins, lunch, glass] = readOk(ICLOUD).instances;

    expect(bins).toMatchObject({ startsAt: '2026-12-01T07:30:00.000Z' });
    expect(lunch).toMatchObject({ startsAt: '2026-12-02T12:00:00.000Z' });
    expect(glass).toMatchObject({
      startsOn: '2026-12-03',
      endsOn: '2026-12-03',
      modelId: GLASS.id,
    });
  });

  it('says a file of last year is all past', () => {
    const lastYear = readOk(
      ics(
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20250115',
        'UID:old-1',
        'SUMMARY:Paper',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20251215',
        'UID:old-2',
        'SUMMARY:Paper',
        'END:VEVENT',
      ),
    );

    // January 2025 is before the year kept; December 2025 is in it, and past.
    expect(lastYear.allPast).toBe(true);
    expect(lastYear.instances).toHaveLength(1);
    expect(readOk(GOOGLE).allPast).toBe(false);
  });

  it('refuses a file that is not a calendar, and one with no events', () => {
    const pdf = parseIcs('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n', {
      now: NOW,
      zone: ROME,
      models: [],
    });
    const empty = parseIcs(ics('X-WR-CALNAME:Empty'), { now: NOW, zone: ROME, models: [] });

    expect(pdf).toMatchObject({ kind: 'error', code: 'not_calendar' });
    expect(empty).toMatchObject({ kind: 'error', code: 'no_events' });
  });

  it('leaves out a cancelled event, and names an event with no UID by what it is', () => {
    const parsed = readOk(
      ics(
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20261210',
        'STATUS:CANCELLED',
        'UID:gone',
        'SUMMARY:Called off',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20261211',
        'SUMMARY:No uid',
        'END:VEVENT',
      ),
    );

    expect(parsed.instances).toHaveLength(1);
    expect(parsed.instances[0]?.sourceUid).toMatch(/^nouid-[0-9a-f]{40}$/u);
  });

  it('sums up what it read: count, span, models and the next one', () => {
    const summary = summarizeIcs(readOk(GOOGLE).instances, NOW, ROME);

    expect(summary).toEqual({
      eventCount: 6,
      rangeFrom: '2026-11-05',
      rangeTo: '2027-03-16',
      matchedModels: 0,
      next: { title: 'Swimming on Friday', startsAt: '2026-11-27T16:00:00.000Z', startsOn: null },
    });
  });
});

describe('matchModel', () => {
  it('takes the model a category names before one in the title', () => {
    expect(matchModel('Paper day', ['GLASS'], [GLASS, PAPER])).toBe(GLASS.id);
  });

  it('finds a name in the title as whole words, ignoring case and accents', () => {
    expect(matchModel('Raccolta ÙMIDO domani', [], [ORGANIC])).toBe(ORGANIC.id);
    expect(matchModel('Umidostrada', [], [ORGANIC])).toBeNull();
  });

  it('lets the longest name win', () => {
    expect(matchModel('Plastica e metalli', [], [PLASTIC, PLASTIC_METAL])).toBe(PLASTIC_METAL.id);
    expect(matchModel('Plastica', [], [PLASTIC, PLASTIC_METAL])).toBe(PLASTIC.id);
  });

  it('matches nothing without a name in it', () => {
    expect(matchModel('Swimming', ['sport'], [GLASS, PAPER])).toBeNull();
  });
});
