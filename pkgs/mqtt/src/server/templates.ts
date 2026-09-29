/**
 * The few Home Assistant value templates the broker reads, as paths into a payload.
 *
 * Home Assistant renders Jinja; the broker does not, and does not pretend to. The templates
 * nearly every device announces are a value itself or one key of its JSON - `{{ value }}`,
 * `{{ value_json.temperature }}`, `{{ value_json['temperature'] }}`, `{{ value_json.a.b }}` - and
 * those are read as the path they name. Anything else - a filter, arithmetic, a condition - is a
 * template this broker does not support, and the entity says so rather than showing a wrong value.
 */

/** A template, read: the path into the payload's JSON, or the payload itself when empty. */
export type ValuePath = readonly string[];

/** What a template came to: a path, or why it cannot be read. */
export type TemplateReading =
  | { readonly kind: 'path'; readonly path: ValuePath }
  | { readonly kind: 'unsupported'; readonly template: string };

/** One step of a path: `.key`, `['key']`, `["key"]` or `[0]`. */
const STEP =
  /^(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*'([^']*)'\s*\]|\[\s*"([^"]*)"\s*\]|\[\s*(\d+)\s*\])/u;

/**
 * Reads a template as a path.
 *
 * @param template - The template the device announced; none is the value itself.
 * @returns The path, or that it is not supported.
 */
export function readTemplate(template: string | undefined): TemplateReading {
  if (template === undefined || template.trim() === '') {
    return { kind: 'path', path: [] };
  }

  const inner = /^\s*\{\{\s*(.*?)\s*\}\}\s*$/su.exec(template)?.[1];

  if (inner === undefined) {
    return { kind: 'unsupported', template };
  }

  if (inner === 'value') {
    return { kind: 'path', path: [] };
  }

  if (!inner.startsWith('value_json')) {
    return { kind: 'unsupported', template };
  }

  const path: string[] = [];
  let rest = inner.slice('value_json'.length);

  while (rest !== '') {
    const step = STEP.exec(rest);

    if (step === null) {
      return { kind: 'unsupported', template };
    }

    path.push(step[1] ?? step[2] ?? step[3] ?? step[4] ?? '');
    rest = rest.slice(step[0].length);
  }

  return path.length === 0 ? { kind: 'unsupported', template } : { kind: 'path', path };
}

/**
 * Reads a value from a payload along a path.
 *
 * @param payload - What was published, as text.
 * @param path - Where the value is; none for the payload itself.
 * @returns The value, or undefined when the payload has nothing there.
 */
export function valueAt(payload: string, path: ValuePath): unknown {
  if (path.length === 0) {
    return payload;
  }

  let value: unknown;

  try {
    value = JSON.parse(payload) as unknown;
  } catch {
    return undefined;
  }

  for (const key of path) {
    if (typeof value !== 'object' || value === null) {
      return undefined;
    }

    value = (value as Record<string, unknown>)[key];
  }

  return value;
}
