/**
 * What can go wrong in alias code, and where.
 *
 * Three kinds: code that cannot be read at all (a syntax error, or a construct the language
 * refuses), a line that fails while it runs, and a run that hits one of its limits. The first two
 * carry the place in the source, 1-based, so an editor can underline it.
 */

/** A stretch of the source: 1-based lines and columns, the end exclusive. */
export type SourceSpan = {
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
};

/** Code that cannot be compiled: a syntax error or a construct the language refuses. */
export class CodeSyntaxError extends Error {
  /** Where the problem is. */
  public readonly span: SourceSpan;

  /**
   * @param message - What is wrong, short and Python-flavoured.
   * @param span - Where.
   */
  public constructor(message: string, span: SourceSpan) {
    super(message);
    this.span = span;
  }
}

/** A line that failed while running: the run ends with an error result. */
export class CodeRunError extends Error {
  /** Where it failed, once the evaluator knows. */
  public span: SourceSpan | null = null;

  /**
   * Places the error at a node, unless an inner node already placed it.
   *
   * @param span - The node's place.
   * @returns The same error.
   */
  public placeAt(span: SourceSpan): this {
    this.span ??= span;
    return this;
  }
}

/** A run that hit a step, time, depth or deadline limit. */
export class CodeLimitError extends Error {}

/**
 * Places an error thrown under a node at that node, when it is a run error with no place yet.
 *
 * @param error - Whatever was thrown.
 * @param span - The node's place.
 * @returns The same error, for rethrowing.
 */
export function placed(error: unknown, span: SourceSpan): unknown {
  return error instanceof CodeRunError ? error.placeAt(span) : error;
}
