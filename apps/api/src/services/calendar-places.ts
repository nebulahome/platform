/**
 * Where the house keeps its holidays: what the Holidays settings offer to choose from, and the
 * place the house's position suggests (docs/calendar.md D3).
 *
 * Countries and their regions come from `date-holidays`. Italy is richer: its 20 regions from
 * GeoNames - a region `date-holidays` has holidays of its own for under that one's code, the rest
 * under GeoNames' - with Alto Adige, the one province `date-holidays` keeps apart, offered on its
 * own; and its towns, each with its patron when one is listed. Towns are matched by name, accents
 * and case aside. Elsewhere there are no towns: the patron is typed by hand.
 */
import {
  type CalendarPlace,
  type CalendarPlaces,
  type CalendarPlacesQuery,
  type CalendarRegionOption,
  type CalendarTownOption,
} from '@nebulahome/contracts';
import {
  countriesOf,
  ITALIAN_CAPITALS,
  ITALIAN_PATRONS,
  regionsOf,
} from '@nebulahome/contracts/holidays';

import { ITALIAN_HOLIDAY_REGIONS, ITALIAN_REGIONS, ITALIAN_TOWNS } from './italian-towns-data.js';

/** One Italian town. */
type Town = {
  readonly name: string;
  readonly province: string;

  /** GeoNames' code of its region. */
  readonly region: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly isCapital: boolean;

  /** Its name as it is compared. */
  readonly folded: string;
};

/** How many towns one answer lists. */
const TOWN_LIMIT = 50;

/**
 * shortcut: the nearest comune within this distance makes a house Italian; a house just over a
 * border (Ticino, Nice) is suggested Italy too. Read a country from a world map if that matters.
 */
const ITALY_REACH_KM = 20;

/** The towns, read from the data once asked for. */
let towns: Town[] | undefined;

/**
 * A name as it is compared: no accents, lower case.
 *
 * @param name - The name.
 * @returns It, folded.
 */
function fold(name: string): string {
  return name
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * Every Italian town.
 *
 * @returns The towns, alphabetically.
 */
function italianTowns(): Town[] {
  towns ??= ITALIAN_TOWNS.split('\n').map((line) => {
    const [name = '', province = '', region = '', latitude = '0', longitude = '0', capital] =
      line.split('|');

    return {
      name,
      province,
      region,
      latitude: Number(latitude),
      longitude: Number(longitude),
      isCapital: capital === '1',
      folded: fold(name),
    };
  });

  return towns;
}

/**
 * The Italian regions, for the select: GeoNames' twenty under the code `date-holidays` gives
 * those it has holidays for, and the provinces it keeps apart.
 *
 * @param language - The language of the names `date-holidays` gives.
 * @returns The regions, alphabetically.
 */
function italianRegions(language: string): CalendarRegionOption[] {
  const named = new Map(regionsOf('IT', language).map((region) => [region.code, region.name]));
  const codes = Object.entries(ITALIAN_HOLIDAY_REGIONS);
  const regions = Object.entries(ITALIAN_REGIONS).map(([region, name]) => ({
    code: codes.find(([, area]) => area.region === region && area.province === null)?.[0] ?? region,
    name,
  }));
  const provinces = codes
    .filter(([, area]) => area.province !== null)
    .map(([code]) => ({ code, name: named.get(code) ?? code }));

  return [...regions, ...provinces].toSorted((left, right) =>
    left.name.localeCompare(right.name, 'it'),
  );
}

/**
 * The towns a region code covers.
 *
 * @param code - A code of the region select.
 * @returns GeoNames' region and, for a province kept apart, its code; null for no such region.
 */
function areaOf(code: string): { region: string; province: string | null } | null {
  if (Object.hasOwn(ITALIAN_HOLIDAY_REGIONS, code)) {
    return ITALIAN_HOLIDAY_REGIONS[code] ?? null;
  }

  return Object.hasOwn(ITALIAN_REGIONS, code) ? { region: code, province: null } : null;
}

/**
 * The code of the region select a town is in: its province's when that is kept apart, its
 * region's otherwise.
 *
 * @param town - The town.
 * @returns The code.
 */
function regionCodeOf(town: Town): string {
  const codes = Object.entries(ITALIAN_HOLIDAY_REGIONS);

  return (
    codes.find(([, area]) => area.region === town.region && area.province === town.province)?.[0] ??
    codes.find(([, area]) => area.region === town.region && area.province === null)?.[0] ??
    town.region
  );
}

/**
 * A town as the select offers it.
 *
 * @param town - The town.
 * @returns Its option, with its patron when one is listed.
 */
function toOption(town: Town): CalendarTownOption {
  const key = ITALIAN_CAPITALS[town.name];
  const patrons = key === undefined ? [] : (ITALIAN_PATRONS[key] ?? []);

  return {
    town: town.name,
    name: town.name,
    province: town.province,
    patronName: patrons.length === 0 ? null : patrons.map((day) => day.name).join(' · '),
    isCapital: town.isCapital,
  };
}

/**
 * The Italian towns of a region matching what was typed; the capitals when nothing was.
 *
 * @param region - The region's code, or none for every region.
 * @param q - What was typed.
 * @returns At most {@link TOWN_LIMIT} towns, the ones starting with the words first.
 */
function townsOf(region: string | undefined, q: string | undefined): CalendarTownOption[] {
  const area = region === undefined ? undefined : areaOf(region);

  if (area === null) {
    return [];
  }

  const needle = fold(q ?? '');
  const inArea = italianTowns().filter(
    (town) =>
      area === undefined ||
      (town.region === area.region && (area.province === null || town.province === area.province)),
  );
  const found =
    needle === ''
      ? inArea.filter((town) => town.isCapital)
      : inArea
          .filter((town) => town.folded.includes(needle))
          .toSorted(
            (left, right) =>
              Number(right.folded.startsWith(needle)) - Number(left.folded.startsWith(needle)),
          );

  return found.slice(0, TOWN_LIMIT).map(toOption);
}

/**
 * What the place selects offer.
 *
 * @param query - The country, the region and what was typed for a town.
 * @param language - The house's language, for the names.
 * @returns Every country, the country's regions, and in Italy the towns.
 */
export function listPlaces(query: CalendarPlacesQuery, language: string): CalendarPlaces {
  const countries = countriesOf(language);

  if (query.country === undefined) {
    return { countries, regions: [], towns: [] };
  }

  return query.country === 'IT'
    ? { countries, regions: italianRegions(language), towns: townsOf(query.region, query.q) }
    : { countries, regions: regionsOf(query.country, language), towns: [] };
}

/**
 * The place a position suggests: in Italy, the region and town whose centre is nearest.
 *
 * @param position - The house's position, or null when it has none.
 * @param position.latitude - In degrees.
 * @param position.longitude - In degrees.
 * @returns The place, or null outside Italy or with no position.
 */
export function suggestPlace(
  position: { readonly latitude: number; readonly longitude: number } | null,
): CalendarPlace | null {
  if (position === null) {
    return null;
  }

  // Flat-earth distance: across a few kilometres it is the same as the great circle's.
  const cos = Math.cos((position.latitude * Math.PI) / 180);
  let nearest: Town | undefined;
  let best = Infinity;

  for (const town of italianTowns()) {
    const distance = Math.hypot(
      town.latitude - position.latitude,
      (town.longitude - position.longitude) * cos,
    );

    if (distance < best) {
      best = distance;
      nearest = town;
    }
  }

  return nearest === undefined || best * 111.2 > ITALY_REACH_KM
    ? null
    : { country: 'IT', region: regionCodeOf(nearest), town: nearest.name };
}
