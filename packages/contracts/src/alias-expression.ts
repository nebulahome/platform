/**
 * Sandboxed evaluation of alias formulas.
 *
 * Alias expressions are owner input. They are evaluated here with a recursive-descent parser
 * that never calls `eval` or `new Function` (RULES.md §16, ARCHITECTURE.md §6.3). The only
 * values in scope are the scalar bindings the caller passed; there is no property access, no
 * indexing, no method call, and no way to reach the house's state through the expression itself.
 */
import type { CapabilityState } from './capabilities.js';
import { ValidationError } from './errors.js';

/** A scalar an expression may read or produce. */
export type AliasScalar = number | boolean | string;

/** How far evaluation is allowed to go. */
export type AliasEvaluateLimits = {
  /** Maximum AST nodes visited; a formula that does not terminate hits this. */
  readonly maxSteps: number;

  /** Wall-clock budget in milliseconds. */
  readonly maxDurationMs: number;
};

/** Defaults sized for a house formula, not a general-purpose language. */
export const DEFAULT_ALIAS_EVALUATE_LIMITS: AliasEvaluateLimits = {
  maxSteps: 10_000,
  maxDurationMs: 50,
};

/** What a successful evaluation produced. */
export type AliasEvaluateOk = {
  readonly ok: true;
  readonly value: AliasScalar;
};

/** What a failed evaluation produced. */
export type AliasEvaluateErr = {
  readonly ok: false;
  readonly error: string;
};

/** The result of evaluating one expression. */
export type AliasEvaluateResult = AliasEvaluateOk | AliasEvaluateErr;

/** One piece of an expression, as the tokeniser cut it. */
type Token =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'ident'; readonly value: string }
  | { readonly kind: 'op'; readonly value: string }
  | { readonly kind: 'eof' };

const MAX_EXPRESSION_LENGTH = 2_000;
const MAX_TEXT_RESULT = 512;

/**
 * Tokenises an expression into a flat list the parser walks once.
 *
 * @param source - The expression text.
 * @returns The tokens, ending with `eof`.
 * @throws {ValidationError} When the text is too long or contains an illegal character.
 */
function tokenise(source: string): Token[] {
  if (source.length > MAX_EXPRESSION_LENGTH) {
    throw new ValidationError(
      `Expression must be at most ${String(MAX_EXPRESSION_LENGTH)} characters`,
    );
  }

  const tokens: Token[] = [];
  let index = 0;

  /**
   * Peeks the character at the cursor without consuming it.
   *
   * @returns The character, or an empty string past the end.
   */
  const peek = (): string => source[index] ?? '';

  /**
   * Consumes and returns the character at the cursor.
   *
   * @returns The character.
   */
  const advance = (): string => {
    const character = source[index] ?? '';
    index += 1;
    return character;
  };

  while (index < source.length) {
    const character = peek();

    if (character === ' ' || character === '\t' || character === '\n' || character === '\r') {
      advance();
      continue;
    }

    if (character >= '0' && character <= '9') {
      let lexeme = advance();

      while (peek() >= '0' && peek() <= '9') {
        lexeme += advance();
      }

      if (peek() === '.') {
        lexeme += advance();

        while (peek() >= '0' && peek() <= '9') {
          lexeme += advance();
        }
      }

      const value = Number(lexeme);

      if (!Number.isFinite(value)) {
        throw new ValidationError(`Invalid number ${lexeme}`);
      }

      tokens.push({ kind: 'number', value });
      continue;
    }

    if (character === '"' || character === "'") {
      const quote = advance();
      let value = '';

      while (index < source.length && peek() !== quote) {
        const next = advance();

        if (next === '\\') {
          const escaped = advance();

          if (escaped === '') {
            throw new ValidationError('Unterminated string escape');
          }

          value += escaped;
          continue;
        }

        value += next;
      }

      if (peek() !== quote) {
        throw new ValidationError('Unterminated string literal');
      }

      advance();
      tokens.push({ kind: 'string', value });
      continue;
    }

    if (
      (character >= 'a' && character <= 'z') ||
      (character >= 'A' && character <= 'Z') ||
      character === '_'
    ) {
      let lexeme = advance();

      while (
        (peek() >= 'a' && peek() <= 'z') ||
        (peek() >= 'A' && peek() <= 'Z') ||
        (peek() >= '0' && peek() <= '9') ||
        peek() === '_'
      ) {
        lexeme += advance();
      }

      if (lexeme === 'true') {
        tokens.push({ kind: 'boolean', value: true });
      } else if (lexeme === 'false') {
        tokens.push({ kind: 'boolean', value: false });
      } else {
        tokens.push({ kind: 'ident', value: lexeme });
      }

      continue;
    }

    const two = source.slice(index, index + 2);

    if (
      two === '&&' ||
      two === '||' ||
      two === '==' ||
      two === '!=' ||
      two === '<=' ||
      two === '>='
    ) {
      tokens.push({ kind: 'op', value: two });
      index += 2;
      continue;
    }

    if ('+-*/()<>=!?:'.includes(character)) {
      tokens.push({ kind: 'op', value: advance() });
      continue;
    }

    throw new ValidationError(`Unexpected character ${JSON.stringify(character)} in expression`);
  }

  tokens.push({ kind: 'eof' });
  return tokens;
}

