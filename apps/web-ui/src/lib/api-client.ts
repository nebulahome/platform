/**
 * The only place this application talks to the API.
 *
 * Three things happen here that must not be spread across the components that call it.
 *
 * **Responses are parsed, not cast.** Every call names the Zod schema its answer must satisfy.
 * A server that changes shape produces a loud failure at the boundary rather than `undefined`
 * arriving somewhere three components away.
 *
 * **A 401 refreshes once, then retries.** The access token lives fifteen minutes, so this will
 * happen to every session that stays open.
 *
 * **Refreshes are single-flight, and that is a correctness requirement rather than an
 * optimisation.** A refresh token is single-use, and presenting a spent one is how the API
 * detects theft: it revokes the entire session family. Two requests that both hit a 401 and both
 * refresh would present the same token twice and sign the person out - the client would have
 * framed itself as an attacker. One in-flight refresh, awaited by everyone.
 */
import type { z } from 'zod';

import { readRefreshToken, writeRefreshToken } from '@/auth/token-storage';
import { ApiError, isApiUnreachable, toApiError } from '@/lib/api-error';

/** Where the API lives. Same origin in development, where Vite proxies `/api` across. */
const BASE_PATH = '/api/v1';

/** What one call needs. */
export type RequestOptions = {
  /** The HTTP method. Defaults to `GET`. */
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

  /** The body, serialised as JSON. */
  readonly body?: unknown;

  /** Whether to attach the access token, and to refresh it on a 401. Defaults to true. */
  readonly isAuthenticated?: boolean;

  /** Cancels the request. */
  readonly signal?: AbortSignal;

  /** What the caller can take back. JSON unless said otherwise. */
  readonly accept?: string;
};

/** What the client needs from the session to do its work. */
export type SessionBridge = {
  /** The access token to present, or null when there is none. */
  readonly readAccessToken: () => string | null;

  /** Records a freshly minted pair. */
  readonly onRefreshed: (accessToken: string, refreshToken: string) => void;

  /** Called when the session is gone for good and the person has to sign in again. */
  readonly onSignedOut: () => void;
};

/** The session the client is currently working on behalf of. */
let session: SessionBridge | undefined;

/** The refresh in flight, if there is one. Everybody who needs a token awaits this. */
let refreshInFlight: Promise<string | null> | undefined;

/**
 * Tells the client how to reach the session.
 *
 * Injected rather than imported, because the store imports the client to make its calls; having
 * the client import the store back would be a cycle, and the one that survives a bundler is
 * never the one you expect.
 *
 * @param bridge - How to read and update the tokens.
 */
export function connectSession(bridge: SessionBridge): void {
  session = bridge;
}

/**
 * Sends one request, without any refresh handling.
 *
 * @param path - The path below `/api/v1`.
 * @param options - Method, body, credentials and cancellation.
 * @param accessToken - The token to present, when there is one.
 * @returns The raw response.
 * @throws {ApiError} When the request never reached the server.
 */
