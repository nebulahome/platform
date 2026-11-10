/**
 * HTTP from alias code: the rules every request obeys, in the server and in a browser trial.
 *
 * The library enforces what must hold wherever code runs: http(s) URLs only, a timeout of at
 * most 10 seconds, at most 5 requests per run, and a response of at most 256 KB. What must last
 * between runs - the GET cache and the one-write-per-URL-every-10-seconds limit - lives in an
 * {@link HttpPolicy} the host keeps. In a trial, writes are not sent: they show what would have
 * gone out and answer with a pretend response.
 */
import { CodeRunError } from './errors.js';
import { response } from './methods.js';
import type { CodeHost, HttpMethod, HttpReply, HttpRequest } from './types.js';
import { isObject, numeric, str, toJson, typeName, type PyValue } from './values.js';

/** The most requests one run may make. */
export const MAX_HTTP_REQUESTS = 5;

/** The longest timeout code may ask for, in seconds. */
export const MAX_HTTP_TIMEOUT_SECONDS = 10;

/** The largest response body, in bytes. */
export const MAX_HTTP_RESPONSE_BYTES = 256 * 1024;

/** How long a GET answer is kept at least, in seconds. */
export const MIN_HTTP_CACHE_SECONDS = 10;

/** How often one URL may be written to, in milliseconds. */
export const HTTP_WRITE_INTERVAL_MS = 10_000;

/** How many GET answers a policy keeps. */
const MAX_CACHE_ENTRIES = 50;

/** One request a run made, or in a trial would have made. */
export type HttpLogEntry = {
  readonly method: HttpMethod;
  readonly url: string;

  /** Whether it went to the host: false for a cache hit or a trial write. */
  readonly sent: boolean;
  readonly cached: boolean;

  /** The status answered; null for a trial write. */
  readonly status: number | null;
};

/**
 * The GET cache and the write rate limit, kept by the host across runs.
 *
 * Pure: the clock is injected, so tests and the browser use their own.
 */
export class HttpPolicy {
  readonly #clock: () => number;
  readonly #cache = new Map<string, { readonly reply: HttpReply; readonly until: number }>();
  readonly #writes = new Map<string, number>();

  /**
   * @param clock - The current instant in milliseconds; `Date.now` unless said.
   */
  public constructor(clock: () => number = () => Date.now()) {
    this.#clock = clock;
  }

  /**
   * A kept GET answer that has not expired.
   *
   * @param key - The request's key.
   * @returns The answer, or null.
   */
  public cached(key: string): HttpReply | null {
    const entry = this.#cache.get(key);

    if (entry === undefined) {
      return null;
    }

    if (entry.until <= this.#clock()) {
      this.#cache.delete(key);
      return null;
    }

    return entry.reply;
  }

  /**
   * Keeps a GET answer.
   *
   * @param key - The request's key.
   * @param reply - The answer.
   * @param seconds - How long to keep it; at least 10.
   */
  public remember(key: string, reply: HttpReply, seconds: number): void {
    const now = this.#clock();

    for (const [stored, entry] of this.#cache) {
      if (entry.until <= now) {
        this.#cache.delete(stored);
      }
    }

    this.#cache.delete(key);
    this.#cache.set(key, {
      reply,
      until: now + Math.max(MIN_HTTP_CACHE_SECONDS, seconds) * 1000,
    });

    for (const stored of this.#cache.keys()) {
      if (this.#cache.size <= MAX_CACHE_ENTRIES) {
        break;
      }

      this.#cache.delete(stored);
    }
  }

  /**
   * Whether a write to a URL may go now; records it when it may.
   *
   * @param url - The URL.
   * @returns False when the URL was written to less than 10 seconds ago.
   */
  public allowWrite(url: string): boolean {
    const now = this.#clock();

    for (const [stored, at] of this.#writes) {
      if (now - at >= HTTP_WRITE_INTERVAL_MS) {
        this.#writes.delete(stored);
      }
    }

    if (this.#writes.has(url)) {
      return false;
    }

    this.#writes.set(url, now);
    return true;
  }
}

