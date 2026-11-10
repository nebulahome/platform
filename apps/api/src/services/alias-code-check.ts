/**
 * What an alias's code reads, and what is wrong with it, for a save.
 *
 * The code's checker (contracts' `alias-code`) says which entity ids the code names - every one,
 * since the language reads entities only by literal id - and the problems that stop the code
 * from running (a syntax error, a construct the language refuses, an entity that is not in the
 * house, a function a part names that is not there).
 */
import {
  aliasCodeExpectation,
  checkCode as checkAliasCode,
  type AliasPartDef,
  type AliasParts,
} from '@nebulahome/contracts';

/** One problem that stops a code from being saved. */
export type CodeProblem = {
  readonly message: string;
  readonly line: number;
  readonly column: number;
};

/** What the code reads, and what stops it. */
export type CodeCheck = {
  readonly reads: readonly string[];
  readonly problems: readonly CodeProblem[];

  /** Whether it reads the time, so `core` runs it every minute. */
  readonly readsTime: boolean;
};

/**
 * Checks an alias's code against its parts.
 *
 * @param code - The code.
 * @param parts - The alias's parts.
 * @param defs - Its type's parts.
 * @param knownEntity - Whether an entity is in the house.
 * @returns What it reads and the errors that stop it; nothing for an empty code.
 */
export function checkCode(
  code: string,
  parts: AliasParts,
  defs: readonly AliasPartDef[],
  knownEntity: (entityId: string) => boolean,
): CodeCheck {
  if (code.trim() === '') {
    return { reads: [], problems: [], readsTime: false };
  }

  const bound = defs.flatMap((def) => {
    const config = parts[def.key];

    return config?.from === 'code'
      ? [
          {
            key: def.key,
            functionName: config.function,
            expectation: aliasCodeExpectation(def, config),
          },
        ]
      : [];
  });
  const result = checkAliasCode(code, {
    parts: bound,
    knownEntity,
    partKeys: Object.keys(parts),
  });

  return {
    reads: result.reads.entityIds,
    problems: result.problems
      .filter((problem) => problem.severity === 'error')
      .map((problem) => ({ message: problem.message, line: problem.line, column: problem.column })),
    readsTime: result.uses.time,
  };
}
