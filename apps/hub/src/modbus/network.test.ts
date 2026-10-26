import { createServer } from 'node:net';

import { describe, expect, it } from 'vitest';

import { hostsOf, hostsOfRanges, isOpen, sweep } from './network.js';

describe('the addresses a search knocks on', () => {
  it('asks a network around the hub, at most a /22, the hub left out', () => {
    const hosts = hostsOf('192.168.1.10', 24);

    expect(hosts).toHaveLength(253);
    expect(hosts).not.toContain('192.168.1.10');
    expect(hostsOf('10.0.0.5', 16)).toHaveLength(1021);
  });

  it('asks the owner’s ranges as written', () => {
    expect(hostsOfRanges(['192.168.1.0/30'])).toEqual(['192.168.1.1', '192.168.1.2']);
    expect(hostsOfRanges(['10.0.0.20-10.0.0.22', '10.0.0.21', '10.0.0.7'])).toEqual([
      '10.0.0.20',
      '10.0.0.21',
      '10.0.0.22',
      '10.0.0.7',
    ]);
  });
});

describe('knocking', () => {
  it('finds the addresses whose port accepts', async () => {
    const listener = createServer((socket) => socket.destroy());

    await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));

    const address = listener.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    try {
      expect(await isOpen('127.0.0.1', port)).toBe(true);
      expect(
        await sweep(
          ['127.0.0.1', '127.0.0.2'],
          async (host) => host === '127.0.0.1' && (await isOpen(host, port)),
        ),
      ).toEqual(['127.0.0.1']);
    } finally {
      listener.close();
    }
  });
});
