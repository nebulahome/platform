/**
 * Reporting installs to the Community Hub, against a Hub faked over fetch: the house registered
 * once with a proof of work and its token kept sealed, events sent in one batch, a refused token
 * renewed - and only that one forgotten -, a Hub away tried again, later after each failure, a
 * batch refused for good dropped, the release the house runs told on start, and nothing sent while
 * reports are off.
 */
import { describe, expect, it, vi } from 'vitest';

import { isSealed, openSecret } from '@nebulahome/db';
import { createLogger } from '@nebulahome/logging';

import type { HubInstallationRow, HubInstallationStore } from '../persistence/hub-installations.js';

import { CommunityHubClient, type HubInstallEvent } from './hub-client.js';
import { HubReporter } from './hub-reporter.js';
import { solveChallenge, solves } from './proof-of-work.js';

const logger = createLogger({ service: 'packet-manager', version: '0.0.0', level: 'fatal' });
const key = Buffer.alloc(32, 7);
const INSTALLATION = '0192a6f0-0000-7000-8000-000000000001';

/** An install of the Hub's `nvr` package. */
const NVR: HubInstallEvent = { kind: 'package', slug: 'nvr', version: '1.4.0', action: 'install' };

/** An install of the Hub's `acme` integration. */
const ACME: HubInstallEvent = {
  kind: 'integration',
  slug: 'acme',
  version: '2.0.0',
  action: 'install',
};

/**
 * `system.community_hub_installations`, in memory.
 *
 * @returns The store, and its rows.
 */
function memoryStore(): HubInstallationStore & { rows: Map<string, HubInstallationRow> } {
  const rows = new Map<string, HubInstallationRow>();

  return {
    rows,
    get: async (url) => Promise.resolve(rows.get(url)),

    /**
     * Keeps a row.
     *
     * @param row - What it holds.
     * @returns Once kept.
     */
    save: async (row) => {
      rows.set(row.hubUrl, { ...row, registeredAt: new Date() });

      return Promise.resolve();
    },

    /**
     * Forgets a row, when it is of that installation.
     *
     * @param url - Which.
     * @param installationId - The installation it must be of.
     * @returns Once forgotten.
     */
    remove: async (url, installationId) => {
      if (rows.get(url)?.installationId === installationId) {
        rows.delete(url);
      }

      return Promise.resolve();
    },
  };
}

/** How the fake Hub behaves, which a test changes as it goes. */
type FakeHubState = {
  isAway: boolean;
  refusals: number;
  isBlocked: boolean;

  /** Run just before a token is refused. */
  beforeRefusal: () => void;
};

/**
 * A Hub that registers houses and counts their reports.
 *
 * @param options - How it misbehaves.
 * @param options.isAway - Whether it cannot be reached.
 * @param options.refusals - How many reports it refuses the token of first.
 * @returns Its fetch, and what it saw.
 */
function fakeHub(options: { isAway?: boolean; refusals?: number } = {}): {
  fetch: typeof fetch;
  calls: number;
  registrations: number;
  reports: { token: string; events: HubInstallEvent[] }[];
  versions: string[];
  state: FakeHubState;
} {
  const state: FakeHubState = {
    isAway: options.isAway ?? false,
    refusals: options.refusals ?? 0,
    isBlocked: false,
    beforeRefusal: () => undefined,
  };
  const seen = {
    calls: 0,
    registrations: 0,
    reports: [] as { token: string; events: HubInstallEvent[] }[],
    versions: [] as string[],
  };

  /**
   * The fake Hub.
   *
   * @param input - What is asked.
   * @param init - The request.
   * @returns Its answer.
   */
  const fetch: typeof globalThis.fetch = async (input, init) => {
    seen.calls += 1;

    if (state.isAway) {
      throw new TypeError('fetch failed');
    }

    const url = String(input instanceof Request ? input.url : input);
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<
      string,
      unknown
    >;

    if (url.endsWith('/v1/installation-challenges')) {
      return Promise.resolve(Response.json({ challenge: 'c.hallenge', difficultyBits: 8 }));
    }

    if (url.endsWith('/v1/installations')) {
      expect(solves('c.hallenge', String(body['solution']), 8)).toBe(true);
      seen.registrations += 1;

      return Promise.resolve(
        Response.json({ id: INSTALLATION, token: `nhi_${String(seen.registrations)}` }),
      );
    }

    const token = new Headers(init?.headers).get('authorization')?.replace('Bearer ', '') ?? '';

    if (state.refusals > 0) {
      state.refusals -= 1;
      state.beforeRefusal();

      return Promise.resolve(
        Response.json(
          { error: { code: 'UNAUTHORIZED', message: 'Unknown token' } },
          { status: 401 },
        ),
      );
    }

    if (state.isBlocked) {
      return Promise.resolve(
        Response.json(
          { error: { code: 'FORBIDDEN', message: 'This installation is blocked' } },
          { status: 403 },
        ),
      );
    }

    if (init?.method === 'PATCH') {
      seen.versions.push(String(body['platformVersion']));

      return Promise.resolve(new Response(null, { status: 204 }));
    }

    seen.reports.push({ token, events: body['events'] as HubInstallEvent[] });

    return Promise.resolve(Response.json({ accepted: 1, ignored: 0 }, { status: 202 }));
  };

  return {
    fetch,
    state,
    get calls() {
      return seen.calls;
    },
    get registrations() {
      return seen.registrations;
    },
    get reports() {
      return seen.reports;
    },
    get versions() {
      return seen.versions;
    },
  };
}

/**
 * A reporter over a fake Hub and a store in memory.
 *
 * @param hub - The fake Hub.
 * @param isEnabled - Whether reports are on.
 * @returns The reporter and its store.
 */
