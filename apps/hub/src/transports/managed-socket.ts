/**
 * A WebSocket the hub keeps open on a bundle's behalf.
 *
 * The part every long-lived socket needs and every vendor would otherwise write again:
 * reconnection with a doubling pause, a reset for the request that timed out, a close that is
 * final - and, for a cloud that signs its sockets in and then says nothing for hours, the
 * handshake's headers, a ping that notices a dead peer, and the HTTP status of a handshake the
 * server refused. The bundle sees text frames and three callbacks and never a socket object, so
 * the one reconnection here is the only one there is.
 *
 * It runs on `ws` rather than Node's own `WebSocket`: Node's answers pings but cannot send them,
 * and reports a refused handshake as an error with no status in it, so neither a dead connection
 * nor a password turned down could be told from anything else.
 *
 * A reset does not wait for the old socket: the peer that stopped answering requests is not
 * going to answer a close frame either. The old socket is let go - its events ignored - and a
 * new one is opened on the usual schedule, while the old one closes whenever it does.
 */
import WebSocket, { type RawData } from 'ws';

import type {
  ManagedSocket,
  ManagedSocketClose,
  ManagedSocketHeaders,
  ManagedSocketOptions,
} from '@nebulahome/package-runtime';

/** The first pause after a drop. */
const DEFAULT_MIN_MS = 1000;

/** The longest pause between attempts. */
const DEFAULT_MAX_MS = 30_000;

/** How long a final close waits for the peer's close frame before giving up on it. */
const CLOSE_GRACE_MS = 2000;

/** The close code for a close nobody has to explain. */
const NORMAL_CLOSURE = 1000;

/**
 * The close code for a socket that ended without a close frame: refused, reset, timed out, or
 * a peer that vanished. The error that comes just before - or the handshake's status - and
 * whether the socket had opened are what tell those apart.
 */
const ABNORMAL_CLOSURE = 1006;

/** The most a close frame's reason may hold, in bytes. */
const MAX_REASON_BYTES = 123;

/**
 * Reads what an error says went wrong: its system code - `ECONNREFUSED` - and its words.
 *
 * @param error - The error.
 * @returns The words, or null when it has none.
 */
function errorTextOf(error: Error): string | null {
  if (error.message === '') {
    return null;
  }

  const code = (error as Error & { code?: unknown }).code;

  return typeof code === 'string' && !error.message.includes(code)
    ? `${code}: ${error.message}`
    : error.message;
}

/**
 * Says what something thrown was.
 *
 * @param error - What was thrown.
 * @returns Its message.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads a frame as text, however `ws` handed it over.
 *
 * @param data - The frame.
 * @returns Its text.
 */
function textOf(data: RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }

  return Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.from(data).toString('utf8');
}

/**
 * Cuts a close reason to what a close frame carries, on a character's edge: `ws` refuses a
 * longer one outright, and a bundle's reason is whatever went wrong, in its own words.
 *
 * @param reason - The reason.
 * @returns It, or as much of it as fits.
 */
function clipReason(reason: string): string {
  const bytes = Buffer.from(reason, 'utf8');

  if (bytes.length <= MAX_REASON_BYTES) {
    return reason;
  }

  let end = MAX_REASON_BYTES;

  // A byte 10xxxxxx continues a character begun before it; cut before that character instead.
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) {
    end -= 1;
  }

  return bytes.subarray(0, end).toString('utf8');
}

/**
 * Says whether a header function answered with a promise.
 *
 * @param value - Its answer.
 * @returns True for a promise, or anything with a `then`.
 */
function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * Opens a managed WebSocket.
 *
 * @param options - Where to connect, how, and what to call.
 * @returns The socket, connecting in the background.
 * @throws {RangeError} When the ping asks for an interval or a timeout that is not a positive
 * number.
 */
