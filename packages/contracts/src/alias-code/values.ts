/**
 * The runtime values of alias code, and Python's semantics for operating on them.
 *
 * None, bool and str are JavaScript's null, boolean and string. Numbers are tagged `int` or
 * `float` so that `7 / 2` shows 3.5 and `4 / 2` shows 2.0 as Python does, though both are
 * JavaScript numbers underneath. Lists, tuples and dicts (string keys only) are plain objects;
 * a Time is an instant with the house's zone; a Response is what an HTTP call answered.
 */
import type { JsonObject, JsonValue } from '../json.js';

import { CodeRunError } from './errors.js';
import { isoFormat } from './time.js';

/** An int. */
export type PyInt = { readonly kind: 'int'; readonly value: number };

/** A float. */
export type PyFloat = { readonly kind: 'float'; readonly value: number };

/** A list: mutable. */
export type PyList = { readonly kind: 'list'; readonly items: PyValue[] };

/** A tuple. */
export type PyTuple = { readonly kind: 'tuple'; readonly items: readonly PyValue[] };

/** A dict with string keys, in insertion order. */
export type PyDict = { readonly kind: 'dict'; readonly entries: Map<string, PyValue> };

/** An instant, shown in the house's time zone. */
export type PyTime = { readonly kind: 'time'; readonly ms: number; readonly zone: string };

/** What an HTTP request answered. */
export type PyResponse = {
  readonly kind: 'response';
  readonly status: number;
  readonly text: string;
  readonly headers: PyDict;
};

/** A def of the code, by name. */
export type PyFunction = { readonly kind: 'function'; readonly name: string };

/** A builtin function, by name. */
export type PyBuiltin = { readonly kind: 'builtin'; readonly name: string };

/** Any value code can hold. */
export type PyValue =
  | null
  | boolean
  | string
  | PyInt
  | PyFloat
  | PyList
  | PyTuple
  | PyDict
  | PyTime
  | PyResponse
  | PyFunction
  | PyBuiltin;

/** A value that is an object, not None, a bool or a str. */
export type PyObject = Exclude<PyValue, null | boolean | string>;

/** How big a list or a string code builds may grow. */
export type ValueLimits = {
  readonly listLength: number;
  readonly stringLength: number;
};

/** A number as arithmetic sees it: its value, and whether it is an int (a bool counts). */
export type Numeric = { readonly value: number; readonly isInt: boolean };

/** An arithmetic operator. */
export type ArithmeticOperator = '+' | '-' | '*' | '/' | '//' | '%' | '**';

/**
 * Formats a count with a space between thousands, for limit messages.
 *
 * @param value - The count.
 * @returns For example `10 000`.
 */
export function thousands(value: number): string {
  return String(value).replaceAll(/\B(?=(\d{3})+(?!\d))/gu, ' ');
}

/**
 * Whether a value is an object.
 *
 * @param value - The value.
 * @returns True for every value but None, a bool and a str.
 */
export function isObject(value: PyValue): value is PyObject {
  return value !== null && typeof value === 'object';
}

/**
 * An int.
 *
 * @param value - Its value.
 * @returns The int.
 */
export function int(value: number): PyInt {
  return { kind: 'int', value: value === 0 ? 0 : value };
}

/**
 * A float.
 *
 * @param value - Its value.
 * @returns The float.
 */
export function float(value: number): PyFloat {
  return { kind: 'float', value };
}

/**
 * A number from arithmetic, refusing one that overflowed.
 *
 * @param value - The result.
 * @param isInt - Whether it is an int.
 * @returns The value.
 * @throws {CodeRunError} When it is not finite.
 */
export function number(value: number, isInt: boolean): PyInt | PyFloat {
  if (!Number.isFinite(value)) {
    throw new CodeRunError(Number.isNaN(value) ? 'math domain error' : 'number is too large');
  }

  return isInt ? int(value) : float(value);
}

/**
 * A number from outside: an int when it has no fraction.
 *
 * @param value - The number.
 * @returns The value, or None when it is not finite.
 */
export function fromNumber(value: number): PyValue {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Number.isInteger(value) ? int(value) : float(value);
}

/**
 * A list, refusing one longer than the limit.
 *
 * @param items - Its items.
 * @param limits - The limits.
 * @returns The list.
 * @throws {CodeRunError} When it is too long.
 */
