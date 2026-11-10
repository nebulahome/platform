/**
 * Sandboxed evaluation of alias formulas.
 *
 * Alias expressions are owner input. They are evaluated here with a recursive-descent parser
 * that never calls `eval` or `new Function` (RULES.md §16, ARCHITECTURE.md §6.3). The only
 * values in scope are the scalar bindings the caller passed - plain names (`t1`) or entity ids
 * (`sensor.kitchen`, `climate.hall.current_temperature`), each bound by the caller to one scalar -
 * and a few pure functions (`avg`, `min`, `max`, `sum`, `abs`, `round`, `clamp`). There is no
 * indexing, no method call, and no way to reach the house's state through the expression itself.
 */
import type { CapabilityState } from './capabilities.js';
import { ValidationError } from './errors.js';

/** A scalar an expression may read or produce. */
export type AliasScalar = number | boolean | string;

/**
 * A binding's value: a scalar, or null when the entity has none now (unavailable, never
 * reported). A function that combines values (`avg`, `min`, `max`, `sum`) leaves a null out; any
 * other use of one fails, naming it.
 */
export type AliasBinding = AliasScalar | null;

/** One function a formula may call. */
export type AliasFormulaFunction = {
  readonly name: string;

  /** How it is called, e.g. `round(x, digits)`. */
  readonly signature: string;

  /** What it does, in one English line. */
  readonly summary: string;

  /** A formula that uses it. */
  readonly example: string;
};

/** The functions a formula may call, for the editor's help and completion. */
export const ALIAS_FORMULA_FUNCTIONS: readonly AliasFormulaFunction[] = [
  {
    name: 'avg',
    signature: 'avg(a, b, …)',
    summary: 'The average of the numbers; one with no value is left out',
    example: 'avg(sensor.living_room_temperature, sensor.kitchen_temperature)',
  },
  {
    name: 'min',
    signature: 'min(a, b, …)',
    summary: 'The smallest of the numbers',
    example: 'min(sensor.bedroom_temperature, sensor.office_temperature)',
  },
  {
    name: 'max',
    signature: 'max(a, b, …)',
    summary: 'The largest of the numbers',
    example: 'max(sensor.bedroom_temperature, sensor.office_temperature)',
  },
  {
    name: 'sum',
    signature: 'sum(a, b, …)',
    summary: 'The numbers added up',
    example: 'sum(sensor.solar_power, sensor.battery_power)',
  },
  {
    name: 'abs',
    signature: 'abs(x)',
    summary: 'The number without its sign',
    example: 'abs(sensor.grid_power)',
  },
  {
    name: 'round',
    signature: 'round(x, digits)',
    summary: 'The number rounded, to whole units or to that many decimals',
    example: 'round(sensor.humidity, 1)',
  },
  {
    name: 'clamp',
    signature: 'clamp(x, low, high)',
    summary: 'The number kept between two limits',
    example: 'clamp(sensor.setpoint, 16, 24)',
  },
];

/** The functions' names. */
const FUNCTION_NAMES: ReadonlySet<string> = new Set(
  ALIAS_FORMULA_FUNCTIONS.map((entry) => entry.name),
);

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

/** A value while an expression is worked out: a scalar, or a binding with no value. */
type Val = AliasScalar | null;

/** One piece of an expression, as the tokeniser cut it. */
type Token =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'ident'; readonly value: string }
  | { readonly kind: 'op'; readonly value: string }
  | { readonly kind: 'eof' };

/**
 * Whether a character continues a name, or a segment of an entity id after a dot.
 *
 * @param character - One character, or empty past the end.
 * @returns True for a letter, a digit or an underscore.
 */