/**
 * Evaluates a tokenised expression against named scalar bindings.
 */
class Evaluator {
  readonly #tokens: readonly Token[];
  readonly #bindings: ReadonlyMap<string, AliasScalar>;
  readonly #limits: AliasEvaluateLimits;
  readonly #startedAt: number;
  #position = 0;
  #steps = 0;

  /**
   * @param tokens - The token stream, including a trailing `eof`.
   * @param bindings - Variable names to scalars; the only values the expression may read.
   * @param limits - Step and time ceilings.
   */
  public constructor(
    tokens: readonly Token[],
    bindings: ReadonlyMap<string, AliasScalar>,
    limits: AliasEvaluateLimits,
  ) {
    this.#tokens = tokens;
    this.#bindings = bindings;
    this.#limits = limits;
    this.#startedAt = Date.now();
  }

  /**
   * Evaluates the whole expression.
   *
   * @returns The scalar result.
   * @throws {ValidationError} When the expression is malformed, exceeds limits, or produces a
   * non-finite number.
   */
  public evaluate(): AliasScalar {
    const value = this.#parseTernary();
    this.#expect('eof');
    return this.#finalise(value);
  }

  /**
   * Counts one evaluation step and aborts when the budget is spent.
   *
   * @throws {ValidationError} When the step or time limit is exceeded.
   */
  #tick(): void {
    this.#steps += 1;

    if (this.#steps > this.#limits.maxSteps) {
      throw new ValidationError('Expression exceeded the step limit');
    }

