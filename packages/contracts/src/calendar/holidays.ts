/**
 * The public holidays of a year at the house's place: the country's, its region's, and the town's
 * patron saint.
 *
 * National and regional holidays come from `date-holidays` (ISC licence), by rule, in the house's
 * language; its data is CC BY-SA 4.0 (https://github.com/commenthol/date-holidays), credited here
 * and used unchanged. Only `public` holidays count: an observance (Mother's Day) or a bank holiday
 * is not a day off. Its third level (the cities of some regions) is not read: the patron comes
 * from `italian-patrons.ts`, through the town's name (`italian-capitals.ts`), or from the one the
 * owner typed (`calendar.patron`).
 *
 * Not exported from the package's root: the data is large and the web UI never needs it. The API
 * and `core` import `@nebulahome/contracts/holidays`.
 */
import Holidays from 'date-holidays';

import type {
  CalendarPatron,
  CalendarPlace,
  CalendarRegionOption,
  HolidayKind,
} from './calendar-schemas.js';
import { ITALIAN_CAPITALS } from './italian-capitals.js';
import { ITALIAN_PATRONS, type ItalianPatronDay } from './italian-patrons.js';
import type { DayKey } from './zoned-time.js';

export { ITALIAN_CAPITALS } from './italian-capitals.js';
export { ITALIAN_PATRONS, type ItalianPatronDay } from './italian-patrons.js';

/** A holiday as the rules make it; the API adds whether it is hidden. */
export type ComputedHoliday = {
  /** Stable from year to year: `it.06_02`, `it-mi.patron`. */
  readonly key: string;
  readonly date: DayKey;
  readonly name: string;
  readonly kind: Exclude<HolidayKind, 'manual'>;
};

/** One reader per place: making one parses the country's rules. */
const READERS = new Map<string, Holidays>();

/**
 * The reader of a place's holidays.
 *
 * @param country - The country.
 * @param region - Its region, or null for the country's alone. An unknown one reads as none.
 * @returns The reader.
 */
function readerOf(country: string, region: string | null): Holidays {
  const id = `${country}/${region ?? ''}`;
  let reader = READERS.get(id);

  if (reader === undefined) {
    reader = region === null ? new Holidays(country) : new Holidays(country, region);
    READERS.set(id, reader);
  }

  return reader;
}

/**
 * A rule as a key's last part: `easter 1` is `easter_1`, `06-02` is `06_02`.
 *
 * @param rule - The `date-holidays` rule.
 * @returns Lower case, every run of anything else one underscore.
 */
function ruleSlug(rule: string): string {
  return rule
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

/**
 * The public holidays of a year at a place, earliest first.
 *
 * A key is the country and the rule, so it stays the same every year and in every language (a
 * substitute day adds `_substitute`); a rule a year holds twice (a lunar feast) gives one key
 * twice, which hides both. A patron day on the same rule as a holiday already listed (Santo
 * Stefano in Biella, Whit Monday in Bolzano) is not listed again.
 *
 * @param year - The year.
 * @param place - The country, the region, the town by its name (`Milano`); a town with no listed
 *   patron adds none.
 * @param language - The house's language, for the names; the country's own when it has none.
 * @param patron - The patron the owner typed, which comes before the listed one.
 * @returns The holidays.
 */
export function holidaysOf(
  year: number,
  place: CalendarPlace,
  language: string,
  patron?: CalendarPatron | null,
): ComputedHoliday[] {
  const prefix = place.country.toLowerCase();
  const national = new Set(
    readerOf(place.country, null)
      .getHolidays(year, language)
      .map((holiday) => holiday.rule),
  );
  const listed = readerOf(place.country, place.region)
    .getHolidays(year, language)
    .filter((holiday) => holiday.type === 'public');
  const holidays: ComputedHoliday[] = listed.map((holiday) => ({
    key: `${prefix}.${ruleSlug(holiday.rule)}${holiday.substitute === true ? '_substitute' : ''}`,
    date: holiday.date.slice(0, 10),
    name: holiday.name,
    kind: national.has(holiday.rule) ? 'national' : 'regional',
  }));
  const rules = new Set(listed.map((holiday) => holiday.rule));
  const typed = patron ?? null;
  // The settings keep the town's name; the patrons are keyed by province (`MI`) or city (`Forli`).
  const listedKey =
    place.country === 'IT' && place.town !== null && Object.hasOwn(ITALIAN_CAPITALS, place.town)
      ? (ITALIAN_CAPITALS[place.town] ?? null)
      : null;
  const days: readonly ItalianPatronDay[] =
    typed !== null
      ? [
          {
            name: typed.name,
            rule: `${String(typed.month).padStart(2, '0')}-${String(typed.day).padStart(2, '0')}`,
          },
        ]
      : listedKey === null
        ? []
        : (ITALIAN_PATRONS[listedKey] ?? []);
  const owner = typed !== null ? prefix : `${prefix}-${(listedKey ?? '').toLowerCase()}`;

  for (const [index, day] of days.entries()) {
    if (rules.has(day.rule.replace(/ since \d{4}$/, ''))) {
      continue;
    }

    // A reader of its own: the country's would rename a national holiday on the same rule.
    const reader = new Holidays();

    reader.setHoliday(day.rule, { name: day.name, type: 'public' });

    for (const holiday of reader.getHolidays(year)) {
      holidays.push({
        key: `${owner}.patron${days.length > 1 ? `_${String(index + 1)}` : ''}`,
        date: holiday.date.slice(0, 10),
        name: day.name,
        kind: 'patron',
      });
    }
  }

  return holidays.toSorted((left, right) => left.date.localeCompare(right.date));
}

/**
 * The countries holidays are known for, by name.
 *
 * @param language - The language of the names.
 * @returns Code and name of each, in alphabetical order of the name.
 */
export function countriesOf(language: string): CalendarRegionOption[] {
  return Object.entries(new Holidays().getCountries(language))
    .map(([code, name]) => ({ code, name }))
    .toSorted((left, right) => left.name.localeCompare(right.name, language));
}

/**
 * The regions of a country that have holidays of their own.
 *
 * @param country - The country.
 * @param language - The language of the names.
 * @returns Code and name of each, in alphabetical order of the name; none for most countries.
 */
export function regionsOf(country: string, language: string): CalendarRegionOption[] {
  /**
   * The country's regions as `date-holidays` answers: undefined for a country it does not know,
   * whatever its types say.
   *
   * @returns Name by code, or undefined.
   */
  const states = (): Readonly<Record<string, string>> | undefined =>
    new Holidays().getStates(country, language);

  return Object.entries(states() ?? {})
    .map(([code, name]) => ({ code, name }))
    .toSorted((left, right) => left.name.localeCompare(right.name, language));
}
