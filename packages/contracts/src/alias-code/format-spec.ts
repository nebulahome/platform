/**
 * Python's number rounding and format-spec mini-language, for `round()` and f-strings.
 *
 * Rounding is half to even on the exact binary value, as Python rounds: `round(2.5)` is 2,
 * `round(2.675, 2)` is 2.67 because 2.675 is stored a little below it.
 */
import { CodeRunError } from './errors.js';
import {
  floatRepr,
  intRepr,
  numeric,
  str,
  thousands,
  typeName,
  type PyValue,
  type ValueLimits,
} from './values.js';

/**
 * A number with a fixed count of decimals, rounded half to even as Python does.
 *
 * @param value - The number.
 * @param digits - Decimals, 0 to 100.
 * @returns The text.
 */
export function toFixedEven(value: number, digits: number): string {
  const fixed = value.toFixed(digits);

  if (Math.abs(value) >= 1e21) {
    return fixed;
  }

  // toFixed is exact but rounds a tie away from zero; only an exact tie needs correcting.
  const exact = Math.abs(value).toFixed(100);
  const point = exact.indexOf('.');
  const tail = exact.slice(point + 1 + digits);

  if (!/^50*$/u.test(tail)) {
    return fixed;
  }

  const truncated = exact.slice(0, digits > 0 ? point + 1 + digits : point);
  const lastDigit = Number(truncated.at(-1));

  return lastDigit % 2 === 0 ? `${value < 0 ? '-' : ''}${truncated}` : fixed;
}

/**
 * Python's `round(x, digits)` on a number.
 *
 * @param value - The number.
 * @param digits - Decimals; negative rounds to tens, hundreds, ...
 * @returns The rounded number.
 */
export function roundEven(value: number, digits: number): number {
  if (digits < 0) {
    const scale = 10 ** -digits;
    return Number(toFixedEven(value / scale, 0)) * scale;
  }

  return Number(toFixedEven(value, Math.min(digits, 100)));
}

