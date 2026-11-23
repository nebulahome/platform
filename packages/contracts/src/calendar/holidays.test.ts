import Holidays from 'date-holidays';
import { describe, expect, it } from 'vitest';

import {
  countriesOf,
  holidaysOf,
  ITALIAN_CAPITALS,
  ITALIAN_PATRONS,
  regionsOf,
} from './holidays.js';

const ITALY = { country: 'IT', region: null, town: null };

/**
 * The holidays of a year at a place, as `date name` lines.
 *
 * @param year - The year.
 * @param place - The place.
 * @param language - The language.
 * @returns The lines.
 */
function lines(
  year: number,
  place: typeof ITALY | { country: string; region: string | null; town: string | null },
  language = 'it',
): string[] {
  return holidaysOf(year, place, language).map((holiday) => `${holiday.date} ${holiday.name}`);
}

describe('the holidays of a place', () => {
  it('lists the Italian public holidays of 2026, Easter Monday and 4 October among them', () => {
    const holidays = holidaysOf(2026, ITALY, 'it');

    expect(holidays.map((holiday) => holiday.date)).toEqual([
      '2026-01-01',
      '2026-01-06',
      '2026-04-05',
      '2026-04-06',
      '2026-04-25',
      '2026-05-01',
      '2026-06-02',
      '2026-08-15',
      '2026-10-04',
      '2026-11-01',
      '2026-12-08',
      '2026-12-25',
      '2026-12-26',
    ]);
    expect(holidays.every((holiday) => holiday.kind === 'national')).toBe(true);
    expect(holidays.find((holiday) => holiday.date === '2026-04-06')).toEqual({
      key: 'it.easter_1',
      date: '2026-04-06',
      name: 'Lunedì dell’Angelo',
      kind: 'national',
    });
  });

  it('moves Easter with the year and keeps every key from one year to the next', () => {
    const in2026 = holidaysOf(2026, ITALY, 'it');
    const in2027 = holidaysOf(2027, ITALY, 'it');

    expect(lines(2027, ITALY)).toContain('2027-03-29 Lunedì dell’Angelo');
    expect(lines(2027, ITALY)).toContain("2027-10-04 Festa nazionale di San Francesco d'Assisi");
    expect(in2027.map((holiday) => holiday.key)).toEqual(in2026.map((holiday) => holiday.key));
    expect(in2026.map((holiday) => holiday.key)).toContain('it.06_02');
  });

  it('leaves out observances, which are not days off', () => {
    expect(lines(2026, ITALY).some((line) => line.startsWith('2026-05-10'))).toBe(false);
  });

  it('names them in the house language', () => {
    expect(lines(2026, ITALY, 'en')).toContain('2026-04-06 Easter Monday');
  });

  it("adds Milan's patron, Sant'Ambrogio on 7 December, once", () => {
    const milan = holidaysOf(2026, { country: 'IT', region: '25', town: 'Milano' }, 'it');

    expect(milan.filter((holiday) => holiday.date === '2026-12-07')).toEqual([
      { key: 'it-mi.patron', date: '2026-12-07', name: "Sant'Ambrogio", kind: 'patron' },
    ]);
  });

  it('works out a patron day that moves: the first Tuesday of May in Asti', () => {
    expect(lines(2026, { country: 'IT', region: null, town: 'Asti' })).toContain(
      '2026-05-05 San Secondo di Asti',
    );
    expect(lines(2027, { country: 'IT', region: null, town: 'Asti' })).toContain(
      '2027-05-04 San Secondo di Asti',
    );
  });

  it('numbers the days of a province with several, and keeps the regional ones regional', () => {
    const bolzano = holidaysOf(2026, { country: 'IT', region: '32', town: 'Bolzano/Bozen' }, 'it');
    const ragusa = holidaysOf(2026, { country: 'IT', region: '82', town: 'Ragusa' }, 'it');

    expect(bolzano.filter((holiday) => holiday.date === '2026-05-25')).toEqual([
      { key: 'it.easter_50', date: '2026-05-25', name: 'Lunedì di Pentecoste', kind: 'regional' },
    ]);
    expect(
      ragusa.filter((holiday) => holiday.kind === 'patron').map((holiday) => holiday.key),
    ).toEqual(['it-rg.patron_1', 'it-rg.patron_2']);
  });

  it('does not list a patron day twice when it is already a holiday', () => {
    expect(
      lines(2026, { country: 'IT', region: null, town: 'Biella' }).filter((line) =>
        line.startsWith('2026-12-26'),
      ),
    ).toHaveLength(1);
  });

  it('takes the patron the owner typed before the listed one', () => {
    const typed = holidaysOf(2026, { country: 'IT', region: null, town: 'Milano' }, 'it', {
      name: 'San Rocco',
      month: 8,
      day: 16,
    });

    expect(typed.filter((holiday) => holiday.kind === 'patron')).toEqual([
      { key: 'it.patron', date: '2026-08-16', name: 'San Rocco', kind: 'patron' },
    ]);
  });

  it('finds the patron by the town as the settings keep it, a city of its own included', () => {
    const forli = holidaysOf(2026, { country: 'IT', region: null, town: 'Forlì' }, 'it');
    const cesena = holidaysOf(2026, { country: 'IT', region: null, town: 'Cesena' }, 'it');

    expect(forli.filter((holiday) => holiday.kind === 'patron')).toEqual([
      { key: 'it-forli.patron', date: '2026-02-04', name: 'Madonna del Fuoco', kind: 'patron' },
    ]);
    expect(cesena.filter((holiday) => holiday.kind === 'patron').map((each) => each.key)).toEqual([
      'it-cesena.patron',
    ]);
  });

  it('adds no patron for a town that is not listed, nor for a code where a name belongs', () => {
    for (const town of ['Rho', 'MI', 'constructor']) {
      expect(
        holidaysOf(2026, { country: 'IT', region: null, town }, 'it').filter(
          (holiday) => holiday.kind === 'patron',
        ),
      ).toEqual([]);
    }
  });

  it('knows nothing of a country it has no rules for', () => {
    expect(holidaysOf(2026, { country: 'XX', region: null, town: null }, 'en')).toEqual([]);
  });
});

