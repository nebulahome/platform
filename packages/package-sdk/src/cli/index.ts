/**
 * `nebulahome-package`: the command a package is checked, built and packed with
 * (PACKAGES_DOCS.md 8.2).
 *
 * ```
 * nebulahome-package validate        the declaration holds together, the way the platform reads it
 * nebulahome-package build           validate, then build both halves into dist/
 * nebulahome-package pack [--url u]  pack dist/ into <id>-<version>.tgz and write index-entry.json
 * ```
 *
 * Every command takes `--root <folder>`, the package's folder - the working directory when not
 * said. A problem ends it with exit code 1, every problem printed.
 */
import path from 'node:path';
import { parseArgs } from 'node:util';

import { PackageConfigError } from '../build/problems.js';
import { buildPackage, checkPackage } from '../vite/build.js';

import { packRelease } from './pack.js';

/** How the command is used. */
const USAGE = `Usage: nebulahome-package <validate | build | pack> [--root <folder>] [--url <base>]

  validate   check nebula.config.ts the way the platform reads a release
  build      validate, then build the interface and the server into dist/
  pack       pack dist/ into <id>-<version>.tgz and write index-entry.json
`;

/**
 * Writes a line for whoever runs the command.
 *
 * @param line - What it says.
 */
function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * Runs the command.
 *
 * @param args - Its arguments, after the program's name.
 * @returns Its exit code.
 */
export async function run(args: readonly string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      root: { type: 'string' },
      url: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command] = positionals;
  const root = path.resolve(values.root ?? '.');

  if (values.help === true || command === undefined) {
    say(USAGE);

    return command === undefined && values.help !== true ? 1 : 0;
  }

  try {
    switch (command) {
      case 'validate': {
        const { generated } = await checkPackage({ root });

        say(
          `${String(generated.manifest['name'])} ${String(generated.manifest['version'])} holds together.`,
        );

        return 0;
      }

      case 'build': {
        const { generated, outDir } = await buildPackage({ root, logLevel: 'warn' });

        say(
          `Built ${String(generated.manifest['name'])} ${String(generated.manifest['version'])} into ${path.relative(root, outDir)}.`,
        );

        return 0;
      }

      case 'pack': {
        const { outDir } = await checkPackage({ root });
        const packed = await packRelease({
          root,
          outDir,
          ...(values.url === undefined ? {} : { urlBase: values.url }),
        });

        say(
          `Packed ${path.relative(root, packed.archive)} (${String(packed.size)} bytes, sha256 ${packed.sha256}).`,
        );
        say(`Wrote ${path.relative(root, packed.indexEntry)}.`);

        return 0;
      }

      default: {
        process.stderr.write(`There is no command ${command}.\n\n${USAGE}`);

        return 1;
      }
    }
  } catch (error: unknown) {
    if (error instanceof PackageConfigError) {
      process.stderr.write(`${error.message}\n`);

      return 1;
    }

    throw error;
  }
}