    if (Date.now() - this.#startedAt > this.#limits.maxDurationMs) {
      throw new ValidationError('Expression exceeded the time limit');
    }
  }

  /**
   * Reads the current token without consuming it.
   *
   * @returns The token at the cursor.
   */
  #current(): Token {
    return this.#tokens[this.#position] ?? { kind: 'eof' };
  }

  /**
   * Consumes the current token.
   *
   * @returns The token that was at the cursor.
   */
  #advance(): Token {
    const token = this.#current();
    this.#position += 1;
    return token;
  }

  /**
   * Requires the current token to be a specific operator or end-of-input.
   *
   * @param value - The operator lexeme, or `eof`.
   * @throws {ValidationError} When it does not match.
   */
  #expect(value: string): void {
    const token = this.#current();

    if (value === 'eof') {
      if (token.kind !== 'eof') {
        throw new ValidationError('Unexpected trailing input in expression');
      }

      return;
    }

    if (token.kind !== 'op' || token.value !== value) {
      throw new ValidationError(`Expected ${value} in expression`);
    }

    this.#advance();
  }

  /**
   * Reports whether the current token is a given operator.
   *
   * @param value - The operator lexeme.
   * @returns True when it matches.
   */
  #matchOp(value: string): boolean {
    const token = this.#current();
    return token.kind === 'op' && token.value === value;
  }

  /**
   * ternary → logicOr ( '?' ternary ':' ternary )?
   *
   * @returns The scalar value.
   */
  #parseTernary(): AliasScalar {
    this.#tick();
    let value = this.#parseLogicOr();

    if (this.#matchOp('?')) {
      this.#advance();
      const whenTrue = this.#parseTernary();
      this.#expect(':');
      const whenFalse = this.#parseTernary();
      value = this.#isTruthy(value) ? whenTrue : whenFalse;
    }

    return value;
  }

  /**
   * logicOr → logicAnd ( '||' logicAnd )*
   *
   * @returns The scalar value.
   */
  #parseLogicOr(): AliasScalar {
    this.#tick();
    let value = this.#parseLogicAnd();

    while (this.#matchOp('||')) {
      this.#advance();
      const right = this.#parseLogicAnd();
      value = this.#isTruthy(value) || this.#isTruthy(right);
    }

    return value;
  }

  /**
   * logicAnd → equality ( '&&' equality )*
   *
   * @returns The scalar value.
   */
  #parseLogicAnd(): AliasScalar {
    this.#tick();
    let value = this.#parseEquality();

    while (this.#matchOp('&&')) {
      this.#advance();
      const right = this.#parseEquality();
      value = this.#isTruthy(value) && this.#isTruthy(right);
    }

    return value;
  }

  /**
   * equality → comparison ( ( '==' | '!=' ) comparison )*
   *
   * @returns The scalar value.
   * @throws {ValidationError} When an operand is not of the type the operator takes.
   */
  #parseEquality(): AliasScalar {
    this.#tick();
    let value = this.#parseComparison();

    while (this.#matchOp('==') || this.#matchOp('!=')) {
      const operator = this.#advance();
      const right = this.#parseComparison();

      if (operator.kind !== 'op') {
        throw new ValidationError('Expected comparison operator');
      }

      value = operator.value === '==' ? value === right : value !== right;
    }

    return value;
  }

  /**
   * comparison → term ( ( '<' | '<=' | '>' | '>=' ) term )*
   *
   * @returns The scalar value.
   * @throws {ValidationError} When an operand is not of the type the operator takes.
   */
  #parseComparison(): AliasScalar {
    this.#tick();
    let value = this.#parseTerm();

    while (this.#matchOp('<') || this.#matchOp('<=') || this.#matchOp('>') || this.#matchOp('>=')) {
      const operator = this.#advance();
      const right = this.#parseTerm();

      if (operator.kind !== 'op') {
        throw new ValidationError('Expected comparison operator');
      }

      const leftNumber = this.#asNumber(value, 'comparison');
      const rightNumber = this.#asNumber(right, 'comparison');

      switch (operator.value) {
        case '<':
          value = leftNumber < rightNumber;
          break;
        case '<=':
          value = leftNumber <= rightNumber;
          break;
        case '>':
          value = leftNumber > rightNumber;
          break;
        default:
          value = leftNumber >= rightNumber;
          break;
      }
    }

    return value;
  }

  /**
   * term → factor ( ( '+' | '-' ) factor )*
   *
   * @returns The scalar value.
   * @throws {ValidationError} When an operand is not of the type the operator takes.
   */
  #parseTerm(): AliasScalar {
    this.#tick();
    let value = this.#parseFactor();

    while (this.#matchOp('+') || this.#matchOp('-')) {
      const operator = this.#advance();
      const right = this.#parseFactor();

      if (operator.kind !== 'op') {
        throw new ValidationError('Expected additive operator');
      }

      if (operator.value === '+' && (typeof value === 'string' || typeof right === 'string')) {
        value = String(value) + String(right);
        continue;
      }

      const leftNumber = this.#asNumber(value, 'addition');
      const rightNumber = this.#asNumber(right, 'addition');
      value = operator.value === '+' ? leftNumber + rightNumber : leftNumber - rightNumber;
    }

    return value;
  }

  /**
   * factor → unary ( ( '*' | '/' ) unary )*
   *
   * @returns The scalar value.
   * @throws {ValidationError} When an operand is not of the type the operator takes.
   */
  #parseFactor(): AliasScalar {
    this.#tick();
    let value = this.#parseUnary();

    while (this.#matchOp('*') || this.#matchOp('/')) {
      const operator = this.#advance();
      const right = this.#parseUnary();

      if (operator.kind !== 'op') {
        throw new ValidationError('Expected multiplicative operator');
      }

      const leftNumber = this.#asNumber(value, 'multiplication');
      const rightNumber = this.#asNumber(right, 'multiplication');

      if (operator.value === '/' && rightNumber === 0) {
        throw new ValidationError('Division by zero');
      }

      value = operator.value === '*' ? leftNumber * rightNumber : leftNumber / rightNumber;
    }

    return value;
  }

  /**
   * unary → ( '!' | '-' ) unary | primary
   *
   * @returns The scalar value.
   */
  #parseUnary(): AliasScalar {
    this.#tick();

    if (this.#matchOp('!')) {
      this.#advance();
      return !this.#isTruthy(this.#parseUnary());
    }

    if (this.#matchOp('-')) {
      this.#advance();
      return -this.#asNumber(this.#parseUnary(), 'negation');
    }

    return this.#parsePrimary();
  }

  /**
   * primary → number | string | boolean | ident | '(' ternary ')'
   *
   * Deliberately no `.`, `[]`, or call forms: a binding is a scalar, not an object.
   *
   * @returns The scalar value.
   * @throws {ValidationError} When a name is not bound, or the expression ends too soon.
   */
  #parsePrimary(): AliasScalar {
    this.#tick();
    const token = this.#current();

    if (token.kind === 'number' || token.kind === 'string' || token.kind === 'boolean') {
      this.#advance();
      return token.value;
    }

    if (token.kind === 'ident') {
      this.#advance();
      const bound = this.#bindings.get(token.value);

      if (bound === undefined) {
        throw new ValidationError(`Unknown variable ${token.value}`);
      }

      return bound;
    }

    if (token.kind === 'op' && token.value === '(') {
      this.#advance();
      const value = this.#parseTernary();
      this.#expect(')');
      return value;
    }

    throw new ValidationError('Expected a value in expression');
  }

  /**
   * Coerces a scalar to a number for an arithmetic or comparison operator.
   *
   * @param value - The operand.
   * @param operation - What failed, for the message.
   * @returns The number.
   * @throws {ValidationError} When the operand is not numeric.
   */
  #asNumber(value: AliasScalar, operation: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ValidationError(`Operand of ${operation} must be a finite number`);
    }

    return value;
  }

  /**
   * Truthiness for `&&`, `||`, `!` and the ternary condition.
   *
   * @param value - The scalar.
   * @returns Whether it is truthy.
   */
  #isTruthy(value: AliasScalar): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'number') {
      return value !== 0;
    }

    return value.length > 0;
  }

  /**
   * Rejects non-finite numbers and truncates long text results.
   *
   * @param value - The raw result.
   * @returns The value safe to write into entity state.
   * @throws {ValidationError} When the result is NaN or Infinity.
   */
  #finalise(value: AliasScalar): AliasScalar {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new ValidationError('Expression produced a non-finite number');
      }

      return value;
    }

    if (typeof value === 'string' && value.length > MAX_TEXT_RESULT) {
      return value.slice(0, MAX_TEXT_RESULT);
    }

    return value;
  }
}

