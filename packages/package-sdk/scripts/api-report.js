/**
 * The SDK's public API, as its published declarations say it: `etc/api/` holds a copy of every
 * `.d.ts` in `dist/`, committed, so any change to what is public is a change in review.
 *
 *   node scripts/api-report.js           write the copy
 *   node scripts/api-report.js --check   fail when the build's declarations differ from it
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist');
const report = path.join(root, 'etc', 'api');
const isCheck = process.argv.includes('--check');

/**
 * Every declaration file under a folder, by its path inside it.
 *
 * @param folder - The folder.
 * @returns Each file's path and text, line endings made LF.
 */
async function declarations(folder) {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true }).catch(() => []);
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.d.ts'))
    .map((entry) =>
      path.relative(folder, path.join(entry.parentPath, entry.name)).replaceAll('\\', '/'),
    )
    .sort();

  return new Map(
    await Promise.all(
      files.map(async (file) => [
        file,
        (await readFile(path.join(folder, file), 'utf8')).replaceAll('\r\n', '\n'),
      ]),
    ),
  );
}

const built = await declarations(dist);

if (built.size === 0) {
  process.stderr.write('dist/ has no declarations: build first\n');
  process.exit(1);
}

if (isCheck) {
  const kept = await declarations(report);
  const changed = [...new Set([...built.keys(), ...kept.keys()])].filter(
    (file) => built.get(file) !== kept.get(file),
  );

  if (changed.length > 0) {
    process.stderr.write(
      `The public API changed in ${changed.join(', ')}.\nIf that is meant, run pnpm api:report and commit etc/api/.\n`,
    );
    process.exit(1);
  }

  process.stdout.write('The public API is as committed.\n');
} else {
  await rm(report, { recursive: true, force: true });

  await Promise.all(
    [...built].map(async ([file, text]) => {
      await mkdir(path.dirname(path.join(report, file)), { recursive: true });
      await writeFile(path.join(report, file), text);
    }),
  );

  process.stdout.write(`Wrote ${String(built.size)} declarations to etc/api/.\n`);
}
