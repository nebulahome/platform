/**
 * A {@link BundleSdk} for tests: the real pieces where they are pure - zod, `defineTransport`,
 * `defineAccount`, `defineStreamSource` - a logger that keeps what it was told, UDP sockets and
 * WebSockets that keep what was sent and take what a test delivers, and nothing else. A WebSocket
 * here connects to nothing: the test opens it, drops it and opens it again, as the network and the
 * hub's reconnection would. An MQTT session, an RTSP stream and the codecs are the hub's; a test
 * that needs one passes its own in `overrides`, and one that reaches for a piece nobody passed is
 * told so by name.
 */
import { z } from 'zod';

import {
  defineAccount,
  defineStreamSource,
  defineTransport,
  type BundleLogFn,
  type BundleLogger,
  type BundleSdk,
  type ManagedSocket,
  type ManagedSocketClose,
  type ManagedSocketHeaders,
  type ManagedSocketOptions,
  type ManagedUdpSocket,
  type ManagedUdpSocketOptions,
  type PlatformServices,
  type UdpPeer,
} from '@nebulahome/package-runtime';

import { SDK_VERSION } from '../version.js';

/** The levels a bundle may log at. */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/** One line a bundle logged. */
export type LogRecord = {
  readonly level: LogLevel;

  /** Its fields, a child logger's among them. */
  readonly fields: Readonly<Record<string, unknown>>;

  readonly message: string | undefined;
};

/** A datagram a bundle sent. */
export type SentDatagram = {
  readonly message: Buffer;
  readonly port: number;
  readonly address: string;
};

/** A UDP socket a bundle opened through the fake SDK. */
export type FakeUdpSocket = {
  /** What it was opened with: the port, the group, `onMessage`. */
  readonly options: ManagedUdpSocketOptions;

  readonly port: number;

  /** What the bundle sent through it, in order. */
  readonly sent: readonly SentDatagram[];

  /** Whether the bundle, or the release, closed it. */
  readonly isClosed: boolean;

  /**
   * Hands the bundle a datagram, as if it arrived.
   *
   * @param message - What arrived.
   * @param from - Who sent it; `192.0.2.1:4000` when not said.
   */
  deliver: (message: Buffer | string, from?: UdpPeer) => void;
};

/** A WebSocket a bundle opened through the fake SDK. */
export type FakeWebSocket = {
  /** What it was opened with: the URL, the headers, the ping, the callbacks. */
  readonly options: ManagedSocketOptions;

  readonly url: string;

  /** The headers of the last opening: a function's answer, once `open` has called it. */
  readonly headers: ManagedSocketHeaders | undefined;

  /** What the bundle sent through it, in order, across every connection. */
  readonly sent: readonly string[];

  /** The reasons the bundle reset it for, in order. */
  readonly resets: readonly string[];

  /** Whether a frame can be sent now. */
  readonly isOpen: boolean;

  /** Whether the bundle, or the release, closed it for good. */
  readonly isClosed: boolean;

  /**
   * Opens it - or opens it again after a drop or a reset, as the hub's reconnection would: reads
   * the headers, a function's answer awaited, then calls `onOpen`.
   *
   * @throws {Error} When it is open already, or closed for good.
   */
  open: () => Promise<void>;

  /**
   * Hands the bundle a text frame, as if it arrived.
   *
   * @throws {Error} When it is not open.
   */
  deliver: (text: string) => void;

  /**
   * Ends the connection - or refuses an attempt to make one - as the network or the server
   * would, and tells the bundle: `drop('connection not accepted (HTTP 401 Unauthorized)',
   * { code: 1006, status: 401 })` is a handshake the server turned down.
   *
   * @throws {Error} When it is closed for good.
   */
  drop: (reason: string, details?: ManagedSocketClose) => void;
};

/** What a test builds a fake SDK with. */
export type FakeSdkOptions = {
  /** What the platform runs that the bundle may use: no broker when not said. */
  readonly platform?: PlatformServices;

  /** Pieces of the SDK the test supplies itself: `openMqtt`, `openRtsp`, `codecs`… */
  readonly overrides?: Partial<Omit<BundleSdk, 'version' | 'z'>>;
};

