/**
 * The tokeniser of alias code: Python's lexical rules, cut to what the interpreter runs.
 *
 * Indentation becomes INDENT and DEDENT tokens, newlines inside brackets are ignored, a backslash
 * at the end of a line joins it to the next, and comments vanish. Strings come out with their
 * escapes decoded; an f-string comes out in pieces, its expressions as source text with their
 * place in the file, for the parser to read. Every token carries where it starts and ends, 1-based,
 * so an error can point at the character.
 */
import { ENTITY_DOMAINS } from '../entity-id.js';

import { CodeSyntaxError, type SourceSpan } from './errors.js';

/** One piece of an f-string: literal text, or an expression with its conversion and format. */
export type FStringPiece =
  | { readonly kind: 'text'; readonly value: string }
  | {
      readonly kind: 'expression';
      readonly source: string;
      readonly line: number;
      readonly column: number;
      readonly conversion: 'r' | 's' | null;
      readonly spec: string | null;
    };

/** One token, with where it is. */
export type Token = SourceSpan &
  (
    | {
        readonly kind: 'name' | 'op' | 'newline' | 'indent' | 'dedent' | 'eof';
        readonly text: string;
      }
    | {
        readonly kind: 'number';
        readonly text: string;
        readonly value: number;
        readonly isInt: boolean;
      }
    | { readonly kind: 'string'; readonly text: string; readonly value: string }
    | { readonly kind: 'fstring'; readonly text: string; readonly pieces: readonly FStringPiece[] }
  );

/**
 * A union member without some keys, member by member.
 */
type DistributiveOmit<TValue, TKey extends PropertyKey> = TValue extends unknown
  ? Omit<TValue, TKey>
  : never;

/** A token before its place is known. */
type TokenBody = DistributiveOmit<Token, keyof SourceSpan>;

/** How to read a text. */
export type LexOptions = {
  /** The line the text starts on in the file, for an f-string expression. */
  readonly line?: number;

  /** The column the text starts at. */
  readonly column?: number;

  /** Read one expression: no indentation, and newlines are spaces. */
  readonly expression?: boolean;
};

/** Operators, longest first so that `**=` is never read as `**` and `=`. */
const OPERATORS = [
  '**=',
  '//=',
  '>>=',
  '<<=',
  '...',
  '**',
  '//',
  '==',
  '!=',
  '<=',
  '>=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '->',
  ':=',
  '<<',
  '>>',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '>',
  '=',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  ',',
  ':',
  '.',
  ';',
  '@',
  '|',
  '&',
  '^',
  '~',
] as const;

/** Operators refused where they appear, with what to write instead. */
const REFUSED_OPERATORS: Readonly<Record<string, string>> = {
  '@': 'decorators are not supported',
  ':=': 'the walrus operator := is not supported',
  '&&': 'use and instead of &&',
  '||': 'use or instead of ||',
};

const OPENERS: Readonly<Record<string, string>> = { ')': '(', ']': '[', '}': '{' };

const DOMAINS: ReadonlySet<string> = new Set(ENTITY_DOMAINS);

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  n: '\n',
  t: '\t',
  r: '\r',
  '0': '\0',
  a: '\u0007',
  b: '\b',
  f: '\f',
  v: '\v',
  '\\': '\\',
  "'": "'",
  '"': '"',
  '\n': '',
};

/** The width a tab advances the indentation to: the next multiple of this. */
export const TAB_WIDTH = 4;

/**
 * Whether a character starts a name.
 *
 * @param character - One character, or empty.
 * @returns True for a letter or an underscore.
 */
function isNameStart(character: string): boolean {
  return /^[\p{L}_]$/u.test(character);
}

/**
 * Whether a character continues a name.
 *
 * @param character - One character, or empty.
 * @returns True for a letter, a digit or an underscore.
 */
function isNamePart(character: string): boolean {
  return /^[\p{L}\p{N}_]$/u.test(character);
}

