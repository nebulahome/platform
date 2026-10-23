/**
 * What an HTTP request action sends, worked out from the block and the house now.
 *
 * Each parameter is an entity's reading, put where its author wrote `{{ name }}`: encoded for an
 * address or a form, as a JSON literal in a JSON body - a number, true or false, or a quoted
 * string - and as it is in plain text. A parameter with no reading fails the action rather than
 * sending a hole, and so does a `{{ name }}` no parameter has.
 *
 * Pure: the readings and the opening of a secret header come in as functions.
 */
import type {
  AliasScalar,
  AutomationAction,
  HttpBodyKind,
  SecretHeaderValue,
} from '@nebulahome/contracts';

/** An HTTP request action. */
export type HttpRequestAction = Extract<AutomationAction, { type: 'http_request' }>;

/** What to send. */
export type HttpRequestParts = {
  readonly url: URL;
  readonly headers: Record<string, string>;

  /** Absent for no body, and always for GET and HEAD, which cannot carry one. */
  readonly body?: string;
};

/** `{{ name }}`, with or without spaces inside the braces. */
const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gu;

/**
 * Writes a reading for the address or a form body.
 *
 * @param value - The reading.
 * @returns It, percent-encoded.
 */
const encodeComponent = (value: AliasScalar): string => encodeURIComponent(String(value));

/** How a reading is written into each kind of body. */
const BODY_ENCODERS: Readonly<
  Record<Exclude<HttpBodyKind, 'none'>, (value: AliasScalar) => string>
> = { json: JSON.stringify, form: encodeComponent, text: String };

/** The type a body is sent as, unless a header of the block says otherwise. */
const CONTENT_TYPES: Readonly<Record<Exclude<HttpBodyKind, 'none'>, string>> = {
  json: 'application/json',
  form: 'application/x-www-form-urlencoded',
  text: 'text/plain; charset=utf-8',
};

/**
 * Puts the parameters' readings where a text names them.
 *
 * @param template - The text, with `{{ name }}` where a reading goes.
 * @param values - The readings, by name.
 * @param encode - How a reading is written here.
 * @returns The text filled in.
 * @throws {Error} When it names a parameter there is not.
 */
export function fillTemplate(
  template: string,
  values: ReadonlyMap<string, AliasScalar>,
  encode: (value: AliasScalar) => string,
): string {
  return template.replaceAll(PLACEHOLDER, (whole: string, name: string) => {
    const value = values.get(name);

    if (value === undefined) {
      throw new Error(`${whole} is not one of the parameters`);
    }

    return encode(value);
  });
}

/**
 * Works out the request an action sends now.
 *
 * @param action - The block.
 * @param readingOf - An entity's reading now, undefined when it has none.
 * @param reveal - Opens a header kept secret.
 * @returns The address, the headers and the body.
 * @throws {Error} When a parameter has no reading, or the address is not http or https.
 */
export function buildHttpRequest(
  action: HttpRequestAction,
  readingOf: (entityId: string) => AliasScalar | undefined,
  reveal: (value: SecretHeaderValue) => string,
): HttpRequestParts {
  const values = new Map<string, AliasScalar>();

  for (const [name, entityId] of Object.entries(action.variables ?? {})) {
    const value = readingOf(entityId);

    if (value === undefined) {
      throw new Error(`${name} (${entityId}) has no reading`);
    }

    values.set(name, value);
  }

  const url = new URL(fillTemplate(action.url, values, encodeComponent));

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The address is not http or https');
  }

  const headers: Record<string, string> = Object.fromEntries(
    (action.headers ?? []).map((header) => [
      header.name,
      typeof header.value === 'string' ? header.value : reveal(header.value),
    ]),
  );
  const kind = action.body?.kind ?? 'none';

  if (kind === 'none' || action.method === 'GET' || action.method === 'HEAD') {
    return { url, headers };
  }

  if (!Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')) {
    headers['content-type'] = CONTENT_TYPES[kind];
  }

  return { url, headers, body: fillTemplate(action.body?.text ?? '', values, BODY_ENCODERS[kind]) };
}
