/**
 * The formatter of alias code: whitespace only, never meaning.
 *
 * Re-indents every block to four spaces per level from the token structure (so tabs and uneven
 * indentation come out even), strips trailing spaces, keeps at most two blank lines in a row and
 * ends the file with one newline. Text inside triple-quoted strings is left exactly as it is. Code
 * that does not parse only gets what is safe without knowing its structure.
 */
import { tokenize, TAB_WIDTH, type Token } from './lexer.js';
import { parseModule } from './parser.js';

/** The indentation of one block level. */
const INDENT = '    ';

/** The most blank lines kept in a row. */
const MAX_BLANK_LINES = 2;

/**
 * The width of a line's leading whitespace, tabs to the next multiple of four as the lexer reads.
 *
 * @param line - The line.
 * @returns The width, and how many characters the whitespace takes.
 */
function leading(line: string): { readonly width: number; readonly length: number } {
  let width = 0;
  let length = 0;

  for (const character of line) {
    if (character === ' ') {
      width += 1;
    } else if (character === '\t') {
      width = (Math.floor(width / TAB_WIDTH) + 1) * TAB_WIDTH;
    } else {
      break;
    }

    length += 1;
  }

  return { width, length };
}

/** What the formatter knows about each line of parsed code. */
type LineShape = {
  /** Lines that begin inside a multi-line string: left as they are. */
  readonly insideString: ReadonlySet<number>;

  /** Lines that end inside a multi-line string: trailing spaces are content. */
  readonly endsInString: ReadonlySet<number>;

  /** The indentation of each line that starts a statement. */
  readonly statementIndent: ReadonlyMap<number, number>;

  /** Lines that continue a statement begun on an earlier line. */
  readonly continuation: ReadonlySet<number>;
};

/**
 * Reads the shape of each line from the tokens.
 *
 * @param tokens - The tokens of parsed code.
 * @returns The line shapes.
 */
function shapeOf(tokens: readonly Token[]): LineShape {
  const insideString = new Set<number>();
  const endsInString = new Set<number>();
  const statementIndent = new Map<number, number>();
  const continuation = new Set<number>();
  let level = 0;
  let statementLine = 0;
  let atStart = true;

  for (const token of tokens) {
    if (token.kind === 'indent') {
      level += 1;
      continue;
    }

    if (token.kind === 'dedent') {
      level -= 1;
      continue;
    }

    if (token.kind === 'newline' || token.kind === 'eof') {
      atStart = true;
      continue;
    }

    if (atStart) {
      statementIndent.set(token.line, level * INDENT.length);
      statementLine = token.line;
      atStart = false;
    }

    for (let line = statementLine + 1; line <= token.endLine; line += 1) {
      continuation.add(line);
    }

    if ((token.kind === 'string' || token.kind === 'fstring') && token.endLine > token.line) {
      for (let line = token.line; line < token.endLine; line += 1) {
        insideString.add(line + 1);
        endsInString.add(line);
      }
    }
  }

  return { insideString, endsInString, statementIndent, continuation };
}

/**
 * Collapses blank lines and ends the text with one newline.
 *
 * @param lines - The formatted lines.
 * @param protectedLines - Indexes of lines inside strings, never collapsed.
 * @returns The text.
 */
function finish(lines: readonly string[], protectedLines: ReadonlySet<number>): string {
  const kept: string[] = [];
  let blanks = 0;

  for (const [index, line] of lines.entries()) {
    if (line === '' && !protectedLines.has(index)) {
      blanks += 1;

      if (blanks > MAX_BLANK_LINES) {
        continue;
      }
    } else {
      blanks = 0;
    }

    kept.push(line);
  }

  while (kept.length > 0 && kept.at(-1) === '' && !protectedLines.has(kept.length - 1)) {
    kept.pop();
  }

  return kept.length === 0 ? '' : `${kept.join('\n')}\n`;
}

/**
 * Formats code that does not parse: only tabs in indentation and trailing spaces.
 *
 * @param lines - The lines.
 * @returns The text.
 */
function formatUnparsed(lines: readonly string[]): string {
  const formatted = lines.map((line) => {
    const { length } = leading(line);
    const indentation = line.slice(0, length).replaceAll('\t', INDENT);
    return (indentation + line.slice(length)).trimEnd();
  });

  return finish(formatted, new Set());
}

/**
 * Formats a code file: four-space indentation, no trailing spaces, at most two blank lines in a
 * row, one newline at the end. Never changes what the code does.
 *
 * @param source - The code.
 * @returns The formatted code.
 */
export function formatCode(source: string): string {
  const normalized = source.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const lines = normalized.split('\n');
  let tokens: Token[];

  try {
    tokens = tokenize(normalized);
    parseModule(normalized);
  } catch {
    return formatUnparsed(lines);
  }

  const shape = shapeOf(tokens);
  const formatted: string[] = [];
  const protectedLines = new Set<number>();
  let shift = 0;
  let nextIndent = 0;

  for (const [index, line] of lines.entries()) {
    const number = index + 1;

    if (shape.insideString.has(number)) {
      protectedLines.add(index);
      formatted.push(shape.endsInString.has(number) ? line : line.trimEnd());
      continue;
    }

    const { width, length } = leading(line);
    const body = line.slice(length);
    const content = shape.endsInString.has(number) ? body : body.trimEnd();
    const indent = shape.statementIndent.get(number);

    if (indent !== undefined) {
      shift = indent - width;
      formatted.push(' '.repeat(indent) + content);
      continue;
    }

    if (content === '') {
      formatted.push('');
      continue;
    }

    if (shape.continuation.has(number)) {
      formatted.push(' '.repeat(Math.max(0, width + shift)) + content);
      continue;
    }

    // A comment line between statements takes the indentation of the next statement.
    nextIndent = indentOfNext(shape, number, lines.length) ?? nextIndent;
    formatted.push(' '.repeat(nextIndent) + content);
  }

  return finish(formatted, protectedLines);
}

/**
 * The indentation of the first statement after a line.
 *
 * @param shape - The line shapes.
 * @param after - The line.
 * @param count - How many lines there are.
 * @returns The indentation, or undefined when no statement follows.
 */
function indentOfNext(shape: LineShape, after: number, count: number): number | undefined {
  for (let line = after + 1; line <= count; line += 1) {
    const indent = shape.statementIndent.get(line);

    if (indent !== undefined) {
      return indent;
    }
  }

  return undefined;
}