async function send(
  path: string,
  options: RequestOptions,
  accessToken: string | null,
): Promise<Response> {
  const headers = new Headers({ accept: options.accept ?? 'application/json' });

  if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
  }

  if (accessToken !== null) {
    headers.set('authorization', `Bearer ${accessToken}`);
  }

  try {
    return await globalThis.fetch(`${BASE_PATH}${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (cause: unknown) {
    // An aborted request is the caller changing their mind, not a failure worth rendering.
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw cause;
    }

    throw new ApiError({
      code: 'NETWORK',
      status: 0,
      message: 'The server could not be reached',
      cause,
    });
  }
}

/**
 * Reads a response body, tolerating the ones that have none.
 *
 * @param response - The response to read.
 * @returns The parsed body, or undefined for a `204`.
 */
async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined;
  }

  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Exchanges the stored refresh token for a new pair, once.
 *
 * @returns The new access token, or null when there is nothing to refresh with or the refresh
 * was refused. A refusal is terminal: the token was spent, revoked or belongs to a session the
 * API has ended, and none of those get better by trying again.
 * @throws {ApiError} When the API could not be reached, which is not a refusal and leaves the
 * stored token exactly where it was.
 */
async function refreshOnce(): Promise<string | null> {
  const refreshToken = readRefreshToken();

  if (refreshToken === null) {
    return null;
  }

  const response = await send(
    '/auth/refresh',
    { method: 'POST', body: { refreshToken }, isAuthenticated: false },
    null,
  );

  if (!response.ok) {
    const failure = toApiError(response, await readBody(response));

    // Not every failed answer is the API refusing the token. A `502` is the proxy in front
    // saying the API is not there - which it is not, for the first seconds after `pnpm dev`
    // and for the length of every restart. Throwing the token away on that would sign a person
    // out of a wall tablet every time the service was redeployed, for no reason the token could
    // have known about. Only an answer from the API itself is final.
    if (isApiUnreachable(failure)) {
      throw failure;
    }

    writeRefreshToken(null);
    session?.onSignedOut();

    return null;
  }

  const body = (await readBody(response)) as
    { tokens?: { accessToken?: unknown; refreshToken?: unknown } } | undefined;
  const accessToken = body?.tokens?.accessToken;
  const nextRefreshToken = body?.tokens?.refreshToken;

  if (typeof accessToken !== 'string' || typeof nextRefreshToken !== 'string') {
    writeRefreshToken(null);
    session?.onSignedOut();

    return null;
  }

  writeRefreshToken(nextRefreshToken);
  session?.onRefreshed(accessToken, nextRefreshToken);

  return accessToken;
}

/**
 * Refreshes, or joins the refresh already running.
 *
 * @returns The new access token, or null when the session is over.
 */
export async function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= refreshOnce().finally(() => {
    refreshInFlight = undefined;
  });

  return refreshInFlight;
}

/**
 * Sends one request with the session's credential, refreshing it once on a 401.
 *
 * @param path - The path below `/api/v1`.
 * @param options - Method, body, credentials and cancellation.
 * @returns The response, which may still be a refusal.
 * @throws {ApiError} When the server cannot be reached, or the credential is gone for good.
 */
async function sendWithCredential(path: string, options: RequestOptions): Promise<Response> {
  const isAuthenticated = options.isAuthenticated ?? true;
  const response = await send(
    path,
    options,
    isAuthenticated ? (session?.readAccessToken() ?? null) : null,
  );

  if (response.status !== 401 || !isAuthenticated) {
    return response;
  }

  const accessToken = await refreshAccessToken();

  if (accessToken === null) {
    throw toApiError(response, await readBody(response));
  }

  return send(path, options, accessToken);
}

/**
 * Reads a picture from the API: a map tile, for the map to draw.
 *
 * A plain `<img>` cannot carry the credential, so the map fetches each tile through here and
 * shows the bytes it gets back.
 *
 * @param path - The path below `/api/v1`.
 * @param options - Credentials and cancellation.
 * @returns The picture.
 * @throws {ApiError} When the server refuses, or cannot be reached.
 */
export async function apiBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  const response = await sendWithCredential(path, {
    ...options,
    accept: options.accept ?? 'image/png,image/*',
  });

  if (!response.ok) {
    throw toApiError(response, await readBody(response));
  }

  return response.blob();
}

/**
 * Calls the API and validates what comes back.
 *
 * @param path - The path below `/api/v1`.
 * @param schema - What a successful body must satisfy.
 * @param options - Method, body, credentials and cancellation.
 * @returns The parsed body.
 * @throws {ApiError} When the server refuses, when it cannot be reached, or when its answer does
 * not match `schema`.
 */
export async function apiRequest<TSchema extends z.ZodType>(
  path: string,
  schema: TSchema,
  options: RequestOptions = {},
): Promise<z.output<TSchema>> {
  const response = await sendWithCredential(path, options);
  const body = await readBody(response);

  if (!response.ok) {
    throw toApiError(response, body);
  }

  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    throw new ApiError({
      code: 'VALIDATION',
      status: response.status,
      message: `The answer from ${path} is not the shape this client expects`,
      details: {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
      traceId: response.headers.get('x-trace-id') ?? '',
    });
  }

  return parsed.data;
}

/**
 * Forgets the session the client was working on behalf of.
 *
 * Exported for the tests, which stand the module up more than once in a process.
 */
export function disconnectSession(): void {
  session = undefined;
  refreshInFlight = undefined;
}