export function list(items: PyValue[], limits: ValueLimits): PyList {
  if (items.length > limits.listLength) {
    throw new CodeRunError(`list is longer than ${thousands(limits.listLength)} items`);
  }

  return { kind: 'list', items };
}

/**
 * A tuple.
 *
 * @param items - Its items.
 * @returns The tuple.
 */
export function tuple(items: readonly PyValue[]): PyTuple {
  return { kind: 'tuple', items };
}

/**
 * A dict.
 *
 * @param entries - Its entries.
 * @returns The dict.
 */
export function dict(entries = new Map<string, PyValue>()): PyDict {
  return { kind: 'dict', entries };
}

/**
 * A Time.
 *
 * @param ms - The instant.
 * @param zone - The house's zone.
 * @returns The Time.
 */
export function time(ms: number, zone: string): PyTime {
  return { kind: 'time', ms, zone };
}

/**
 * A string code built, refusing one longer than the limit.
 *
 * @param value - The string.
 * @param limits - The limits.
 * @returns The same string.
 * @throws {CodeRunError} When it is too long.
 */
export function text(value: string, limits: ValueLimits): string {
  if (value.length > limits.stringLength) {
    throw new CodeRunError(`str is longer than ${thousands(limits.stringLength)} characters`);
  }

  return value;
}

/**
 * The Python name of a value's type, for messages.
 *
 * @param value - The value.
 * @returns For example `int`, `str` or `None`.
 */
export function typeName(value: PyValue): string {
  if (value === null) {
    return 'None';
  }

  if (typeof value === 'boolean') {
    return 'bool';
  }

  if (typeof value === 'string') {
    return 'str';
  }

  switch (value.kind) {
    case 'time': {
      return 'Time';
    }
    case 'response': {
      return 'Response';
    }
    case 'builtin': {
      return 'function';
    }
    default: {
      return value.kind;
    }
  }
}

/**
 * The number in a value, when arithmetic takes it: an int, a float, or a bool as 0 or 1.
 *
 * @param value - The value.
 * @returns The number, or null for any other value.
 */
export function numeric(value: PyValue): Numeric | null {
  if (typeof value === 'boolean') {
    return { value: value ? 1 : 0, isInt: true };
  }

  if (isObject(value) && (value.kind === 'int' || value.kind === 'float')) {
    return { value: value.value, isInt: value.kind === 'int' };
  }

  return null;
}

/**
 * Python truthiness.
 *
 * @param value - The value.
 * @returns False for None, False, zero, an empty str, list, tuple or dict, and a failed Response.
 */
export function truthy(value: PyValue): boolean {
  if (value === null) {
    return false;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return value.length > 0;
  }

  switch (value.kind) {
    case 'int':
    case 'float': {
      return value.value !== 0;
    }
    case 'list':
    case 'tuple': {
      return value.items.length > 0;
    }
    case 'dict': {
      return value.entries.size > 0;
    }
    case 'response': {
      return isOkStatus(value.status);
    }
    default: {
      return true;
    }
  }
}

/**
 * Whether an HTTP status is a success.
 *
 * @param status - The status.
 * @returns True for 200 to 299.
 */
export function isOkStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * Python `==`: numbers by value (True == 1), lists, tuples and dicts deeply.
 *
 * @param left - One value.
 * @param right - The other.
 * @returns Whether they are equal.
 */
export function equals(left: PyValue, right: PyValue): boolean {
  if (left === right) {
    return true;
  }

  const leftNumber = numeric(left);
  const rightNumber = numeric(right);

  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber.value === rightNumber.value;
  }

  if (!isObject(left) || !isObject(right) || left.kind !== right.kind) {
    return false;
  }

  if ((left.kind === 'list' || left.kind === 'tuple') && 'items' in right) {
    return (
      left.items.length === right.items.length &&
      left.items.every((item, index) => equals(item, right.items[index] ?? null))
    );
  }

  if (left.kind === 'dict' && right.kind === 'dict') {
    if (left.entries.size !== right.entries.size) {
      return false;
    }

    for (const [key, value] of left.entries) {
      const other = right.entries.get(key);

      if (other === undefined || !equals(value, other)) {
        return false;
      }
    }

    return true;
  }

  return left.kind === 'time' && right.kind === 'time' && left.ms === right.ms;
}

/**
 * The sign of a difference.
 *
 * @param difference - A number.
 * @returns -1, 0 or 1.
 */
function signOf(difference: number): number {
  return difference < 0 ? -1 : difference > 0 ? 1 : 0;
}

