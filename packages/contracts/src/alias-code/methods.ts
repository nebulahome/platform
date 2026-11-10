/**
 * The methods and attributes of values: str, list and dict methods, Time and Response fields.
 *
 * Only the methods the language notes list exist; anything else is a short error naming the
 * type, so a Python habit that does not carry over says so at the line.
 */
import { CodeRunError } from './errors.js';
import { bindArguments, parseSignature, type SignatureParam } from './signature.js';
import { isoFormat, zonedFields } from './time.js';
import {
  dict,
  equals,
  float,
  fromJson,
  int,
  isObject,
  isOkStatus,
  iterate,
  list,
  numeric,
  repr,
  text,
  thousands,
  tuple,
  typeName,
  type PyDict,
  type PyList,
  type PyResponse,
  type PyTime,
  type PyValue,
  type ValueLimits,
} from './values.js';

/** A method of one type. */
type Method<TSelf> = {
  readonly params: readonly SignatureParam[];
  readonly implementation: (
    self: TSelf,
    args: readonly (PyValue | undefined)[],
    limits: ValueLimits,
  ) => PyValue;
};

/**
 * A method table from signatures and implementations.
 *
 * @param entries - Pairs of a signature and what it does.
 * @returns The table by method name.
 */
function table<TSelf>(
  entries: readonly (readonly [string, Method<TSelf>['implementation']])[],
): ReadonlyMap<string, Method<TSelf>> {
  return new Map(
    entries.map(([signature, implementation]) => {
      const parsed = parseSignature(signature);
      return [parsed.name, { params: parsed.params, implementation }];
    }),
  );
}

/**
 * A str argument of a method.
 *
 * @param method - The method, for the message.
 * @param value - The argument.
 * @returns The string.
 * @throws {CodeRunError} When it is not a str.
 */
function textArgument(method: string, value: PyValue | undefined): string {
  if (typeof value !== 'string') {
    throw new CodeRunError(`${method}() needs a str, got ${typeName(value ?? null)}`);
  }

  return value;
}

/**
 * An int argument of a method, or its default.
 *
 * @param method - The method, for the message.
 * @param value - The argument, undefined when left out.
 * @param fallback - The default.
 * @returns The integer.
 * @throws {CodeRunError} When it is not an int.
 */
function intArgument(method: string, value: PyValue | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const number = numeric(value);

  if (!number?.isInt) {
    throw new CodeRunError(`${method}() needs an int, got ${typeName(value)}`);
  }

  return number.value;
}

/**
 * Strips characters from one or both ends.
 *
 * @param value - The string.
 * @param characters - The characters to strip, or None for whitespace.
 * @param ends - Which ends.
 * @returns The stripped string.
 */
function strip(
  value: string,
  characters: PyValue | undefined,
  ends: 'both' | 'left' | 'right',
): string {
  if (characters === undefined || characters === null) {
    if (ends === 'left') {
      return value.trimStart();
    }

    return ends === 'right' ? value.trimEnd() : value.trim();
  }

  const set = textArgument('strip', characters);
  let start = 0;
  let end = value.length;

  if (ends !== 'right') {
    while (start < end && set.includes(value.charAt(start))) {
      start += 1;
    }
  }

  if (ends !== 'left') {
    while (end > start && set.includes(value.charAt(end - 1))) {
      end -= 1;
    }
  }

  return value.slice(start, end);
}

/**
 * Python's `str.split`.
 *
 * @param value - The string.
 * @param separator - The separator, or None for runs of whitespace.
 * @param maxSplit - The most splits; negative for all.
 * @returns The pieces.
 * @throws {CodeRunError} When the separator is empty.
 */
function split(value: string, separator: PyValue | undefined, maxSplit: number): string[] {
  if (separator === undefined || separator === null) {
    const pieces: string[] = [];
    let rest = value.trimStart();

    while (rest !== '' && (maxSplit < 0 || pieces.length < maxSplit)) {
      const match = /\s+/u.exec(rest);

      if (match === null) {
        break;
      }

      pieces.push(rest.slice(0, match.index));
      rest = rest.slice(match.index + match[0].length);
    }

    return rest === '' ? pieces : [...pieces, maxSplit < 0 ? rest.trimEnd() : rest];
  }

  const sep = textArgument('split', separator);

  if (sep === '') {
    throw new CodeRunError('split() got an empty separator');
  }

  const pieces = value.split(sep);

  if (maxSplit < 0 || pieces.length <= maxSplit + 1) {
    return pieces;
  }

  return [...pieces.slice(0, maxSplit), pieces.slice(maxSplit).join(sep)];
}

/**
 * Python's `str.replace`.
 *
 * @param value - The string.
 * @param old - What to replace.
 * @param replacement - What to put instead.
 * @param count - The most replacements; negative for all.
 * @returns The new string.
 */
function replace(value: string, old: string, replacement: string, count: number): string {
  const pieces = old === '' ? ['', ...value.split(''), ''] : value.split(old);

  if (count < 0 || pieces.length <= count + 1) {
    return pieces.join(replacement);
  }

  return pieces.slice(0, count + 1).join(replacement) + old + pieces.slice(count + 1).join(old);
}

