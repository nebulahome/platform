/**
 * The opening decision, on the mornings the API is not there to make it with.
 *
 * `pnpm dev` brings Vite up in a few seconds and `api` up a good while later, so the first page
 * load reliably finds a proxy answering 502 for the service behind it. The store used to
 * conclude "signed out" from that - the wrong screen for a fresh installation, the wrong screen
 * for a valid session, and a conclusion it never revisited. These cases are that first load,
 * with the clock under control so the retries take no real time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { retryDelayMs, useSession } from '@/auth/session-store';

/**
 * Answers the way Vite does while nothing is listening on the API's port.
 *
 * @returns An empty `502`.
 */
const PROXY_GONE = (): Response => new Response('', { status: 502 });

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
 * Installs a fetch that answers by path, from a queue per path.
 *
 * @param routes - For each path suffix, the answers in order; the last one repeats.
 * @returns A count of calls per path, so a case can say how many times something was asked.
 */
function stubFetch(routes: Record<string, (() => Response)[]>): Record<string, number> {
  const counts: Record<string, number> = {};

  vi.stubGlobal('fetch', (url: string) => {
    const path = Object.keys(routes).find((suffix) => url.endsWith(suffix));

    if (path === undefined) {
      return Promise.resolve(json(404, {}));
    }

    const answers = routes[path] ?? [];
    const index = counts[path] ?? 0;

    counts[path] = index + 1;

    return Promise.resolve(answers[Math.min(index, answers.length - 1)]?.() ?? json(500, {}));
  });

  return counts;
}

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.localStorage.clear();
  useSession.setState({
    status: 'starting',
    user: undefined,
    accessToken: null,
    challengeId: null,
    isWaitingForApi: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('initialise, while the API is not there', () => {
  it('keeps deciding rather than deciding wrongly, and says so', async () => {
    const counts = stubFetch({
      '/setup': [PROXY_GONE, PROXY_GONE, () => json(200, { isRequired: true })],
    });

    const done = useSession.getState().initialise();

    // First attempt: a 502. Not a decision.
    await vi.advanceTimersByTimeAsync(0);
    expect(useSession.getState().status).toBe('starting');
    expect(useSession.getState().isWaitingForApi).toBe(true);

    // Second attempt after the first delay: still nobody.
    await vi.advanceTimersByTimeAsync(retryDelayMs(1));
    expect(useSession.getState().status).toBe('starting');

    // Third attempt: the API is up, and the answer is the one a fresh installation gives.
    await vi.advanceTimersByTimeAsync(retryDelayMs(2));
    await done;

    expect(counts['/setup']).toBe(3);
    expect(useSession.getState().status).toBe('setup-required');
    expect(useSession.getState().isWaitingForApi).toBe(false);
  });

  it('restores a session it could not refresh at first, without having thrown the token away', async () => {
    globalThis.localStorage.setItem('nebula.refresh-token', 'still-good');

    stubFetch({
      '/auth/refresh': [
        PROXY_GONE,
        () =>
          json(200, {
            tokens: { accessToken: 'fresh', refreshToken: 'rotated' },
          }),
      ],
      '/auth/session': [
        () =>
          json(200, {
            id: '00000000-0000-4000-8000-000000000001',
            username: 'mattia',
            displayName: 'Mattia Carli',
            role: 'owner',
            permissions: [],
            avatarUrl: null,
            locale: 'en',
            timezone: 'UTC',
            isTwoFactorEnabled: false,
            mustChangePassword: false,
          }),
      ],
    });

    const done = useSession.getState().initialise();

    await vi.advanceTimersByTimeAsync(0);
    expect(useSession.getState().status).toBe('starting');
    expect(globalThis.localStorage.getItem('nebula.refresh-token')).toBe('still-good');

    await vi.advanceTimersByTimeAsync(retryDelayMs(1));
    await done;

    expect(useSession.getState().status).toBe('signed-in');
    expect(useSession.getState().user?.username).toBe('mattia');
    expect(globalThis.localStorage.getItem('nebula.refresh-token')).toBe('rotated');
  });

  it('still treats an answer from the API as final', async () => {
    // A 500 is the API speaking. Asking again in a second will not change what it says, and
    // the sign-in form is where the person will be once it is fixed.
    const counts = stubFetch({ '/setup': [() => json(500, {})] });

    await useSession.getState().initialise();

    expect(counts['/setup']).toBe(1);
    expect(useSession.getState().status).toBe('signed-out');
    expect(useSession.getState().isWaitingForApi).toBe(false);
  });
});

describe('retryDelayMs', () => {
  it('doubles from a second', () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([1000, 2000, 4000, 8000]);
  });

  it('stops growing at ten seconds', () => {
    // Fast enough that the page comes alive within moments of the service, slow enough that a
    // house full of tablets waiting on a restart is not a flood.
    expect(retryDelayMs(5)).toBe(10_000);
    expect(retryDelayMs(50)).toBe(10_000);
  });
});