/**
 * Python ordering, for `<`, sorting, min and max.
 *
 * @param left - One value.
 * @param right - The other.
 * @param operator - The operator, for the message.
 * @returns Negative, zero or positive.
 * @throws {CodeRunError} When the two cannot be ordered.
 */
export function order(left: PyValue, right: PyValue, operator = '<'): number {
  const leftNumber = numeric(left);
  const rightNumber = numeric(right);

  if (leftNumber !== null && rightNumber !== null) {
    return signOf(leftNumber.value - rightNumber.value);
  }

  if (typeof left === 'string' && typeof right === 'string') {
    return left < right ? -1 : left > right ? 1 : 0;
  }

  if (isObject(left) && isObject(right)) {
    if (left.kind === 'time' && right.kind === 'time') {
      return signOf(left.ms - right.ms);
    }

    if (
      (left.kind === 'list' && right.kind === 'list') ||
      (left.kind === 'tuple' && right.kind === 'tuple')
    ) {
      const length = Math.min(left.items.length, right.items.length);

      for (let index = 0; index < length; index += 1) {
        const a = left.items[index] ?? null;
        const b = right.items[index] ?? null;

        if (!equals(a, b)) {
          return order(a, b, operator);
        }
      }

      return signOf(left.items.length - right.items.length);
    }
  }

  throw new CodeRunError(
    `unsupported comparison: ${typeName(left)} ${operator} ${typeName(right)}`,
  );
}

/**
 * Whether a container holds an item, for `in`.
 *
 * @param container - A str, list, tuple or dict.
 * @param item - What to look for.
 * @returns Whether it is there.
 * @throws {CodeRunError} When the container cannot hold anything.
 */
export function contains(container: PyValue, item: PyValue): boolean {
  if (typeof container === 'string') {
    if (typeof item !== 'string') {
      throw new CodeRunError(`'in <str>' needs a str on the left, got ${typeName(item)}`);
    }

    return container.includes(item);
  }

  if (isObject(container)) {
    if (container.kind === 'list' || container.kind === 'tuple') {
      return container.items.some((candidate) => equals(candidate, item));
    }

    if (container.kind === 'dict') {
      return typeof item === 'string' && container.entries.has(item);
    }
  }

  throw new CodeRunError(`'in' needs a str, list, tuple or dict, got ${typeName(container)}`);
}

/**
 * Python `is`: the same object; for numbers, the same kind and value.
 *
 * @param left - One value.
 * @param right - The other.
 * @returns Whether they are identical.
 */
export function identical(left: PyValue, right: PyValue): boolean {
  if (
    isObject(left) &&
    isObject(right) &&
    (left.kind === 'int' || left.kind === 'float') &&
    left.kind === right.kind
  ) {
    return left.value === right.value;
  }

  return left === right;
}

/**
 * A comparison operator applied.
 *
 * @param operator - The operator.
 * @param left - The left operand.
 * @param right - The right operand.
 * @returns Whether it holds.
 */
export function compare(operator: string, left: PyValue, right: PyValue): boolean {
  switch (operator) {
    case '==': {
      return equals(left, right);
    }
    case '!=': {
      return !equals(left, right);
    }
    case 'in': {
      return contains(right, left);
    }
    case 'not in': {
      return !contains(right, left);
    }
    case 'is': {
      return identical(left, right);
    }
    case 'is not': {
      return !identical(left, right);
    }
    case '<': {
      return order(left, right, operator) < 0;
    }
    case '<=': {
      return order(left, right, operator) <= 0;
    }
    case '>': {
      return order(left, right, operator) > 0;
    }
    default: {
      return order(left, right, operator) >= 0;
    }
  }
}

/**
 * Python floor division of two numbers, exact for floats as CPython's `divmod`.
 *
 * @param left - The dividend.
 * @param right - The divisor, not zero.
 * @returns The floored quotient.
 */
function floorDivide(left: number, right: number): number {
  const remainder = left % right;
  let quotient = (left - remainder) / right;

  if (remainder !== 0 && right < 0 !== remainder < 0) {
    quotient -= 1;
  }

  if (quotient === 0) {
    return 0;
  }

  const floored = Math.floor(quotient);
  return quotient - floored > 0.5 ? floored + 1 : floored;
}

/**
 * Python modulo: the result takes the sign of the divisor.
 *
 * @param left - The dividend.
 * @param right - The divisor, not zero.
 * @returns The remainder.
 */
