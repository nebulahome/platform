/**
 * Reporting installs to the Community Hub, against a Hub faked over fetch: the house registered
 * once with a proof of work and its token kept sealed, events sent in one batch, a refused token
 * renewed, a Hub away tried again, and nothing sent while reports are off.
 */
import { describe, expect, it } from 'vitest';

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
     * Forgets a row.
     *
     * @param url - Which.
     * @returns Once forgotten.
     */
    remove: async (url) => {
      rows.delete(url);

      return Promise.resolve();
    },
  };
}

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
  registrations: number;
  reports: { token: string; events: HubInstallEvent[] }[];
  state: { isAway: boolean; refusals: number };
} {
  const state = { isAway: options.isAway ?? false, refusals: options.refusals ?? 0 };
  const seen = {
    registrations: 0,
    reports: [] as { token: string; events: HubInstallEvent[] }[],
  };

  /**
   * The fake Hub.
   *
   * @param input - What is asked.
   * @param init - The request.
   * @returns Its answer.
   */
  const fetch: typeof globalThis.fetch = async (input, init) => {
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

      return Promise.resolve(
        Response.json(
          { error: { code: 'UNAUTHORIZED', message: 'Unknown token' } },
          { status: 401 },
        ),
      );
    }

    seen.reports.push({ token, events: body['events'] as HubInstallEvent[] });

    return Promise.resolve(Response.json({ accepted: 1, ignored: 0 }, { status: 202 }));
  };

  return {
    fetch,
    state,
    get registrations() {
      return seen.registrations;
    },
    get reports() {
      return seen.reports;
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
