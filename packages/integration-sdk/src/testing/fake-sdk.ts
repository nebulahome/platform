/**
 * A {@link BundleSdk} for tests: the real pieces where they are pure - zod, `defineTransport`,
 * `defineAccount`, `defineStreamSource`, the infrared codec - a logger that keeps what it was
 * told, UDP sockets, WebSockets and serial ports that keep what was sent and take what a test
 * delivers, Bluetooth scanners that keep what a proxy reported, and nothing else. A WebSocket here
 * connects to nothing: the test opens it, drops it and opens it again, as the network and the
 * hub's reconnection would; a serial port is any port the code names, held by it alone. An MQTT
 * session, a Modbus session, an RTSP stream and the other codecs are the hub's; a test that needs
 * one passes its own in `overrides`, and one that reaches for a piece nobody passed is told so by
 * name.
 */
import { z } from 'zod';

import {
  bluetoothAdvertSchema,
  serialLineSchema,
  ValidationError,
  type BluetoothAdvert,
  type BluetoothAdvertInput,
  type SerialLine,
} from '@nebulahome/contracts';
import {
  defineAccount,
  defineStreamSource,
  defineTransport,
  infraredCodec,
  type BluetoothScanner,
  type BluetoothScannerOptions,
  type BundleBluetooth,
  type BundleLogFn,
  type BundleLogger,
  type BundleSdk,
  type ManagedSocket,
  type ManagedSocketClose,
  type ManagedSocketHeaders,
  type ManagedSocketOptions,
  type ManagedUdpSocket,
  type ManagedUdpSocketOptions,
  type OpenSerial,
  type PlatformServices,
  type SerialSession,
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

/** A serial port a bundle opened through the fake SDK. */
export type FakeSerialPort = {
  readonly portId: string;

  /** The line it was opened at, the defaults filled in: `9600 8N1` unless said. */
  readonly line: SerialLine;

  /** What the bundle wrote, a buffer a write, in order. */
  readonly written: readonly Buffer[];

  /** Whether the bundle closed it, the test unplugged it, or the release let go of it. */
  readonly isClosed: boolean;

  /**
   * Hands the bundle bytes, as if the port read them: one chunk, as a port reads one.
   *
   * @throws {Error} When the port is closed.
   */
  feed: (bytes: Uint8Array | string) => void;

  /**
   * Takes the port away, as unplugging it or the owner taking it back would, and tells the
   * bundle why; its writes then fail with `SerialClosed`.
   *
   * @param reason - Why; `Unplugged` when not said.
   */
  unplug: (reason?: string) => void;
};

/** A Bluetooth proxy's scanner a bundle opened through the fake SDK. */
export type FakeBluetoothScanner = {
  /** Which proxy reports: its connection's key and its device key. */
  readonly options: BluetoothScannerOptions;

  /** Every report, as the bundle made it, an empty one too: that is the proxy saying it is alive. */
  readonly reports: readonly (readonly BluetoothAdvertInput[])[];

  /**
   * The advertisements the house keeps of those, read as the broker reads them: 1024 a report at
   * most, one that does not hold dropped, addresses upper case and hex lower case.
   *
   * shortcut: a 128-bit UUID on the Bluetooth base stays as reported, where the hub shortens it to
   * 16 bits; shorten it here too if a vendor's test ever reads one.
   */
  readonly adverts: readonly BluetoothAdvert[];

  /** Whether the bundle closed it, or opened another for the same proxy. */
  readonly isClosed: boolean;
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

  /** The serial ports the bundle opened, in order. */
  readonly serialPorts: readonly FakeSerialPort[];

  /** The Bluetooth scanners the bundle opened, in order. */
  readonly bluetoothScanners: readonly FakeBluetoothScanner[];

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
 * An error the Serial broker refuses with, named as the hub names it.
 *
 * @param name - `SerialPortHeld`, `SerialClosed`.
 * @param message - The sentence.
 * @returns The error.
 */
function serialFailure(name: string, message: string): Error {
  return Object.assign(new Error(message), { name });
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
  const serialPorts: FakeSerialPort[] = [];
  const bluetoothScanners: FakeBluetoothScanner[] = [];

  /** Closes each scanner opened, by the proxy it is: opening another for it closes the first. */
  const scannerClosers: { options: BluetoothScannerOptions; close: () => void }[] = [];

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

  /**
   * Opens a fake serial port: any port, held by the bundle alone - a second open of one still
   * open is refused, as the broker refuses it.
   *
   * @param portId - The port.
   * @param input - How it is spoken.
   * @returns The session.
   * @throws {ValidationError} When the line is not one.
   * @throws {Error} `SerialPortHeld` when the port is open already.
   */
  const openSerial: OpenSerial = async (portId, input) => {
    const parsed = serialLineSchema.safeParse(input);

    if (!parsed.success) {
      throw new ValidationError('The serial line is not one', { details: { portId } });
    }

    if (serialPorts.some((port) => port.portId === portId && !port.isClosed)) {
      throw serialFailure('SerialPortHeld', 'The port is open already');
    }

    const written: Buffer[] = [];
    const dataListeners = new Set<(bytes: Uint8Array) => void>();
    const closeListeners = new Set<(reason: string) => void>();
    let isClosed = false;

    /**
     * Ends the session once, telling the bundle why.
     *
     * @param reason - Why.
     */
    const finish = (reason: string): void => {
      if (isClosed) {
        return;
      }

      isClosed = true;

      for (const listener of closeListeners) {
        listener(reason);
      }
    };

    serialPorts.push({
      portId,
      line: parsed.data,
      written,

      /**
       * Whether it was closed.
       *
       * @returns True once it was.
       */
      get isClosed() {
        return isClosed;
      },

      /**
       * Hands the bundle bytes.
       *
       * @param bytes - What the port read.
       * @throws {Error} When the port is closed.
       */
      feed: (bytes) => {
        if (isClosed) {
          throw new Error(`The serial port ${portId} is closed`);
        }

        const chunk = Buffer.from(bytes);

        for (const listener of dataListeners) {
          listener(chunk);
        }
      },

      /**
       * Takes the port away.
       *
       * @param reason - Why.
       */
      unplug: (reason = 'Unplugged') => {
        finish(reason);
      },
    });
    closers.push(() => {
      isClosed = true;
    });

    const session: SerialSession = {
      /**
       * Keeps bytes the bundle writes.
       *
       * @param bytes - What it writes.
       * @returns Once kept.
       * @throws {Error} `SerialClosed` once the session is closed.
       */
      write: async (bytes) => {
        if (isClosed) {
          throw serialFailure('SerialClosed', 'The port is closed');
        }

        written.push(Buffer.from(bytes));

        return Promise.resolve();
      },

      /**
       * Hears what the test feeds.
       *
       * @param listener - Called with each chunk.
       * @returns Stops hearing.
       */
      onData: (listener) => {
        dataListeners.add(listener);

        return () => dataListeners.delete(listener);
      },

      /**
       * Hears the port go, once.
       *
       * @param listener - Called with why.
       * @returns Stops hearing.
       */
      onClose: (listener) => {
        closeListeners.add(listener);

        return () => closeListeners.delete(listener);
      },

      /**
       * Lets go of the port.
       *
       * @returns Once closed.
       */
      close: async () => {
        finish('Closed');

        return Promise.resolve();
      },
    };

    return Promise.resolve(session);
  };

  const bluetooth: BundleBluetooth = {
    /**
     * Opens a fake proxy's scanner, closing the one opened before for the same proxy.
     *
     * @param scannerOptions - The proxy: its connection's key and its device key.
     * @returns The scanner.
     */
    scanner: (scannerOptions): BluetoothScanner => {
      const reports: (readonly BluetoothAdvertInput[])[] = [];
      const adverts: BluetoothAdvert[] = [];
      let isClosed = false;

      /** Stops it taking reports. */
      const close = (): void => {
        isClosed = true;
      };

      for (const earlier of scannerClosers) {
        if (
          earlier.options.key === scannerOptions.key &&
          earlier.options.deviceKey === scannerOptions.deviceKey
        ) {
          earlier.close();
        }
      }

      bluetoothScanners.push({
        options: scannerOptions,
        reports,
        adverts,

        /**
         * Whether it was closed.
         *
         * @returns True once it was.
         */
        get isClosed() {
          return isClosed;
        },
      });
      scannerClosers.push({ options: scannerOptions, close });
      closers.push(close);

      return {
        /**
         * Keeps a report, and what of it the house keeps; nothing once closed, as the broker
         * takes nothing then.
         *
         * @param heard - The advertisements.
         */
        report: (heard) => {
          if (isClosed) {
            return;
          }

          reports.push([...heard]);

          for (const advert of heard.slice(0, 1024)) {
            const parsed = bluetoothAdvertSchema.safeParse(advert);

            if (parsed.success) {
              adverts.push(parsed.data);
            }
          }
        },
        close,
      };
    },
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
    openModbus: notFaked('openModbus'),
    openSerial,
    bluetooth,
    openRtsp: notFaked('openRtsp'),
    platform: options.platform ?? { mqtt: null },
    codecs: { lzma: notFaked('codecs.lzma'), infrared: infraredCodec },
    images: { png: notFaked('images.png') },
    ...options.overrides,
  };

  return {
    sdk,
    logs,
    udpSockets,
    webSockets,
    serialPorts,
    bluetoothScanners,

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