/**
 * Whether a character is an ASCII digit.
 *
 * @param character - One character, or empty.
 * @returns True for 0-9.
 */
function isDigit(character: string): boolean {
  return character >= '0' && character <= '9';
}

/**
 * Decodes the backslash escapes of a string's text.
 *
 * Unknown escapes keep their backslash, as Python does.
 *
 * @param text - The text between the quotes.
 * @param span - Where the string is, for an error.
 * @returns The decoded text.
 * @throws {CodeSyntaxError} When a \x, \u or \U escape is malformed.
 */
export function decodeEscapes(text: string, span: SourceSpan): string {
  if (!text.includes('\\')) {
    return text;
  }

  let decoded = '';
  let index = 0;

  while (index < text.length) {
    const character = text.charAt(index);

    if (character !== '\\') {
      decoded += character;
      index += 1;
      continue;
    }

    const next = text.charAt(index + 1);
    const simple = SIMPLE_ESCAPES[next];

    if (simple !== undefined) {
      decoded += simple;
      index += 2;
      continue;
    }

    const width = next === 'x' ? 2 : next === 'u' ? 4 : next === 'U' ? 8 : 0;

    if (width > 0) {
      const hex = text.slice(index + 2, index + 2 + width);
      const code = Number.parseInt(hex, 16);

      if (!/^[0-9a-fA-F]+$/u.test(hex) || hex.length !== width || code > 0x10_ff_ff) {
        throw new CodeSyntaxError(`invalid \\${next} escape`, span);
      }

      decoded += String.fromCodePoint(code);
      index += 2 + width;
      continue;
    }

    decoded += character;
    index += 1;
  }

  return decoded;
}

/**
 * Cuts the text of an f-string into literal pieces and expressions.
 *
 * @param content - The text between the quotes, undecoded.
 * @param raw - Whether it is a raw string: escapes stay as written.
 * @param line - The line the text starts on.
 * @param column - The column it starts at.
 * @param span - The whole string, for errors.
 * @returns The pieces, in order.
 * @throws {CodeSyntaxError} When a brace or a conversion is malformed.
 */
function fstringPieces(
  content: string,
  raw: boolean,
  line: number,
  column: number,
  span: SourceSpan,
): FStringPiece[] {
  const pieces: FStringPiece[] = [];
  let text = '';
  let index = 0;

  /**
   * Turns the literal text gathered so far into a piece.
   */
  const flush = (): void => {
    if (text !== '') {
      pieces.push({ kind: 'text', value: raw ? text : decodeEscapes(text, span) });
      text = '';
    }
  };

  /**
   * Where an offset into the text is in the file.
   *
   * @param offset - The offset.
   * @returns Its line and column.
   */
  const positionOf = (offset: number): { line: number; column: number } => {
    const before = content.slice(0, offset);
    const lastNewline = before.lastIndexOf('\n');
    const newlines = before.split('\n').length - 1;

    return {
      line: line + newlines,
      column: lastNewline < 0 ? column + offset : offset - lastNewline,
    };
  };

  while (index < content.length) {
    const character = content.charAt(index);

    if (character === '\\' && !raw) {
      text += content.slice(index, index + 2);
      index += 2;
      continue;
    }

    if (character === '}') {
      if (content.charAt(index + 1) !== '}') {
        throw new CodeSyntaxError("f-string: single '}' is not allowed", span);
      }

      text += '}';
      index += 2;
      continue;
    }

    if (character !== '{') {
      text += character;
      index += 1;
      continue;
    }

    if (content.charAt(index + 1) === '{') {
      text += '{';
      index += 2;
      continue;
    }

    flush();

    let end = index + 1;
    let depth = 0;
    let quote = '';

    for (; end < content.length; end += 1) {
      const inner = content.charAt(end);

      if (quote !== '') {
        if (inner === quote) {
          quote = '';
        }

        continue;
      }

      if (inner === '"' || inner === "'") {
        quote = inner;
      } else if ('([{'.includes(inner)) {
        depth += 1;
      } else if (')]}'.includes(inner)) {
        if (depth === 0) {
          break;
        }

        depth -= 1;
      } else if (
        depth === 0 &&
        (inner === ':' || (inner === '!' && content.charAt(end + 1) !== '='))
      ) {
        break;
      }
    }

    const source = content.slice(index + 1, end);
    const start = positionOf(index + 1);
    let conversion: 'r' | 's' | null = null;
    let spec: string | null = null;

    if (content.charAt(end) === '!') {
      const letter = content.charAt(end + 1);

      if (letter !== 'r' && letter !== 's' && letter !== 'a') {
        throw new CodeSyntaxError('f-string: invalid conversion character', span);
      }

      conversion = letter === 's' ? 's' : 'r';
      end += 2;
    }

    if (content.charAt(end) === ':') {
      const close = content.indexOf('}', end);

      if (close < 0) {
        throw new CodeSyntaxError("f-string: expecting '}'", span);
      }

      spec = content.slice(end + 1, close);

      if (spec.includes('{')) {
        throw new CodeSyntaxError('f-string: nested format specs are not supported', span);
      }

      end = close;
    }

    if (content.charAt(end) !== '}') {
      throw new CodeSyntaxError("f-string: expecting '}'", span);
    }

    if (source.trim() === '') {
      throw new CodeSyntaxError('f-string: empty expression not allowed', span);
    }

    pieces.push({ kind: 'expression', source, ...start, conversion, spec });
    index = end + 1;
  }

  flush();
  return pieces;
}

