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

import type { BundleSdk, TransportFactory } from './sdk.js';
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
