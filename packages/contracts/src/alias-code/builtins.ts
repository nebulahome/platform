/**
 * The builtin functions of alias code: one registry for the evaluator, the checker and the docs.
 *
 * Each entry carries its signature as the docs show it (parsed into the parameters the evaluator
 * binds and the checker counts), its group, a one-line summary and an example, and what it does.
 * The clock, the house's position, entity metadata, history and HTTP all come through the host,
 * so a builtin never reaches past the {@link BuiltinContext} it is given.
 */
import { ENTITY_ID_PATTERN } from '../entity-id.js';
import {
  SUN_EVENTS,
  SUN_PHASES,
  isSunPhase,
  nextSunEvent,
  sunPhaseLabel,
  sunPosition,
  sunState,
  sunTimes,
  type GeoPosition,
  type SunEvent,
  type SunPeriod,
  type SunPhase,
} from '../sun.js';

import { CodeRunError } from './errors.js';
import { roundEven, toFixedEven } from './format-spec.js';
import { checkSizes } from './methods.js';
import { parseSignature, type SignatureParam } from './signature.js';
import { zonedFields, zonedToEpoch } from './time.js';
import type { CodeHost, HistoryKind, HttpMethod } from './types.js';
import {
  binaryOp,
  equals,
  float,
  floatRepr,
  fromJson,
  fromNumber,
  int,
  isObject,
  iterate,
  list,
  number,
  numeric,
  order,
  str,
  text,
  thousands,
  time,
  toJson,
  truthy,
  tuple,
  typeName,
  type Numeric,
  type PyTime,
  type PyValue,
  type ValueLimits,
} from './values.js';

/** What a builtin may reach while it runs. */
export type BuiltinContext = {
  readonly host: CodeHost;
  readonly limits: ValueLimits;

  /** Records an entity id as read, for the run result. */
  readonly read: (entityId: string) => void;

  /** Records printed text against the line that printed it. */
  readonly print: (text: string) => void;

  /** Sends, or in a trial pretends to send, one HTTP request. */
  readonly http: (method: HttpMethod, args: readonly (PyValue | undefined)[]) => Promise<PyValue>;
};

/** What a builtin does with its bound arguments. */
export type BuiltinImplementation = (
  args: readonly (PyValue | undefined)[],
  context: BuiltinContext,
) => PyValue | Promise<PyValue>;

/** The groups of the docs panel, in order. */
export const CODE_BUILTIN_GROUPS = [
  'Math',
  'Numbers and lists',
  'Conversion',
  'Time',
  'Sun',
  'Entities',
  'History',
  'HTTP',
  'Debug',
] as const;

/** A group of the docs panel. */
export type BuiltinGroup = (typeof CODE_BUILTIN_GROUPS)[number];

/** What a builtin makes the code depend on, for the checker's `uses`. */
export type BuiltinUse = 'time' | 'sun' | 'history' | 'http';

/** One builtin: its docs and what it does. */
export type BuiltinEntry = {
  /** The name code calls it by; `http.get` for the HTTP methods. */
  readonly name: string;

  /** As the docs show it, such as `round(x, digits=0)`. */
  readonly signature: string;
  readonly group: BuiltinGroup;

  /** One English line. */
  readonly summary: string;

  /** One line of code using it. */
  readonly example: string;

  /** A function to call, or a constant name such as `pi`. */
  readonly kind: 'function' | 'constant';
  readonly params: readonly SignatureParam[];
  readonly uses: BuiltinUse | null;

  /** Whether the first argument must be an entity id written in quotes. */
  readonly entityArgument: boolean;
  readonly implementation: BuiltinImplementation;
};

/** Options of a registry entry. */
type EntryOptions = {
  readonly uses?: BuiltinUse;
  readonly entityArgument?: boolean;
};

/**
 * A function entry.
 *
 * @param group - Its docs group.
 * @param signature - Its signature, as the docs show it.
 * @param summary - One line.
 * @param example - One line of code.
 * @param implementation - What it does.
 * @param options - What it depends on, and whether it takes an entity id.
 * @returns The entry.
 */
function define(
  group: BuiltinGroup,
  signature: string,
  summary: string,
  example: string,
  implementation: BuiltinImplementation,
  options: EntryOptions = {},
): BuiltinEntry {
  const { name, params } = parseSignature(signature);

  return {
    name,
    signature,
    group,
    summary,
    example,
    kind: 'function',
    params,
    uses: options.uses ?? null,
    entityArgument: options.entityArgument ?? false,
    implementation,
  };
}

/**
 * A constant entry.
 *
 * @param name - Its name.
 * @param summary - One line.
 * @param example - One line of code.
 * @param value - Its value.
 * @returns The entry.
 */
function constant(name: string, summary: string, example: string, value: number): BuiltinEntry {
  return {
    name,
    signature: name,
    group: 'Math',
    summary,
    example,
    kind: 'constant',
    params: [],
    uses: null,
    entityArgument: false,
    implementation: constantOf(value),
  };
}

/**
 * The implementation of a constant.
 *
 * @param value - The constant.
 * @returns A function giving it as a float.
 */
function constantOf(value: number): BuiltinImplementation {
  return () => float(value);
}

// --- argument helpers --------------------------------------------------------------------

/**
 * A number argument; a bool counts as 0 or 1.
 *
 * @param name - The builtin, for the message.
 * @param value - The argument.
 * @returns The number and whether it is an int.
 * @throws {CodeRunError} On None or a value that is not a number.
 */
function numberArgument(name: string, value: PyValue | undefined): Numeric {
  const given = value ?? null;

  if (given === null) {
    throw new CodeRunError(`${name}() got None`);
  }

  const result = numeric(given);

  if (result === null) {
    throw new CodeRunError(`${name}() needs a number, got ${typeName(given)}`);
  }

  return result;
}

/**
 * A number argument's value.
 *
 * @param name - The builtin.
 * @param value - The argument.
 * @returns The number.
 */
function numberOf(name: string, value: PyValue | undefined): number {
  return numberArgument(name, value).value;
}

/**
 * An int argument.
 *
 * @param name - The builtin.
 * @param value - The argument.
 * @returns The integer.
 * @throws {CodeRunError} When it is not an int.
 */
function intOf(name: string, value: PyValue | undefined): number {
  const result = numberArgument(name, value);

  if (!result.isInt) {
    throw new CodeRunError(`${name}() needs an int, got float`);
  }

  return result.value;
}

/**
 * A str argument.
 *
 * @param name - The builtin.
 * @param value - The argument.
 * @returns The string.
 * @throws {CodeRunError} When it is not a str.
 */
