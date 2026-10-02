/**
 * The managed UDP sockets, against real sockets on the loopback interface.
 *
 * What is checked is what a bundle cannot be trusted to do on its own: that a datagram arrives
 * with who sent it, that closing leaves the port free, and that every socket a vendor opened is
 * closed when the vendor is, whatever the bundle remembered to do.
 */
import { createSocket } from 'node:dgram';
import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger, type PlatformLogger } from '@nebulahome/logging';
import type { UdpPeer } from '@nebulahome/package-runtime';

import { createUdpSockets } from './managed-udp.js';

/**
 * A logger that writes nowhere.
 *
 * @returns A logger bound to a discarding stream.
 */
function silent(): PlatformLogger {
  return createLogger(
    { service: 'hub-udp', version: '0.0.0', level: 'fatal' },
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

/**
 * Waits until a condition holds, polling.
 *
 * @param condition - What to wait for.
 * @param timeoutMs - How long before giving up.
 */
async function until(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting');
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('createUdpSockets', () => {
  it('delivers a datagram as bytes, with the address and port it came from', async () => {
    const sockets = createUdpSockets(silent());
    const heard: { message: string; from: UdpPeer }[] = [];
    const listener = sockets.open({
      onMessage: (message, from) => {
        heard.push({ message: message.toString(), from });
      },
    });
    const sender = sockets.open({ onMessage: () => undefined });

    await sender.send('{"msg":"scan"}', await portOf(listener), '127.0.0.1');
    await until(() => heard.length > 0);

    expect(heard[0]?.message).toBe('{"msg":"scan"}');
    expect(heard[0]?.from).toEqual({ address: '127.0.0.1', port: await portOf(sender) });

    await sockets.closeAll();
  });

  it('listens on the port a bundle asks for, as a device answering to a fixed port needs', async () => {
    const free = await freePort();
    const sockets = createUdpSockets(silent());
    const heard: string[] = [];

    sockets.open({
      port: free,
      onMessage: (message) => {
        heard.push(message.toString());
      },
    });

    const probe = createSocket('udp4');

    await until(() => {
      probe.send('hello', free, '127.0.0.1');

      return heard.length > 0;
    });
    probe.close();
    await sockets.closeAll();

    expect(heard[0]).toBe('hello');
  });

  it('refuses to send once closed', async () => {
    const sockets = createUdpSockets(silent());
    const socket = sockets.open({ onMessage: () => undefined });

    await socket.close();

    await expect(socket.send('late', 9, '127.0.0.1')).rejects.toThrow(/closed/);
    await sockets.closeAll();
  });

  it("closes every socket a vendor opened when the vendor's are closed, freeing the ports", async () => {
    // A bundle that forgot to close would otherwise hold its port until the hub restarted, and
    // a vendor reloaded after an update could not bind it again.
    const free = await freePort();
    const sockets = createUdpSockets(silent());

    sockets.open({ port: free, onMessage: () => undefined });
    await sockets.closeAll();

    const again = createUdpSockets(silent());
    const reopened = again.open({ port: free, onMessage: () => undefined });

    expect(await portOf(reopened)).toBe(free);
    await again.closeAll();
  });

  it('reports a port it could not bind rather than throwing into the bundle', async () => {
    const free = await freePort();
    const holder = createSocket('udp4');

    await new Promise<void>((resolve) => {
      holder.bind(free, '0.0.0.0', resolve);
    });

    const errors: Error[] = [];
    const sockets = createUdpSockets(silent());
    const socket = sockets.open({
      port: free,
      onMessage: () => undefined,
      onError: (error) => {
        errors.push(error);
      },
    });

    await until(() => errors.length > 0);
    await expect(socket.send('x', 9, '127.0.0.1')).rejects.toThrow();

    holder.close();
    await sockets.closeAll();
  });
});

/**
 * Waits for a socket to bind and reads its port.
 *
 * @param socket - The socket.
 * @param socket.port - The port it reports.
 * @returns The port, once it is not zero.
 */
async function portOf(socket: { readonly port: number }): Promise<number> {
  await until(() => socket.port !== 0);

  return socket.port;
}

/**
 * Finds a port nothing is bound to.
 *
 * @returns The port.
 */
async function freePort(): Promise<number> {
  const socket = createSocket('udp4');

  await new Promise<void>((resolve) => {
    socket.bind(0, '127.0.0.1', resolve);
  });

  const { port } = socket.address();

  await new Promise<void>((resolve) => {
    socket.close(() => {
      resolve();
    });
  });

  return port;
}
