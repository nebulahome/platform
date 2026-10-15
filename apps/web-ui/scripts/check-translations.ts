/**
 * `pnpm --filter @nebulahome/web-ui check:translations`: the interface's strings against its
 * catalogues (RULES.md 1), run by `lint` and so by CI.
 *
 * Reads every source file of the interface and of `@nebulahome/ui`, which the interface draws
 * with and whose strings it translates, leaving out the tests, the test helpers, the component
 * gallery (a page for developers) and the i18n module itself, whose keys are not written out
 * because it is what says them. Every problem is listed, and any fails the run.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SUPPORTED_LOCALES } from '@nebulahome/contracts';

import {
  checkCatalogue,
  extractUses,
  findForeignLetters,
  type TranslationProblem,
  type TranslationUse,
} from './translations.js';

/** The interface's folder. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Where the source is read from, the interface's first. */
const SOURCES = [path.join(ROOT, 'src'), path.resolve(ROOT, '..', '..', 'packages', 'ui', 'src')];

/** Where the catalogues are. */
const LOCALES = path.join(ROOT, 'src', 'locales');

/** Paths, relative to a source folder, that are not the interface's strings. */
const LEFT_OUT = [/\.test\.tsx?$/, /^testing\//, /^gallery[^/]*\.tsx$/, /^i18n\//, /^locales\//];

/**
 * Lists the source files of one folder.
 *
 * @param folder - The folder.
 * @returns Their paths, relative to it.
 */
async function sourceFiles(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });

  return entries
    .filter(
      (entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts'),
    )
    .map((entry) =>
      path.relative(folder, path.join(entry.parentPath, entry.name)).replaceAll(path.sep, '/'),
    )
    .filter((relative) => !LEFT_OUT.some((pattern) => pattern.test(relative)));
}

/**
 * Runs the check.
 *
 * @returns The problems found.
 */
async function check(): Promise<TranslationProblem[]> {
  const uses: TranslationUse[] = [];
  const problems: TranslationProblem[] = [];

  for (const folder of SOURCES) {
    // One folder after the other, files in parallel: the report lists the interface first.
    // eslint-disable-next-line no-await-in-loop -- see above
    const files = await sourceFiles(folder);
    // eslint-disable-next-line no-await-in-loop -- see above
    const texts = await Promise.all(
      files.map(async (file) => [file, await readFile(path.join(folder, file), 'utf8')] as const),
    );
    const label = path.relative(ROOT, folder).replaceAll(path.sep, '/');

    for (const [file, text] of texts) {
      const found = extractUses(`${label}/${file}`, text);

      uses.push(...found.uses);
      problems.push(...found.problems, ...findForeignLetters(`${label}/${file}`, text));
    }
  }

  const catalogues = await Promise.all(
    SUPPORTED_LOCALES.filter((locale) => locale !== 'en').map(
      async (locale) =>
        [
          locale,
          JSON.parse(await readFile(path.join(LOCALES, `${locale}.json`), 'utf8')) as unknown,
        ] as const,
    ),
  );

  for (const [locale, catalogue] of catalogues) {
    problems.push(...checkCatalogue(uses, catalogue, locale));
  }

  return problems;
}

const problems = await check();

for (const problem of problems) {
  process.stderr.write(`${problem.where}: ${problem.message}\n`);
}

if (problems.length > 0) {
  process.stderr.write(`\n${String(problems.length)} translation problem(s)\n`);
  process.exitCode = 1;
}
