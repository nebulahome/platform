import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defineTransport } from './transport.js';

/**
 * A transport that records what it was asked to probe.
 *
 * @param probed - Where the configurations it saw are collected.
 * @returns The transport, as a registry would hold it.
 */
function recorder(probed: unknown[]) {
  return defineTransport({
    id: 'fake',
    configSchema: z.object({ host: z.string().min(1) }),
    connectionKey: (config) => `fake:${config.host}`,
    connect: () => Promise.reject(new Error('not used here')),
    scan: async function* scan() {
      yield* await Promise.resolve([]);
    },
    probe: (config) => {
      probed.push(config);

      return Promise.resolve(`${config.host} answered`);
    },
  });
}

describe('defineTransport', () => {
  it('validates the settings before letting the transport probe them', async () => {
    const probed: unknown[] = [];
    const transport = recorder(probed);

    await expect(transport.probe({ host: '' }, AbortSignal.timeout(100))).rejects.toThrow();
    expect(probed).toEqual([]);
  });

  it('hands a valid configuration through and returns what the transport said', async () => {
    const probed: unknown[] = [];
    const transport = recorder(probed);

    await expect(transport.probe({ host: '192.168.1.40' }, AbortSignal.timeout(100))).resolves.toBe(
      '192.168.1.40 answered',
    );
    expect(probed).toEqual([{ host: '192.168.1.40' }]);
  });
});