/**
 * Evaluates an alias expression against named scalar bindings.
 *
 * @param expression - The formula text.
 * @param bindings - Variable names to scalars. Only these names may appear as identifiers.
 * @param limits - Optional step and time ceilings.
 * @returns The result, or a structured error that never includes source entity state.
 */
export function evaluateAliasExpression(
  expression: string,
  bindings: ReadonlyMap<string, AliasScalar>,
  limits: AliasEvaluateLimits = DEFAULT_ALIAS_EVALUATE_LIMITS,
): AliasEvaluateResult {
  try {
    const tokens = tokenise(expression);
    const value = new Evaluator(tokens, bindings, limits).evaluate();
    return { ok: true, value };
  } catch (error) {
    const message =
      error instanceof ValidationError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Expression evaluation failed';

    return { ok: false, error: message };
  }
}

/**
 * The scalar a formula variable binds to, read from a source entity's capability state.
 *
 * Only the primary reading of each capability is used - never the whole state object - so an
 * expression cannot reach attributes or nested fields through a variable. One function for the
 * engine in `core` and the preview in the API, so that a preview says what the alias will do.
 *
 * @param state - The entity's capability state, or undefined when it never reported.
 * @returns The scalar, or undefined when nothing usable is present.
 */
export function aliasScalarFromState(state: CapabilityState | undefined): AliasScalar | undefined {
  if (state === undefined) {
    return undefined;
  }

  if (state.sensor_numeric !== undefined) {
    return state.sensor_numeric.value;
  }

  if (state.sensor_binary !== undefined) {
    return state.sensor_binary.isOn;
  }

  if (state.sensor_text !== undefined) {
    return state.sensor_text.value;
  }

  if (state.on_off !== undefined) {
    return state.on_off.isOn;
  }

  if (state.level !== undefined) {
    return state.level.level;
  }

  if (state.cover !== undefined) {
    return state.cover.position;
  }

  if (state.lock !== undefined) {
    return state.lock.lockState === 'locked';
  }

  if (state.thermostat !== undefined) {
    return state.thermostat.currentTemperature;
  }

  if (state.media_player !== undefined) {
    return state.media_player.volume;
  }

  return undefined;
}