export function openWebSocket(options: ManagedSocketOptions): ManagedSocket {
  const { url, logger, onOpen, onMessage, onClose, ping, tls } = options;
  const reconnect =
    options.reconnect === false
      ? null
      : {
          minMs: options.reconnect?.minMs ?? DEFAULT_MIN_MS,
          maxMs: options.reconnect?.maxMs ?? DEFAULT_MAX_MS,
        };

  if (ping !== undefined && !(ping.everyMs > 0 && ping.timeoutMs > 0)) {
    throw new RangeError('A ping needs an interval and a timeout above zero');
  }

  let current: WebSocket | null = null;
  let isFinal = false;
  let pauseMs = reconnect?.minMs ?? 0;
  let timer: NodeJS.Timeout | null = null;

  // The current socket's pings: one interval, and the wait for the pong of the last one sent.
  let pingTimer: NodeJS.Timeout | null = null;
  let pongTimer: NodeJS.Timeout | null = null;

  // A kept socket says it went once, at info, and that it is back once; the retries in between
  // are debug. A socket opened for one question says everything at debug: a device that is off
  // is the ordinary answer to a probe, not news.
  const role = reconnect === null ? 'one-shot' : 'kept';
  let wasOpen = false;
  let failedAttempts = 0;

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
   * Stops pinging the current socket, and waiting for its pong.
   */
  const stopPinging = (): void => {
    if (pingTimer !== null) {
      clearInterval(pingTimer);
      pingTimer = null;
    }

    if (pongTimer !== null) {
      clearTimeout(pongTimer);
      pongTimer = null;
    }
  };

  /**
   * Lets go of the current socket and reports the drop.
   *
   * @param reason - Why, in a few words.
   * @param details - The close code and, for a refused handshake, its status.
   */
  const dropped = (reason: string, details: ManagedSocketClose = {}): void => {
    current = null;
    stopPinging();

    // Never the headers: they carry the password of a socket that signs in by them.
    const { code, status } = details;

    if (reconnect !== null && wasOpen) {
      logger.info({ url, reason, code }, 'Socket dropped; reconnecting');
    } else {
      logger.debug(
        { url, role, reason, code, status, attempt: failedAttempts + 1 },
        wasOpen ? 'Socket closed' : 'Socket did not open',
      );
    }

    if (!wasOpen) {
      failedAttempts += 1;
    }

    wasOpen = false;
    onClose(reason, details);
    schedule();
  };

  /**
   * Reports an attempt that failed before there was a socket, on the next tick, so the caller
   * has its socket object before it hears the socket went.
   *
   * @param reason - Why.
   */
  const failSoon = (reason: string): void => {
    queueMicrotask(() => {
      if (!isFinal) {
        dropped(reason);
      }
    });
  };

  /**
   * Pings the socket that just opened, as the options ask, and drops it when a pong is late.
   *
   * @param socket - The socket.
   */
  const startPinging = (socket: WebSocket): void => {
    if (ping === undefined) {
      return;
    }

    pingTimer = setInterval(() => {
      // One ping at a time: a pong still awaited is already being timed.
      if (current !== socket || pongTimer !== null) {
        return;
      }

      pongTimer = setTimeout(() => {
        pongTimer = null;

        if (current !== socket) {
          return;
        }

        // A peer that does not answer a ping will not answer a close frame either.
        current = null;
        socket.terminate();
        dropped(`no answer to a ping within ${String(ping.timeoutMs)} ms`, {
          code: ABNORMAL_CLOSURE,
        });
      }, ping.timeoutMs);
      pongTimer.unref();
      socket.ping();
    }, ping.everyMs);
    pingTimer.unref();
  };

  /**
   * Opens one socket with these headers and wires its events; events of a socket that was let
   * go are ignored.
   *
   * @param headers - The handshake's headers, if any.
   */
  function dial(headers: ManagedSocketHeaders | undefined): void {
    let socket: WebSocket;

    try {
      socket = new WebSocket(url, {
        // Whatever the server offers, frames come uncompressed, as from Node's own socket before.
        perMessageDeflate: false,
        ...(headers === undefined ? {} : { headers: { ...headers } }),
        ...(tls?.rejectUnauthorized === undefined
          ? {}
          : { rejectUnauthorized: tls.rejectUnauthorized }),
      });
    } catch (error: unknown) {
      // A URL the constructor refuses outright - a host with a space in it - is an address
      // with nothing behind it, as far as the bundle is concerned.
      failSoon(messageOf(error));

      return;
    }

    current = socket;

    /** What the last error said, to explain the close that follows it. */
    let failure: string | null = null;

    /** The status of a handshake the server refused, and its words. */
    let status: number | undefined;
    let refusal: string | null = null;
    let hasOpened = false;

    socket.on('open', () => {
      if (current !== socket) {
        return;
      }

      hasOpened = true;

      if (reconnect !== null && failedAttempts > 0) {
        logger.info({ url, attempts: failedAttempts }, 'Socket reopened');
      }

      pauseMs = reconnect?.minMs ?? 0;
      failedAttempts = 0;
      wasOpen = true;
      startPinging(socket);
      onOpen();
    });

    socket.on('message', (data) => {
      if (current !== socket) {
        return;
      }

      onMessage(textOf(data));
    });

    socket.on('pong', () => {
      if (current === socket && pongTimer !== null) {
        clearTimeout(pongTimer);
        pongTimer = null;
      }
    });

    socket.on('unexpected-response', (request, response) => {
      // With a listener here, `ws` leaves a refused handshake to it, so it is ended here for
      // every socket, let go or not. The error the abort raises says only that it was aborted:
      // the status is the news.
      status = response.statusCode;
      refusal = `HTTP ${String(status)} ${response.statusMessage ?? ''}`.trim();
      socket.terminate();
    });

    // Kept for every socket's whole life, let go or not: `ws` throws an error nobody listens to,
    // and a socket closed while it connects raises one.
    socket.on('error', (error) => {
      // A socket already let go has nobody left to tell, and its error is the expected end of a
      // socket nobody wants.
      if (current !== socket || refusal !== null) {
        return;
      }

      // Kept for the close that always follows, which is where it is logged, once: an error
      // event on its own would put a second, vaguer line in the log for every attempt.
      failure = errorTextOf(error);
    });

    socket.on('close', (code, reasonBytes) => {
      if (current !== socket) {
        return;
      }

      const reason = reasonBytes.toString('utf8');
      const said =
        reason !== ''
          ? reason
          : code === ABNORMAL_CLOSURE
            ? hasOpened
              ? 'connection lost'
              : 'connection not accepted'
            : `closed with code ${String(code)}`;
      const why = refusal ?? failure;

      dropped(
        why === null ? said : `${said} (${why})`,
        status === undefined ? { code } : { code, status },
      );
    });
  }

  /**
   * Starts one attempt: reads the headers - a function's answer, awaited when it is a promise -
   * then opens the socket.
   */
  function connect(): void {
    if (isFinal) {
      return;
    }

    const source = options.headers;
    let headers: ManagedSocketHeaders | PromiseLike<ManagedSocketHeaders> | undefined;

    try {
      headers = typeof source === 'function' ? source() : source;
    } catch (error: unknown) {
      failSoon(`headers failed: ${messageOf(error)}`);

      return;
    }

    if (!isPromiseLike(headers)) {
      dial(headers);

      return;
    }

    headers.then(
      (resolved) => {
        if (!isFinal) {
          dial(resolved);
        }
      },
      (error: unknown) => {
        if (!isFinal) {
          dropped(`headers failed: ${messageOf(error)}`);
        }
      },
    );
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
      stopPinging();
      logger.debug({ url, reason }, 'Socket reset');
      wasOpen = false;
      socket.close(NORMAL_CLOSURE, clipReason(reason));
      onClose(reason, {});
      schedule();
    },

    /**
     * Closes for good.
     *
     * @returns A promise that settles once the peer has answered the close, or the grace period
     * has passed and the connection was cut.
     */
    close: async (): Promise<void> => {
      isFinal = true;

      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }

      stopPinging();
      const socket = current;
      current = null;

      if (socket === null || socket.readyState === WebSocket.CLOSED) {
        return;
      }

      await new Promise<void>((resolve) => {
        const grace = setTimeout(() => {
          // The peer did not answer: the connection is cut rather than left to `ws`'s own
          // thirty seconds, so a vendor let go holds nothing.
          socket.terminate();
          resolve();
        }, CLOSE_GRACE_MS);
        grace.unref();
        socket.once('close', () => {
          clearTimeout(grace);
          resolve();
        });
        socket.close(NORMAL_CLOSURE, 'closing');
      });
    },
  };
}