/**
 * Reads source text into tokens.
 */
class Lexer {
  readonly #source: string;
  readonly #expression: boolean;
  readonly #tokens: Token[] = [];
  readonly #indents: number[] = [0];
  readonly #brackets: { readonly text: string; readonly span: SourceSpan }[] = [];
  #index = 0;
  #line: number;
  #column: number;
  #atLineStart: boolean;

  /**
   * @param source - The text.
   * @param options - Where it starts, and whether it is one expression.
   */
  public constructor(source: string, options: LexOptions) {
    this.#source = source.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    this.#expression = options.expression ?? false;
    this.#line = options.line ?? 1;
    this.#column = options.column ?? 1;
    this.#atLineStart = !this.#expression;
  }

  /**
   * Reads the whole text.
   *
   * @returns The tokens, ending with `eof`.
   */
  public run(): Token[] {
    while (this.#index < this.#source.length) {
      if (this.#atLineStart) {
        this.#indentation();
      } else {
        this.#next();
      }
    }

    this.#finish();
    return this.#tokens;
  }

  /**
   * The character at an offset from the cursor.
   *
   * @param offset - How far ahead.
   * @returns The character, or empty past the end.
   */
  #peek(offset = 0): string {
    return this.#source.charAt(this.#index + offset);
  }

  /**
   * Consumes one character, keeping the line and column.
   */
  #advance(): void {
    const character = this.#source.charAt(this.#index);
    this.#index += 1;

    if (character === '\n') {
      this.#line += 1;
      this.#column = 1;
    } else {
      this.#column += 1;
    }
  }

  /**
   * The place of the cursor, as a zero-width span.
   *
   * @returns The span.
   */
  #here(): SourceSpan {
    return { line: this.#line, column: this.#column, endLine: this.#line, endColumn: this.#column };
  }

  /**
   * Adds a token from a start to the cursor.
   *
   * @param token - What it is.
   * @param start - Where it began.
   */
  #push(token: TokenBody, start: SourceSpan): void {
    this.#tokens.push({
      ...token,
      line: start.line,
      column: start.column,
      endLine: this.#line,
      endColumn: this.#column,
    });
  }

  /**
   * Measures the indentation of a new line and emits INDENT or DEDENT; skips blank and
   * comment-only lines whole.
   *
   * @throws {CodeSyntaxError} When a line dedents to a level that was never opened.
   */
  #indentation(): void {
    let width = 0;
    let offset = 0;

    for (;;) {
      const character = this.#peek(offset);

      if (character === ' ') {
        width += 1;
      } else if (character === '\t') {
        width = (Math.floor(width / TAB_WIDTH) + 1) * TAB_WIDTH;
      } else if (character === '\f') {
        width = 0;
      } else {
        break;
      }

      offset += 1;
    }

    const first = this.#peek(offset);

    if (first === '' || first === '\n' || first === '#') {
      while (this.#index < this.#source.length && this.#peek() !== '\n') {
        this.#advance();
      }

      if (this.#peek() === '\n') {
        this.#advance();
      }

      return;
    }

    for (let index = 0; index < offset; index += 1) {
      this.#advance();
    }

    this.#atLineStart = false;
    const here = this.#here();
    let top = this.#indents.at(-1) ?? 0;

    if (width > top) {
      this.#indents.push(width);
      this.#push({ kind: 'indent', text: '' }, here);
      return;
    }

    while (width < top) {
      this.#indents.pop();
      this.#push({ kind: 'dedent', text: '' }, here);
      top = this.#indents.at(-1) ?? 0;
    }

    if (width !== top) {
      throw new CodeSyntaxError('unindent does not match any outer indentation level', here);
    }
  }

  /**
   * Reads the next token, or skips space, a comment or a joined line.
   */
  #next(): void {
    const character = this.#peek();

    if (character === ' ' || character === '\t' || character === '\f') {
      this.#advance();
      return;
    }

    if (character === '#') {
      while (this.#index < this.#source.length && this.#peek() !== '\n') {
        this.#advance();
      }

      return;
    }

    if (character === '\\' && this.#peek(1) === '\n') {
      this.#advance();
      this.#advance();
      return;
    }

    if (character === '\n') {
      const start = this.#here();
      this.#advance();

      if (this.#brackets.length === 0 && !this.#expression) {
        const last = this.#tokens.at(-1);

        if (last !== undefined && last.kind !== 'newline') {
          this.#tokens.push({ kind: 'newline', text: '\n', ...start });
        }

        this.#atLineStart = true;
      }

      return;
    }

    if (isDigit(character) || (character === '.' && isDigit(this.#peek(1)))) {
      this.#number();
      return;
    }

    if (isNameStart(character)) {
      this.#nameOrString();
      return;
    }

    if (character === '"' || character === "'") {
      this.#string('', this.#here());
      return;
    }

    this.#operator();
  }

  /**
   * Reads a number literal.
   *
   * @throws {CodeSyntaxError} When letters follow the digits, or the number is too large.
   */
  #number(): void {
    const start = this.#here();
    const begin = this.#index;

    /**
     * Consumes a run of digits and underscores.
     */
    const digits = (): void => {
      while (isDigit(this.#peek()) || this.#peek() === '_') {
        this.#advance();
      }
    };

    digits();

    if (this.#peek() === '.' && this.#peek(1) !== '.') {
      this.#advance();
      digits();
    }

    const sign = this.#peek(1);

    if (
      (this.#peek() === 'e' || this.#peek() === 'E') &&
      (isDigit(sign) || ((sign === '+' || sign === '-') && isDigit(this.#peek(2))))
    ) {
      this.#advance();

      if (!isDigit(this.#peek())) {
        this.#advance();
      }

      digits();
    }

    if (isNamePart(this.#peek())) {
      throw new CodeSyntaxError('invalid decimal literal', this.#here());
    }

    const text = this.#source.slice(begin, this.#index);
    const clean = text.replaceAll('_', '');
    const value = Number(clean);

    if (!Number.isFinite(value)) {
      throw new CodeSyntaxError('number is too large', start);
    }

    this.#push({ kind: 'number', text, value, isInt: !/[.eE]/u.test(clean) }, start);
  }

  /**
   * Reads a name, or a string whose prefix looked like one.
   *
   * @throws {CodeSyntaxError} When a bytes literal is written.
   */
  #nameOrString(): void {
    const start = this.#here();
    const begin = this.#index;

    while (isNamePart(this.#peek())) {
      this.#advance();
    }

    const text = this.#source.slice(begin, this.#index);
    const prefix = text.toLowerCase();

    if (
      /^(?:r|u|f|b|rf|fr|br|rb)$/u.test(prefix) &&
      (this.#peek() === '"' || this.#peek() === "'")
    ) {
      if (prefix.includes('b')) {
        throw new CodeSyntaxError('bytes are not supported', start);
      }

      this.#string(prefix, start);
      return;
    }

    this.#push({ kind: 'name', text }, start);

    // An entity's object id may start with a digit, which Python would read as a number.
    if (DOMAINS.has(text) && this.#peek() === '.' && isDigit(this.#peek(1))) {
      const dot = this.#here();
      this.#advance();
      this.#push({ kind: 'op', text: '.' }, dot);
      const objectStart = this.#here();
      const objectBegin = this.#index;

      while (/^[A-Za-z0-9_]$/u.test(this.#peek())) {
        this.#advance();
      }

      this.#push({ kind: 'name', text: this.#source.slice(objectBegin, this.#index) }, objectStart);
    }
  }

  /**
   * Reads a string literal, the cursor on its opening quote.
   *
   * @param prefix - Its lower-case prefix letters, if any.
   * @param start - Where the literal, prefix included, begins.
   * @throws {CodeSyntaxError} When it is never closed.
   */
  #string(prefix: string, start: SourceSpan): void {
    const raw = prefix.includes('r');
    const quote = this.#peek();
    const triple = this.#peek(1) === quote && this.#peek(2) === quote;
    const quoteLength = triple ? 3 : 1;

    for (let index = 0; index < quoteLength; index += 1) {
      this.#advance();
    }

    const contentLine = this.#line;
    const contentColumn = this.#column;
    const contentBegin = this.#index;
    const isFormat = prefix.includes('f');
    // Inside an f-string's {…}, quotes start nested strings, as in Python 3.12.
    let braces = 0;

    for (;;) {
      if (this.#index >= this.#source.length) {
        throw new CodeSyntaxError(
          triple ? 'unterminated triple-quoted string literal' : 'unterminated string literal',
          start,
        );
      }

      const character = this.#peek();

      if (isFormat && braces === 0 && (character === '{' || character === '}')) {
        if (this.#peek(1) === character) {
          this.#advance();
          this.#advance();
          continue;
        }

        braces = character === '{' ? 1 : 0;
        this.#advance();
        continue;
      }

      if (isFormat && braces > 0) {
        if (character === '{') {
          braces += 1;
        } else if (character === '}') {
          braces -= 1;
        } else if (character === '"' || character === "'") {
          this.#nestedString(character, start);
          continue;
        }
      }

      if (character === '\\') {
        this.#advance();

        if (this.#index < this.#source.length) {
          this.#advance();
        }

        continue;
      }

      if (character === '\n' && !triple) {
        throw new CodeSyntaxError('unterminated string literal', start);
      }

      if (
        character === quote &&
        (!triple || (this.#peek(1) === quote && this.#peek(2) === quote))
      ) {
        break;
      }

      this.#advance();
    }

    const content = this.#source.slice(contentBegin, this.#index);
    const text = this.#source.slice(contentBegin - quoteLength - prefix.length, this.#index);

    for (let index = 0; index < quoteLength; index += 1) {
      this.#advance();
    }

    const span = { ...start, endLine: this.#line, endColumn: this.#column };

    if (prefix.includes('f')) {
      this.#push(
        {
          kind: 'fstring',
          text,
          pieces: fstringPieces(content, raw, contentLine, contentColumn, span),
        },
        start,
      );
    } else {
      this.#push(
        { kind: 'string', text, value: raw ? content : decodeEscapes(content, span) },
        start,
      );
    }
  }

  /**
   * Skips a string written inside an f-string's braces, the cursor on its opening quote.
   *
   * @param quote - Its quote character.
   * @param start - Where the enclosing f-string begins, for errors.
   * @throws {CodeSyntaxError} When it is never closed.
   */
  #nestedString(quote: string, start: SourceSpan): void {
    this.#advance();

    while (this.#peek() !== quote) {
      if (this.#index >= this.#source.length || this.#peek() === '\n') {
        throw new CodeSyntaxError('unterminated string literal', start);
      }

      if (this.#peek() === '\\') {
        this.#advance();
      }

      this.#advance();
    }

    this.#advance();
  }

  /**
   * Reads an operator or a bracket.
   *
   * @throws {CodeSyntaxError} On a refused operator, an unmatched bracket or a stray character.
   */
  #operator(): void {
    const start = this.#here();
    const two = this.#source.slice(this.#index, this.#index + 2);
    const refusedPair = REFUSED_OPERATORS[two];

    if (refusedPair !== undefined) {
      throw new CodeSyntaxError(refusedPair, start);
    }

    const operator = OPERATORS.find((candidate) => this.#source.startsWith(candidate, this.#index));

    if (operator === undefined) {
      const character = this.#peek();

      throw new CodeSyntaxError(
        character === '!' ? 'use not instead of !' : `invalid character '${character}'`,
        start,
      );
    }

    const refused = REFUSED_OPERATORS[operator];

    if (refused !== undefined) {
      throw new CodeSyntaxError(refused, start);
    }

    const { length } = operator;

    for (let index = 0; index < length; index += 1) {
      this.#advance();
    }

    const span = { ...start, endLine: this.#line, endColumn: this.#column };

    if (operator === '(' || operator === '[' || operator === '{') {
      this.#brackets.push({ text: operator, span });
    }

    const opener = OPENERS[operator];

    if (opener !== undefined) {
      const open = this.#brackets.pop();

      if (open === undefined) {
        throw new CodeSyntaxError(`unmatched '${operator}'`, span);
      }

      if (open.text !== opener) {
        throw new CodeSyntaxError(
          `closing '${operator}' does not match opening '${open.text}'`,
          span,
        );
      }
    }

    this.#push({ kind: 'op', text: operator }, start);
  }

  /**
   * Closes the text: an open bracket is an error, then the last NEWLINE, the DEDENTs and EOF.
   *
   * @throws {CodeSyntaxError} When a bracket was never closed.
   */
  #finish(): void {
    const open = this.#brackets.at(-1);

    if (open !== undefined) {
      throw new CodeSyntaxError(`'${open.text}' was never closed`, open.span);
    }

    const here = this.#here();

    if (!this.#expression) {
      const last = this.#tokens.at(-1);

      if (last !== undefined && last.kind !== 'newline') {
        this.#tokens.push({ kind: 'newline', text: '', ...here });
      }

      while (this.#indents.length > 1) {
        this.#indents.pop();
        this.#tokens.push({ kind: 'dedent', text: '', ...here });
      }
    }

    this.#tokens.push({ kind: 'eof', text: '', ...here });
  }
}

/**
 * Reads source text into tokens.
 *
 * @param source - The code, or one expression with `options.expression`.
 * @param options - Where the text starts in the file, and whether it is one expression.
 * @returns The tokens, ending with `eof`.
 * @throws {CodeSyntaxError} When the text cannot be tokenised.
 */
export function tokenize(source: string, options: LexOptions = {}): Token[] {
  return new Lexer(source, options).run();
}
