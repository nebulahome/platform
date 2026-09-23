/**
 * A WebSocket the hub keeps open on a bundle's behalf.
 *
 * Node's own `WebSocket` (22.5+) with the part every long-lived socket needs and every vendor
 * would otherwise write again: reconnection with a doubling pause, a reset for the request
 * that timed out, a close that is final. The bundle sees text frames and three callbacks and
 * never a socket object, so the one reconnection here is the only one there is.
 *
 * A reset does not wait for the old socket: the peer that stopped answering requests is not
 * going to answer a close frame either. The old socket is let go - its events ignored - and a
 * new one is opened on the usual schedule, while the old one closes whenever it does.
 */
import { WebSocket } from 'node:http';

import type { ManagedSocket, ManagedSocketOptions } from '@nebula-home/package-runtime';

/** The first pause after a drop. */
const DEFAULT_MIN_MS = 1000;

/** The longest pause between attempts. */
const DEFAULT_MAX_MS = 30_000;

/** How long a final close waits for the peer's close frame before giving up on it. */
const CLOSE_GRACE_MS = 2000;

/** The close code for a close nobody has to explain. */
const NORMAL_CLOSURE = 1000;

/**
 * Opens a managed WebSocket.
 *
 * @param options - Where to connect and what to call.
 * @returns The socket, connecting in the background.
 */
export function openWebSocket(options: ManagedSocketOptions): ManagedSocket {
  const { url, logger, onOpen, onMessage, onClose } = options;
  const reconnect =
    options.reconnect === false
      ? null
      : {
          minMs: options.reconnect?.minMs ?? DEFAULT_MIN_MS,
          maxMs: options.reconnect?.maxMs ?? DEFAULT_MAX_MS,
        };

  let current: WebSocket | null = null;
  let isFinal = false;
  let pauseMs = reconnect?.minMs ?? 0;
  let timer: NodeJS.Timeout | null = null;

  /**
   * Arranges the next attempt, unless this socket is finished or one-shot.
   */
  const schedule = (): void => {
    if (isFinal || reconnect === null || timer !== null) {
      return;
    }

    timer = setTimeout(() => {
      timer = null;
      connect();
    }, pauseMs);
    timer.unref();
    pauseMs = Math.min(pauseMs * 2, reconnect.maxMs);
  };

  /**
   * Lets go of the current socket and reports the drop.
   *
   * @param reason - Why, in a few words.
   */
  const dropped = (reason: string): void => {
    current = null;
    onClose(reason);
    schedule();
  };

  /**
   * Opens one socket and wires its events; events of a socket that was let go are ignored.
   */
  function connect(): void {
    if (isFinal) {
      return;
    }

    let socket: WebSocket;

    try {
      socket = new WebSocket(url);
    } catch (error: unknown) {
      // A URL the constructor refuses outright - a host with a space in it - is an address
      // with nothing behind it, as far as the bundle is concerned. Reported on the next tick,
      // so the caller has its socket object before it hears the socket went.
      const reason = error instanceof Error ? error.message : String(error);

      queueMicrotask(() => {
        dropped(reason);
      });

      return;
    }

    current = socket;

    socket.addEventListener('open', () => {
      if (current !== socket) {
        return;
      }

      pauseMs = reconnect?.minMs ?? 0;
      onOpen();
    });

    socket.addEventListener('message', (event) => {
      if (current !== socket) {
        return;
      }

      onMessage(typeof event.data === 'string' ? event.data : String(event.data));
    });

    socket.addEventListener('error', () => {
      // The close event that follows carries what can be said; an error event says nothing
      // a person can read, and logging it would put a line in the log for every retry.
      logger.debug({ url }, 'Socket error');
    });

    socket.addEventListener('close', (event) => {
      if (current !== socket) {
        return;
      }

      dropped(event.reason === '' ? `closed with code ${String(event.code)}` : event.reason);
    });
  }

  connect();

  return {
    /**
     * Says whether a frame can be sent now.
     *
     * @returns True while the current socket is open.
     */
    get isOpen(): boolean {
      return current?.readyState === WebSocket.OPEN;
    },

    /**
     * Sends one text frame.
     *
     * @param text - The frame.
     * @throws {Error} When the socket is not open.
     */
    send: (text: string): void => {
      if (current?.readyState !== WebSocket.OPEN) {
        throw new Error(`The socket to ${url} is not open`);
      }

      current.send(text);
    },

    /**
     * Drops the socket so it reconnects.
     *
     * @param reason - Why, for the drop report.
     */
    reset: (reason: string): void => {
      const socket = current;

      if (socket === null) {
        return;
      }

      current = null;
      socket.close(NORMAL_CLOSURE, reason);
      onClose(reason);
      schedule();
    },

    /**
     * Closes for good.
     *
     * @returns A promise that settles once the peer has answered the close, or the grace period
     * has passed.
     */
    close: async (): Promise<void> => {
      isFinal = true;

      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }

      const socket = current;
      current = null;

      if (socket === null || socket.readyState === WebSocket.CLOSED) {
        return;
      }

      await new Promise<void>((resolve) => {
        const grace = setTimeout(resolve, CLOSE_GRACE_MS);
        grace.unref();
        socket.addEventListener(
          'close',
          () => {
            clearTimeout(grace);
            resolve();
          },
          { once: true },
        );
        socket.close(NORMAL_CLOSURE, 'closing');
      });
    },
  };
}
