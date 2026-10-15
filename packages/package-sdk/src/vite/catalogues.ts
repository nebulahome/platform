/**
 * A package's translation catalogues: `locales/<language>.json` beside `nebula.config.ts`
 * (PACKAGES_DOCS.md 6.5).
 *
 * Each is a JSON object of strings, nested as the keys are dotted - `{ "clients": { "title":
 * "Client" } }` for `t('clients.title', 'Clients')` - with i18next's plural suffixes (`_one`,
 * `_many`, `_other`) and `{{placeholders}}`. The build bundles each as a chunk of the interface,
 * loaded only for a viewer who reads that language; English needs no file, being the strings'
 * own fallback.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/** The folder the catalogues are in, beside the config. */
export const LOCALES_FOLDER = 'locales';

/** The largest catalogue a release carries. */
export const CATALOGUE_LIMIT = 256 * 1024;

/** A language tag a catalogue may be named by: `it`, `pt-BR`, `zh-Hant`. */
const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|\d{3}))?$/;

/** The plural suffixes i18next reads. */
const PLURAL_SUFFIX = /_(?:zero|one|two|few|many|other)$/;

/** One catalogue, found. */
export type Catalogue = {
  /** Its language, `it`. */
  readonly language: string;

  /** Its file. */
  readonly file: string;
};

/**
 * The catalogues beside a config, by file name: whether they hold together is
 * {@link catalogueProblems}'s to say.
 *
 * @param configDirectory - The folder of `nebula.config.ts`.
 * @returns Them, ordered by language; none when there is no `locales` folder.
 */
export async function findCatalogues(configDirectory: string): Promise<Catalogue[]> {
  const folder = path.join(configDirectory, LOCALES_FOLDER);
  let names: string[];

  try {
    names = await readdir(folder);
  } catch {
    return [];
  }

  return names
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({ language: name.slice(0, -'.json'.length), file: path.join(folder, name) }))
    .sort((left, right) => left.language.localeCompare(right.language));
}

/**
 * The catalogues whose name is a language: the ones the interface is given.
 *
 * @param catalogues - The catalogues found.
 * @returns The ones it can load.
 */
export function namedCatalogues(catalogues: readonly Catalogue[]): Catalogue[] {
  return catalogues.filter((catalogue) => LANGUAGE_TAG.test(catalogue.language));
}

/**
 * The keys of a catalogue, dotted, plural suffixes left on.
 *
 * @param value - The catalogue, or a part of it.
 * @param prefix - The key of the part.
 * @param problems - Where what does not hold is said.
 * @returns The keys.
 */
function keysOf(value: unknown, prefix: string, problems: string[]): string[] {
  if (typeof value === 'string') {
    return [prefix];
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    problems.push(
      `${prefix === '' ? 'the catalogue' : prefix}: is not a string or an object of strings`,
    );

    return [];
  }

  return Object.entries(value).flatMap(([name, child]) => {
    if (name === '' || name.includes('.')) {
      problems.push(
        `${prefix === '' ? '' : `${prefix}.`}${name}: a key has no dots of its own - nest it instead`,
      );

      return [];
    }

    return keysOf(child, prefix === '' ? name : `${prefix}.${name}`, problems);
  });
}

/**
 * Reads a catalogue's keys.
 *
 * @param file - The catalogue.
 * @returns Its keys, and what is wrong with it.
 */
export async function readCatalogue(
  file: string,
): Promise<{ readonly keys: readonly string[]; readonly problems: readonly string[] }> {
  const problems: string[] = [];

  if ((await stat(file)).size > CATALOGUE_LIMIT) {
    return { keys: [], problems: ['a catalogue is at most 256 KB'] };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return { keys: [], problems: ['is not JSON'] };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { keys: [], problems: ['is not an object of strings'] };
  }

  const keys = keysOf(parsed, '', problems);
  const plurals = new Set(
    keys.filter((key) => PLURAL_SUFFIX.test(key)).map((key) => key.replace(PLURAL_SUFFIX, '')),
  );

  for (const base of plurals) {
    if (!keys.includes(`${base}_other`)) {
      problems.push(`${base}: a plural needs its _other form`);
    }
  }

  return { keys, problems };
}

/**
 * What is wrong with a package's catalogues, file by file.
 *
 * @param catalogues - The catalogues found.
 * @param configDirectory - The folder of `nebula.config.ts`, for the names said.
 * @returns The problems; none when they hold together.
 */
export async function catalogueProblems(
  catalogues: readonly Catalogue[],
  configDirectory: string,
): Promise<string[]> {
  const problems: string[] = [];

  for (const catalogue of catalogues) {
    const name = path.relative(configDirectory, catalogue.file).replaceAll('\\', '/');

    if (!LANGUAGE_TAG.test(catalogue.language)) {
      problems.push(`${name}: is not named by a language, as it.json or pt-BR.json`);
      continue;
    }

    // eslint-disable-next-line no-await-in-loop -- a catalogue per language, read once
    const { problems: found } = await readCatalogue(catalogue.file);

    problems.push(...found.map((problem) => `${name}: ${problem}`));
  }

  return problems;
}

/**
 * The strings a catalogue lacks and the keys no string uses.
 *
 * @param used - The keys the interface's code says, as `t('key', …)`.
 * @param keys - The catalogue's keys, plural suffixes left on.
 * @returns What is missing and what is left over, each ordered.
 */
export function catalogueCoverage(
  used: ReadonlySet<string>,
  keys: readonly string[],
): { readonly missing: readonly string[]; readonly unknown: readonly string[] } {
  const present = new Set(keys.map((key) => key.replace(PLURAL_SUFFIX, '')));

  return {
    missing: [...used].filter((key) => !present.has(key)).sort(),
    unknown: [...present].filter((key) => !used.has(key)).sort(),
  };
}
