/**
 * Whether a value a function returned fits the part it is bound to.
 *
 * A part expects a number, a boolean, one of a list of words, a text or a colour; the run gives
 * back JSON-ish values, and this decides what the part takes. None always fits: it means "no
 * answer yet".
 */

/** What a part expects its function to return. */
export type Expectation = {
  readonly kind: 'number' | 'boolean' | 'enum' | 'text' | 'color';

  /** The allowed words of an enum part. */
  readonly values?: readonly string[];
};

/** A colour as a part takes it. */
export type FittedColor = { readonly hue: number; readonly saturation: number };

/** What a part takes. */
export type FittedValue = number | boolean | string | FittedColor | null;

/** Whether a value fits, and the value the part takes when it does. */
export type FitResult =
  | { readonly ok: true; readonly value: FittedValue }
  | { readonly ok: false; readonly message: string };

/** How long a text part's value may be. */
export const MAX_TEXT_RETURN = 512;

/**
 * A short description of a value, for a message.
 *
 * @param value - The value.
 * @returns For example `"heat"`, `True`, `3` or `a list`.
 */
function describe(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(value.length > 30 ? `${value.slice(0, 29)}…` : value);
  }

  if (typeof value === 'boolean') {
    return value ? 'True' : 'False';
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return 'a list';
  }

  return value === null || value === undefined ? 'None' : 'a dict';
}

/**
 * A colour from a `(hue, saturation)` pair or a `{"hue", "saturation"}` dict.
 *
 * @param value - The value.
 * @returns The fit.
 */
function fitColor(value: unknown): FitResult {
  let hue: unknown;
  let saturation: unknown;

  if (Array.isArray(value) && value.length === 2) {
    [hue, saturation] = value as unknown[];
  } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    hue = record['hue'];
    saturation = record['saturation'];
  }

  if (typeof hue !== 'number' || typeof saturation !== 'number') {
    return { ok: false, message: `expected a colour as (hue, saturation), got ${describe(value)}` };
  }

  if (!(hue >= 0 && hue <= 360)) {
    return { ok: false, message: `hue must be between 0 and 360, got ${String(hue)}` };
  }

  if (!(saturation >= 0 && saturation <= 100)) {
    return {
      ok: false,
      message: `saturation must be between 0 and 100, got ${String(saturation)}`,
    };
  }

  return { ok: true, value: { hue, saturation } };
}

/**
 * Whether a returned value fits a part's expectation.
 *
 * @param value - The value, as a run result gives it.
 * @param expectation - What the part expects.
 * @returns The value the part takes, or why it does not fit.
 */
export function fitReturn(value: unknown, expectation: Expectation): FitResult {
  if (value === null || value === undefined) {
    return { ok: true, value: null };
  }

  switch (expectation.kind) {
    case 'number': {
      return typeof value === 'number' && Number.isFinite(value)
        ? { ok: true, value }
        : { ok: false, message: `expected a number, got ${describe(value)}` };
    }
    case 'boolean': {
      return typeof value === 'boolean'
        ? { ok: true, value }
        : { ok: false, message: `expected True or False, got ${describe(value)}` };
    }
    case 'enum': {
      const values = expectation.values ?? [];

      if (typeof value === 'string' && values.includes(value)) {
        return { ok: true, value };
      }

      return { ok: false, message: `${describe(value)} is not one of: ${values.join(', ')}` };
    }
    case 'text': {
      if (typeof value !== 'string') {
        return { ok: false, message: `expected text, got ${describe(value)}` };
      }

      return value.length <= MAX_TEXT_RETURN
        ? { ok: true, value }
        : { ok: false, message: `text is longer than ${String(MAX_TEXT_RETURN)} characters` };
    }
    case 'color': {
      return fitColor(value);
    }
  }
}