function textOf(name: string, value: PyValue | undefined): string {
  if (typeof value !== 'string') {
    throw new CodeRunError(`${name}() needs a str, got ${typeName(value ?? null)}`);
  }

  return value;
}

/**
 * A Time argument; None passes through as null.
 *
 * @param name - The builtin.
 * @param value - The argument.
 * @returns The Time, or null for None.
 * @throws {CodeRunError} When it is neither.
 */
function timeOf(name: string, value: PyValue | undefined): PyTime | null {
  const given = value ?? null;

  if (given === null) {
    return null;
  }

  if (!isObject(given) || given.kind !== 'time') {
    throw new CodeRunError(`${name}() needs a Time, got ${typeName(given)}`);
  }

  return given;
}

/**
 * The items of an iterable argument.
 *
 * @param name - The builtin.
 * @param value - The argument.
 * @returns The items.
 * @throws {CodeRunError} When it is not iterable.
 */
function itemsOf(name: string, value: PyValue | undefined): PyValue[] {
  const given = value ?? null;

  if (given === null) {
    throw new CodeRunError(`${name}() got None`);
  }

  try {
    return iterate(given);
  } catch {
    throw new CodeRunError(`${name}() needs a list, got ${typeName(given)}`);
  }
}

/**
 * The numbers of a list argument, none of them None.
 *
 * @param name - The builtin.
 * @param value - The argument.
 * @param allowEmpty - Whether an empty list is fine.
 * @returns The numbers, and whether all are ints.
 * @throws {CodeRunError} On None in the list, a non-number, or an empty list where one is not
 *   fine.
 */
function numbersOf(
  name: string,
  value: PyValue | undefined,
  allowEmpty: boolean,
): { readonly values: number[]; readonly allInt: boolean } {
  const items = itemsOf(name, value);

  if (items.length === 0 && !allowEmpty) {
    throw new CodeRunError(`${name}() got an empty list`);
  }

  const values: number[] = [];
  let allInt = true;

  for (const item of items) {
    if (item === null) {
      throw new CodeRunError(`${name}() got None`);
    }

    const result = numeric(item);

    if (result === null) {
      throw new CodeRunError(`${name}() needs numbers, got ${typeName(item)}`);
    }

    values.push(result.value);
    allInt &&= result.isInt;
  }

  return { values, allInt };
}

/**
 * The items of a variadic argument; one iterable argument stands for its items.
 *
 * @param name - The builtin.
 * @param value - The variadic tuple.
 * @returns The items.
 */
function spreadOf(name: string, value: PyValue | undefined): PyValue[] {
  const given = value ?? null;
  const items = isObject(given) && given.kind === 'tuple' ? [...given.items] : [];
  const [only] = items;

  return items.length === 1 && only !== undefined ? itemsOf(name, only) : items;
}

/**
 * An entity id argument.
 *
 * @param name - The builtin.
 * @param value - The argument.
 * @returns The id.
 * @throws {CodeRunError} When it is not a valid entity id.
 */
function entityIdOf(name: string, value: PyValue | undefined): string {
  if (typeof value !== 'string' || !ENTITY_ID_PATTERN.test(value)) {
    throw new CodeRunError(`${name}() needs an entity id like "sensor.kitchen_temperature"`);
  }

  return value;
}

/**
 * A math function's result, refusing a domain error.
 *
 * @param value - The result.
 * @returns The float.
 * @throws {CodeRunError} When it is NaN or infinite.
 */
function mathResult(value: number): PyValue {
  return number(value, false);
}

/**
 * Refuses an argument outside a function's domain.
 *
 * @param holds - Whether it is inside.
 * @throws {CodeRunError} When it is not.
 */
function domain(holds: boolean): void {
  if (!holds) {
    throw new CodeRunError('math domain error');
  }
}

/**
 * The smallest or largest of values.
 *
 * @param name - `min` or `max`.
 * @param value - The variadic tuple.
 * @param direction - -1 for min, 1 for max.
 * @returns The item.
 * @throws {CodeRunError} On an empty list or None.
 */
function extreme(name: string, value: PyValue | undefined, direction: number): PyValue {
  const items = spreadOf(name, value);
  let best: PyValue | undefined;

  for (const item of items) {
    if (item === null) {
      throw new CodeRunError(`${name}() got None`);
    }

    if (best === undefined || order(item, best) * direction > 0) {
      best = item;
    }
  }

  if (best === undefined) {
    throw new CodeRunError(`${name}() got an empty list`);
  }

  return best;
}

/**
 * The decimals a step is written with, so `round_to(0.3, 0.1)` gives 0.3, not 0.30000000000000004.
 *
 * @param step - The step.
 * @returns Its count of decimals.
 */
function decimalsOf(step: number): number {
  const shown = floatRepr(step);
  const point = shown.indexOf('.');

  return point < 0 || shown.includes('e') ? 10 : shown.length - point - 1;
}

// --- time and sun helpers ------------------------------------------------------------------

/**
 * Now as a Time.
 *
 * @param context - The builtin context.
 * @returns The Time.
 */
function nowOf(context: BuiltinContext): PyTime {
  return time(context.host.now(), context.host.timeZone);
}

/**
 * Reads `HH:MM` or `HH:MM:SS`.
 *
 * @param name - The builtin.
 * @param value - The argument.
 * @returns Hours, minutes and seconds.
 * @throws {CodeRunError} When it is not a time of day.
 */
function clockOf(name: string, value: PyValue | undefined): Clock {
  const given = textOf(name, value);
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/u.exec(given.trim());
  const hour = Number(match?.[1] ?? 99);
  const minute = Number(match?.[2] ?? 99);
  const second = Number(match?.[3] ?? 0);

  if (hour > 23 || minute > 59 || second > 59) {
    throw new CodeRunError(`${name}() needs a time like "07:30", got ${JSON.stringify(given)}`);
  }

  return { hour, minute, second };
}

/** A time of day. */
type Clock = { readonly hour: number; readonly minute: number; readonly second: number };

/**
 * Seconds since midnight of a time of day.
 *
 * @param clock - The time of day.
 * @returns The seconds.
 */
function secondsOfDay(clock: Clock): number {
  return clock.hour * 3600 + clock.minute * 60 + clock.second;
}

/**
 * Minutes, hours or days since a Time, as a float.
 *
 * @param name - The builtin.
 * @param value - The Time, or None.
 * @param context - The builtin context.
 * @param unitMs - The unit, in milliseconds.
 * @returns The float, or None for None.
 */
