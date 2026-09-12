/**
 * The API client.
 *
 * One case here is worth more than the rest: a refresh token is single-use, and two requests
 * that both hit a 401 and both refresh would present the same token twice. The API reads that as
 * theft and revokes the session - the client would have signed the person out by being helpful.
 * `refreshes once when several requests fail together` is the test that this cannot happen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { apiRequest, connectSession, disconnectSession } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';

/** What the fake server answered, and what it was asked. */
type Call = { url: string; init: RequestInit | undefined };

/** Every request the test made. */
let calls: Call[] = [];

/**
 * Builds a JSON response.
 *
 * @param status - The status to answer with.
 * @param body - The body to serialise.
 * @returns The response.
 */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Installs a fetch that answers from a queue of handlers.
 *
 * @param handlers - One per expected call, in order.
 */
function stubFetch(handlers: ((url: string) => Response)[]): void {
  let index = 0;

  vi.stubGlobal('fetch', (url: string, init: RequestInit | undefined) => {
    calls.push({ url, init });

    const handler = handlers[Math.min(index, handlers.length - 1)];

    index += 1;

    return Promise.resolve(handler?.(url) ?? json(500, {}));
  });
}

beforeEach(() => {
  calls = [];
  globalThis.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  disconnectSession();
});

describe('apiRequest', () => {
  it('parses a successful body against the schema it was given', async () => {
    stubFetch([() => json(200, { name: 'hallway' })]);

    const answer = await apiRequest('/areas', z.object({ name: z.string() }), {
      isAuthenticated: false,
    });

    expect(answer).toEqual({ name: 'hallway' });
  });

  it('refuses a body that is not the shape the client expects', async () => {
    stubFetch([() => json(200, { name: 42 })]);

    await expect(
      apiRequest('/areas', z.object({ name: z.string() }), { isAuthenticated: false }),
    ).rejects.toThrow(ApiError);
  });

  it('turns the error envelope into a typed failure', async () => {
    stubFetch([
      () =>
        json(403, {
          error: {
            code: 'PERMISSION',
            message: 'This action requires user:read',
            details: { permission: 'user:read' },
            traceId: '01JD8Z4K2P9QF3M7X1V6R8T2NB',
          },
        }),
    ]);

    await expect(
      apiRequest('/users', z.unknown(), { isAuthenticated: false }),
    ).rejects.toMatchObject({
      code: 'PERMISSION',
      status: 403,
      traceId: '01JD8Z4K2P9QF3M7X1V6R8T2NB',
    });
  });

  it('reports an unreachable server rather than throwing whatever fetch threw', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));

    await expect(
      apiRequest('/areas', z.unknown(), { isAuthenticated: false }),
    ).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
  });

  it('attaches the access token when there is one', async () => {
    stubFetch([() => json(200, {})]);
    connectSession({
      readAccessToken: () => 'a-token',
      onRefreshed: () => undefined,
      onSignedOut: () => undefined,
    });

    await apiRequest('/areas', z.unknown());

    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe('Bearer a-token');
  });

  it('refreshes on a 401 and retries the original request', async () => {
    globalThis.localStorage.setItem('nebula.refresh-token', 'refresh-1');

    const responses = [
      json(401, { error: { code: 'AUTHENTICATION', message: 'no', details: {}, traceId: 't' } }),
      json(200, { tokens: { accessToken: 'fresh', refreshToken: 'refresh-2' } }),
      json(200, { items: [] }),
    ];
    let index = 0;

    vi.stubGlobal('fetch', (url: string, init: RequestInit | undefined) => {
      calls.push({ url, init });

      return Promise.resolve(responses[index++] ?? json(500, {}));
    });

    connectSession({
      readAccessToken: () => 'stale',
      onRefreshed: () => undefined,
      onSignedOut: () => undefined,
    });

    const answer = await apiRequest('/entities', z.object({ items: z.array(z.unknown()) }));

    expect(answer).toEqual({ items: [] });
    expect(calls.map((call) => call.url)).toEqual([
      '/api/v1/entities',
      '/api/v1/auth/refresh',
      '/api/v1/entities',
    ]);
    expect(new Headers(calls[2]?.init?.headers).get('authorization')).toBe('Bearer fresh');
    expect(globalThis.localStorage.getItem('nebula.refresh-token')).toBe('refresh-2');
  });

  it('refreshes once when several requests fail together', async () => {
    globalThis.localStorage.setItem('nebula.refresh-token', 'refresh-1');

    vi.stubGlobal('fetch', (url: string, init: RequestInit | undefined) => {
      calls.push({ url, init });

      if (url.endsWith('/auth/refresh')) {
        return Promise.resolve(
          json(200, { tokens: { accessToken: 'fresh', refreshToken: 'refresh-2' } }),
        );
      }

      const isRetry = new Headers(init?.headers).get('authorization') === 'Bearer fresh';

      return Promise.resolve(
        isRetry
          ? json(200, {})
          : json(401, {
              error: { code: 'AUTHENTICATION', message: 'no', details: {}, traceId: 't' },
            }),
      );
    });

    connectSession({
      readAccessToken: () => 'stale',
      onRefreshed: () => undefined,
      onSignedOut: () => undefined,
    });

    await Promise.all([
      apiRequest('/entities', z.unknown()),
      apiRequest('/areas', z.unknown()),
      apiRequest('/devices', z.unknown()),
    ]);

    // Three 401s, ONE refresh, three retries. A second refresh here would present a spent token
    // and the API would revoke the session for reuse.
    const refreshes = calls.filter((call) => call.url.endsWith('/auth/refresh'));

    expect(refreshes).toHaveLength(1);
    expect(calls).toHaveLength(7);
  });

  it('gives up and signs out when the refresh is refused', async () => {
    globalThis.localStorage.setItem('nebula.refresh-token', 'spent');

    const onSignedOut = vi.fn();

    stubFetch([
      () =>
        json(401, { error: { code: 'AUTHENTICATION', message: 'no', details: {}, traceId: 't' } }),
      () =>
        json(401, { error: { code: 'AUTHENTICATION', message: 'no', details: {}, traceId: 't' } }),
    ]);

    connectSession({
      readAccessToken: () => 'stale',
      onRefreshed: () => undefined,
      onSignedOut,
    });

    await expect(apiRequest('/entities', z.unknown())).rejects.toThrow(ApiError);
    expect(onSignedOut).toHaveBeenCalledOnce();
    expect(globalThis.localStorage.getItem('nebula.refresh-token')).toBeNull();
  });

  it('keeps the session when the refresh never reached the API', async () => {
    // A 502 is the proxy in front - Vite in development, the proxy service in production -
    // saying the API is not there. The token was not refused; nobody looked at it. Throwing it
    // away here would sign a wall tablet out on every restart of the service.
    globalThis.localStorage.setItem('nebula.refresh-token', 'still-good');

    const onSignedOut = vi.fn();

    stubFetch([
      () =>
        json(401, { error: { code: 'AUTHENTICATION', message: 'no', details: {}, traceId: 't' } }),
      () => new Response('', { status: 502 }),
    ]);

    connectSession({
      readAccessToken: () => 'stale',
      onRefreshed: () => undefined,
      onSignedOut,
    });

    await expect(apiRequest('/entities', z.unknown())).rejects.toMatchObject({ status: 502 });
    expect(onSignedOut).not.toHaveBeenCalled();
    expect(globalThis.localStorage.getItem('nebula.refresh-token')).toBe('still-good');
  });

  it('does not try to refresh a call that never had a credential', async () => {
    globalThis.localStorage.setItem('nebula.refresh-token', 'refresh-1');
    stubFetch([
      () =>
        json(401, { error: { code: 'AUTHENTICATION', message: 'no', details: {}, traceId: 't' } }),
    ]);

    await expect(
      apiRequest('/auth/login', z.unknown(), { method: 'POST', isAuthenticated: false }),
    ).rejects.toThrow(ApiError);

    // A wrong password must not spend the refresh token of whoever was signed in before.
    expect(calls).toHaveLength(1);
  });
});
