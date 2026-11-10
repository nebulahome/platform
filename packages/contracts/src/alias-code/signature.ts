/**
 * Function signatures as the docs write them, and binding a call's arguments to them.
 *
 * The registry writes each builtin's signature once, for people (`round(x, digits=0)`,
 * `range([start,] stop[, step])`, `print(*values)`), and the same text is parsed here into the
 * parameters the evaluator binds and the checker counts, so the docs cannot drift from what runs.
 */
import { CodeRunError } from './errors.js';
import { tuple, type PyValue } from './values.js';

/** One parameter. */
export type SignatureParam = {
  readonly name: string;

  /** Whether it may be left out: it has a default, or sits in brackets. */
  readonly optional: boolean;

  /** Whether it takes all remaining positional arguments, as `*values`. */
  readonly variadic: boolean;
};

/** A parsed signature. */
export type Signature = {
  readonly name: string;
  readonly params: readonly SignatureParam[];
};

/**
 * Parses a signature as the docs write it.
 *
 * @param signature - For example `round(x, digits=0)` or `range([start,] stop[, step])`.
 * @returns The function name and its parameters.
 */
export function parseSignature(signature: string): Signature {
  const open = signature.indexOf('(');
  const name = signature.slice(0, open);
  const inside = signature.slice(open + 1, signature.lastIndexOf(')'));
  const params: SignatureParam[] = [];
  let depth = 0;

  /**
   * Moves the bracket depth over brackets in a stretch of text.
   *
   * @param stretch - Text holding only brackets and spaces.
   */
  const bracket = (stretch: string): void => {
    depth += stretch.split('[').length - stretch.split(']').length;
  };

  for (const piece of inside.split(',')) {
    const parts = /^(?<before>[\s[\]]*)(?<body>[^[\]]*)(?<after>[\s[\]]*)$/u.exec(piece)?.groups;
    const body = parts?.['body']?.trim() ?? '';
    bracket(parts?.['before'] ?? '');
    const optional = depth > 0 || body.includes('=');
    bracket(parts?.['after'] ?? '');
    const cleaned = body.split('=')[0]?.trim() ?? '';

    if (cleaned !== '') {
      params.push({
        name: cleaned.replace(/^\*/u, ''),
        optional,
        variadic: cleaned.startsWith('*'),
      });
    }
  }

  return { name, params };
}

/**
 * Binds a call's arguments to parameters.
 *
 * Positional arguments fill parameters in order, but an optional parameter is skipped while
 * there are only enough arguments for the required ones - which is how `range(5)` means
 * `range(0, 5)`. Keywords fill parameters by name. A variadic parameter takes the rest as a tuple.
 *
 * @param name - The function's name, for messages.
 * @param params - Its parameters.
 * @param positional - The positional arguments.
 * @param keywords - The keyword arguments.
 * @returns One slot per parameter; undefined where an optional one was left out.
 * @throws {CodeRunError} On too many arguments, an unknown or repeated keyword, or a missing one.
 */
export function bindArguments(
  name: string,
  params: readonly SignatureParam[],
  positional: readonly PyValue[],
  keywords: ReadonlyMap<string, PyValue>,
): (PyValue | undefined)[] {
  const bound: (PyValue | undefined)[] = params.map(() => undefined);
  const required = params.filter((param) => !param.optional && !param.variadic).length;
  let spare = positional.length - required;
  let next = 0;

  for (const [slot, param] of params.entries()) {
    if (param.variadic) {
      bound[slot] = tuple(positional.slice(next));
      next = positional.length;
      continue;
    }

    if (next >= positional.length) {
      continue;
    }

    if (param.optional) {
      if (spare <= 0) {
        continue;
      }

      spare -= 1;
    }

    bound[slot] = positional[next];
    next += 1;
  }

  if (next < positional.length) {
    const most = params.length;

    throw new CodeRunError(
      most === 0
        ? `${name}() takes no arguments (${String(positional.length)} given)`
        : `${name}() takes at most ${String(most)} argument${most === 1 ? '' : 's'} (${String(positional.length)} given)`,
    );
  }

  for (const [key, value] of keywords) {
    const slot = params.findIndex((param) => param.name === key && !param.variadic);

    if (slot < 0) {
      throw new CodeRunError(`${name}() got an unexpected keyword argument '${key}'`);
    }

    if (bound[slot] !== undefined) {
      throw new CodeRunError(`${name}() got multiple values for argument '${key}'`);
    }

    bound[slot] = value;
  }

  for (const [slot, param] of params.entries()) {
    if (!param.optional && !param.variadic && bound[slot] === undefined) {
      throw new CodeRunError(`${name}() missing required argument '${param.name}'`);
    }
  }

  return bound;
}

/**
 * Checks a call's argument count and keyword names without values, for the checker.
 *
 * @param name - The function's name.
 * @param params - Its parameters.
 * @param positionalCount - How many positional arguments the call passes.
 * @param keywordNames - The keyword names it passes.
 * @returns The problem, or null when the call fits.
 * @throws {Error} Anything binding throws besides a mismatched call.
 */
export function arityProblem(
  name: string,
  params: readonly SignatureParam[],
  positionalCount: number,
  keywordNames: readonly string[],
): string | null {
  try {
    bindArguments(
      name,
      params,
      Array.from({ length: positionalCount }, () => null),
      new Map(keywordNames.map((keyword) => [keyword, null])),
    );
    return null;
  } catch (error) {
    if (error instanceof CodeRunError) {
      return error.message;
    }

    throw error;
  }
}
