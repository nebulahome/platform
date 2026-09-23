/**
 * The platform's mDNS source: what it makes of a service, and a real round trip on this host.
 */
import { Writable } from 'node:stream';

import BonjourModule from 'bonjour-service';
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

describe('createMdnsSource', () => {
  it('hears a service announced on this host, and only the services it was asked for', async () => {
    const publisher = new BonjourModule();
    const heard: MdnsAnnouncement[] = [];
    const source = createMdnsSource({ logger: silent() });

    source.start(['_nebulatest._tcp'], (announcement) => {
      heard.push(announcement);
    });
    publisher.publish({
      name: 'nebula-relay-one',
      type: 'nebulatest',
      port: 8081,
      txt: { id: 'r1', type: 'diy_plug' },
    });
    publisher.publish({ name: 'unrelated', type: 'nebulaother', port: 9 });

    for (let attempt = 0; attempt < 150 && heard.length === 0; attempt += 1) {
      if (attempt % 25 === 0) {
        source.query();
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    await source.stop();
    await new Promise<void>((resolve) => {
      publisher.unpublishAll(() => {
        publisher.destroy();
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