function modulo(left: number, right: number): number {
  const remainder = left % right;
  return remainder !== 0 && right < 0 !== remainder < 0 ? remainder + right : remainder + 0;
}

/**
 * An arithmetic operator applied to two numbers.
 *
 * @param operator - The operator.
 * @param left - The left number.
 * @param right - The right number.
 * @returns The result: an int when both are ints and the operator keeps ints.
 * @throws {CodeRunError} On division by zero, a complex power, or overflow.
 */
function arithmetic(operator: ArithmeticOperator, left: Numeric, right: Numeric): PyInt | PyFloat {
  const bothInt = left.isInt && right.isInt;

  switch (operator) {
    case '+': {
      return number(left.value + right.value, bothInt);
    }
    case '-': {
      return number(left.value - right.value, bothInt);
    }
    case '*': {
      return number(left.value * right.value, bothInt);
    }
    case '**': {
      if (left.value === 0 && right.value < 0) {
        throw new CodeRunError('division by zero');
      }

      if (left.value < 0 && !Number.isInteger(right.value)) {
        throw new CodeRunError('a negative number to a fractional power is a complex number');
      }

      return number(left.value ** right.value, bothInt && right.value >= 0);
    }
    default: {
      break;
    }
  }

  if (right.value === 0) {
    throw new CodeRunError('division by zero');
  }

  switch (operator) {
    case '/': {
      return number(left.value / right.value, false);
    }
    case '//': {
      return number(floorDivide(left.value, right.value), bothInt);
    }
    default: {
      return number(modulo(left.value, right.value), bothInt);
    }
  }
}

/**
 * A sequence repeated: `"ab" * 3`, `[0] * 5`.
 *
 * @param sequence - The str, list or tuple.
 * @param count - How many times.
 * @param limits - The size limits.
 * @returns The repeated sequence.
 * @throws {CodeRunError} When the count is not an int or the result is too big.
 */
function repeat(sequence: string | PyList | PyTuple, count: PyValue, limits: ValueLimits): PyValue {
  const times = numeric(count);

  if (!times?.isInt) {
    throw new CodeRunError(`can't multiply a sequence by ${typeName(count)}`);
  }

  const n = Math.max(0, times.value);

  if (typeof sequence === 'string') {
    if (sequence.length * n > limits.stringLength) {
      throw new CodeRunError(`str is longer than ${thousands(limits.stringLength)} characters`);
    }

    return sequence.repeat(n);
  }

  if (sequence.items.length * n > limits.listLength) {
    throw new CodeRunError(`list is longer than ${thousands(limits.listLength)} items`);
  }

  const items: PyValue[] = [];

  for (let index = 0; index < n; index += 1) {
    items.push(...sequence.items);
  }

  return sequence.kind === 'list' ? list(items, limits) : tuple(items);
}

/**
 * A binary operator applied, with Python's rules for numbers, strings, lists and tuples.
 *
 * @param operator - The operator.
 * @param left - The left operand.
 * @param right - The right operand.
 * @param limits - The size limits for what it builds.
 * @returns The result.
 * @throws {CodeRunError} When the operand types do not take the operator.
 */
export function binaryOp(
  operator: ArithmeticOperator,
  left: PyValue,
  right: PyValue,
  limits: ValueLimits,
): PyValue {
  const leftNumber = numeric(left);
  const rightNumber = numeric(right);

  if (leftNumber !== null && rightNumber !== null) {
    return arithmetic(operator, leftNumber, rightNumber);
  }

  if (operator === '+') {
    if (typeof left === 'string' && typeof right === 'string') {
      return text(left + right, limits);
    }

    if (isObject(left) && isObject(right)) {
      if (left.kind === 'list' && right.kind === 'list') {
        return list([...left.items, ...right.items], limits);
      }

      if (left.kind === 'tuple' && right.kind === 'tuple') {
        return tuple([...left.items, ...right.items]);
      }
    }
  }

  if (operator === '*') {
    if (
      typeof left === 'string' ||
      (isObject(left) && (left.kind === 'list' || left.kind === 'tuple'))
    ) {
      return repeat(left, right, limits);
    }

    if (
      typeof right === 'string' ||
      (isObject(right) && (right.kind === 'list' || right.kind === 'tuple'))
    ) {
      return repeat(right, left, limits);
    }
  }

  throw new CodeRunError(`unsupported operand: ${typeName(left)} ${operator} ${typeName(right)}`);
}

