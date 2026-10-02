/**
 * UDP sockets the hub holds on a bundle's behalf.
 *
 * Some devices speak datagrams: a Govee light answers a multicast scan on one port and takes its
 * commands on another, a Broadlink blaster is addressed by broadcast. A bundle asks for a socket
 * through the SDK rather than `node:dgram`, for the reason the managed WebSocket exists - the
 * hub then owns what outlives a mistake. Every socket a vendor opens is tracked, and closed when
 * the vendor is, so a bundle that forgot cannot hold a port until the hub restarts.
 *
 * Binding is asynchronous and the socket is handed back at once: a send waits for the bind, and a
 * bind that failed - the port is taken - is reported to the bundle through `onError` and makes
 * every send fail, rather than throwing into code that did not expect it.
 */
import { createSocket, type Socket } from 'node:dgram';

import type { PlatformLogger } from '@nebulahome/logging';
import type {
  ManagedUdpSocket,
  ManagedUdpSocketOptions,
  OpenUdpSocket,
} from '@nebulahome/package-runtime';

/** The UDP sockets of one vendor, and the way to close them all. */
export type UdpSockets = {
  /** Opens one socket, tracked until it or all of them are closed. */
  readonly open: OpenUdpSocket;

  /**
   * Closes every socket still open.
   *
   * @returns A promise that settles once every port is free.
   */
  readonly closeAll: () => Promise<void>;
};

/**
 * Closes a socket, once.
 *
 * @param socket - The socket.
 * @returns A promise that settles once it is closed.
 */
async function closeSocket(socket: Socket): Promise<void> {
  await new Promise<void>((resolve) => {
    try {
      socket.close(() => {
        resolve();
      });
    } catch {
      // Closed already, which is where it was going.
      resolve();
    }
  });
}

/**
 * Binds a socket and sets it up as asked.
 *
 * @param socket - The socket, not yet bound.
 * @param options - What the bundle asked for.
 * @returns A promise that settles once it is bound and has joined its group.
 */
async function bind(socket: Socket, options: ManagedUdpSocketOptions): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(options.port ?? 0, () => {
      socket.off('error', reject);
      resolve();
    });
  });

  if (options.multicast !== undefined) {
    socket.addMembership(options.multicast.group);
    socket.setMulticastLoopback(options.multicast.loopback ?? false);
  }

  if (options.broadcast === true) {
    socket.setBroadcast(true);
  }
}

/**
 * Makes the UDP sockets of one vendor.
 *
 * @param logger - Where a socket's failures are logged, before the bundle hears of them.
 * @returns The opener the SDK hands the vendor, and the way to close what it opened.
 */
export function createUdpSockets(logger: PlatformLogger): UdpSockets {
  const open = new Set<ManagedUdpSocket>();

  /**
   * Opens one socket.
   *
   * @param options - What the bundle asked for.
   * @returns The socket, binding.
   */
  const openOne = (options: ManagedUdpSocketOptions): ManagedUdpSocket => {
    const socket = createSocket({
      type: 'udp4',
      reuseAddr: options.reuseAddr ?? options.multicast !== undefined,
    });
    let isClosed = false;

    /**
     * Logs a failure and tells the bundle.
     *
     * @param error - What failed.
     */
    const report = (error: Error): void => {
      logger.warn({ err: error, port: options.port }, 'A bundle UDP socket failed');
      options.onError?.(error);
    };

    const ready = bind(socket, options);

    ready.then(
      () => {
        socket.on('error', report);
      },
      (error: unknown) => {
        report(error instanceof Error ? error : new Error(String(error)));
      },
    );

    socket.on('message', (message, from) => {
      options.onMessage(message, { address: from.address, port: from.port });
    });

    const managed: ManagedUdpSocket = {
      /**
       * The port the socket is bound to.
       *
       * @returns The port, or 0 until it has bound.
       */
      get port(): number {
        try {
          return socket.address().port;
        } catch {
          return 0;
        }
      },

      /**
       * Sends one datagram, once the socket has bound.
       *
       * @param message - What to send.
       * @param port - Where to.
       * @param address - To whom.
       * @returns A promise that settles once it is sent.
       * @throws {Error} When the socket is closed, did not bind, or the send failed.
       */
      send: async (message: Buffer | string, port: number, address: string): Promise<void> => {
        if (isClosed) {
          throw new Error('The UDP socket is closed');
        }

        await ready;
        await new Promise<void>((resolve, reject) => {
          socket.send(message, port, address, (error) => {
            if (error === null) {
              resolve();
            } else {
              reject(error);
            }
          });
        });
      },

      /**
       * Closes for good, leaving the group.
       *
       * @returns A promise that settles once the port is free.
       */
      close: async (): Promise<void> => {
        if (isClosed) {
          return;
        }

        isClosed = true;
        open.delete(managed);
        await closeSocket(socket);
      },
    };

    open.add(managed);

    return managed;
  };

  return {
    open: openOne,

    /**
     * Closes every socket still open.
     *
     * @returns A promise that settles once every port is free.
     */
    closeAll: async (): Promise<void> => {
      await Promise.all([...open].map(async (socket) => socket.close()));
    },
  };
}