/** What one run's HTTP calls share. */
export type HttpSession = {
  readonly host: CodeHost;
  readonly policy: HttpPolicy;
  readonly trial: boolean;

  /** What a write answers in a trial. */
  readonly pretend: HttpReply;
  readonly log: HttpLogEntry[];

  /** Notes a line in the trace, such as "Would send POST …". */
  readonly note: (text: string) => void;
};

/**
 * A dict argument as string pairs.
 *
 * @param name - The function, for the message.
 * @param what - The argument, for the message.
 * @param value - The argument.
 * @returns The pairs; empty for None or a missing argument.
 * @throws {CodeRunError} When it is not a dict.
 */
function pairs(name: string, what: string, value: PyValue | undefined): [string, string][] {
  const given = value ?? null;

  if (given === null) {
    return [];
  }

  if (!isObject(given) || given.kind !== 'dict') {
    throw new CodeRunError(`${name}() ${what} must be a dict, got ${typeName(given)}`);
  }

  return [...given.entries].map(([key, item]) => [key, str(item)]);
}

/**
 * The URL of a request, with GET params added to its query string.
 *
 * @param name - The function.
 * @param value - The url argument.
 * @param params - The params argument.
 * @returns The full URL.
 * @throws {CodeRunError} When it is not an http or https URL.
 */
function urlOf(name: string, value: PyValue | undefined, params: PyValue | undefined): string {
  if (typeof value !== 'string' || !/^https?:\/\//iu.test(value)) {
    throw new CodeRunError(`${name}() url must start with http:// or https://`);
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new CodeRunError(`${name}() url is not valid`);
  }

  for (const [key, item] of pairs(name, 'params', params)) {
    url.searchParams.append(key, item);
  }

  return url.toString();
}

/**
 * The timeout of a request, in milliseconds.
 *
 * @param name - The function.
 * @param value - The timeout argument, in seconds.
 * @returns Milliseconds.
 * @throws {CodeRunError} When it is not a number from above 0 to 10.
 */
function timeoutOf(name: string, value: PyValue | undefined): number {
  const seconds = value === undefined ? 5 : numeric(value)?.value;

  if (seconds === undefined || !(seconds > 0 && seconds <= MAX_HTTP_TIMEOUT_SECONDS)) {
    throw new CodeRunError(
      `${name}() timeout must be above 0 and at most ${String(MAX_HTTP_TIMEOUT_SECONDS)} seconds`,
    );
  }

  return seconds * 1000;
}

/**
 * The body of a write, and the content type it implies.
 *
 * @param name - The function.
 * @param json - The json argument.
 * @param data - The data argument.
 * @returns The body text and its type; null for no body.
 * @throws {CodeRunError} When both are given, or data is neither a dict nor a str.
 */
function bodyOf(
  name: string,
  json: PyValue | undefined,
  data: PyValue | undefined,
): { readonly text: string; readonly type: string } | null {
  const jsonValue = json ?? null;
  const dataValue = data ?? null;

  if (jsonValue !== null && dataValue !== null) {
    throw new CodeRunError(`${name}() takes json or data, not both`);
  }

  if (jsonValue !== null) {
    return { text: JSON.stringify(toJson(jsonValue, `${name}() json`)), type: 'application/json' };
  }

  if (dataValue === null) {
    return null;
  }

  if (typeof dataValue === 'string') {
    return { text: dataValue, type: 'text/plain; charset=utf-8' };
  }

  if (isObject(dataValue) && dataValue.kind === 'dict') {
    return {
      text: new URLSearchParams(pairs(name, 'data', dataValue)).toString(),
      type: 'application/x-www-form-urlencoded',
    };
  }

  throw new CodeRunError(`${name}() data must be a dict or a str, got ${typeName(dataValue)}`);
}