function isNamePart(character: string): boolean {
  return (
    (character >= 'a' && character <= 'z') ||
    (character >= 'A' && character <= 'Z') ||
    (character >= '0' && character <= '9') ||
    character === '_'
  );
}

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

      while (isNamePart(peek())) {
        lexeme += advance();
      }

      // An entity id is one name: `sensor.kitchen`, `climate.hall.current_temperature`.
      while (peek() === '.' && isNamePart(source[index + 1] ?? '')) {
        lexeme += advance();

        while (isNamePart(peek())) {
          lexeme += advance();
        }
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

    if ('+-*/()<>=!?:,'.includes(character)) {
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
  readonly #bindings: ReadonlyMap<string, AliasBinding>;
  readonly #limits: AliasEvaluateLimits;
  readonly #startedAt: number;
  #position = 0;
  #steps = 0;

  /** The last binding read that had no value, to name it when an operator needs one. */
  #missing: string | undefined;

  /**
   * @param tokens - The token stream, including a trailing `eof`.
   * @param bindings - Variable names to scalars; the only values the expression may read.
   * @param limits - Step and time ceilings.
   */
  public constructor(
    tokens: readonly Token[],
    bindings: ReadonlyMap<string, AliasBinding>,
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
    return this.#finalise(this.#present(value));
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
  #parseTernary(): Val {
    this.#tick();
    let value = this.#parseLogicOr();

    if (this.#matchOp('?')) {
      this.#advance();
      const whenTrue = this.#parseTernary();
      this.#expect(':');
      const whenFalse = this.#parseTernary();
      value = this.#isTruthy(this.#present(value)) ? whenTrue : whenFalse;
    }

    return value;
  }

  /**
   * logicOr → logicAnd ( '||' logicAnd )*
   *
   * @returns The scalar value.
   */
  #parseLogicOr(): Val {
    this.#tick();
    let value = this.#parseLogicAnd();

    while (this.#matchOp('||')) {
      this.#advance();
      const right = this.#parseLogicAnd();
      value = this.#isTruthy(this.#present(value)) || this.#isTruthy(this.#present(right));
    }

    return value;
  }

  /**
   * logicAnd → equality ( '&&' equality )*
   *
   * @returns The scalar value.
   */
  #parseLogicAnd(): Val {
    this.#tick();
    let value = this.#parseEquality();

    while (this.#matchOp('&&')) {
      this.#advance();
      const right = this.#parseEquality();
      value = this.#isTruthy(this.#present(value)) && this.#isTruthy(this.#present(right));
    }

    return value;
  }

  /**
   * equality → comparison ( ( '==' | '!=' ) comparison )*
   *
   * @returns The scalar value.
   * @throws {ValidationError} When an operand is not of the type the operator takes.
   */
  #parseEquality(): Val {
    this.#tick();
    let value = this.#parseComparison();

    while (this.#matchOp('==') || this.#matchOp('!=')) {
      const operator = this.#advance();
      const right = this.#parseComparison();

      if (operator.kind !== 'op') {
        throw new ValidationError('Expected comparison operator');
      }

      const left = this.#present(value);
      const other = this.#present(right);
      value = operator.value === '==' ? left === other : left !== other;
    }

    return value;
  }

  /**
   * comparison → term ( ( '<' | '<=' | '>' | '>=' ) term )*
   *
   * @returns The scalar value.
   * @throws {ValidationError} When an operand is not of the type the operator takes.
   */
  #parseComparison(): Val {
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
  #parseTerm(): Val {
    this.#tick();
    let value = this.#parseFactor();

    while (this.#matchOp('+') || this.#matchOp('-')) {
      const operator = this.#advance();
      const right = this.#parseFactor();

      if (operator.kind !== 'op') {
        throw new ValidationError('Expected additive operator');
      }

      if (operator.value === '+' && (typeof value === 'string' || typeof right === 'string')) {
        value = String(this.#present(value)) + String(this.#present(right));
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
  #parseFactor(): Val {
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
  #parseUnary(): Val {
    this.#tick();

    if (this.#matchOp('!')) {
      this.#advance();
      return !this.#isTruthy(this.#present(this.#parseUnary()));
    }

    if (this.#matchOp('-')) {
      this.#advance();
      return -this.#asNumber(this.#parseUnary(), 'negation');
    }

    return this.#parsePrimary();
  }

  /**
   * primary → number | string | boolean | ident | function '(' args ')' | '(' ternary ')'
   *
   * No `[]` or method forms: a binding is a scalar, not an object; the only calls are the pure
   * functions of {@link ALIAS_FORMULA_FUNCTIONS}.
   *
   * @returns The scalar value, or null for a binding with no value.
   * @throws {ValidationError} When a name is not bound, or the expression ends too soon.
   */
  #parsePrimary(): Val {
    this.#tick();
    const token = this.#current();

    if (token.kind === 'number' || token.kind === 'string' || token.kind === 'boolean') {
      this.#advance();
      return token.value;
    }

    if (token.kind === 'ident') {
      this.#advance();

      if (this.#matchOp('(')) {
        return this.#call(token.value);
      }

      const bound = this.#bindings.get(token.value);

      if (bound === undefined) {
        throw new ValidationError(
          token.value.includes('.')
            ? `${token.value} is not read here`
            : `Unknown variable ${token.value}`,
        );
      }

      if (bound === null) {
        this.#missing = token.value;
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
  #asNumber(value: Val, operation: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.#present(value);
      throw new ValidationError(`Operand of ${operation} must be a finite number`);
    }

    return value;
  }

  /**
   * A value an operator needs, which a binding with no value is not.
   *
   * @param value - The operand.
   * @returns It, when it is there.
   * @throws {ValidationError} When it is a binding with no value, naming it.
   */
  #present(value: Val): AliasScalar {
    if (value === null) {
      throw new ValidationError(`${this.#missing ?? 'A source'} has no value`);
    }

    return value;
  }

  /**
   * Calls one of the formula functions with the arguments that follow.
   *
   * @param name - The function's name.
   * @returns What it gives.
   * @throws {ValidationError} When the function is unknown, or its arguments do not fit.
   */
  #call(name: string): Val {
    if (!FUNCTION_NAMES.has(name)) {
      throw new ValidationError(`Unknown function ${name}`);
    }

    this.#expect('(');
    const args: Val[] = [];

    if (!this.#matchOp(')')) {
      args.push(this.#parseTernary());

      while (this.#matchOp(',')) {
        this.#advance();
        args.push(this.#parseTernary());
      }
    }

    this.#expect(')');

    /**
     * The arguments as numbers, those with no value left out.
     *
     * @returns The numbers.
     * @throws {ValidationError} When none has a value, or one is not a number.
     */
    const numbers = (): number[] => {
      const present = args.filter((arg) => arg !== null);

      if (present.length === 0) {
        throw new ValidationError(`${name}() got no values`);
      }

      return present.map((arg) => this.#asNumber(arg, `${name}()`));
    };
    /**
     * Requires the call to have as many arguments as the function takes.
     *
     * @param low - The fewest.
     * @param high - The most.
     * @throws {ValidationError} When the count is off.
     */
    const arity = (low: number, high: number): void => {
      if (args.length < low || args.length > high) {
        throw new ValidationError(
          low === high
            ? `${name}() takes ${String(low)} value${low === 1 ? '' : 's'}`
            : `${name}() takes ${String(low)} to ${String(high)} values`,
        );
      }
    };

    switch (name) {
      case 'avg': {
        const values = numbers();
        return values.reduce((total, value) => total + value, 0) / values.length;
      }
      case 'min':
        return Math.min(...numbers());
      case 'max':
        return Math.max(...numbers());
      case 'sum':
        return numbers().reduce((total, value) => total + value, 0);
      case 'abs':
        arity(1, 1);
        return Math.abs(this.#asNumber(args[0] ?? null, 'abs()'));
      case 'round': {
        arity(1, 2);
        const digits = args[1] === undefined ? 0 : this.#asNumber(args[1], 'round()');
        const factor = 10 ** Math.max(0, Math.min(10, Math.trunc(digits)));
        return Math.round(this.#asNumber(args[0] ?? null, 'round()') * factor) / factor;
      }
      default: {
        arity(3, 3);
        const value = this.#asNumber(args[0] ?? null, 'clamp()');
        const low = this.#asNumber(args[1] ?? null, 'clamp()');
        const high = this.#asNumber(args[2] ?? null, 'clamp()');
        return Math.min(high, Math.max(low, value));
      }
    }
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
 * @param bindings - Names or entity ids to scalars (null: no value now). Only these names may
 *   appear as identifiers.
 * @param limits - Optional step and time ceilings.
 * @returns The result, or a structured error that never includes source entity state.
 */
export function evaluateAliasExpression(
  expression: string,
  bindings: ReadonlyMap<string, AliasBinding>,
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
 * The names a formula reads: its variables and entity ids, without its functions.
 *
 * What `core` binds before evaluating, and what an alias reads (its inputs, the entities that
 * cannot be removed while it reads them). A formula that does not tokenise reads nothing.
 *
 * @param expression - The formula text.
 * @returns The names, in order of first use, each once.
 */
export function aliasExpressionNames(expression: string): string[] {
  let tokens: Token[];

  try {
    tokens = tokenise(expression);
  } catch {
    return [];
  }

  const names: string[] = [];

  tokens.forEach((token, index) => {
    const next = tokens[index + 1];
    const isCall = next?.kind === 'op' && next.value === '(';

    if (token.kind === 'ident' && !isCall && !names.includes(token.value)) {
      names.push(token.value);
    }
  });

  return names;
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

/** What one stretch of a formula is, as an editor colours it. */
export type AliasSpanKind =
  'space' | 'number' | 'string' | 'boolean' | 'ident' | 'function' | 'op' | 'invalid';

/** One stretch of a formula: where it starts and ends, and what it is. */
export type AliasExpressionSpan = {
  /** The index of its first character. */
  readonly start: number;

  /** The index after its last character. */
  readonly end: number;

  readonly kind: AliasSpanKind;
};

/**
 * Whether a character can start an identifier.
 *
 * @param character - One character, or empty past the end.
 * @returns True for a letter or an underscore.
 */
function isIdentStart(character: string): boolean {
  return (
    (character >= 'a' && character <= 'z') ||
    (character >= 'A' && character <= 'Z') ||
    character === '_'
  );
}

/**
 * Whether a character can continue an identifier.
 *
 * @param character - One character, or empty past the end.
 * @returns True for a letter, a digit or an underscore.
 */
function isIdentPart(character: string): boolean {
  return isIdentStart(character) || (character >= '0' && character <= '9');
}

/**
 * Cuts a formula into the stretches an editor colours, the way the tokeniser reads it.
 *
 * The same character rules as {@link evaluateAliasExpression}'s tokeniser, but it never throws: a
 * formula is half-written most of the time it is on screen, and an editor that could colour only
 * valid formulas would flicker to plain text at every keystroke. What the tokeniser would refuse -
 * a stray character, a string with no closing quote - comes back as `invalid`, so the editor can
 * mark the place instead of going blank. The spans cover the text exactly, end to end.
 *
 * @param source - The formula as typed.
 * @returns The spans, in order.
 */
export function scanAliasExpression(source: string): AliasExpressionSpan[] {
  const spans: AliasExpressionSpan[] = [];
  let index = 0;

  /**
   * Records a span from `start` to where the cursor now is.
   *
   * @param start - Where it began.
   * @param kind - What it is.
   */
  const push = (start: number, kind: AliasSpanKind): void => {
    spans.push({ start, end: index, kind });
  };

  while (index < source.length) {
    const start = index;
    const character = source[index] ?? '';

    if (character === ' ' || character === '\t' || character === '\n' || character === '\r') {
      while (index < source.length && ' \t\n\r'.includes(source[index] ?? '')) {
        index += 1;
      }

      push(start, 'space');
      continue;
    }

    if (character >= '0' && character <= '9') {
      while (index < source.length && /[0-9.]/u.test(source[index] ?? '')) {
        index += 1;
      }

      push(start, Number.isFinite(Number(source.slice(start, index))) ? 'number' : 'invalid');
      continue;
    }

    if (character === '"' || character === "'") {
      index += 1;

      while (index < source.length && source[index] !== character) {
        index += source[index] === '\\' ? 2 : 1;
      }

      const isClosed = index < source.length;

      index = Math.min(source.length, index + 1);
      push(start, isClosed ? 'string' : 'invalid');
      continue;
    }

    if (isIdentStart(character)) {
      while (index < source.length && isIdentPart(source[index] ?? '')) {
        index += 1;
      }

      while (source[index] === '.' && isIdentPart(source[index + 1] ?? '')) {
        index += 1;

        while (index < source.length && isIdentPart(source[index] ?? '')) {
          index += 1;
        }
      }

      const word = source.slice(start, index);
      const isCall = FUNCTION_NAMES.has(word) && /^\s*\(/u.test(source.slice(index));

      push(start, word === 'true' || word === 'false' ? 'boolean' : isCall ? 'function' : 'ident');
      continue;
    }

    const two = source.slice(index, index + 2);

    if (['&&', '||', '==', '!=', '<=', '>='].includes(two)) {
      index += 2;
      push(start, 'op');
      continue;
    }

    index += 1;
    push(start, '+-*/()<>=!?:,'.includes(character) ? 'op' : 'invalid');
  }

  return spans;
}
