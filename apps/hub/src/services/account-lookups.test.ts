/**
 * A vendor's transport handed the account its configuration names when it scans or probes.
 */
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  defineTransport,
  type AccountHandle,
  type Discovered,
  type TransportLookContext,
} from '@nebulahome/package-runtime';

import { vendorOfTransport, withAccountLookups } from './account-lookups.js';

/** An account of the vendor's. */
const HANDLE: AccountHandle = {
  id: 'uid-1',
  label: 'owner@example.com',
  status: 'connected',
  credentials: {},
  session: {},
  update: async () => Promise.resolve(),
  needsSignIn: async () => Promise.resolve(),
};

/**
 * A transport that says which account it was handed.
 *
 * @param seen - Where each context goes.
 * @returns The transport.
 */
function recording(seen: (TransportLookContext | undefined)[]): ReturnType<typeof defineTransport> {
  return defineTransport({
    id: 'cloudy/cloud',
    configSchema: z.object({ account: z.string().optional() }),
    connectionKey: () => 'cloudy',
    connect: () => {
      throw new Error('unused');
    },

    /**
     * Says what it was handed, as one device.
     *
     * @param config - Unused.
     * @param terms - Unused.
     * @param signal - Unused.
     * @param context - What it was handed.
     * @yields {Discovered} One device.
     */
    async *scan(config, terms, signal, context) {
      seen.push(context);
      yield await Promise.resolve({ deviceKey: 'robot', payload: {} });
    },
    probe: async (config, signal, context) => {
      seen.push(context);

      return Promise.resolve('fine');
    },
  });
}

describe('a transport wrapped for accounts', () => {
  it('scans and probes with the account the configuration names, of its own vendor', async () => {
    const seen: (TransportLookContext | undefined)[] = [];
    const accountOf = vi.fn(async (vendorId: string, accountId: string) =>
      Promise.resolve(vendorId === 'cloudy' && accountId === 'uid-1' ? HANDLE : undefined),
    );
    const transport = withAccountLookups(recording(seen), accountOf);
    const found: Discovered[] = [];

    for await (const each of transport.scan({ account: 'uid-1' }, {}, AbortSignal.timeout(1000))) {
      found.push(each);
    }

    await transport.probe({ account: 'uid-9' }, AbortSignal.timeout(1000));
    await transport.probe({}, AbortSignal.timeout(1000));

    expect(found).toHaveLength(1);
    expect(seen).toEqual([{ account: HANDLE }, {}, {}]);
    expect(accountOf).toHaveBeenCalledTimes(2);
  });

  it('keeps what the caller handed', async () => {
    const seen: (TransportLookContext | undefined)[] = [];
    const accountOf = vi.fn();
    const transport = withAccountLookups(recording(seen), accountOf);

    await transport.probe({ account: 'uid-1' }, AbortSignal.timeout(1000), { account: HANDLE });

    expect(seen).toEqual([{ account: HANDLE }]);
    expect(accountOf).not.toHaveBeenCalled();
  });

  it('knows a vendor transport from a platform one', () => {
    expect(vendorOfTransport('ecovacs/cloud')).toBe('ecovacs');
    expect(vendorOfTransport('mqtt')).toBeNull();
  });
});