/**
 * The size of a text in UTF-8 bytes.
 *
 * @param value - The text.
 * @returns Its byte length.
 */
export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Sends a request through the host; a failure reads as status 0 with the reason as the body.
 *
 * @param session - The run's HTTP session.
 * @param request - The request.
 * @returns The answer.
 * @throws {CodeRunError} When the answer is over 256 KB.
 */
async function send(session: HttpSession, request: HttpRequest): Promise<HttpReply> {
  let reply: HttpReply;

  try {
    reply = await session.host.http(request);
  } catch (error) {
    return {
      status: 0,
      headers: {},
      text: error instanceof Error ? error.message : 'request failed',
    };
  }

  if (byteLength(reply.text) > MAX_HTTP_RESPONSE_BYTES) {
    throw new CodeRunError('the response is over 256 KB');
  }

  return reply;
}

/**
 * Lower-cases the names of a headers record.
 *
 * @param entries - Header pairs.
 * @returns The record.
 */
function headerRecord(entries: readonly (readonly [string, string])[]): Record<string, string> {
  return Object.fromEntries(entries.map(([key, value]) => [key.toLowerCase(), value]));
}

/**
 * Runs one `http.<method>(...)` call of code.
 *
 * @param method - The method.
 * @param args - The bound arguments: url, params, headers, timeout, cache for GET; url, json,
 *   data, headers, timeout for the others.
 * @param session - The run's HTTP session.
 * @returns The Response.
 * @throws {CodeRunError} When a rule is broken: the URL, the timeout, the request count, a
 *   write too soon after the last one, or an answer too large.
 */
export async function sendHttp(
  method: HttpMethod,
  args: readonly (PyValue | undefined)[],
  session: HttpSession,
): Promise<PyValue> {
  const name = `http.${method.toLowerCase()}`;
  const isGet = method === 'GET';
  const [urlArgument, second, third, fourth, fifth] = args;
  const url = urlOf(name, urlArgument, isGet ? second : undefined);
  const headers = headerRecord(pairs(name, 'headers', isGet ? third : fourth));
  const timeoutMs = timeoutOf(name, isGet ? fourth : fifth);

  if (session.log.length >= MAX_HTTP_REQUESTS) {
    throw new CodeRunError(`at most ${String(MAX_HTTP_REQUESTS)} http requests per run`);
  }

  if (isGet) {
    const seconds = fifth === undefined ? 60 : (numeric(fifth)?.value ?? 60);
    const key = `${url}\n${JSON.stringify(Object.entries(headers).toSorted())}`;
    const cached = session.policy.cached(key);

    if (cached !== null) {
      session.log.push({ method, url, sent: false, cached: true, status: cached.status });
      return response(cached.status, cached.headers, cached.text);
    }

    const reply = await send(session, { method, url, headers, body: null, timeoutMs });
    session.log.push({ method, url, sent: true, cached: false, status: reply.status });

    if (reply.status >= 200 && reply.status < 300) {
      session.policy.remember(key, reply, seconds);
    }

    return response(reply.status, reply.headers, reply.text);
  }

  const body = bodyOf(name, second, third);
  const sentHeaders =
    body === null || 'content-type' in headers
      ? headers
      : { ...headers, 'content-type': body.type };

  if (session.trial) {
    session.note(`Would send ${method} ${url}`);
    session.log.push({ method, url, sent: false, cached: false, status: null });
    return response(session.pretend.status, session.pretend.headers, session.pretend.text);
  }

  if (!session.policy.allowWrite(url)) {
    throw new CodeRunError('Too frequent: one write to this URL every 10 seconds');
  }

  const reply = await send(session, {
    method,
    url,
    headers: sentHeaders,
    body: body?.text ?? null,
    timeoutMs,
  });

  session.log.push({ method, url, sent: true, cached: false, status: reply.status });
  return response(reply.status, reply.headers, reply.text);
}