describe('the Italian patrons', () => {
  it('has every province and city the source lists', () => {
    expect(Object.keys(ITALIAN_PATRONS)).toHaveLength(114);
    expect(ITALIAN_PATRONS['RM']).toEqual([{ name: 'Santi Pietro e Paolo', rule: '06-29' }]);
    expect(ITALIAN_PATRONS['Forli']).toEqual([{ name: 'Madonna del Fuoco', rule: '02-04' }]);
  });

  it('is reached from a town for every province and city, but the three whose cities are listed', () => {
    const reached = new Set(Object.values(ITALIAN_CAPITALS));

    expect(Object.keys(ITALIAN_PATRONS).filter((key) => !reached.has(key))).toEqual([
      'BT',
      'FC',
      'PU',
    ]);
    expect(ITALIAN_CAPITALS['Milano']).toBe('MI');
    expect(ITALIAN_CAPITALS['Forlì']).toBe('Forli');
  });

  it('writes every day as a rule date-holidays reads, once a year', () => {
    for (const [town, days] of Object.entries(ITALIAN_PATRONS)) {
      for (const day of days) {
        const reader = new Holidays();

        expect(reader.setHoliday(day.rule, { name: day.name, type: 'public' }), town).toBe(true);
        expect(reader.getHolidays(2026), `${town} ${day.rule}`).toHaveLength(1);
      }
    }
  });
});

describe('the place selects', () => {
  it('lists the countries in the language asked', () => {
    expect(countriesOf('it')).toContainEqual({ code: 'IT', name: 'Italia' });
  });

  it("lists a country's regions, and none for one it does not know", () => {
    expect(regionsOf('IT', 'en')).toContainEqual({ code: '25', name: 'Lombardy' });
    expect(regionsOf('XX', 'en')).toEqual([]);
  });
});
