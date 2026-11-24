import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BLUETOOTH_GATT_STALE,
  BLUETOOTH_PROXY_GATT_OPS,
  type JsonObject,
} from '@nebulahome/contracts';

import { DATABASE_TTL_MS } from './gatt-databases.js';
import { BluetoothLinks } from './links.js';

const ADDRESS = 'D8:BF:C5:C6:4C:57';
const PROXY = 'proxy';
const BOT = 'cba20d00-224d-11e6-9fb8-0002a5d5c51b';

/** A SwitchBot's services, as a proxy found them. */
const SERVICES = [
  {
    uuid: BOT,
    handle: 0x30,
    characteristics: [
      {
        uuid: 'cba20002-224d-11e6-9fb8-0002a5d5c51b',
        handle: 0x32,
        properties: 0x0c,
        descriptors: [],
      },
    ],
  },
];

/** The same with the standard service that holds the Database Hash. */
const WITH_HASH = [
  {
    uuid: '1801',
    handle: 0x01,
    characteristics: [{ uuid: '2b2a', handle: 0x03, properties: 0x02, descriptors: [] }],
  },
  ...SERVICES,
];

const READ = {
  address: ADDRESS,
  service: BOT,
  characteristic: 'cba20003-224d-11e6-9fb8-0002a5d5c51b',
};

/**
 * An error a proxy throws for a handle the device refused.
 *
 * @returns It.
 */
const stale = () =>
  Object.assign(new Error('refused a handle of the list'), { code: BLUETOOTH_GATT_STALE });

/**
 * Links over a fake proxy with three connections.
 *
 * @param answer - What the proxy answers each op; a thrown error is its failure.
 * @returns The links, and the ops sent - `connect cached` when it carried the services.
 */
function setup(answer: (op: string, args: JsonObject) => unknown) {
  const sent: string[] = [];
  const links = new BluetoothLinks(
    async (deviceId, op, args) => {
      sent.push(`${op.replace('bluetooth-proxy.', '')}${'database' in args ? ' cached' : ''}`);

      // A proxy answers later.
      await Promise.resolve();

      return answer(op, args);
    },
    () => undefined,
  );

  links.setSlots(PROXY, { free: 3, limit: 3 });

  return { links, sent };
}

/**
 * A proxy that searches when it has no services, answering with `database`.
 *
 * @param database - What it finds.
 * @param more - Its answers to the other ops.
 * @returns The answers.
 */
const proxyFinding =
  (database: unknown, more: (op: string, args: JsonObject) => unknown = () => null) =>
  (op: string, args: JsonObject): unknown =>
    op === BLUETOOTH_PROXY_GATT_OPS.connect
      ? 'database' in args
        ? { mtu: 247 }
        : { mtu: 247, database }
      : more(op, args);

const deadline = () => AbortSignal.timeout(10_000);

afterEach(() => {
  vi.useRealTimers();
});

