/**
 * `nebulahome-integration`: the command an integration is checked, built and packed with
 * (INTEGRATIONS_DOCS.md 8).
 *
 * ```
 * nebulahome-integration validate   the sources hold together, the way the hub reads a bundle
 * nebulahome-integration build      validate, then build src/ into dist/<vendor>/
 * nebulahome-integration pack       pack dist/<vendor>/ into <vendor>-<version>.tgz
 * ```
 *
 * Every command takes `--root <folder>`, the repository - the working directory when not said.
 * A problem ends it with exit code 1, every problem printed.
 */
import path from 'node:path';
import { parseArgs } from 'node:util';

import { buildIntegration } from '../build.js';
import { checkIntegration } from '../check.js';
import { packIntegration } from '../pack.js';
import { IntegrationError } from '../project.js';

/** How the command is used. */
const USAGE = `Usage: nebulahome-integration <validate | build | pack> [--root <folder>]

  validate   check src/ the way the hub reads a bundle
  build      validate, then build src/ into dist/<vendor>/ and load it back
  pack       pack dist/<vendor>/ into <vendor>-<version>.tgz, for a release or a local folder
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
        const { project, declaration } = await checkIntegration({ root });

        say(
          `${declaration.manifest.name} ${project.version} holds together: ${String(declaration.drivers.length)} driver${declaration.drivers.length === 1 ? '' : 's'}.`,
        );

        return 0;
      }

      case 'build': {
        const { project, outputDirectory, files, modules } = await buildIntegration({ root });

        say(
          `Built ${project.vendorId} ${project.version} into ${path.relative(root, outputDirectory)}: ${String(files)} files, ${String(modules)} modules.`,
        );

        return 0;
      }

      case 'pack': {
        const { archive, sha256, size } = await packIntegration({ root });

        say(`Packed ${path.relative(root, archive)}: ${String(size)} bytes, sha256 ${sha256}.`);

        return 0;
      }

      default: {
        say(`Unknown command: ${command}\n\n${USAGE}`);

        return 1;
      }
    }
  } catch (error: unknown) {
    if (error instanceof IntegrationError) {
      for (const problem of error.problems) {
        process.stderr.write(`✖ ${problem}\n`);
      }

      return 1;
    }

    throw error;
  }
}
