/**
 * The SDK a bundle's own code is written against.
 *
 * The one thing worth checking is that a transport can be written from the SDK alone - the
 * runtime's zod, `defineTransport`, a socket - with nothing imported from the platform, and
 * that what comes out is a transport the registry would hold like one of the platform's own.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createLogger } from '@nebula-home/logging';

import type { DiscoverySourceFactory, Sighting } from './discovery.js';
import type { BundleSdk, ManagedUdpSocketOptions, TransportFactory } from './sdk.js';
import { defineTransport } from './transport.js';

describe('BundleSdk', () => {
  it('is enough to write a transport against, with nothing imported from the platform', async () => {
    const sdk: BundleSdk = {
      version: '1.0.0',
      z,
      logger: createLogger({ service: 'test', version: '0.0.0', level: 'fatal' }),
      defineTransport,
      openWebSocket: () => {
        throw new Error('not opened in this test');
      },
      openUdpSocket: () => {
        throw new Error('not opened in this test');
      },
    };
    const factory: TransportFactory = (given) =>
      given.defineTransport({
        id: 'vendor/wire',
        configSchema: given.z.object({ host: given.z.string() }),
        connectionKey: (config) => config.host,
        connect: () => Promise.reject(new Error('unused')),
        // eslint-disable-next-line @typescript-eslint/no-empty-function -- a scan that finds nothing
        scan: async function* scan() {},
        probe: () => Promise.resolve(given.version),
      });

    const transport = factory(sdk);

    expect(transport.id).toBe('vendor/wire');
    expect(transport.connectionKey({ host: 'a' })).toBe('a');
    await expect(transport.probe({ host: 'a' }, new AbortController().signal)).resolves.toBe(
      '1.0.0',
    );
  });
});

describe('BundleSdk.openUdpSocket', () => {
  it('is enough to write a discovery module against: ask the network, report who answers', async () => {
    // A fake socket standing in for the hub's: whatever is sent to the multicast group is
    // answered by one device, the way a Govee light answers a scan.
    let options: ManagedUdpSocketOptions | undefined;
    const sdk: BundleSdk = {
      version: '1.1.0',
      z,
      logger: createLogger({ service: 'test', version: '0.0.0', level: 'fatal' }),
      defineTransport,
      openWebSocket: () => {
        throw new Error('not opened in this test');
      },
      openUdpSocket: (given) => {
        options = given;

        return {
          port: given.port ?? 0,
          send: (message) => {
            options?.onMessage(Buffer.from(`{"device":"AA:BB","asked":"${String(message)}"}`), {
              address: '192.168.1.60',
              port: 4003,
            });

            return Promise.resolve();
          },
          close: () => Promise.resolve(),
        };
      },
    };
    const factory: DiscoverySourceFactory = (given) => ({
      listen: async function* listen(signal): AsyncGenerator<Sighting> {
        const heard: Sighting[] = [];
        const socket = given.openUdpSocket({
          port: 4002,
          multicast: { group: '239.255.255.250' },
          onMessage: (message, from) => {
            heard.push({
              config: { host: from.address },
              payload: given.z
                .record(given.z.string(), given.z.string())
                .parse(JSON.parse(message.toString())),
            });
          },
        });

        await socket.send('scan', 4001, '239.255.255.250');
        yield* heard;

        if (signal.aborted) {
          await socket.close();
        }
      },
    });

    const sightings: Sighting[] = [];

    for await (const sighting of factory(sdk).listen(new AbortController().signal)) {
      sightings.push(sighting);
    }

    expect(options?.multicast?.group).toBe('239.255.255.250');
    expect(sightings).toEqual([
      { config: { host: '192.168.1.60' }, payload: { device: 'AA:BB', asked: 'scan' } },
    ]);
  });
});
