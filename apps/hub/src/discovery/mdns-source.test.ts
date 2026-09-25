/**
 * The platform's mDNS source: what it makes of a service, what it asks and when, and a real round
 * trip on this host.
 */
import { Writable } from 'node:stream';

import createMulticastDns, {
  type MulticastDns,
  type MulticastDnsOptions,
  type MulticastDnsPacket,
  type MulticastDnsQuestion,
  type MulticastDnsRemote,
} from 'multicast-dns';
import { describe, expect, it } from 'vitest';

import { createLogger, type PlatformLogger } from '@nebula-home/logging';
import type { MdnsAnnouncement } from '@nebula-home/package-runtime';

import { createMdnsSource, isPrivateIpv4, toAnnouncement } from './mdns-source.js';

/**
 * A logger that writes nowhere.
 *
 * @returns A logger bound to a discarding stream.
 */
function silent(): PlatformLogger {
  return createLogger(
    { service: 'hub-mdns', version: '0.0.0', level: 'fatal' },
    new Writable({
      /**
       * Discards a chunk.
       *
       * @param chunk - Ignored.
       * @param encoding - Ignored.
       * @param done - Called to accept the write.
       */
      write(chunk, encoding, done): void {
        done();
      },
    }),
  );
}

describe('isPrivateIpv4', () => {
  it('accepts the ranges a house network uses, and link-local', () => {
    expect(
      ['192.168.1.40', '10.0.0.7', '172.16.4.2', '172.31.255.1', '169.254.3.3'].map(isPrivateIpv4),
    ).toEqual([true, true, true, true, true]);
  });

  it('refuses a public address, an IPv6 one and anything that is not an address', () => {
    // Announcements are not authenticated: whatever is on the network may announce anything,
    // and the hub must not be talked into probing a host on the internet.
    expect(['8.8.8.8', '172.32.0.1', 'fe80::1', 'shelly.local', ''].map(isPrivateIpv4)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('accepts loopback, for a device simulated on the hub itself', () => {
    expect(isPrivateIpv4('127.0.0.1')).toBe(true);
  });
});

describe('toAnnouncement', () => {
  it('reads the instance, the address, the port and the TXT record as text', () => {
    const announcement = toAnnouncement(
      {
        name: 'shellyplus1pm-a8032ab12345',
        host: 'shellyplus1pm-a8032ab12345.local',
        port: 80,
        addresses: ['fe80::1', '192.168.1.40'],
        txt: { gen: '2', app: 'Plus1PM', ver: Buffer.from('1.4.2'), auth: true },
      },
      '_shelly._tcp',
    );

    expect(announcement).toEqual({
      service: '_shelly._tcp',
      instance: 'shellyplus1pm-a8032ab12345',
      host: 'shellyplus1pm-a8032ab12345.local',
      address: '192.168.1.40',
      port: 80,
      txt: { gen: '2', app: 'Plus1PM', ver: '1.4.2', auth: '' },
    });
  });

  it('falls back on the address the answer came from when the record carries none', () => {
    const announcement = toAnnouncement(
      {
        name: 'eWeLink_1000abcd',
        host: 'x.local',
        port: 8081,
        referer: { address: '192.168.1.50' },
      },
      '_ewelink._tcp',
    );

    expect(announcement?.address).toBe('192.168.1.50');
    expect(announcement?.txt).toEqual({});
  });

  it('reports nothing for a device with no private IPv4 address to reach it at', () => {
    expect(
      toAnnouncement(
        { name: 'far', host: 'far.local', port: 80, addresses: ['8.8.8.8', 'fe80::1'] },
        '_shelly._tcp',
      ),
    ).toBeNull();
  });
});

/** A socket the test drives: what it was opened with, what it asked, and a way to answer it. */
type FakeSocket = {
  readonly options: MulticastDnsOptions;
  readonly questions: MulticastDnsQuestion[][];
  isDestroyed: boolean;
  readonly answer: (packet: MulticastDnsPacket, from?: string) => void;
  readonly fail: (error: Error) => void;
};

/**
 * Opens fake sockets and keeps them for the test.
 *
 * @returns The opener, and every socket it opened.
 */
function fakeSockets(): {
  readonly open: (options: MulticastDnsOptions) => MulticastDns;
  readonly opened: FakeSocket[];
} {
  const opened: FakeSocket[] = [];

  return {
    opened,
    open: (options) => {
      const listeners = new Map<string, ((...args: never[]) => void)[]>();
      const fake: FakeSocket = {
        options,
        questions: [],
        isDestroyed: false,
        answer: (packet, from = '192.168.1.40') => {
          for (const listener of listeners.get('response') ?? []) {
            (listener as (packet: MulticastDnsPacket, remote: MulticastDnsRemote) => void)(packet, {
              address: from,
              port: 5353,
            });
          }
        },
        fail: (error) => {
          for (const listener of listeners.get('error') ?? []) {
            (listener as (error: Error) => void)(error);
          }
        },
      };
      const socket = {
        on: (event: string, listener: (...args: never[]) => void) => {
          listeners.set(event, [...(listeners.get(event) ?? []), listener]);

          return socket;
        },
        query: (query: { readonly questions: readonly MulticastDnsQuestion[] }) => {
          fake.questions.push([...query.questions]);
        },
        destroy: (callback?: () => void) => {
          fake.isDestroyed = true;
          callback?.();
        },
      } as unknown as MulticastDns;

      opened.push(fake);

      return socket;
    },
  };
}

/** A Shelly's PTR answer, and the records a full answer carries beside it. */
const PTR = {
  name: '_shelly._tcp.local',
  type: 'PTR',
  ttl: 120,
  data: 'shelly0110dimg3-80b54e331ee0._shelly._tcp.local',
};
const SRV = {
  name: 'shelly0110dimg3-80b54e331ee0._shelly._tcp.local',
  type: 'SRV',
  ttl: 120,
  data: { target: 'ShellyDimmerG3-80B54E331EE0.local', port: 80, priority: 0, weight: 0 },
};
const TXT = {
  name: 'shelly0110dimg3-80b54e331ee0._shelly._tcp.local',
  type: 'TXT',
  ttl: 120,
  data: [Buffer.from('gen=3'), Buffer.from('app=Dimmer0110VPMG3'), Buffer.from('ver=2.0.0')],
};
const A = {
  name: 'ShellyDimmerG3-80B54E331EE0.local',
  type: 'A',
  ttl: 120,
  data: '192.168.178.116',
};

describe('createMdnsSource', () => {
  it('asks on every interface of this machine, each from its own socket, one question a packet', () => {
    const { open, opened } = fakeSockets();
    const source = createMdnsSource({
      logger: silent(),
      open,
      interfaces: () => ['192.168.178.20', '172.24.64.1'],
    });

    source.start(['_shelly._tcp', '_http._tcp'], () => undefined);
    source.query();

    // Bound to every address, so that Linux delivers the group's packets to each of them.
    expect(opened.map((socket) => socket.options)).toEqual([
      { interface: '192.168.178.20', bind: '0.0.0.0' },
      { interface: '172.24.64.1', bind: '0.0.0.0' },
    ]);

    // One question a packet: a Shelly Gen3 leaves unanswered a packet whose first question it
    // does not answer.
    for (const socket of opened) {
      expect(socket.questions).toEqual([
        [{ name: '_shelly._tcp.local', type: 'PTR' }],
        [{ name: '_http._tcp.local', type: 'PTR' }],
      ]);
    }
  });

  it('reports a device from a whole answer, with its address, port and TXT record', () => {
    const { open, opened } = fakeSockets();
    const heard: MdnsAnnouncement[] = [];
    const source = createMdnsSource({ logger: silent(), open, interfaces: () => ['10.0.0.2'] });

    source.start(['_shelly._tcp'], (announcement) => {
      heard.push(announcement);
    });
    opened[0]?.answer({ answers: [PTR], additionals: [SRV, TXT, A] });

    expect(heard).toEqual([
      {
        service: '_shelly._tcp',
        instance: 'shelly0110dimg3-80b54e331ee0',
        host: 'ShellyDimmerG3-80B54E331EE0.local',
        address: '192.168.178.116',
        port: 80,
        txt: { gen: '3', app: 'Dimmer0110VPMG3', ver: '2.0.0' },
      },
    ]);
  });

  it('asks for what an answer left out, and reports the device once it has it', () => {
    // A PTR answer alone says a device exists, not where: the SRV and TXT records are asked for by
    // name rather than the device being ignored until it announces itself again.
    const { open, opened } = fakeSockets();
    const heard: MdnsAnnouncement[] = [];
    const source = createMdnsSource({ logger: silent(), open, interfaces: () => ['10.0.0.2'] });

    source.start(['_shelly._tcp'], (announcement) => {
      heard.push(announcement);
    });
    opened[0]?.answer({ answers: [PTR] });

    expect(heard).toEqual([]);
    expect(opened[0]?.questions).toEqual([
      [{ name: 'shelly0110dimg3-80b54e331ee0._shelly._tcp.local', type: 'SRV' }],
      [{ name: 'shelly0110dimg3-80b54e331ee0._shelly._tcp.local', type: 'TXT' }],
    ]);

    opened[0]?.answer({ answers: [SRV, TXT], additionals: [A] });

    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ address: '192.168.178.116', port: 80 });
  });

  it('reports a device again on every question while it is remembered, and not after goodbye', () => {
    const { open, opened } = fakeSockets();
    const heard: MdnsAnnouncement[] = [];
    const source = createMdnsSource({ logger: silent(), open, interfaces: () => ['10.0.0.2'] });

    source.start(['_shelly._tcp'], (announcement) => {
      heard.push(announcement);
    });
    opened[0]?.answer({ answers: [PTR], additionals: [SRV, TXT, A] });
    source.query();

    expect(heard).toHaveLength(2);

    opened[0]?.answer({ answers: [{ ...PTR, ttl: 0 }] });
    source.query();

    expect(heard).toHaveLength(2);
  });

  it('ignores what it was not asked to browse for', () => {
    const { open, opened } = fakeSockets();
    const heard: MdnsAnnouncement[] = [];
    const source = createMdnsSource({ logger: silent(), open, interfaces: () => ['10.0.0.2'] });

    source.start(['_ewelink._tcp'], (announcement) => {
      heard.push(announcement);
    });
    opened[0]?.answer({ answers: [PTR], additionals: [SRV, TXT, A] });

    expect(heard).toEqual([]);
  });

  it('logs a socket that fails, and opens it again at the next question', () => {
    const { open, opened } = fakeSockets();
    const source = createMdnsSource({ logger: silent(), open, interfaces: () => ['10.0.0.2'] });

    source.start(['_shelly._tcp'], () => undefined);

    expect(() => {
      opened[0]?.fail(Object.assign(new Error('bind EADDRINUSE'), { code: 'EADDRINUSE' }));
    }).not.toThrow();
    expect(opened[0]?.isDestroyed).toBe(true);

    source.query();

    expect(opened).toHaveLength(2);
    expect(opened[1]?.questions).toEqual([[{ name: '_shelly._tcp.local', type: 'PTR' }]]);
  });

  it('asks from one socket on the system default when no interface is on a house network', () => {
    const { open, opened } = fakeSockets();
    const source = createMdnsSource({ logger: silent(), open, interfaces: () => [] });

    source.start(['_shelly._tcp'], () => undefined);

    expect(opened.map((socket) => socket.options)).toEqual([{}]);
  });

  it('hears a service announced on this host, and only the services it was asked for', async () => {
    // A real round trip over the loopback of the multicast group: a responder answers the PTR
    // question the way a device does.
    const responder = createMulticastDns();
    const heard: MdnsAnnouncement[] = [];
    const source = createMdnsSource({ logger: silent() });

    responder.on('query', (query: { readonly questions: readonly MulticastDnsQuestion[] }) => {
      if (query.questions.some((question) => question.name === '_nebulatest._tcp.local')) {
        responder.respond({
          answers: [
            {
              name: '_nebulatest._tcp.local',
              type: 'PTR',
              ttl: 120,
              data: 'nebula-relay-one._nebulatest._tcp.local',
            },
          ],
          additionals: [
            {
              name: 'nebula-relay-one._nebulatest._tcp.local',
              type: 'SRV',
              ttl: 120,
              data: { target: 'nebula-relay-one.local', port: 8081, priority: 0, weight: 0 },
            },
            {
              name: 'nebula-relay-one._nebulatest._tcp.local',
              type: 'TXT',
              ttl: 120,
              data: ['id=r1', 'type=diy_plug'],
            },
            { name: 'nebula-relay-one.local', type: 'A', ttl: 120, data: '127.0.0.1' },
          ],
        });
      }
    });

    source.start(['_nebulatest._tcp'], (announcement) => {
      heard.push(announcement);
    });

    for (let attempt = 0; attempt < 150 && heard.length === 0; attempt += 1) {
      if (attempt % 25 === 0) {
        source.query();
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    await source.stop();
    await new Promise<void>((resolve) => {
      responder.destroy(() => {
        resolve();
      });
    });

    expect(heard[0]).toMatchObject({
      service: '_nebulatest._tcp',
      instance: 'nebula-relay-one',
      port: 8081,
      txt: { id: 'r1', type: 'diy_plug' },
    });
    expect(heard.every((announcement) => announcement.service === '_nebulatest._tcp')).toBe(true);
  });
});
