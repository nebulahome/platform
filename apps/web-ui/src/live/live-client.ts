/**
 * One socket to the live channel, kept open for as long as somebody is signed in.
 *
 * The channel is what makes a page a window rather than a snapshot: `core` publishes every state
 * change on the bus, `api` fans it out to the sockets that may hear it, and this client hands each
 * message on. Everything else here is about staying connected, which is where the work is.
 *
 * The socket authenticates with its first message rather than with a query parameter - API.md 7 -
 * and the server closes it when the access token behind it expires, with a code that says so.
 * That close is routine, not a failure: the token is refreshed and the socket opened again at
 * once. Any other close is backed off the same way the sign-in decision is, doubling from a
 * second to ten, so a page waits patiently through a restart rather than hammering it.
 *
 * Reconnecting is also how the server learns about entities that did not exist when the socket
 * authenticated: it decides what a socket may hear once, at that moment. Adopting a device
 * therefore ends with a fresh socket, and the hook that owns this client does that on the device
 * event the same socket delivers.
 */
import {
  WS_CLOSE_TOKEN_EXPIRED,
  WS_CLOSE_UNAUTHENTICATED,
  wsServerMessageSchema,
  type WsClientMessage,
  type WsServerMessage,
  type WsTopic,
} from '@nebula-home/contracts';

import { retryDelayMs } from '@/auth/session-store';

/** Where the channel stands. */
export type LiveStatus = 'offline' | 'connecting' | 'live';

/** The part of a WebSocket the client uses, so a test can stand one in. */
export type LiveSocket = {
  /** Sends one frame. */
  send(data: string): void;

  /** Closes the connection. */
  close(code?: number, reason?: string): void;

  /** Hears the connection opening. */
  addEventListener(type: 'open', listener: () => void): void;

  /** Hears one frame arriving. */
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;

  /** Hears the connection closing, with the code that says why. */
  addEventListener(type: 'close', listener: (event: { readonly code: number }) => void): void;
};

/** Opens a socket to a URL. */
export type SocketFactory = (url: string) => LiveSocket;

/** What the client needs. */
export type LiveClientOptions = {
  /** Where the channel is. */
  readonly url: string;

  /** Reads the access token to authenticate with. Null means nobody is signed in. */
  readonly readAccessToken: () => string | null;

  /** Mints a new access token when the one behind the socket has expired. */
  readonly refreshAccessToken: () => Promise<string | null>;

  /** Hears every message the server sends, the handshake ones included. */
  readonly onMessage: (message: WsServerMessage) => void;

  /** Hears every change of standing. */
  readonly onStatus: (status: LiveStatus) => void;

  /** What to listen to. Every topic is asked for on each connection. */
  readonly topics?: readonly WsTopic[];

  /** Opens the socket. The browser's own by default; a test passes a fake. */
  readonly openSocket?: SocketFactory;

  /** How long to wait before trying again, by failed attempt. */
  readonly delayFor?: (attempt: number) => number;
};

/** What is asked for when nothing is specified: states, and the device events that add to them. */
const DEFAULT_TOPICS: readonly WsTopic[] = ['state', 'devices'];

/**
 * Opens a browser socket.
 *
 * @param url - Where to.
 * @returns The socket.
 */
function openBrowserSocket(url: string): LiveSocket {
  return new WebSocket(url);
}

/**
 * Reads a frame as JSON, or as nothing when it is not.
 *
 * @param data - What the socket delivered.
 * @returns The parsed value, or undefined for anything that is not a JSON string.
 */