/**
 * A unary operator applied.
 *
 * @param operator - `-`, `+` or `not`.
 * @param operand - The operand.
 * @returns The result.
 * @throws {CodeRunError} When `-` or `+` meets something that is not a number.
 */
export function unaryOp(operator: '-' | '+' | 'not', operand: PyValue): PyValue {
  if (operator === 'not') {
    return !truthy(operand);
  }

  const value = numeric(operand);

  if (value === null) {
    throw new CodeRunError(`unsupported operand: ${operator}${typeName(operand)}`);
  }

  return number(operator === '-' ? -value.value : value.value, value.isInt);
}

/**
 * The items a for loop, an unpacking or a builtin walks over.
 *
 * @param value - A str (its characters), a list, a tuple or a dict (its keys).
 * @returns A fresh array of the items.
 * @throws {CodeRunError} When the value is not iterable.
 */
export function iterate(value: PyValue): PyValue[] {
  if (typeof value === 'string') {
    return Array.from(value);
  }

  if (isObject(value)) {
    if (value.kind === 'list' || value.kind === 'tuple') {
      return [...value.items];
    }

    if (value.kind === 'dict') {
      return [...value.entries.keys()];
    }
  }

  throw new CodeRunError(`${typeName(value)} is not iterable`);
}

/**
 * An int index, read from a value.
 *
 * @param index - The value.
 * @param what - What is indexed, for the message.
 * @returns The integer.
 * @throws {CodeRunError} When it is not an int.
 */
function integerIndex(index: PyValue, what: string): number {
  const value = numeric(index);

  if (!value?.isInt) {
    throw new CodeRunError(`${what} indices must be integers, not ${typeName(index)}`);
  }

  return value.value;
}

/**
 * Where an index points, negative counting from the end.
 *
 * @param index - The index value.
 * @param length - The length of what is indexed.
 * @param what - Its type, for the message.
 * @returns The position.
 * @throws {CodeRunError} When it is out of range.
 */
function position(index: PyValue, length: number, what: string): number {
  const raw = integerIndex(index, what);
  const at = raw < 0 ? raw + length : raw;

  if (at < 0 || at >= length) {
    throw new CodeRunError(`${what} index out of range`);
  }

  return at;
}

/**
 * `container[index]`.
 *
 * @param container - A str, list, tuple or dict.
 * @param index - An int, or a str key for a dict.
 * @returns The item.
 * @throws {CodeRunError} When the index is out of range, the key is missing, or the value cannot
 *   be indexed.
 */
export function getItem(container: PyValue, index: PyValue): PyValue {
  if (typeof container === 'string') {
    return container.charAt(position(index, container.length, 'string'));
  }

  if (isObject(container)) {
    if (container.kind === 'list' || container.kind === 'tuple') {
      return container.items[position(index, container.items.length, container.kind)] ?? null;
    }

    if (container.kind === 'dict') {
      if (typeof index !== 'string') {
        throw new CodeRunError(`dict keys are str, got ${typeName(index)}`);
      }

      const value = container.entries.get(index);

      if (value === undefined) {
        throw new CodeRunError(`key ${repr(index)} not found`);
      }

      return value;
    }
  }

  throw new CodeRunError(`${typeName(container)} cannot be indexed`);
}

/**
 * `container[index] = value`.
 *
 * @param container - A list or a dict.
 * @param index - An int, or a str key for a dict.
 * @param value - The value.
 * @throws {CodeRunError} When the container is not mutable or the index is wrong.
 */
export function setItem(container: PyValue, index: PyValue, value: PyValue): void {
  if (isObject(container) && container.kind === 'list') {
    container.items[position(index, container.items.length, 'list')] = value;
    return;
  }

  if (isObject(container) && container.kind === 'dict') {
    if (typeof index !== 'string') {
      throw new CodeRunError(`dict keys must be str, got ${typeName(index)}`);
    }

    container.entries.set(index, value);
    return;
  }

  throw new CodeRunError(`${typeName(container)} does not support item assignment`);
}

/**
 * `container[lower:upper:step]`, with Python's clamping and negative steps.
 *
 * @param container - A str, list or tuple.
 * @param lower - The start, or None.
 * @param upper - The stop, or None.
 * @param step - The step, or None.
 * @returns The slice, of the same type.
 * @throws {CodeRunError} When the container cannot be sliced or the step is zero.
 */
