/**
 * `nebulahome-package`: the command a package is checked, built and packed with
 * (PACKAGES_DOCS.md 8.2).
 *
 * ```
 * nebulahome-package validate        the declaration holds together, the way the platform reads it
 * nebulahome-package build           validate, then build both halves into dist/
 * nebulahome-package pack [--url u]  pack dist/ into <id>-<version>.tgz, and index-entry.json with --url
 * ```
 *
 * Every command takes `--root <folder>`, the package's folder - the working directory when not
 * said. A problem ends it with exit code 1, every problem printed.
 *
 * The build and the archive are loaded when a command needs them: the build imports Vite, the
 * package's own development dependency, so the help runs anywhere - `npx` in an empty folder - and
 * a command run without Vite says what to install.
 */
import path from 'node:path';
import { parseArgs } from 'node:util';

import { PackageConfigError } from '../generate/problems.js';

/** The tools a package is built with, as the README has them installed. */
const BUILD_TOOLS =
  'pnpm add -D vite typescript react @types/react @vitejs/plugin-react tailwindcss @tailwindcss/vite';

/** How the command is used. */
const USAGE = `Usage: nebulahome-package <validate | build | pack> [--root <folder>] [--url <base>]

  validate   check nebula.config.ts the way the platform reads a release
  build      validate, then build the interface and the server into dist/
  pack       pack dist/ into <id>-<version>.tgz; with --url, or on GitHub Actions, write
             index-entry.json for the package index too
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
 * Says whether an error is Node failing to find Vite: the SDK is not where the package's tools
 * are installed, or they are not installed yet.
 *
 * @param error - What was thrown.
 * @returns True when it is.
 */
function isViteMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 'ERR_MODULE_NOT_FOUND' &&
    error.message.includes("'vite'")
  );
}

/**
 * What to do when Vite is missing.
 *
 * @param command - The command that needs it.
 * @returns The lines to print.
 */
function viteMissing(command: string): string {
  return `nebulahome-package ${command} needs Vite, and it is not installed where the SDK is.
Install the SDK and the tools a package is built with in the package's folder:

  pnpm add @nebulahome/package-sdk
  ${BUILD_TOOLS}

then run the command from there: pnpm exec nebulahome-package ${command}
`;
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
        const { checkPackage } = await import('../vite/build.js');
        const { generated } = await checkPackage({ root });

        say(
          `${String(generated.manifest['name'])} ${String(generated.manifest['version'])} holds together.`,
        );

        return 0;
      }

      case 'build': {
        const { buildPackage } = await import('../vite/build.js');
        const { generated, outDir } = await buildPackage({ root, logLevel: 'warn' });

        say(
          `Built ${String(generated.manifest['name'])} ${String(generated.manifest['version'])} into ${path.relative(root, outDir)}.`,
        );

        return 0;
      }

      case 'pack': {
        const [{ checkPackage }, { packRelease }] = await Promise.all([
          import('../vite/build.js'),
          import('./pack.js'),
        ]);
        const { outDir } = await checkPackage({ root });
        const packed = await packRelease({
          root,
          outDir,
          ...(values.url === undefined ? {} : { urlBase: values.url }),
        });

        say(
          `Packed ${path.relative(root, packed.archive)} (${String(packed.size)} bytes, sha256 ${packed.sha256}).`,
        );
        say(
          packed.indexEntry === undefined
            ? 'Wrote no index-entry.json: pass --url <base> for the address the archive is released at.'
            : `Wrote ${path.relative(root, packed.indexEntry)}.`,
        );

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

    if (isViteMissing(error)) {
      process.stderr.write(viteMissing(command));

      return 1;
    }

    throw error;
  }
}