function since(
  name: string,
  value: PyValue | undefined,
  context: BuiltinContext,
  unitMs: number,
): PyValue {
  const moment = timeOf(name, value);
  return moment === null ? null : float((context.host.now() - moment.ms) / unitMs);
}

const HALF_DAY_MS = 43_200_000;

/**
 * A Time for an instant, or None.
 *
 * @param moment - The instant, or null.
 * @param context - The builtin context.
 * @returns The Time, or None.
 */
function timeOrNone(moment: Date | null, context: BuiltinContext): PyValue {
  return moment === null ? null : time(moment.getTime(), context.host.timeZone);
}

/**
 * Runs a sun function with the house's position, or gives None when it has none.
 *
 * @param context - The builtin context.
 * @param compute - What to compute from the position and now.
 * @returns Its result, or None.
 */
function withPosition(
  context: BuiltinContext,
  compute: (position: GeoPosition, now: Date) => PyValue,
): PyValue {
  const position = context.host.position();
  return position === null ? null : compute(position, new Date(context.host.now()));
}

/**
 * Today's moment of a sun event: within the solar day around today's solar noon.
 *
 * @param context - The builtin context.
 * @param event - The event.
 * @param period - Morning or evening, for twice-daily events.
 * @returns The Time, or None when it does not happen today.
 */
function todaysEvent(context: BuiltinContext, event: SunEvent, period?: SunPeriod): PyValue {
  return withPosition(context, (position, now) => {
    const noon = sunTimes(now, position).solarNoon.getTime();
    const found = nextSunEvent({ event, period }, position, new Date(noon - HALF_DAY_MS), {
      maxDays: 2,
    });

    return found !== null && found.getTime() <= noon + HALF_DAY_MS
      ? time(found.getTime(), context.host.timeZone)
      : null;
  });
}

/** The sun events that have a moment: every event but the elevation ones. */
const TIMED_SUN_EVENTS: readonly SunEvent[] = SUN_EVENTS.filter(
  (event) => event !== 'elevation_crossed' && event !== 'elevation_changed',
);

/**
 * A sun event name argument.
 *
 * @param name - The builtin.
 * @param value - The argument.
 * @returns The event.
 * @throws {CodeRunError} When it is not an event with a moment.
 */
function sunEventOf(name: string, value: PyValue | undefined): SunEvent {
  const given = textOf(name, value);
  const event = TIMED_SUN_EVENTS.find((candidate) => candidate === given);

  if (event === undefined) {
    throw new CodeRunError(`${name}() needs a sun event: one of ${TIMED_SUN_EVENTS.join(', ')}`);
  }

  return event;
}

/**
 * A period argument: morning or evening.
 *
 * @param name - The builtin.
 * @param value - The argument, or undefined for the default.
 * @param fallback - The default.
 * @returns The period, or undefined for either.
 * @throws {CodeRunError} When it is something else.
 */
function periodOf(
  name: string,
  value: PyValue | undefined,
  fallback: SunPeriod | undefined,
): SunPeriod | undefined {
  if (value === undefined) {
    return fallback;
  }

  if (value === null) {
    return undefined;
  }

  if (value !== 'morning' && value !== 'evening') {
    throw new CodeRunError(`${name}() period must be "morning" or "evening"`);
  }

  return value;
}

/**
 * The most recent moment of a sun event, within the last two days.
 *
 * @param event - The event.
 * @param position - Where the house is.
 * @param now - Now.
 * @returns The moment, or null.
 */
function previousSunEvent(event: SunEvent, position: GeoPosition, now: Date): Date | null {
  let cursor = new Date(now.getTime() - 4 * HALF_DAY_MS);
  let last: Date | null = null;

  // shortcut: looks back two days only, so a polar event of months ago reads None; widen if asked.
  for (let index = 0; index < 8; index += 1) {
    const found = nextSunEvent({ event }, position, cursor, { maxDays: 3 });

    if (found === null || found.getTime() > now.getTime()) {
      break;
    }

    last = found;
    cursor = found;
  }

  return last;
}

// --- HTTP and history helpers -------------------------------------------------------------

/**
 * A history builtin.
 *
 * @param kind - Which summary.
 * @param name - The builtin's name.
 * @param summary - One line.
 * @param example - One line of code.
 * @returns The entry.
 */
function historyEntry(
  kind: HistoryKind,
  name: string,
  summary: string,
  example: string,
): BuiltinEntry {
  return define(
    'History',
    `${name}(entity_id, minutes)`,
    summary,
    example,
    async ([entityId, minutes], context) => {
      const id = entityIdOf(name, entityId);
      const span = numberOf(name, minutes);

      if (!(span >= 1 && span <= 1440)) {
        throw new CodeRunError(`${name}() minutes must be between 1 and 1440`);
      }

      context.read(id);
      const value = await context.host.history(kind, id, span);
      return value === null || !Number.isFinite(value) ? null : float(value);
    },
    { uses: 'history', entityArgument: true },
  );
}

/**
 * An HTTP method builtin.
 *
 * @param method - The method.
 * @param signature - Its signature.
 * @param summary - One line.
 * @param example - One line of code.
 * @returns The entry.
 */
function httpEntry(
  method: HttpMethod,
  signature: string,
  summary: string,
  example: string,
): BuiltinEntry {
  return define(
    'HTTP',
    signature,
    summary,
    example,
    (args, context) => context.http(method, args),
    {
      uses: 'http',
    },
  );
}

const WRITE_ARGUMENTS = '(url, json=None, data=None, headers={}, timeout=5)';

// --- the registry --------------------------------------------------------------------------