const SPEC =
  /^(?:(?<fill>.)?(?<align>[<>=^]))?(?<sign>[+\- ])?(?<alternate>#)?(?<zero>0)?(?<width>\d+)?(?<grouping>[,_])?(?:\.(?<precision>\d+))?(?<type>[bdeEfFgGosxX%])?$/su;

/**
 * Inserts a separator between thousands of the integer part.
 *
 * @param digits - A number's text, without sign.
 * @param separator - `,` or `_`.
 * @returns The grouped text.
 */
function group(digits: string, separator: string): string {
  const point = digits.search(/[.eE%]/u);
  const whole = point < 0 ? digits : digits.slice(0, point);
  const rest = point < 0 ? '' : digits.slice(point);

  return whole.replaceAll(/\B(?=(\d{3})+(?!\d))/gu, separator) + rest;
}

/**
 * Exponent notation as Python writes it: at least two exponent digits.
 *
 * @param value - A non-negative number.
 * @param precision - Digits after the point.
 * @returns For example `1.234560e+03`.
 */
function exponential(value: number, precision: number): string {
  const [mantissa = '0', exponent = '+0'] = value.toExponential(precision).split('e');
  const sign = exponent.startsWith('-') ? '-' : '+';
  return `${mantissa}e${sign}${exponent.replace(/^[+-]/u, '').padStart(2, '0')}`;
}

/**
 * Python's general format (`g`): fixed or exponent by size, trailing zeros removed.
 *
 * @param value - A non-negative number.
 * @param precision - Significant digits.
 * @param alternate - Keep trailing zeros.
 * @param keepPoint - Keep at least one decimal, as a float without a type shows.
 * @returns The text.
 */
function general(value: number, precision: number, alternate: boolean, keepPoint: boolean): string {
  const digits = precision === 0 ? 1 : precision;

  if (value === 0) {
    return keepPoint ? '0.0' : '0';
  }

  const exponent = Number(value.toExponential(digits - 1).split('e')[1] ?? '0');

  /**
   * Removes trailing zeros after the point, unless asked to keep them.
   *
   * @param text - The digits.
   * @returns The trimmed digits.
   */
  const trim = (text: string): string =>
    alternate || !text.includes('.') ? text : text.replace(/\.?0+$/u, '');

  if (exponent >= -4 && exponent < digits) {
    const fixed = trim(toFixedEven(value, digits - 1 - exponent));
    return keepPoint && !fixed.includes('.') ? `${fixed}.0` : fixed;
  }

  const [mantissa = '0', power = '+00'] = exponential(value, digits - 1).split('e');
  return `${trim(mantissa)}e${power}`;
}

/**
 * The digits of a number under a format type, without its sign.
 *
 * @param type - The format type letter, or empty.
 * @param value - The absolute value.
 * @param isInt - Whether it is an int.
 * @param precision - The precision, or null.
 * @param alternate - Whether `#` was given.
 * @returns The digits.
 * @throws {CodeRunError} When the type needs an int and gets a float.
 */
function numberBody(
  type: string,
  value: number,
  isInt: boolean,
  precision: number | null,
  alternate: boolean,
): string {
  const radix = { b: 2, o: 8, x: 16, X: 16 }[type];

  if (type === 'd' || radix !== undefined) {
    if (!isInt) {
      throw new CodeRunError(`format code '${type}' needs an int, got float`);
    }

    if (radix === undefined) {
      return intRepr(value);
    }

    const digits = value.toString(radix);
    const prefix = alternate ? `0${type === 'X' ? 'X' : type}` : '';
    return prefix + (type === 'X' ? digits.toUpperCase() : digits);
  }

  switch (type) {
    case 'f':
    case 'F': {
      return toFixedEven(value, precision ?? 6);
    }
    case '%': {
      return `${toFixedEven(value * 100, precision ?? 6)}%`;
    }
    case 'e':
    case 'E': {
      const shown = exponential(value, precision ?? 6);
      return type === 'E' ? shown.toUpperCase() : shown;
    }
    case 'g':
    case 'G': {
      const shown = general(value, precision ?? 6, alternate, false);
      return type === 'G' ? shown.toUpperCase() : shown;
    }
    default: {
      if (precision === null) {
        return isInt ? intRepr(value) : floatRepr(value);
      }

      return general(value, precision, alternate, !isInt);
    }
  }
}

/**
 * A value formatted by a Python format spec, as `f"{value:spec}"`.
 *
 * @param value - The value.
 * @param spec - The spec after the colon, such as `.1f`, `d` or `>8`.
 * @param limits - The size limits.
 * @returns The text.
 * @throws {CodeRunError} When the spec is malformed or does not fit the value.
 */
export function formatWithSpec(value: PyValue, spec: string, limits: ValueLimits): string {
  if (spec === '') {
    return str(value);
  }

  const groups = SPEC.exec(spec)?.groups;

  if (groups === undefined) {
    throw new CodeRunError(`invalid format spec '${spec}'`);
  }

  const type = groups['type'] ?? '';
  const precision = groups['precision'] === undefined ? null : Number(groups['precision']);
  const width = Number(groups['width'] ?? '0');
  const zero = groups['zero'] !== undefined;

  if (width > limits.stringLength || (precision !== null && precision > 100)) {
    throw new CodeRunError(`format spec '${spec}' is too wide`);
  }

  const number = typeof value === 'string' ? null : numeric(value);
  let sign = '';
  let body: string;

  if (number === null) {
    if (type !== '' && type !== 's') {
      throw new CodeRunError(`format code '${type}' needs a number, got ${typeName(value)}`);
    }

    const shown = str(value);
    body = precision === null ? shown : shown.slice(0, precision);
  } else {
    if (type === 's') {
      throw new CodeRunError(`format code 's' needs a str, got ${typeName(value)}`);
    }

    const negative = number.value < 0 || Object.is(number.value, -0);
    body = numberBody(
      type,
      Math.abs(number.value),
      number.isInt,
      precision,
      groups['alternate'] !== undefined,
    );

    const separator = groups['grouping'];

    if (separator !== undefined) {
      body = group(body, separator);
    }

    sign = negative ? '-' : groups['sign'] === '+' ? '+' : groups['sign'] === ' ' ? ' ' : '';
  }

  const isNumber = number !== null;
  const align = groups['align'] ?? (zero && isNumber ? '=' : isNumber ? '>' : '<');
  const fill = groups['fill'] ?? (zero ? '0' : ' ');
  const padding = Math.max(0, width - sign.length - body.length);

  if (padding + sign.length + body.length > limits.stringLength) {
    throw new CodeRunError(`str is longer than ${thousands(limits.stringLength)} characters`);
  }

  switch (align) {
    case '<': {
      return sign + body + fill.repeat(padding);
    }
    case '^': {
      const before = Math.floor(padding / 2);
      return fill.repeat(before) + sign + body + fill.repeat(padding - before);
    }
    case '=': {
      return sign + fill.repeat(padding) + body;
    }
    default: {
      return fill.repeat(padding) + sign + body;
    }
  }
}