export function sliceOf(
  container: PyValue,
  lower: PyValue,
  upper: PyValue,
  step: PyValue,
): PyValue {
  const isSequence =
    typeof container === 'string' ||
    (isObject(container) && (container.kind === 'list' || container.kind === 'tuple'));

  if (!isSequence) {
    throw new CodeRunError(`${typeName(container)} cannot be sliced`);
  }

  const items = typeof container === 'string' ? container.split('') : container.items;
  const length = items.length;
  const stride = step === null ? 1 : integerIndex(step, 'slice');

  if (stride === 0) {
    throw new CodeRunError('slice step cannot be zero');
  }

  /**
   * One bound of the slice, clamped as Python clamps it.
   *
   * @param bound - The bound value, or None.
   * @param fallback - What None means.
   * @returns The clamped index.
   */
  const clampBound = (bound: PyValue, fallback: number): number => {
    if (bound === null) {
      return fallback;
    }

    const raw = integerIndex(bound, 'slice');
    const at = raw < 0 ? raw + length : raw;

    return stride > 0 ? Math.min(Math.max(at, 0), length) : Math.min(Math.max(at, -1), length - 1);
  };

  const start = clampBound(lower, stride > 0 ? 0 : length - 1);
  const stop = clampBound(upper, stride > 0 ? length : -1);
  const picked: PyValue[] = [];

  for (let index = start; stride > 0 ? index < stop : index > stop; index += stride) {
    picked.push(items[index] ?? null);
  }

  if (typeof container === 'string') {
    return picked.filter((item) => typeof item === 'string').join('');
  }

  return container.kind === 'list' ? { kind: 'list', items: picked } : tuple(picked);
}

/**
 * Python's repr of a str.
 *
 * @param value - The string.
 * @param quote - The quote to use; Python's choice when null.
 * @returns The quoted, escaped string.
 */
function stringRepr(value: string, quote: string | null): string {
  const mark = quote ?? (value.includes("'") && !value.includes('"') ? '"' : "'");
  let shown = mark;

  for (const character of value) {
    if (character === mark || character === '\\') {
      shown += `\\${character}`;
    } else if (character === '\n') {
      shown += '\\n';
    } else if (character === '\r') {
      shown += '\\r';
    } else if (character === '\t') {
      shown += '\\t';
    } else if (character < ' ' || character === '\u007f') {
      shown += `\\x${character.charCodeAt(0).toString(16).padStart(2, '0')}`;
    } else {
      shown += character;
    }
  }

  return shown + mark;
}

/**
 * Python's repr of an int.
 *
 * @param value - The int.
 * @returns Its digits, never in exponent form.
 */
export function intRepr(value: number): string {
  return Math.abs(value) < 1e21 ? String(value) : BigInt(value).toString();
}

/**
 * Python's repr of a float: the shortest round-trip digits, `.0` on whole numbers, exponent form
 * below 1e-4 and from 1e16.
 *
 * @param value - The float.
 * @returns For example `2.0`, `0.1`, `1e+16`.
 */
export function floatRepr(value: number): string {
  if (Number.isNaN(value)) {
    return 'nan';
  }

  if (!Number.isFinite(value)) {
    return value > 0 ? 'inf' : '-inf';
  }

  if (value === 0) {
    return Object.is(value, -0) ? '-0.0' : '0.0';
  }

  const [mantissa = '0', exponentText = '0'] = value.toExponential().split('e');
  const exponent = Number(exponentText);

  if (exponent < -4 || exponent >= 16) {
    const digits = String(Math.abs(exponent)).padStart(2, '0');
    return `${mantissa}e${exponent < 0 ? '-' : '+'}${digits}`;
  }

  const fixed = String(value);
  return fixed.includes('.') ? fixed : `${fixed}.0`;
}

/**
 * Python's repr of any value.
 *
 * @param value - The value.
 * @param quote - The quote for strings; Python's choice when null. Chips use `"`.
 * @param seen - Containers already being shown, so a list that holds itself shows `[...]`.
 * @returns The text.
 */