/** Every builtin, in docs order. */
export const CODE_BUILTINS: readonly BuiltinEntry[] = [
  // Math
  define('Math', 'abs(x)', 'How far x is from zero.', 'abs(room - target)', ([x]) => {
    const value = numberArgument('abs', x);
    return number(Math.abs(value.value), value.isInt);
  }),
  define(
    'Math',
    'round(x, digits=0)',
    'x rounded to digits decimals, halves to even as Python does; an int without digits.',
    'round(sensor.outdoor_temperature, 1)',
    ([x, digits]) => {
      const value = numberArgument('round', x);

      if (digits === undefined || digits === null) {
        return int(roundEven(value.value, 0));
      }

      const rounded = roundEven(value.value, intOf('round', digits));
      return value.isInt ? int(rounded) : float(rounded);
    },
  ),
  define('Math', 'floor(x)', 'The largest int not above x.', 'floor(2.7)', ([x]) =>
    int(Math.floor(numberOf('floor', x))),
  ),
  define('Math', 'ceil(x)', 'The smallest int not below x.', 'ceil(2.1)', ([x]) =>
    int(Math.ceil(numberOf('ceil', x))),
  ),
  define('Math', 'trunc(x)', 'x without its fraction, toward zero.', 'trunc(-2.7)', ([x]) =>
    int(Math.trunc(numberOf('trunc', x))),
  ),
  define('Math', 'sqrt(x)', 'The square root of x.', 'sqrt(dx ** 2 + dy ** 2)', ([x]) => {
    const value = numberOf('sqrt', x);
    domain(value >= 0);
    return mathResult(Math.sqrt(value));
  }),
  define('Math', 'pow(x, y)', 'x to the power y, as x ** y.', 'pow(2, 10)', ([x, y], context) => {
    numberArgument('pow', x);
    numberArgument('pow', y);
    return binaryOp('**', x ?? null, y ?? null, context.limits);
  }),
  define('Math', 'exp(x)', 'e to the power x.', 'exp(-t / 10)', ([x]) =>
    mathResult(Math.exp(numberOf('exp', x))),
  ),
  define(
    'Math',
    'log(x, base=e)',
    'The logarithm of x, natural unless a base is given.',
    'log(1000, 10)',
    ([x, base]) => {
      const value = numberOf('log', x);
      domain(value > 0);

      if (base === undefined || base === null) {
        return mathResult(Math.log(value));
      }

      const radix = numberOf('log', base);
      domain(radix > 0);

      if (radix === 1) {
        throw new CodeRunError('division by zero');
      }

      return mathResult(Math.log(value) / Math.log(radix));
    },
  ),
  define('Math', 'log10(x)', 'The base-10 logarithm of x.', 'log10(lux)', ([x]) => {
    const value = numberOf('log10', x);
    domain(value > 0);
    return mathResult(Math.log10(value));
  }),
  define('Math', 'log2(x)', 'The base-2 logarithm of x.', 'log2(1024)', ([x]) => {
    const value = numberOf('log2', x);
    domain(value > 0);
    return mathResult(Math.log2(value));
  }),
  define('Math', 'sin(x)', 'The sine of x radians.', 'sin(radians(30))', ([x]) =>
    mathResult(Math.sin(numberOf('sin', x))),
  ),
  define('Math', 'cos(x)', 'The cosine of x radians.', 'cos(radians(60))', ([x]) =>
    mathResult(Math.cos(numberOf('cos', x))),
  ),
  define('Math', 'tan(x)', 'The tangent of x radians.', 'tan(radians(45))', ([x]) =>
    mathResult(Math.tan(numberOf('tan', x))),
  ),
  define('Math', 'asin(x)', 'The arc sine of x, in radians.', 'degrees(asin(0.5))', ([x]) => {
    const value = numberOf('asin', x);
    domain(value >= -1 && value <= 1);
    return mathResult(Math.asin(value));
  }),
  define('Math', 'acos(x)', 'The arc cosine of x, in radians.', 'degrees(acos(0.5))', ([x]) => {
    const value = numberOf('acos', x);
    domain(value >= -1 && value <= 1);
    return mathResult(Math.acos(value));
  }),
  define('Math', 'atan(x)', 'The arc tangent of x, in radians.', 'degrees(atan(1))', ([x]) =>
    mathResult(Math.atan(numberOf('atan', x))),
  ),
  define(
    'Math',
    'atan2(y, x)',
    'The angle of the point (x, y) from the x axis, in radians.',
    'degrees(atan2(north, east))',
    ([y, x]) => mathResult(Math.atan2(numberOf('atan2', y), numberOf('atan2', x))),
  ),
  define('Math', 'hypot(x, y)', 'The length of the vector (x, y).', 'hypot(3, 4)', ([x, y]) =>
    mathResult(Math.hypot(numberOf('hypot', x), numberOf('hypot', y))),
  ),
  define('Math', 'degrees(x)', 'x radians in degrees.', 'degrees(pi)', ([x]) =>
    mathResult((numberOf('degrees', x) * 180) / Math.PI),
  ),
  define('Math', 'radians(x)', 'x degrees in radians.', 'radians(180)', ([x]) =>
    mathResult((numberOf('radians', x) * Math.PI) / 180),
  ),
  define(
    'Math',
    'sign(x)',
    '-1, 0 or 1, as x is negative, zero or positive.',
    'sign(change)',
    ([x]) => int(Math.sign(numberOf('sign', x))),
  ),
  define(
    'Math',
    'clamp(x, low, high)',
    'x kept between low and high.',
    'clamp(level, 0, 100)',
    ([x, low, high]) => {
      const value = numberOf('clamp', x);
      const bottom = numberOf('clamp', low);
      const top = numberOf('clamp', high);

      if (bottom > top) {
        throw new CodeRunError('clamp() low is above high');
      }

      return (value < bottom ? low : value > top ? high : x) ?? null;
    },
  ),
  define(
    'Math',
    'scale(x, in_low, in_high, out_low, out_high)',
    'x mapped from one range onto another, in a straight line; not clamped.',
    'scale(sensor.lux, 0, 1000, 0, 100)',
    ([x, inLow, inHigh, outLow, outHigh]) => {
      const from = numberOf('scale', inLow);
      const to = numberOf('scale', inHigh);

      if (from === to) {
        throw new CodeRunError('scale() in_low and in_high are equal');
      }

      const start = numberOf('scale', outLow);
      const share = (numberOf('scale', x) - from) / (to - from);
      return mathResult(start + share * (numberOf('scale', outHigh) - start));
    },
  ),
  define(
    'Math',
    'round_to(x, step)',
    'x rounded to the nearest multiple of step.',
    'round_to(target, 0.5)',
    ([x, step]) => {
      const value = numberArgument('round_to', x);
      const unit = numberArgument('round_to', step);

      if (unit.value <= 0) {
        throw new CodeRunError('round_to() step must be above zero');
      }

      const rounded = roundEven(value.value / unit.value, 0) * unit.value;
      return value.isInt && unit.isInt
        ? int(rounded)
        : float(Number(toFixedEven(rounded, decimalsOf(unit.value))));
    },
  ),
  constant('pi', 'The ratio of a circle to its diameter, 3.14159…', 'pi * radius ** 2', Math.PI),
  constant('e', 'The base of natural logarithms, 2.71828…', 'e ** -t', Math.E),

  // Numbers and lists
  define(
    'Numbers and lists',
    'min(*values)',
    'The smallest of the arguments, or of one list.',
    'min(sensor.a, sensor.b)',
    ([values]) => extreme('min', values, -1),
  ),
  define(
    'Numbers and lists',
    'max(*values)',
    'The largest of the arguments, or of one list.',
    'max(readings)',
    ([values]) => extreme('max', values, 1),
  ),
  define(
    'Numbers and lists',
    'sum(xs)',
    'The total of a list of numbers.',
    'sum(powers)',
    ([xs]) => {
      const { values, allInt } = numbersOf('sum', xs, true);
      return number(
        values.reduce((total, value) => total + value, 0),
        allInt,
      );
    },
  ),
  define(
    'Numbers and lists',
    'avg(xs)',
    'The mean of a list of numbers.',
    'avg(recent)',
    ([xs]) => {
      const { values } = numbersOf('avg', xs, false);
      return mathResult(values.reduce((total, value) => total + value, 0) / values.length);
    },
  ),
  define(
    'Numbers and lists',
    'median(xs)',
    'The middle of a list of numbers; the mean of the two middle ones for an even count.',
    'median(recent)',
    ([xs]) => {
      const { values, allInt } = numbersOf('median', xs, false);
      const sorted = values.toSorted((left, right) => left - right);
      const middle = Math.floor(sorted.length / 2);
      const upper = sorted[middle] ?? 0;

      if (sorted.length % 2 === 1) {
        return number(upper, allInt);
      }

      return mathResult(((sorted[middle - 1] ?? 0) + upper) / 2);
    },
  ),
  define(
    'Numbers and lists',
    'stdev(xs)',
    'The population standard deviation of a list of numbers.',
    'stdev(recent)',
    ([xs]) => {
      const { values } = numbersOf('stdev', xs, false);
      const mean = values.reduce((total, value) => total + value, 0) / values.length;
      const spread = values.reduce((total, value) => total + (value - mean) ** 2, 0);
      return mathResult(Math.sqrt(spread / values.length));
    },
  ),
  define(
    'Numbers and lists',
    'len(x)',
    'How many items a list, tuple, dict or str holds.',
    'len(recent)',
    ([x]) => {
      const value = x ?? null;

      if (typeof value === 'string') {
        return int(value.length);
      }

      if (isObject(value)) {
        if (value.kind === 'list' || value.kind === 'tuple') {
          return int(value.items.length);
        }

        if (value.kind === 'dict') {
          return int(value.entries.size);
        }
      }

      throw new CodeRunError(`len() needs a list, tuple, dict or str, got ${typeName(value)}`);
    },
  ),
  define(
    'Numbers and lists',
    'range([start,] stop[, step])',
    'The ints from start (0) up to, not including, stop.',
    'for i in range(3):',
    ([start, stop, step], context) => {
      const first = start === undefined ? 0 : intOf('range', start);
      const last = intOf('range', stop);
      const stride = step === undefined ? 1 : intOf('range', step);

      if (stride === 0) {
        throw new CodeRunError('range() step cannot be zero');
      }

      const count = Math.max(0, Math.ceil((last - first) / stride));

      if (count > context.limits.listLength) {
        throw new CodeRunError(
          `range() is longer than ${thousands(context.limits.listLength)} items`,
        );
      }

      return {
        kind: 'list',
        items: Array.from({ length: count }, (unused, index) => int(first + index * stride)),
      };
    },
  ),
  define(
    'Numbers and lists',
    'sorted(xs, reverse=False)',
    'A new list of the items in order.',
    'sorted(readings, reverse=True)',
    ([xs, reverse], context) => {
      const flip = truthy(reverse ?? false);
      const items = itemsOf('sorted', xs).sort((left, right) =>
        flip ? order(right, left) : order(left, right),
      );
      return list(items, context.limits);
    },
  ),
  define(
    'Numbers and lists',
    'reversed(xs)',
    'A new list of the items, last first.',
    'reversed(readings)',
    ([xs], context) => list(itemsOf('reversed', xs).reverse(), context.limits),
  ),
  define(
    'Numbers and lists',
    'enumerate(xs, start=0)',
    'A list of (index, item) pairs.',
    'for i, value in enumerate(readings):',
    ([xs, start], context) => {
      const first = start === undefined ? 0 : intOf('enumerate', start);
      return list(
        itemsOf('enumerate', xs).map((item, index) => tuple([int(first + index), item])),
        context.limits,
      );
    },
  ),
  define(
    'Numbers and lists',
    'zip(*lists)',
    'A list of tuples pairing the items of the lists, as long as the shortest.',
    'for a, b in zip(xs, ys):',
    ([lists], context) => {
      const given = lists ?? null;
      const columns = (isObject(given) && given.kind === 'tuple' ? given.items : []).map((item) =>
        itemsOf('zip', item),
      );
      const length = columns.length === 0 ? 0 : Math.min(...columns.map((column) => column.length));

      return list(
        Array.from({ length }, (unused, index) =>
          tuple(columns.map((column) => column[index] ?? null)),
        ),
        context.limits,
      );
    },
  ),
  define('Numbers and lists', 'any(xs)', 'Whether any item is true.', 'any(windows)', ([xs]) =>
    itemsOf('any', xs).some((item) => truthy(item)),
  ),
  define(
    'Numbers and lists',
    'all(xs)',
    'Whether every item is true.',
    'all(doors_closed)',
    ([xs]) => itemsOf('all', xs).every((item) => truthy(item)),
  ),
  define(
    'Numbers and lists',
    'count(xs, value)',
    'How many items equal value.',
    'count(states, "on")',
    ([xs, value]) => int(itemsOf('count', xs).filter((item) => equals(item, value ?? null)).length),
  ),

  // Conversion
  define(
    'Conversion',
    'int(x)',
    'x as an int: a float loses its fraction, a str is read.',
    'int("42")',
    ([x]) => {
      const value = x ?? null;

      if (typeof value === 'string') {
        if (!/^\s*[+-]?\d+(?:_\d+)*\s*$/u.test(value)) {
          throw new CodeRunError(`invalid literal for int(): ${JSON.stringify(value)}`);
        }

        return int(Number(value.replaceAll('_', '').trim()));
      }

      return int(Math.trunc(numberOf('int', value)));
    },
  ),
  define('Conversion', 'float(x)', 'x as a float; a str is read.', 'float("21.5")', ([x]) => {
    const value = x ?? null;

    if (typeof value === 'string') {
      const read = readNumber(value);

      if (read === null) {
        throw new CodeRunError(`could not convert str to float: ${JSON.stringify(value)}`);
      }

      return float(read);
    }

    return float(numberOf('float', value));
  }),
  define('Conversion', 'str(x)', 'x as text.', 'str(round(power))', ([x], context) =>
    text(str(x ?? null), context.limits),
  ),
  define(
    'Conversion',
    'bool(x)',
    'Whether x is true: not None, zero or empty.',
    'bool(recent)',
    ([x]) => truthy(x ?? null),
  ),
  define(
    'Conversion',
    'to_number(x, default=None)',
    'x as a number when it is one or reads as one, else default.',
    'to_number(sensor.mode_text, 0)',
    ([x, fallback]) => {
      const value = x ?? null;
      const given = numeric(value);

      if (given !== null) {
        return number(given.value, given.isInt);
      }

      const read = typeof value === 'string' ? readNumber(value) : null;
      return read === null ? (fallback ?? null) : fromNumber(read);
    },
  ),
  define(
    'Conversion',
    'is_number(x)',
    'Whether x is an int or a float (a bool or a numeric str is not).',
    'is_number(sensor.power)',
    ([x]) => isObject(x ?? null) && numeric(x ?? null) !== null,
  ),
  define(
    'Conversion',
    'json_parse(text)',
    'The value a JSON text holds.',
    'json_parse(r.text)',
    ([value], context) => {
      let parsed: unknown;

      try {
        parsed = JSON.parse(textOf('json_parse', value));
      } catch (error) {
        if (error instanceof CodeRunError) {
          throw error;
        }

        throw new CodeRunError('json_parse() got text that is not JSON');
      }

      return checkSizes(fromJson(parsed, context.host.timeZone), context.limits);
    },
  ),
  define(
    'Conversion',
    'json_text(value)',
    'value written as JSON text.',
    'json_text({"on": True})',
    ([value], context) =>
      text(JSON.stringify(toJson(value ?? null, 'json_text()')), context.limits),
  ),
  define(
    'Conversion',
    'url_encode(dict_or_text)',
    'A dict as a query string, or a str escaped for a URL.',
    'url_encode({"q": "Rome"})',
    ([value], context) => {
      const given = value ?? null;

      if (typeof given === 'string') {
        return text(encodeURIComponent(given), context.limits);
      }

      if (isObject(given) && given.kind === 'dict') {
        return text(queryString(given.entries), context.limits);
      }

      throw new CodeRunError(`url_encode() needs a dict or a str, got ${typeName(given)}`);
    },
  ),

  // Time
  define(
    'Time',
    'now()',
    'The current time, in the house’s time zone.',
    'now().hour >= 22',
    (args, context) => nowOf(context),
    { uses: 'time' },
  ),
  define(
    'Time',
    'today_at(text)',
    'Today at a time of day, such as "07:30".',
    'now() > today_at("07:30")',
    ([value], context) => {
      const clock = clockOf('today_at', value);
      const zone = context.host.timeZone;
      const today = zonedFields(context.host.now(), zone);
      return time(zonedToEpoch({ ...today, ...clock }, zone), zone);
    },
    { uses: 'time' },
  ),
  define(
    'Time',
    'time_between(start, end)',
    'Whether now is from start up to end, times of day; wraps midnight when end is earlier.',
    'time_between("22:00", "06:00")',
    ([start, end], context) => {
      const from = clockOf('time_between', start);
      const to = clockOf('time_between', end);
      const at = secondsOfDay(zonedFields(context.host.now(), context.host.timeZone));
      const low = secondsOfDay(from);
      const high = secondsOfDay(to);

      return low <= high ? at >= low && at < high : at >= low || at < high;
    },
    { uses: 'time' },
  ),
  define(
    'Time',
    'add_minutes(t, n)',
    'The Time n minutes after t; None stays None.',
    'add_minutes(now(), 30)',
    ([t, n]) => {
      const moment = timeOf('add_minutes', t);
      return moment === null
        ? null
        : time(moment.ms + numberOf('add_minutes', n) * 60_000, moment.zone);
    },
  ),
  define(
    'Time',
    'seconds_since(t)',
    'Seconds from t to now, as a float; None for None.',
    'seconds_since(last_changed("binary_sensor.door"))',
    ([t], context) => since('seconds_since', t, context, 1000),
    { uses: 'time' },
  ),
  define(
    'Time',
    'minutes_since(t)',
    'Minutes from t to now, as a float; None for None.',
    'minutes_since(mem["started"]) > 30',
    ([t], context) => since('minutes_since', t, context, 60_000),
    { uses: 'time' },
  ),
  define(
    'Time',
    'hours_since(t)',
    'Hours from t to now, as a float; None for None.',
    'hours_since(last_changed("sensor.filter"))',
    ([t], context) => since('hours_since', t, context, 3_600_000),
    { uses: 'time' },
  ),
  define(
    'Time',
    'days_since(t)',
    'Days from t to now, as a float; None for None.',
    'days_since(mem["cleaned"]) > 7',
    ([t], context) => since('days_since', t, context, 86_400_000),
    { uses: 'time' },
  ),
  define(
    'Time',
    'is_weekend()',
    'Whether today is Saturday or Sunday in the house.',
    'if is_weekend():',
    (args, context) => zonedFields(context.host.now(), context.host.timeZone).weekday >= 5,
    { uses: 'time' },
  ),

  // Sun
  define(
    'Sun',
    'sunrise()',
    'Today’s sunrise, or None on a polar day or night.',
    'now() > sunrise()',
    (args, context) =>
      withPosition(context, (position, now) =>
        timeOrNone(sunTimes(now, position).sunrise, context),
      ),
    { uses: 'sun' },
  ),
  define(
    'Sun',
    'sunset()',
    'Today’s sunset, or None on a polar day or night.',
    'now() > sunset()',
    (args, context) =>
      withPosition(context, (position, now) => timeOrNone(sunTimes(now, position).sunset, context)),
    { uses: 'sun' },
  ),
  define(
    'Sun',
    'dawn()',
    'Today’s civil dawn: the sun 6° below the horizon, rising.',
    'now() > dawn()',
    (args, context) => todaysEvent(context, 'dawn'),
    { uses: 'sun' },
  ),
  define(
    'Sun',
    'dusk()',
    'Today’s civil dusk: the sun 6° below the horizon, setting.',
    'now() > dusk()',
    (args, context) => todaysEvent(context, 'dusk'),
    { uses: 'sun' },
  ),
  define(
    'Sun',
    'solar_noon()',
    'When the sun is highest today.',
    'now() > solar_noon()',
    (args, context) =>
      withPosition(context, (position, now) =>
        timeOrNone(sunTimes(now, position).solarNoon, context),
      ),
    { uses: 'sun' },
  ),
  define(
    'Sun',
    'solar_midnight()',
    'When the sun is lowest, after today’s solar noon.',
    'solar_midnight()',
    (args, context) =>
      withPosition(context, (position, now) =>
        time(sunTimes(now, position).solarNoon.getTime() + HALF_DAY_MS, context.host.timeZone),
      ),
    { uses: 'sun' },
  ),
  define(
    'Sun',
    'golden_hour_start(period="evening")',
    'When today’s golden hour starts, "morning" or "evening".',
    'now() > golden_hour_start()',
    ([period], context) =>
      todaysEvent(context, 'golden_hour_start', periodOf('golden_hour_start', period, 'evening')),
    { uses: 'sun' },
  ),
  define(
    'Sun',
    'golden_hour_end(period="evening")',
    'When today’s golden hour ends, "morning" or "evening".',
    'now() < golden_hour_end()',
    ([period], context) =>
      todaysEvent(context, 'golden_hour_end', periodOf('golden_hour_end', period, 'evening')),
    { uses: 'sun' },
  ),
  define(
    'Sun',
    'blue_hour_start(period="evening")',
    'When today’s blue hour starts, "morning" or "evening".',
    'now() > blue_hour_start()',
    ([period], context) =>
      todaysEvent(context, 'blue_hour_start', periodOf('blue_hour_start', period, 'evening')),
    { uses: 'sun' },
  ),
  define(
    'Sun',
    'blue_hour_end(period="evening")',
    'When today’s blue hour ends, "morning" or "evening".',
    'now() < blue_hour_end()',
    ([period], context) =>
      todaysEvent(context, 'blue_hour_end', periodOf('blue_hour_end', period, 'evening')),
    { uses: 'sun' },
  ),
  define(
    'Sun',
    'next_sun_event(name)',
    'When a sun event, such as "sunset", next happens.',
    'next_sun_event("sunset")',
    ([name], context) => {
      const event = sunEventOf('next_sun_event', name);
      return withPosition(context, (position, now) =>
        timeOrNone(nextSunEvent({ event }, position, now), context),
      );
    },
    { uses: 'sun' },
  ),
  define(
    'Sun',
    'minutes_to(name)',
    'Minutes until a sun event next happens, as a float.',
    'minutes_to("sunset") < 30',
    ([name], context) => {
      const event = sunEventOf('minutes_to', name);
      return withPosition(context, (position, now) => {
        const next = nextSunEvent({ event }, position, now);
        return next === null ? null : float((next.getTime() - now.getTime()) / 60_000);
      });
    },
    { uses: 'sun' },
  ),
  define(
    'Sun',
    'minutes_since_sun(name)',
    'Minutes since a sun event last happened, within two days, as a float.',
    'minutes_since_sun("sunrise") > 60',
    ([name], context) => {
      const event = sunEventOf('minutes_since_sun', name);
      return withPosition(context, (position, now) => {
        const last = previousSunEvent(event, position, now);
        return last === null ? null : float((now.getTime() - last.getTime()) / 60_000);
      });
    },
    { uses: 'sun' },
  ),
  define(
    'Sun',
    'sun_phase()',
    'What the sun is doing: "day", "golden_hour", "blue_hour", "night" or "polar_night".',
    'sun_phase() == "golden_hour"',
    (args, context) =>
      withPosition(context, (position, now) => sunPhaseLabel(sunState(now, position))),
    { uses: 'sun' },
  ),
  define(
    'Sun',
    'is_sun_phase(name, elevation=0, period=None)',
    'Whether the sun is in a phase: day, twilight, night, golden_hour, blue_hour, midnight_sun, polar_night, above, below.',
    'is_sun_phase("twilight")',
    ([name, elevation, period], context) => {
      const given = textOf('is_sun_phase', name);
      const phase: SunPhase | undefined = SUN_PHASES.find((candidate) => candidate === given);

      if (phase === undefined) {
        throw new CodeRunError(`is_sun_phase() needs one of ${SUN_PHASES.join(', ')}`);
      }

      const angle = elevation === undefined ? 0 : numberOf('is_sun_phase', elevation);
      const half = periodOf('is_sun_phase', period, undefined);

      return withPosition(context, (position, now) =>
        isSunPhase({ phase, elevation: angle, period: half }, sunState(now, position)),
      );
    },
    { uses: 'sun' },
  ),
  define(
    'Sun',
    'is_daytime()',
    'Whether the sun is above the horizon.',
    'if is_daytime():',
    (args, context) =>
      withPosition(context, (position, now) =>
        isSunPhase({ phase: 'day' }, sunState(now, position)),
      ),
    { uses: 'sun' },
  ),
  define(
    'Sun',
    'is_sun_rising()',
    'Whether the sun is climbing: before solar noon.',
    'is_sun_rising()',
    (args, context) => withPosition(context, (position, now) => sunState(now, position).isRising),
    { uses: 'sun' },
  ),
  define(
    'Sun',
    'is_midnight_sun()',
    'Whether the sun does not set today.',
    'is_midnight_sun()',
    (args, context) =>
      withPosition(context, (position, now) => sunState(now, position).isMidnightSun),
    { uses: 'sun' },
  ),
  define(
    'Sun',
    'is_polar_night()',
    'Whether the sun does not rise today.',
    'is_polar_night()',
    (args, context) =>
      withPosition(context, (position, now) => sunState(now, position).isPolarNight),
    { uses: 'sun' },
  ),
  define(
    'Sun',
    'sun_elevation_at(t)',
    'The sun’s height above the horizon at a Time, in degrees.',
    'sun_elevation_at(now()) > 20',
    ([t], context) => {
      const moment = timeOf('sun_elevation_at', t);
      return moment === null
        ? null
        : withPosition(context, (position) =>
            float(sunPosition(new Date(moment.ms), position).elevation),
          );
    },
    { uses: 'sun' },
  ),
  define(
    'Sun',
    'sun_azimuth_at(t)',
    'The sun’s bearing at a Time, in degrees clockwise from north.',
    'sun_azimuth_at(now()) > 180',
    ([t], context) => {
      const moment = timeOf('sun_azimuth_at', t);
      return moment === null
        ? null
        : withPosition(context, (position) =>
            float(sunPosition(new Date(moment.ms), position).azimuth),
          );
    },
    { uses: 'sun' },
  ),

  // Entities
  define(
    'Entities',
    'available(entity_id)',
    'Whether an entity is reporting.',
    'available("sensor.outdoor_temperature")',
    ([entityId], context) => {
      const id = entityIdOf('available', entityId);
      context.read(id);
      return context.host.available(id);
    },
    { entityArgument: true },
  ),
  define(
    'Entities',
    'last_changed(entity_id)',
    'When an entity’s state last changed, or None.',
    'minutes_since(last_changed("binary_sensor.door"))',
    ([entityId], context) => {
      const id = entityIdOf('last_changed', entityId);
      context.read(id);
      const changed = context.host.lastChanged(id);
      return changed === null ? null : time(changed, context.host.timeZone);
    },
    { entityArgument: true },
  ),
  define(
    'Entities',
    'name_of(entity_id)',
    'An entity’s display name, or None.',
    'name_of("sensor.outdoor_temperature")',
    ([entityId], context) => {
      const id = entityIdOf('name_of', entityId);
      context.read(id);
      return context.host.nameOf(id);
    },
    { entityArgument: true },
  ),
  define(
    'Entities',
    'unit_of(entity_id)',
    'An entity’s unit of measurement, or None.',
    'unit_of("sensor.outdoor_temperature")',
    ([entityId], context) => {
      const id = entityIdOf('unit_of', entityId);
      context.read(id);
      return context.host.unitOf(id);
    },
    { entityArgument: true },
  ),

  // History
  historyEntry(
    'avg',
    'avg_over',
    'The mean of an entity over the last minutes (1 to 1440).',
    'avg_over("sensor.power", 10)',
  ),
  historyEntry(
    'min',
    'min_over',
    'The lowest value of an entity over the last minutes.',
    'min_over("sensor.power", 10)',
  ),
  historyEntry(
    'max',
    'max_over',
    'The highest value of an entity over the last minutes.',
    'max_over("sensor.power", 10)',
  ),
  historyEntry(
    'change',
    'change_over',
    'How much an entity changed over the last minutes: last minus first.',
    'change_over("sensor.energy", 60)',
  ),

  // HTTP
  httpEntry(
    'GET',
    'http.get(url, params={}, headers={}, timeout=5, cache=60)',
    'Fetches a URL; the answer is kept for cache seconds (at least 10).',
    'r = http.get("https://api.example.com/now", params={"city": "Rome"})',
  ),
  httpEntry(
    'POST',
    `http.post${WRITE_ARGUMENTS}`,
    'Sends a POST; not sent in a trial.',
    'http.post(url, json={"on": True})',
  ),
  httpEntry(
    'PUT',
    `http.put${WRITE_ARGUMENTS}`,
    'Sends a PUT; not sent in a trial.',
    'http.put(url, json=settings)',
  ),
  httpEntry(
    'PATCH',
    `http.patch${WRITE_ARGUMENTS}`,
    'Sends a PATCH; not sent in a trial.',
    'http.patch(url, json={"level": 3})',
  ),
  httpEntry(
    'DELETE',
    `http.delete${WRITE_ARGUMENTS}`,
    'Sends a DELETE; not sent in a trial.',
    'http.delete(url)',
  ),

  // Debug
  define(
    'Debug',
    'print(*values)',
    'Shows values in a trial, next to the line; does nothing when the alias runs.',
    'print("room", room)',
    ([values], context) => {
      const given = values ?? null;
      const items = isObject(given) && given.kind === 'tuple' ? given.items : [];
      context.print(items.map((item) => str(item)).join(' '));
      return null;
    },
  ),
];