/** A fake SDK, and what the bundle did with it. */
export type FakeSdk = {
  readonly sdk: BundleSdk;

  /** What the bundle logged, in order. */
  readonly logs: readonly LogRecord[];

  /** The UDP sockets the bundle opened, in order. */
  readonly udpSockets: readonly FakeUdpSocket[];

  /** The WebSockets the bundle opened, in order; none is open until the test opens it. */
  readonly webSockets: readonly FakeWebSocket[];

  /**
   * Closes every socket the bundle left open, as the hub does when it lets go of a vendor.
   *
   * @returns Once they are closed.
   */
  release: () => Promise<void>;
};

/** The first port a fake socket says it is bound to, when the bundle asks for none. */
const FIRST_FREE_PORT = 40_000;

/**
 * A piece of the SDK no test passed: it says which, and how to pass it.
 *
 * @param name - The piece.
 * @returns A function that throws.
 */
function notFaked(name: string): () => never {
  return () => {
    throw new Error(
      `${name} is not faked: pass your own in createFakeSdk({ overrides: { ${name.split('.')[0] ?? name} } })`,
    );
  };
}

/**
 * A logger that keeps what it is told.
 *
 * @param logs - Where it keeps it.
 * @param bound - The fields every line carries.
 * @returns The logger.
 */
function recordingLogger(
  logs: LogRecord[],
  bound: Readonly<Record<string, unknown>>,
): BundleLogger {
  /**
   * One level.
   *
   * @param level - Which.
   * @returns What logs at it.
   */
  const at =
    (level: LogLevel): BundleLogFn =>
    (first: unknown, message?: string): void => {
      logs.push(
        typeof first === 'string'
          ? { level, fields: bound, message: first }
          : { level, fields: { ...bound, ...(first as Record<string, unknown>) }, message },
      );
    };

  return {
    trace: at('trace'),
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    fatal: at('fatal'),

    /**
     * A logger whose lines carry more fields.
     *
     * @param fields - The fields.
     * @returns The logger.
     */
    child: (fields) => recordingLogger(logs, { ...bound, ...fields }),
  };
}

/**
 * Builds a fake SDK.
 *
 * @param options - The platform's services, and the pieces the test supplies.
 * @returns The SDK, and what the bundle does with it.
 */
