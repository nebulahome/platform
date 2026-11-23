import { describe, expect, it } from 'vitest';

import { escapeText, feedFileOf, foldLine } from './calendar-feed.js';

describe('calendar feed file', () => {
  it('escapes text values', () => {
    expect(escapeText('Dinner; then, cake\\pie\nbye')).toBe('Dinner\\; then\\, cake\\\\pie\\nbye');
  });

  it('folds long lines at 75 octets without cutting a character', () => {
    const line = `SUMMARY:${'è'.repeat(60)}`;
    const folded = foldLine(line);

    for (const part of folded.split('\r\n')) {
      expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(75);
    }

    expect(folded.replaceAll('\r\n ', '')).toBe(line);
  });

  it('writes all-day and timed events, the all-day end exclusive', () => {
    const file = feedFileOf(
      'Kitchen tablet',
      [
        {
          uid: 'a@nebula',
          title: 'Aunt Carla staying',
          notes: null,
          category: 'Guests',
          isAllDay: true,
          startsOn: '2026-12-02',
          endsOn: '2026-12-05',
          startsAt: null,
          endsAt: null,
        },
        {
          uid: 'b@nebula',
          title: 'Dinner with the Rossis',
          notes: 'Bring wine',
          category: null,
          isAllDay: false,
          startsOn: null,
          endsOn: null,
          startsAt: '2026-12-04T19:30:00.000Z',
          endsAt: '2026-12-04T22:00:00.000Z',
        },
      ],
      new Date('2026-12-03T17:42:00Z'),
    );

    expect(file.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(file).toContain('X-WR-CALNAME:Kitchen tablet\r\n');
    expect(file).toContain('DTSTART;VALUE=DATE:20261202\r\nDTEND;VALUE=DATE:20261206\r\n');
    expect(file).toContain('DTSTART:20261204T193000Z\r\nDTEND:20261204T220000Z\r\n');
    expect(file).toContain('DTSTAMP:20261203T174200Z\r\n');
    expect(file).toContain('CATEGORIES:Guests\r\n');
    expect(file).toContain('DESCRIPTION:Bring wine\r\n');
    expect(file.split('BEGIN:VEVENT')).toHaveLength(3);
  });
});
