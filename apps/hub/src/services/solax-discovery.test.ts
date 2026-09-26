/**
 * The SolaX listener's sweep: which addresses a network is, from its real netmask, and whether a
 * port is open. The identification itself is the transports' own, tested beside them.
 */
import { createServer, type Server } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** The module, where the bundle ships it. */
const MODULE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../bundles/solax/lan/discovery.js',
);

/** What the module exports for the sweep. */
type Sweep = {
  readonly hostsOf: (address: string, prefix: number) => string[];
  readonly isOpen: (host: string, port: number, signal: AbortSignal) => Promise<boolean>;
};

let sweep: Sweep;
let server: Server;
let port = 0;

beforeAll(async () => {
  sweep = (await import(pathToFileURL(MODULE).href)) as Sweep;
  server = createServer((socket) => {
    socket.end();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();

  port = typeof address === 'object' && address !== null ? address.port : 0;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

describe('the SolaX sweep', () => {
  it('asks the whole of a /22 from its netmask, not the /24 its address suggests', () => {
    const hosts = sweep.hostsOf('192.168.5.20', 22);

    expect(hosts).toHaveLength(1021);
    expect(hosts[0]).toBe('192.168.4.1');
    expect(hosts.at(-1)).toBe('192.168.7.254');
    expect(hosts).not.toContain('192.168.5.20');
  });

  it('asks a /24 whole, and only the /22 around the hub of anything wider', () => {
    expect(sweep.hostsOf('10.0.0.7', 24)).toHaveLength(253);

    const wide = sweep.hostsOf('10.20.130.7', 16);

    expect(wide).toHaveLength(1021);
    expect(wide[0]).toBe('10.20.128.1');
  });

  it('knows a port that accepts from one that does not', async () => {
    const signal = AbortSignal.timeout(5000);

    await expect(sweep.isOpen('127.0.0.1', port, signal)).resolves.toBe(true);

    const closed = createServer();

    await new Promise<void>((resolve) => {
      closed.listen(0, '127.0.0.1', resolve);
    });

    const address = closed.address();
    const freed = typeof address === 'object' && address !== null ? address.port : 0;

    await new Promise<void>((resolve) => {
      closed.close(() => {
        resolve();
      });
    });

    await expect(sweep.isOpen('127.0.0.1', freed, signal)).resolves.toBe(false);
  });
});
