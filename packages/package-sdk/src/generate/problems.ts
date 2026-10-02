/**
 * What is wrong with a package's declaration, every problem at once and each with where it is,
 * so an author fixes them in one pass rather than one build at a time.
 */

/** Thrown when a declaration does not hold together. */
export class PackageConfigError extends Error {
  /** Every problem, one line each: `cards[0].options.days: …`. */
  public readonly problems: readonly string[];

  /**
   * Gathers the problems.
   *
   * @param problems - Each problem, with where it is.
   */
  public constructor(problems: readonly string[]) {
    super(
      `The package does not hold together:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`,
    );
    this.name = 'PackageConfigError';
    this.problems = problems;
  }
}

/** Where problems are gathered while a declaration is read. */
export type Problems = {
  /**
   * Records one.
   *
   * @param path - Where, in the declaration's terms.
   * @param message - What.
   */
  readonly add: (path: string, message: string) => void;

  /** Every problem recorded. */
  readonly list: readonly string[];
};

/**
 * A place to gather problems.
 *
 * @returns It.
 */
export function problems(): Problems {
  const list: string[] = [];

  return {
    /**
     * Records a problem.
     *
     * @param path - Where in the declaration, or empty for the whole of it.
     * @param message - What is wrong.
     */
    add: (path, message) => {
      list.push(path === '' ? message : `${path}: ${message}`);
    },
    list,
  };
}

/**
 * A path from its parts, as a declaration is written: `cards[0].options.days`.
 *
 * @param parts - The keys and indexes.
 * @returns The path.
 */
export function pathOf(parts: readonly PropertyKey[]): string {
  return parts.reduce<string>((path, part) => {
    if (typeof part === 'number') {
      return `${path}[${String(part)}]`;
    }

    return path === '' ? String(part) : `${path}.${String(part)}`;
  }, '');
}