/**
 * Whether a string starts or ends with a str or any str of a tuple.
 *
 * @param method - `startswith` or `endswith`.
 * @param value - The string.
 * @param affix - A str or a tuple of str.
 * @returns Whether it does.
 */
function hasAffix(
  method: 'startswith' | 'endswith',
  value: string,
  affix: PyValue | undefined,
): boolean {
  const given = affix ?? null;
  const candidates = isObject(given) && given.kind === 'tuple' ? given.items : [given];

  return candidates.some((candidate) => {
    const piece = textArgument(method, candidate);
    return method === 'startswith' ? value.startsWith(piece) : value.endsWith(piece);
  });
}

const STR_METHODS = table<string>([
  ['lower()', (self) => self.toLowerCase()],
  ['upper()', (self) => self.toUpperCase()],
  [
    'title()',
    (self) =>
      self.replaceAll(
        /\p{L}+/gu,
        (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
      ),
  ],
  ['strip(chars=None)', (self, [characters]) => strip(self, characters, 'both')],
  ['lstrip(chars=None)', (self, [characters]) => strip(self, characters, 'left')],
  ['rstrip(chars=None)', (self, [characters]) => strip(self, characters, 'right')],
  [
    'split(sep=None, maxsplit=-1)',
    (self, [separator, maxSplit], limits) =>
      list(split(self, separator, intArgument('split', maxSplit, -1)), limits),
  ],
  [
    'join(items)',
    (self, [items], limits) => {
      const pieces = iterate(items ?? null).map((item) => {
        if (typeof item !== 'string') {
          throw new CodeRunError(`join() needs str items, got ${typeName(item)}`);
        }

        return item;
      });

      return text(pieces.join(self), limits);
    },
  ],
  [
    'replace(old, new, count=-1)',
    (self, [old, replacement, count], limits) =>
      text(
        replace(
          self,
          textArgument('replace', old),
          textArgument('replace', replacement),
          intArgument('replace', count, -1),
        ),
        limits,
      ),
  ],
  ['startswith(prefix)', (self, [prefix]) => hasAffix('startswith', self, prefix)],
  ['endswith(suffix)', (self, [suffix]) => hasAffix('endswith', self, suffix)],
  ['find(sub)', (self, [sub]) => int(self.indexOf(textArgument('find', sub)))],
]);

const LIST_METHODS = table<PyList>([
  [
    'append(item)',
    (self, [item], limits) => {
      if (self.items.length >= limits.listLength) {
        throw new CodeRunError(`list is longer than ${thousands(limits.listLength)} items`);
      }

      self.items.push(item ?? null);
      return null;
    },
  ],
  [
    'pop(index=-1)',
    (self, [index]) => {
      if (self.items.length === 0) {
        throw new CodeRunError('pop from empty list');
      }

      const raw = intArgument('pop', index, -1);
      const at = raw < 0 ? raw + self.items.length : raw;

      if (at < 0 || at >= self.items.length) {
        throw new CodeRunError('pop index out of range');
      }

      return self.items.splice(at, 1)[0] ?? null;
    },
  ],
  [
    'index(value)',
    (self, [value]) => {
      const at = self.items.findIndex((item) => equals(item, value ?? null));

      if (at < 0) {
        throw new CodeRunError(`${repr(value ?? null)} is not in list`);
      }

      return int(at);
    },
  ],
  [
    'count(value)',
    (self, [value]) => int(self.items.filter((item) => equals(item, value ?? null)).length),
  ],
]);

const DICT_METHODS = table<PyDict>([
  [
    'get(key, default=None)',
    (self, [key, fallback]) =>
      (typeof key === 'string' ? self.entries.get(key) : undefined) ?? fallback ?? null,
  ],
  ['keys()', (self) => ({ kind: 'list', items: [...self.entries.keys()] })],
  ['values()', (self) => ({ kind: 'list', items: [...self.entries.values()] })],
  [
    'items()',
    (self) => ({
      kind: 'list',
      items: [...self.entries].map(([key, value]) => tuple([key, value])),
    }),
  ],
  [
    'pop(key, default=None)',
    (self, [key, fallback]) => {
      const value = typeof key === 'string' ? self.entries.get(key) : undefined;

      if (typeof key !== 'string' || value === undefined) {
        if (fallback === undefined) {
          throw new CodeRunError(`key ${repr(key ?? null)} not found`);
        }

        return fallback;
      }

      self.entries.delete(key);
      return value;
    },
  ],
  [
    'clear()',
    (self) => {
      self.entries.clear();
      return null;
    },
  ],
]);

const TIME_FIELDS = ['year', 'month', 'day', 'hour', 'minute', 'second', 'weekday'] as const;

const TIME_METHODS = table<PyTime>([
  ['isoformat()', (self) => isoFormat(self.ms, self.zone)],
  ['timestamp()', (self) => float(self.ms / 1000)],
  ['weekday()', (self) => int(zonedFields(self.ms, self.zone).weekday)],
]);

const RESPONSE_METHODS = table<PyResponse>([
  [
    'json()',
    (self, args, limits) => {
      let parsed: unknown;

      try {
        parsed = JSON.parse(self.text);
      } catch {
        throw new CodeRunError('the response is not JSON');
      }

      return checkSizes(fromJson(parsed, 'UTC'), limits);
    },
  ],
]);

/**
 * Refuses a value from JSON whose lists are longer than code may build.
 *
 * @param value - The value.
 * @param limits - The limits.
 * @returns The same value.
 * @throws {CodeRunError} When a list is too long.
 */
export function checkSizes(value: PyValue, limits: ValueLimits): PyValue {
  if (isObject(value)) {
    const items = value.kind === 'list' ? list(value.items, limits).items : null;

    for (const item of items ?? (value.kind === 'dict' ? value.entries.values() : [])) {
      checkSizes(item, limits);
    }
  }

  return value;
}

/**
 * Calls a method from a table.
 *
 * @param methods - The type's table.
 * @param type - The type's name, for messages.
 * @param self - The receiver.
 * @param name - The method.
 * @param args - Positional arguments.
 * @param keywords - Keyword arguments.
 * @param limits - The size limits.
 * @returns What the method returns.
 * @throws {CodeRunError} When the type has no such method.
 */
function invoke<TSelf>(
  methods: ReadonlyMap<string, Method<TSelf>>,
  type: string,
  self: TSelf,
  name: string,
  args: readonly PyValue[],
  keywords: ReadonlyMap<string, PyValue>,
  limits: ValueLimits,
): PyValue {
  const method = methods.get(name);

  if (method === undefined) {
    throw new CodeRunError(`${type} has no method ${name}()`);
  }

  return method.implementation(self, bindArguments(name, method.params, args, keywords), limits);
}

/**
 * Calls a method of a value: `text.lower()`, `xs.append(1)`, `t.isoformat()`.
 *
 * @param receiver - The value.
 * @param name - The method.
 * @param args - Positional arguments.
 * @param keywords - Keyword arguments.
 * @param limits - The size limits.
 * @returns What the method returns.
 * @throws {CodeRunError} When the value has no such method or the arguments do not fit.
 */
export function callMethod(
  receiver: PyValue,
  name: string,
  args: readonly PyValue[],
  keywords: ReadonlyMap<string, PyValue>,
  limits: ValueLimits,
): PyValue {
  if (typeof receiver === 'string') {
    return invoke(STR_METHODS, 'str', receiver, name, args, keywords, limits);
  }

  if (isObject(receiver)) {
    switch (receiver.kind) {
      case 'list': {
        return invoke(LIST_METHODS, 'list', receiver, name, args, keywords, limits);
      }
      case 'dict': {
        return invoke(DICT_METHODS, 'dict', receiver, name, args, keywords, limits);
      }
      case 'time': {
        return invoke(TIME_METHODS, 'Time', receiver, name, args, keywords, limits);
      }
      case 'response': {
        return invoke(RESPONSE_METHODS, 'Response', receiver, name, args, keywords, limits);
      }
      default: {
        break;
      }
    }
  }

  throw new CodeRunError(`${typeName(receiver)} has no method ${name}()`);
}

/**
 * Reads an attribute of a value: a Time's fields, a Response's status, ok, text and headers.
 *
 * @param value - The value.
 * @param name - The attribute.
 * @returns Its value.
 * @throws {CodeRunError} When the value has no such attribute.
 */
export function getAttribute(value: PyValue, name: string): PyValue {
  if (isObject(value) && value.kind === 'time') {
    if (name === 'timestamp') {
      return float(value.ms / 1000);
    }

    const field = TIME_FIELDS.find((candidate) => candidate === name);

    if (field !== undefined) {
      return int(zonedFields(value.ms, value.zone)[field]);
    }
  }

  if (isObject(value) && value.kind === 'response') {
    switch (name) {
      case 'status': {
        return int(value.status);
      }
      case 'ok': {
        return isOkStatus(value.status);
      }
      case 'text': {
        return value.text;
      }
      case 'headers': {
        return value.headers;
      }
      default: {
        break;
      }
    }
  }

  const methods =
    typeof value === 'string'
      ? STR_METHODS
      : isObject(value) && value.kind === 'list'
        ? LIST_METHODS
        : isObject(value) && value.kind === 'dict'
          ? DICT_METHODS
          : null;

  if (methods?.has(name) === true) {
    throw new CodeRunError(`${name} is a method: call it, like ${name}()`);
  }

  throw new CodeRunError(`${typeName(value)} has no attribute '${name}'`);
}

/**
 * A Response value from what the host answered.
 *
 * @param status - The status.
 * @param headers - The headers, names in lower case.
 * @param body - The body text.
 * @returns The Response.
 */
export function response(
  status: number,
  headers: Readonly<Record<string, string>>,
  body: string,
): PyResponse {
  return {
    kind: 'response',
    status,
    text: body,
    headers: dict(
      new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])),
    ),
  };
}
