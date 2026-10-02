/**
 * A package's compose file, read as `validate` and `build` read it: the rules the supervisor holds
 * it to, checked on the YAML as written, and the variables it uses checked against what the
 * platform gives it (PACKAGES_DOCS.md 4.8) - so a release the platform would refuse never leaves
 * the author's machine.
 */
import { parse } from 'yaml';

import {
  COMPOSE_PLATFORM_VARIABLES,
  composeVariableOf,
  packageComposeProblems,
} from '@nebulahome/contracts';

/**
 * Compose's variable references: `$NAME`, `${NAME}`, and `${NAME:-default}` with every operator.
 * A doubled `$$` is a literal dollar, so the reference must not follow another `$`.
 */
const REFERENCE =
  /(?<!\$)\$(?:\{([A-Za-z_][A-Za-z0-9_]*)(:?[-?+])?[^}]*\}|([A-Za-z_][A-Za-z0-9_]*))/g;

/**
 * What is wrong with a package's compose file, one sentence each.
 *
 * @param text - The file, as written.
 * @param settingKeys - The keys of the package's declared settings.
 * @returns The problems; empty when the platform will run it.
 */
export function composeFileProblems(text: string, settingKeys: readonly string[]): string[] {
  let document: unknown;

  try {
    document = parse(text);
  } catch (error: unknown) {
    return [`is not YAML: ${error instanceof Error ? error.message : String(error)}`];
  }

  const problems = packageComposeProblems(document);
  const given = new Set<string>([
    ...COMPOSE_PLATFORM_VARIABLES,
    ...settingKeys.map((key) => composeVariableOf(key)),
  ]);
  const told = new Set<string>();

  for (const match of text.matchAll(REFERENCE)) {
    const name = match[1] ?? match[3] ?? '';
    const operator = match[2];
    const hasDefault = operator === '-' || operator === ':-';

    if (given.has(name) || told.has(name) || (hasDefault && !name.startsWith('NEBULA_'))) {
      continue;
    }

    told.add(name);
    problems.push(
      name.startsWith('NEBULA_SETUP_')
        ? `\${${name}} is no declared setting's variable: a setting apiToken is \${NEBULA_SETUP_API_TOKEN}`
        : `\${${name}} is not given to the file: only a setting's \${NEBULA_SETUP_<KEY>} and ${COMPOSE_PLATFORM_VARIABLES.map((each) => `\${${each}}`).join(', ')}`,
    );
  }

  return problems;
}