function reporterOver(
  hub: ReturnType<typeof fakeHub>,
  isEnabled = true,
): { reporter: HubReporter; store: ReturnType<typeof memoryStore> } {
  const store = memoryStore();
  const reporter = new HubReporter({
    hub: new CommunityHubClient({ url: 'https://hub.example', logger, fetch: hub.fetch }),
    store,
    secretsKey: key,
    platformVersion: '1.0.0',
    logger,
    isEnabled,
    batchDelayMs: 60_000,
    retryMs: 60_000,
  });

  return { reporter, store };
}

describe('the proof of work', () => {
  it('finds a solution the Hub accepts, and refuses a difficulty no house could meet', async () => {
    const solution = await solveChallenge('nonce.signature', 12);

    expect(solves('nonce.signature', solution, 12)).toBe(true);
    expect(solves('nonce.signature', 'anything', 0)).toBe(true);
    await expect(solveChallenge('nonce.signature', 40)).rejects.toThrow(/40 bits/u);
  });
});

describe('reporting installs', () => {
  it('registers the house once, keeps its token sealed, and sends a batch', async () => {
    const hub = fakeHub();
    const { reporter, store } = reporterOver(hub);

    reporter.report(NVR);
    reporter.report(ACME);
    await reporter.flush();

    expect(hub.registrations).toBe(1);
    expect(hub.reports).toEqual([{ token: 'nhi_1', events: [NVR, ACME] }]);

    const row = store.rows.get('https://hub.example');

    expect(row?.installationId).toBe(INSTALLATION);
    expect(isSealed(row?.token)).toBe(true);
    expect(JSON.stringify(row?.token)).not.toContain('nhi_1');
    expect(openSecret(row?.token ?? { $sealed: '' }, key)).toBe('nhi_1');

    reporter.report({ ...NVR, version: '1.5.0', action: 'update' });
    await reporter.flush();

    expect(hub.registrations).toBe(1);
    expect(hub.reports.at(-1)?.token).toBe('nhi_1');
    reporter.stop();
  });

  it('registers again once when the Hub refuses the token', async () => {
    const hub = fakeHub();
    const { reporter } = reporterOver(hub);

    reporter.report(NVR);
    await reporter.flush();
    hub.state.refusals = 1;
    reporter.report(ACME);
    await reporter.flush();

    expect(hub.registrations).toBe(2);
    expect(hub.reports.at(-1)).toEqual({ token: 'nhi_2', events: [ACME] });
    reporter.stop();
  });

  it('keeps the events while the Hub is away, and sends them when it is back', async () => {
    const hub = fakeHub({ isAway: true });
    const { reporter } = reporterOver(hub);

    reporter.report(NVR);
    await reporter.flush();

    expect(hub.reports).toEqual([]);

    hub.state.isAway = false;
    await reporter.flush();

    expect(hub.reports).toEqual([{ token: 'nhi_1', events: [NVR] }]);
    reporter.stop();
  });

  it('waits twice as long after each failed attempt, and sends once the Hub is back', async () => {
    vi.useFakeTimers();

    try {
      const hub = fakeHub({ isAway: true });
      const { reporter } = reporterOver(hub);

      reporter.report(NVR);
      await reporter.flush();
      expect(hub.calls).toBe(1);

      // A minute after the first failure, then two after the second.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(hub.calls).toBe(2);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(hub.calls).toBe(2);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(hub.calls).toBe(3);

      hub.state.isAway = false;
      await vi.advanceTimersByTimeAsync(240_000);

      expect(hub.reports).toEqual([{ token: 'nhi_1', events: [NVR] }]);
      reporter.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('forgets only the token the Hub refused, not one registered meanwhile', async () => {
    const hub = fakeHub();
    const { reporter, store } = reporterOver(hub);
    const url = 'https://hub.example';

    reporter.report(NVR);
    await reporter.flush();

    const refused = store.rows.get(url);
    const other = '0192a6f0-0000-7000-8000-000000000002';

    // A report registered the house again while the start's request was in flight.
    hub.state.refusals = 1;
    hub.state.beforeRefusal = () => {
      if (refused !== undefined) {
        store.rows.set(url, { ...refused, installationId: other });
      }
    };
    await reporter.start();

    expect(store.rows.get(url)?.installationId).toBe(other);
    reporter.stop();
  });

  it('drops a batch the Hub refuses for good, rather than holding up the next', async () => {
    const hub = fakeHub();
    const { reporter } = reporterOver(hub);

    hub.state.isBlocked = true;
    reporter.report(NVR);
    await reporter.flush();
    hub.state.isBlocked = false;
    reporter.report(ACME);
    await reporter.flush();

    expect(hub.reports).toEqual([{ token: 'nhi_1', events: [ACME] }]);
    reporter.stop();
  });

  it('tells the Hub the release it runs on start, once it is registered', async () => {
    const hub = fakeHub();
    const { reporter } = reporterOver(hub);

    await reporter.start();
    expect(hub.versions).toEqual([]);

    reporter.report(NVR);
    await reporter.flush();
    await reporter.start();

    expect(hub.versions).toEqual(['1.0.0']);
    expect(hub.registrations).toBe(1);
    reporter.stop();
  });

  it('sends nothing while reports are off', async () => {
    const hub = fakeHub();
    const { reporter, store } = reporterOver(hub, false);

    reporter.report(NVR);
    await reporter.flush();

    expect(hub.registrations).toBe(0);
    expect(hub.reports).toEqual([]);
    expect(store.rows.size).toBe(0);
  });
});