function parseJson(data: unknown): unknown {
  if (typeof data !== 'string') {
    return undefined;
  }

  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

/** The live channel, as one long-lived connection. */
export class LiveClient {
  readonly #options: LiveClientOptions;

  /** Whether {@link LiveClient.start} has been called and {@link LiveClient.stop} has not. */
  #isRunning = false;

  /** The socket that is open or opening, if one is. */
  #socket: LiveSocket | undefined;

  /** The reconnection that is waiting, if one is. */
  #timer: ReturnType<typeof setTimeout> | undefined;

  /** How many connections in a row have failed. */
  #failures = 0;

  /**
   * Creates the client. Nothing connects until {@link LiveClient.start}.
   *
   * @param options - See {@link LiveClientOptions}.
   */
  public constructor(options: LiveClientOptions) {
    this.#options = options;
  }

  /** Connects, and keeps connecting until {@link LiveClient.stop}. Idempotent. */
  public start(): void {
    if (this.#isRunning) {
      return;
    }

    this.#isRunning = true;
    this.#connect();
  }

  /** Closes the socket and stops reconnecting. Idempotent. */
  public stop(): void {
    this.#isRunning = false;
    this.#clearTimer();
    this.#drop();
    this.#options.onStatus('offline');
  }

  /**
   * Closes the socket and opens a new one at once.
   *
   * For when what the socket may hear has changed - a device was adopted - and only a fresh
   * handshake will tell the server so.
   */
  public reconnect(): void {
    if (!this.#isRunning) {
      return;
    }

    this.#clearTimer();
    this.#drop();
    this.#connect();
  }

  /** Forgets a reconnection that was waiting. */
  #clearTimer(): void {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
  }

  /** Closes the current socket, if there is one, without hearing its close as a failure. */
  #drop(): void {
    const socket = this.#socket;

    this.#socket = undefined;
    socket?.close();
  }

  /** Opens a socket, if there is a token to open it with. */
  #connect(): void {
    const accessToken = this.#options.readAccessToken();

    if (!this.#isRunning || accessToken === null) {
      this.#options.onStatus('offline');

      return;
    }

    const open = this.#options.openSocket ?? openBrowserSocket;
    const socket = open(this.#options.url);

    this.#socket = socket;
    this.#options.onStatus('connecting');

    /**
     * Sends one message, as JSON.
     *
     * @param message - What to send.
     */
    const send = (message: WsClientMessage): void => {
      socket.send(JSON.stringify(message));
    };

    socket.addEventListener('open', () => {
      if (this.#socket === socket) {
        send({ type: 'authenticate', accessToken });
      }
    });

    socket.addEventListener('message', (event) => {
      if (this.#socket !== socket) {
        return;
      }

      const parsed = wsServerMessageSchema.safeParse(parseJson(event.data));

      if (!parsed.success) {
        return;
      }

      if (parsed.data.type === 'welcome') {
        this.#failures = 0;

        for (const topic of this.#options.topics ?? DEFAULT_TOPICS) {
          send({ type: 'subscribe', topic });
        }

        this.#options.onStatus('live');
      }

      this.#options.onMessage(parsed.data);
    });

    socket.addEventListener('close', (event) => {
      if (this.#socket !== socket) {
        // Closed by `stop` or `reconnect`, which have already decided what happens next.
        return;
      }

      this.#socket = undefined;
      this.#options.onStatus('offline');

      if (!this.#isRunning) {
        return;
      }

      if (event.code === WS_CLOSE_TOKEN_EXPIRED || event.code === WS_CLOSE_UNAUTHENTICATED) {
        // The server said which credential it wants: a fresh one. Ask for it, then come straight
        // back - with a wait only when the refresh itself came back empty-handed.
        void this.#options.refreshAccessToken().then((token) => {
          if (token === null) {
            this.#retryLater();
          } else if (this.#isRunning && this.#socket === undefined) {
            this.#connect();
          }
        });

        return;
      }

      this.#retryLater();
    });
  }

  /** Schedules the next attempt, further away each time. */
  #retryLater(): void {
    this.#failures += 1;

    const wait = (this.#options.delayFor ?? retryDelayMs)(this.#failures);

    this.#clearTimer();
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#connect();
    }, wait);
  }
}