export function repr(
  value: PyValue,
  quote: string | null = null,
  seen = new Set<PyObject>(),
): string {
  if (value === null) {
    return 'None';
  }

  if (typeof value === 'boolean') {
    return value ? 'True' : 'False';
  }

  if (typeof value === 'string') {
    return stringRepr(value, quote);
  }

  switch (value.kind) {
    case 'int': {
      return intRepr(value.value);
    }
    case 'float': {
      return floatRepr(value.value);
    }
    case 'time': {
      return isoFormat(value.ms, value.zone, ' ');
    }
    case 'response': {
      return `<Response [${String(value.status)}]>`;
    }
    case 'function': {
      return `<function ${value.name}>`;
    }
    case 'builtin': {
      return `<built-in function ${value.name}>`;
    }
    default: {
      break;
    }
  }

  if (seen.has(value)) {
    return value.kind === 'dict' ? '{...}' : value.kind === 'list' ? '[...]' : '(...)';
  }

  seen.add(value);
  let shown: string;

  if (value.kind === 'dict') {
    const entries = [...value.entries].map(
      ([key, item]) => `${stringRepr(key, quote)}: ${repr(item, quote, seen)}`,
    );
    shown = `{${entries.join(', ')}}`;
  } else {
    const items = value.items.map((item) => repr(item, quote, seen));

    if (value.kind === 'list') {
      shown = `[${items.join(', ')}]`;
    } else {
      shown = items.length === 1 ? `(${items.join('')},)` : `(${items.join(', ')})`;
    }
  }

  seen.delete(value);
  return shown;
}

/**
 * Python's str of a value: a str as it is, anything else as its repr.
 *
 * @param value - The value.
 * @returns The text.
 */
export function str(value: PyValue): string {
  return typeof value === 'string' ? value : repr(value);
}

/** How long a value label in a trace may be. */
export const MAX_LABEL = 32;

/**
 * A short label of a value for a trace chip: its repr with double quotes, cut to fit.
 *
 * @param value - The value.
 * @returns The label.
 */
export function label(value: PyValue): string {
  return shorten(repr(value, '"'), MAX_LABEL);
}

/**
 * Cuts a text to a length with an ellipsis.
 *
 * @param value - The text.
 * @param length - The most characters.
 * @returns It, or its start and `…`.
 */
export function shorten(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

/**
 * A value from JSON or a host: numbers become ints or floats, `{"$time": iso}` a Time.
 *
 * @param value - The value.
 * @param zone - The house's zone, for Times.
 * @returns The runtime value; None for what JSON cannot hold.
 */
export function fromJson(value: unknown, zone: string): PyValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    return fromNumber(value);
  }

  if (Array.isArray(value)) {
    return { kind: 'list', items: value.map((item: unknown) => fromJson(item, zone)) };
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    const stamp = record['$time'];

    if (keys.length === 1 && typeof stamp === 'string') {
      const ms = Date.parse(stamp);

      if (!Number.isNaN(ms)) {
        return time(ms, zone);
      }
    }

    return dict(new Map(keys.map((key) => [key, fromJson(record[key], zone)])));
  }

  return null;
}

/** How deep a value may nest when it is turned into JSON. */
const MAX_JSON_DEPTH = 32;

/**
 * A runtime value as JSON: tuples become arrays, a Time `{"$time": iso}`.
 *
 * @param value - The value.
 * @param what - What the JSON is for, for the message.
 * @param depth - How deep this call is.
 * @returns The JSON value.
 * @throws {CodeRunError} For a Response or a function, or values nested too deeply.
 */
export function toJson(value: PyValue, what: string, depth = 0): JsonValue {
  if (depth > MAX_JSON_DEPTH) {
    throw new CodeRunError(`${what}: values nest too deeply`);
  }

  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }

  switch (value.kind) {
    case 'int':
    case 'float': {
      return value.value;
    }
    case 'list':
    case 'tuple': {
      return value.items.map((item) => toJson(item, what, depth + 1));
    }
    case 'dict': {
      return dictToJson(value, what, depth);
    }
    case 'time': {
      return { $time: new Date(value.ms).toISOString() };
    }
    default: {
      throw new CodeRunError(
        `${what}: a ${typeName(value)} cannot be kept, only None, bool, numbers, str, lists, dicts and Times`,
      );
    }
  }
}

/**
 * A dict as a JSON object.
 *
 * @param value - The dict.
 * @param what - What the JSON is for, for the message.
 * @param depth - How deep this call is.
 * @returns The object.
 */
export function dictToJson(value: PyDict, what: string, depth = 0): JsonObject {
  const object: JsonObject = {};

  for (const [key, item] of value.entries) {
    Object.defineProperty(object, key, {
      value: toJson(item, what, depth + 1),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  return object;
}