/** The builtins by name. */
export const BUILTINS_BY_NAME: ReadonlyMap<string, BuiltinEntry> = new Map(
  CODE_BUILTINS.map((entry) => [entry.name, entry]),
);

/**
 * A query string from a dict: `a=1&b=x%20y`.
 *
 * @param entries - The dict's entries.
 * @returns The query string.
 */
export function queryString(entries: ReadonlyMap<string, PyValue>): string {
  return [...entries]
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(str(value))}`)
    .join('&');
}

/**
 * A number read from text as Python's `float()` reads it.
 *
 * @param value - The text.
 * @returns The number, or null when the text is not one.
 */
function readNumber(value: string): number | null {
  const trimmed = value.trim().replaceAll('_', '');

  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/u.test(trimmed)) {
    return null;
  }

  const read = Number(trimmed);
  return Number.isFinite(read) ? read : null;
}

/** What the docs panel says about the language, one line each. */
export const LANGUAGE_NOTES: readonly string[] = [
  'Code aliases are written in a subset of Python 3: def, return, if/elif/else, for, while, break, continue, pass, assignment, list comprehensions and f-strings.',
  'Each part of the alias calls the function of the same name with no arguments, and takes what it returns; return None when there is no answer yet.',
  'An entity reads by its id, like binary_sensor.lr_window; a third name reads a field, like climate.living_room.current_temperature. One that is unavailable reads as None.',
  'part.<key> reads another part of this alias, like part.target_temperature.',
  'mem is a dict kept between runs, up to 16 KB as JSON: None, bool, numbers, str, lists, dicts and Times.',
  'Unlike Python, mem["key"] on a missing key gives None instead of an error, so mem["count"] or 0 works.',
  'mem changes are kept only when the run ends without an error.',
  'No import: everything there is is already there. Not supported: classes, try/except, raise, lambda, with, global, nonlocal, yield, async/await, del, decorators, *args/**kwargs, :=, assert, sets, dict comprehensions and a def inside a def.',
  'Ints and floats share JavaScript number precision: integers are exact up to 2**53, and 7 // 2, 7 / 2 and 2 ** 3 still give 3, 3.5 and 8.',
  'Dict keys are str. keys(), values() and items() give lists.',
  'Methods: str lower upper title strip lstrip rstrip split join replace startswith endswith find; list append pop index count; dict get keys values items pop clear.',
  'A Time comes from now(), today_at(), last_changed() or a sun function: compare Times with < > ==, and read .year .month .day .hour .minute .second .weekday (0 is Monday) .timestamp, or call .isoformat().',
  'Sun functions give None when the house has no location; golden and blue hour functions take period="morning" or "evening" (evening unless said).',
  'http.get() and the other methods give a Response with .status .ok .text .headers and .json(); a request that fails gives status 0 instead of an error.',
  'At most 5 requests per run, 10 seconds each; a GET is answered from cache for cache seconds; one write per URL every 10 seconds; in a trial, writes are not sent.',
  'A run stops after 10 000 steps, 50 ms of work or 15 s in all; calls nest at most 32 deep, lists hold at most 1 000 items and str at most 4 096 characters.',
  'print() shows its values next to the line in a trial; it does nothing when the alias runs.',
];
