import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createLogger } from '@nebula-home/logging';
import {
  defineTransport,
  Registry,
  type Discovered,
  type Transport,
  type TransportConnection,
} from '@nebula-home/package-runtime';

import { ConnectionPool } from './connections.js';

/** What each fake connection recorded, so a test can see what the pool did. */
type Journal = {
  readonly opened: string[];
  readonly closed: string[];
  readonly applied: { key: string; count: number }[];
};

/**
 * A transport that opens nothing and writes down everything.
 *
 * @param journal - Where to record.
 * @returns The transport.
 */
function fakeTransport(journal: Journal): Transport {
  return defineTransport({
    id: 'fake',
    configSchema: z.object({ host: z.string() }),
    connectionKey: (config): string => `fake:${config.host}`,

    connect: (config): Promise<TransportConnection> => {
      const key = `fake:${config.host}`;
      journal.opened.push(key);

      return Promise.resolve({
        key,
        send: (): Promise<unknown> => Promise.resolve(null),
        apply: (subscriptions): Promise<void> => {
          journal.applied.push({ key, count: subscriptions.length });

          return Promise.resolve();
        },
        close: (): Promise<void> => {
          journal.closed.push(key);

          return Promise.resolve();
        },
      });
    },

    // This transport never discovers anything: the pool is about holding connections open, and
    // what a scan finds belongs to the tests for discovery.
    scan: async function* scan(): AsyncGenerator<Discovered> {
      yield* await Promise.resolve([]);
    },

    probe: (): Promise<string> => Promise.resolve('not used by the pool'),
  });
}

/**
 * A pool holding one fake transport.
 *
 * @returns The pool and the journal its connections write to.
 */
function pool(): { pool: ConnectionPool; journal: Journal } {
  const journal: Journal = { opened: [], closed: [], applied: [] };
  const transports = new Registry<Transport>('transport');
  transports.register(fakeTransport(journal));

  const logger = createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' });

  return { pool: new ConnectionPool({ transports, logger }), journal };
}

describe('ConnectionPool', () => {
  it('opens one connection for two instances pointing at the same place', async () => {
    // The reason the two layers were split. Without sharing, three integrations on one MQTT
    // broker would each grow their own session and their own reconnection logic.
    const { pool: connections, journal } = pool();

    await connections.acquire('fake', { host: 'broker' }, 'first');
    await connections.acquire('fake', { host: 'broker' }, 'second');

    expect(journal.opened).toEqual(['fake:broker']);
  });

  it('opens a separate connection for a different place', async () => {
    const { pool: connections, journal } = pool();

    await connections.acquire('fake', { host: 'a' }, 'first');
    await connections.acquire('fake', { host: 'b' }, 'second');

    expect(journal.opened).toEqual(['fake:a', 'fake:b']);
  });

  it('keeps a shared connection open while anyone still holds it', async () => {
    // Stopping one instance must not disconnect the other from the same broker.
    const { pool: connections, journal } = pool();

    await connections.acquire('fake', { host: 'broker' }, 'first');
    await connections.acquire('fake', { host: 'broker' }, 'second');
    await connections.release('first');

    expect(journal.closed).toEqual([]);
  });

  it('closes a connection once the last holder lets go', async () => {
    const { pool: connections, journal } = pool();

    await connections.acquire('fake', { host: 'broker' }, 'first');
    await connections.acquire('fake', { host: 'broker' }, 'second');
    await connections.release('first');
    await connections.release('second');

    expect(journal.closed).toEqual(['fake:broker']);
  });

  it('lets go of everything a holder had when it is released', async () => {
    const { pool: connections, journal } = pool();

    await connections.acquire('fake', { host: 'broker' }, 'only');
    await connections.release('only');

    expect(journal.closed).toEqual(['fake:broker']);
  });

  it('is unbothered by releasing something that was never acquired', async () => {
    // An instance that failed before it connected is still released on shutdown.
    const { pool: connections } = pool();

    await expect(connections.release('never-started')).resolves.toBeUndefined();
  });

  it('refuses a configuration the transport does not accept', async () => {
    // The owner's settings reach this untouched from a jsonb column. Validating here means a
    // wrong one fails the instance with a message, rather than the transport failing later in
    // a way that names none of it.
    const { pool: connections } = pool();

    await expect(connections.acquire('fake', { wrong: true }, 'first')).rejects.toThrow();
  });

  it('closes everything it holds when the service stops', async () => {
    const { pool: connections, journal } = pool();

    await connections.acquire('fake', { host: 'a' }, 'first');
    await connections.acquire('fake', { host: 'b' }, 'second');
    await connections.closeAll();

    expect(journal.closed.sort()).toEqual(['fake:a', 'fake:b']);
  });
});