export function createFakeSdk(options: FakeSdkOptions = {}): FakeSdk {
  const logs: LogRecord[] = [];
  const udpSockets: FakeUdpSocket[] = [];
  const webSockets: FakeWebSocket[] = [];

  /** Closes each socket opened, for the release. */
  const closers: (() => void)[] = [];

  /**
   * Opens a fake UDP socket.
   *
   * @param socketOptions - What the bundle asked for.
   * @returns The socket.
   */
  const openUdpSocket = (socketOptions: ManagedUdpSocketOptions): ManagedUdpSocket => {
    const sent: SentDatagram[] = [];
    const port = socketOptions.port ?? FIRST_FREE_PORT + udpSockets.length;
    let isClosed = false;
    const fake: FakeUdpSocket = {
      options: socketOptions,
      port,
      sent,

      /**
       * Whether it was closed.
       *
       * @returns True once it was.
       */
      get isClosed() {
        return isClosed;
      },

      /**
       * Hands the bundle a datagram.
       *
       * @param message - What arrived.
       * @param from - Who sent it.
       */
      deliver: (message, from = { address: '192.0.2.1', port: 4000 }) => {
        socketOptions.onMessage(Buffer.from(message), from);
      },
    };

    udpSockets.push(fake);
    closers.push(() => {
      isClosed = true;
    });

    return {
      port,

      /**
       * Keeps a datagram the bundle sends.
       *
       * @param message - What it sends.
       * @param toPort - The port it sends to.
       * @param address - The address it sends to.
       * @returns Once kept.
       * @throws {Error} When the socket is closed.
       */
      send: async (message, toPort, address) => {
        if (isClosed) {
          throw new Error('The socket is closed');
        }

        sent.push({ message: Buffer.from(message), port: toPort, address });

        return Promise.resolve();
      },

      /**
       * Closes the socket.
       *
       * @returns Once closed.
       */
      close: async () => {
        isClosed = true;

        return Promise.resolve();
      },
    };
  };

  /**
   * Opens a fake WebSocket, connected to nothing until the test opens it.
   *
   * @param socketOptions - What the bundle asked for.
   * @returns The socket, as the bundle sees it.
   */
  const openWebSocket = (socketOptions: ManagedSocketOptions): ManagedSocket => {
    const { url } = socketOptions;
    const sent: string[] = [];
    const resets: string[] = [];
    let headers: ManagedSocketHeaders | undefined;
    let isOpen = false;
    let isClosed = false;

    const fake: FakeWebSocket = {
      options: socketOptions,
      url,
      sent,
      resets,

      /**
       * The headers of the last opening.
       *
       * @returns Them, or undefined before the first.
       */
      get headers() {
        return headers;
      },

      /**
       * Whether it is open.
       *
       * @returns True while it is.
       */
      get isOpen() {
        return isOpen;
      },

      /**
       * Whether it was closed for good.
       *
       * @returns True once it was.
       */
      get isClosed() {
        return isClosed;
      },

      /**
       * Opens it, as a connection that succeeds.
       *
       * @returns Once open.
       * @throws {Error} When it is open already, or closed for good.
       */
      open: async () => {
        if (isClosed) {
          throw new Error(`The socket to ${url} is closed for good`);
        }

        if (isOpen) {
          throw new Error(`The socket to ${url} is open already`);
        }

        const source = socketOptions.headers;
        headers = typeof source === 'function' ? await source() : source;
        isOpen = true;
        socketOptions.onOpen();
      },

      /**
       * Hands the bundle a frame.
       *
       * @param text - The frame.
       * @throws {Error} When it is not open.
       */
      deliver: (text) => {
        if (!isOpen) {
          throw new Error(`The socket to ${url} is not open`);
        }

        socketOptions.onMessage(text);
      },

      /**
       * Ends the connection, or refuses an attempt.
       *
       * @param reason - Why.
       * @param details - The close code and the status.
       * @throws {Error} When it is closed for good.
       */
      drop: (reason, details = {}) => {
        if (isClosed) {
          throw new Error(`The socket to ${url} is closed for good`);
        }

        isOpen = false;
        socketOptions.onClose(reason, details);
      },
    };

    webSockets.push(fake);
    closers.push(() => {
      isOpen = false;
      isClosed = true;
    });

    return {
      /**
       * Whether a frame can be sent now.
       *
       * @returns True while the test has it open.
       */
      get isOpen() {
        return isOpen;
      },

      /**
       * Keeps a frame the bundle sends.
       *
       * @param text - The frame.
       * @throws {Error} When it is not open.
       */
      send: (text) => {
        if (!isOpen) {
          throw new Error(`The socket to ${url} is not open`);
        }

        sent.push(text);
      },

      /**
       * Drops the connection and says so, as the hub does; the test opens it again.
       *
       * @param reason - Why.
       */
      reset: (reason) => {
        if (!isOpen) {
          return;
        }

        resets.push(reason);
        isOpen = false;
        socketOptions.onClose(reason, {});
      },

      /**
       * Closes for good.
       *
       * @returns Once closed.
       */
      close: async () => {
        isOpen = false;
        isClosed = true;

        return Promise.resolve();
      },
    };
  };

  const sdk: BundleSdk = {
    version: SDK_VERSION,
    z,
    logger: recordingLogger(logs, {}),
    defineTransport,
    defineAccount,
    defineStreamSource,
    openUdpSocket,
    openWebSocket,
    openMqtt: notFaked('openMqtt'),
    openRtsp: notFaked('openRtsp'),
    platform: options.platform ?? { mqtt: null },
    codecs: { lzma: notFaked('codecs.lzma') },
    images: { png: notFaked('images.png') },
    ...options.overrides,
  };

  return {
    sdk,
    logs,
    udpSockets,
    webSockets,

    /**
     * Closes what the bundle left open.
     *
     * @returns Once closed.
     */
    release: async () => {
      // Closed as the hub closes them when it lets go of a vendor: whatever the bundle still held.
      for (const close of closers) {
        close();
      }

      return Promise.resolve();
    },
  };
}