describe('the services a proxy found', () => {
  it('are searched once, then handed to the next connect, through any proxy', async () => {
    const { links, sent } = setup(proxyFinding(SERVICES));

    links.setSlots('other', { free: 1, limit: 1 });
    await links.connect(ADDRESS, PROXY, deadline());
    links.lost(PROXY, ADDRESS, 'gone');
    await links.connect(ADDRESS, 'other', deadline());

    expect(sent).toEqual(['connect', 'connect cached']);
  });

  it('are trusted for 24 h when the device has no Database Hash', async () => {
    vi.useFakeTimers({ now: 0, toFake: ['Date'] });

    const { links, sent } = setup(proxyFinding(SERVICES));

    await links.connect(ADDRESS, PROXY, deadline());
    links.lost(PROXY, ADDRESS, 'gone');
    vi.setSystemTime(DATABASE_TTL_MS - 1);
    await links.connect(ADDRESS, PROXY, deadline());
    links.lost(PROXY, ADDRESS, 'gone');
    vi.setSystemTime(2 * DATABASE_TTL_MS);
    await links.connect(ADDRESS, PROXY, deadline());

    expect(sent).toEqual(['connect', 'connect cached', 'connect']);
  });

  it('are checked against the Database Hash at each connect, and searched again when it changed', async () => {
    vi.useFakeTimers({ now: 0, toFake: ['Date'] });

    const hashes = ['aa', 'aa', 'bb', 'cc'];
    const { links, sent } = setup(
      proxyFinding(WITH_HASH, (op) =>
        op === BLUETOOTH_PROXY_GATT_OPS.read ? { data: hashes.shift() } : null,
      ),
    );

    await links.connect(ADDRESS, PROXY, deadline());
    links.lost(PROXY, ADDRESS, 'gone');
    // A hash it can check is trusted however old.
    vi.setSystemTime(3 * DATABASE_TTL_MS);
    await links.connect(ADDRESS, PROXY, deadline());
    links.lost(PROXY, ADDRESS, 'gone');
    await links.connect(ADDRESS, PROXY, deadline());

    expect(sent).toEqual([
      'connect',
      'read',
      'connect cached',
      'read',
      'connect cached',
      'read',
      'disconnect',
      'connect',
      'read',
    ]);
    expect(links.connections(PROXY)).toEqual({ used: 1, max: 3 });
  });

  it('fall back to 24 h when the hash cannot be read', async () => {
    vi.useFakeTimers({ now: 0, toFake: ['Date'] });

    const { links, sent } = setup(
      proxyFinding(WITH_HASH, (op) => {
        if (op === BLUETOOTH_PROXY_GATT_OPS.read) {
          throw new Error('insufficient authentication');
        }

        return null;
      }),
    );

    await links.connect(ADDRESS, PROXY, deadline());
    links.lost(PROXY, ADDRESS, 'gone');
    await links.connect(ADDRESS, PROXY, deadline());
    links.lost(PROXY, ADDRESS, 'gone');
    vi.setSystemTime(DATABASE_TTL_MS);
    await links.connect(ADDRESS, PROXY, deadline());

    expect(sent).toEqual(['connect', 'read', 'connect cached', 'connect', 'read']);
  });

  it('are not kept when they do not hold together', async () => {
    const twice = [{ ...SERVICES[0], handle: 0x32 }];
    const { links, sent } = setup(proxyFinding(twice));

    await links.connect(ADDRESS, PROXY, deadline());
    links.lost(PROXY, ADDRESS, 'gone');
    await links.connect(ADDRESS, PROXY, deadline());

    expect(sent).toEqual(['connect', 'connect']);
  });
});

describe('a request on services handed over', () => {
  /**
   * Links already holding the services, connected with them.
   *
   * @param more - The proxy's answers to the other ops.
   * @returns The links and the ops sent since that connect.
   */
  async function cached(more: (op: string, args: JsonObject) => unknown) {
    const { links, sent } = setup(proxyFinding(SERVICES, more));

    await links.connect(ADDRESS, PROXY, deadline());
    links.lost(PROXY, ADDRESS, 'gone');
    await links.connect(ADDRESS, PROXY, deadline());
    sent.length = 0;

    return { links, sent };
  }

  it('is carried out once more, searching, when the device refused it before anything was done', async () => {
    let isFirst = true;
    const { links, sent } = await cached((op) => {
      if (op === BLUETOOTH_PROXY_GATT_OPS.read && isFirst) {
        isFirst = false;
        throw stale();
      }

      return op === BLUETOOTH_PROXY_GATT_OPS.read ? { data: '64' } : null;
    });

    await expect(
      links.request(ADDRESS, BLUETOOTH_PROXY_GATT_OPS.read, READ, deadline()),
    ).resolves.toEqual({ data: '64' });
    expect(sent).toEqual(['read', 'disconnect', 'connect', 'read']);
    expect(links.connections(PROXY)).toEqual({ used: 1, max: 3 });
  });

  it('is never carried out again once one was answered on the link, and the services are forgotten', async () => {
    let reads = 0;
    const { links, sent } = await cached((op) => {
      if (op === BLUETOOTH_PROXY_GATT_OPS.read && reads++ > 0) {
        throw stale();
      }

      return { data: '64' };
    });

    await links.request(ADDRESS, BLUETOOTH_PROXY_GATT_OPS.read, READ, deadline());
    await expect(
      links.request(ADDRESS, BLUETOOTH_PROXY_GATT_OPS.read, READ, deadline()),
    ).rejects.toMatchObject({ code: BLUETOOTH_GATT_STALE });
    links.lost(PROXY, ADDRESS, 'gone');
    await links.connect(ADDRESS, PROXY, deadline());

    expect(sent).toEqual(['read', 'read', 'connect']);
  });

  it('that fails any other way is not carried out again, and the services are forgotten', async () => {
    const { links, sent } = await cached(() => {
      throw new Error('did not answer within 5000 ms');
    });

    await expect(
      links.request(ADDRESS, BLUETOOTH_PROXY_GATT_OPS.read, READ, deadline()),
    ).rejects.toThrow('did not answer');
    links.lost(PROXY, ADDRESS, 'gone');
    await links.connect(ADDRESS, PROXY, deadline());

    expect(sent).toEqual(['read', 'connect']);
  });
});
