/**
 * Writes `apps/api/src/services/italian-towns-data.ts` and
 * `packages/contracts/src/calendar/italian-capitals.ts` from GeoNames' Italy file.
 *
 * GeoNames (https://www.geonames.org, CC BY 4.0) lists every comune as an ADM3 feature with its
 * ISTAT code, province code, region code and centre; ISTAT's own list has no coordinates. The
 * provincial capitals are the PPLA/PPLA2/PPLC places, matched by ISTAT code.
 *
 * Two maps are matched by name, accents and case aside, because their sources share no code:
 * a capital to its key in `ITALIAN_PATRONS` (the province's code, or the city's name when the
 * source lists the city on its own: Forlì, Cesena, Andria…), and a region `date-holidays` has
 * holidays of its own for to GeoNames' region, through the names GeoNames knows each by in every
 * language. A province is tried before a region: `date-holidays`' Alto Adige is the province of
 * Bolzano, not the whole of Trentino-Alto Adige. Run again when the comuni change (mergers happen
 * every year), then `pnpm prettier --write` the two files:
 *
 *   curl -O https://download.geonames.org/export/dump/IT.zip && unzip IT.zip
 *   pnpm tsx scripts/italian-towns.ts IT.txt
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { ITALIAN_PATRONS } from '../packages/contracts/src/calendar/italian-patrons.js';

const [source] = process.argv.slice(2);

if (source === undefined) {
  throw new Error('usage: tsx scripts/italian-towns.ts <IT.txt>');
}

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

/** `date-holidays`, from the package that depends on it: the repository root does not. */
// eslint-disable-next-line @typescript-eslint/naming-convention -- a class, read with require
const Holidays = createRequire(new URL('../packages/contracts/package.json', import.meta.url))(
  'date-holidays',
) as new () => { getStates: (country: string, language: string) => Record<string, string> };

const rows = readFileSync(source, 'utf8')
  .split('\n')
  .map((line) => line.split('\t'));
const regions = new Map<string, string>();
const capitals = new Set<string>();

for (const row of rows) {
  if (row[7] === 'ADM1') {
    regions.set(row[10] ?? '', (row[1] ?? '').replace(/^Regione Autonoma /u, ''));
  }

  if (row[7] === 'PPLA' || row[7] === 'PPLA2' || row[7] === 'PPLC') {
    capitals.add(row[12] ?? '');
  }
}

const comuni = rows.filter((row) => row[7] === 'ADM3' && (row[11] ?? '') !== '');
const towns = comuni
  .map((row) =>
    [
      row[1],
      row[11],
      row[10],
      Number(row[4]).toFixed(4),
      Number(row[5]).toFixed(4),
      capitals.has(row[12] ?? '') ? '1' : '0',
    ].join('|'),
  )
  .sort((a, b) => a.localeCompare(b, 'it'));

// Capital → patron key: the city's own key when the source lists the city, else the province's.
const patronTowns = new Map<string, string>();

for (const key of Object.keys(ITALIAN_PATRONS).filter((each) => each.length > 2)) {
  const found = comuni.filter((row) => fold(row[1] ?? '') === fold(key));

  if (found.length !== 1) {
    throw new Error(`${String(found.length)} comuni are named like the patron city ${key}`);
  }

  patronTowns.set(found[0]?.[1] ?? '', key);
}

for (const row of comuni) {
  const name = row[1] ?? '';
  const province = row[11] ?? '';

  if (capitals.has(row[12] ?? '') && !patronTowns.has(name) && province in ITALIAN_PATRONS) {
    patronTowns.set(name, province);
  }
}

// `date-holidays` region → GeoNames region, and the province when it is only one.
const places = rows
  .filter((row) => row[7] === 'ADM2' || row[7] === 'ADM1')
  .toSorted((a, b) => (a[7] === b[7] ? 0 : a[7] === 'ADM2' ? -1 : 1));
const holidayRegions = new Map<string, { region: string; province: string | null }>();

for (const [code, english] of Object.entries(new Holidays().getStates('IT', 'en'))) {
  const names = new Set(
    [english, new Holidays().getStates('IT', 'it')[code] ?? ''].map(fold).filter(Boolean),
  );
  const place = places.find((row) =>
    [row[1] ?? '', ...(row[3] ?? '').split(',')].some((name) => names.has(fold(name))),
  );

  if (place === undefined) {
    throw new Error(`No GeoNames region or province is named like ${english} (${code})`);
  }

  holidayRegions.set(code, {
    region: place[10] ?? '',
    province: place[7] === 'ADM2' ? (place[11] ?? null) : null,
  });
}

writeFileSync(
  'apps/api/src/services/italian-towns-data.ts',
  `/**
 * The comuni of Italy, from GeoNames (https://www.geonames.org, CC BY 4.0), written by
 * \`scripts/italian-towns.ts\`; do not edit by hand. One town a line:
 * name|province code|region code|latitude|longitude|provincial capital (1).
 */

/** The regions, by GeoNames' code. */
export const ITALIAN_REGIONS: Readonly<Record<string, string>> = ${JSON.stringify(Object.fromEntries([...regions].sort()), null, 2)};

/**
 * The regions \`date-holidays\` has holidays of its own for, by its code (\`regionsOf('IT')\`):
 * GeoNames' region, and the province when the code is one province of it (Alto Adige).
 */
export const ITALIAN_HOLIDAY_REGIONS: Readonly<
  Record<string, { readonly region: string; readonly province: string | null }>
> = ${JSON.stringify(Object.fromEntries([...holidayRegions].sort()), null, 2)};

/** The towns, one a line. */
export const ITALIAN_TOWNS = \`${towns.join('\n')}\`;
`,
);
writeFileSync(
  'packages/contracts/src/calendar/italian-capitals.ts',
  `/**
 * The Italian towns whose patron saint's day \`ITALIAN_PATRONS\` lists, by their name as the
 * settings keep it (\`calendar.town\`, GeoNames' spelling: \`Milano\`, \`Forlì\`,
 * \`Bolzano/Bozen\`): the key of their days there. Written by \`scripts/italian-towns.ts\`; do not
 * edit by hand. A town not here has no listed patron: the owner types it (\`calendar.patron\`).
 */

/** The key in \`ITALIAN_PATRONS\` of each town that has one. */
export const ITALIAN_CAPITALS: Readonly<Record<string, string>> = ${JSON.stringify(Object.fromEntries([...patronTowns].sort(([a], [b]) => a.localeCompare(b, 'it'))), null, 2)};
`,
);
process.stdout.write(
  `${String(towns.length)} towns, ${String(regions.size)} regions, ${String(capitals.size)} capitals, ` +
    `${String(patronTowns.size)} towns with a patron, ${String(holidayRegions.size)} holiday regions\n`,
);
