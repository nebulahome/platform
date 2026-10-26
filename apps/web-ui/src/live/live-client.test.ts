/**
 * The socket's life: authenticate, subscribe, hand messages on, and come back after every kind
 * of close. Driven through a fake socket so the exchange can be read from the test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  entityIdSchema,
  WS_CLOSE_TOKEN_EXPIRED,
  type WsServerMessage,
} from '@nebulahome/contracts';

import { LiveClient, type LiveSocket, type LiveStatus } from './live-client';

/** A socket the test drives by hand. */
class FakeSocket implements LiveSocket {
  public readonly sent: string[] = [];

  public isClosed = false;

  readonly #listeners = new Map<string, ((event: never) => void)[]>();

  public send(data: string): void {
    this.sent.push(data);
  }

  public close(): void {
    this.isClosed = true;
  }

  public addEventListener(type: 'open', listener: () => void): void;
  public addEventListener(
    type: 'message',
    listener: (event: { readonly data: unknown }) => void,
  ): void;
  public addEventListener(
    type: 'close',
    listener: (event: { readonly code: number }) => void,
  ): void;
  public addEventListener(type: string, listener: (event: never) => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }

  /** Fires the server's side of the exchange. */
  public open(): void {
    this.#fire('open', {});
  }

  /**
   * Delivers one message from the server.
   *
   * @param message - What the server says.
   */
  public deliver(message: WsServerMessage): void {
    this.#fire('message', { data: JSON.stringify(message) });
  }

  /**
   * Ends the connection from the server's side.
   *
   * @param code - The close code.
   */
  public closeFromServer(code: number): void {
    this.#fire('close', { code });
  }

  /**
   * Calls the listeners of one event.
   *
   * @param type - Which event.
   * @param event - What they hear.
   */
  #fire(type: string, event: unknown): void {
    for (const listener of this.#listeners.get(type) ?? []) {
      // Each listener was registered for the one shape of event this fake fires under its name.
      listener(event as never);
    }
  }
}

/** The welcome the server sends once the token checks out. */
const WELCOME: WsServerMessage = {
  type: 'welcome',
  userId: '00000000-0000-4000-8000-000000000001',
  traceId: 'trace',
  expiresAt: new Date('2026-09-12T00:15:00.000Z'),
};

/** A state change as the server sends it. */
const CHANGE: WsServerMessage = {
  type: 'state_changed',
  entityId: entityIdSchema.parse('sensor.p1s_nozzle_temperature'),
  state: { sensor_numeric: { value: 215 } },
  attributes: {},
  isAvailable: true,
  changedAt: new Date('2026-09-12T00:00:00.000Z'),
};

/**
 * Builds a client over fake sockets.
 *
 * @param tokens - What each read of the access token answers, in order; the last one repeats.
 * @returns The client, the sockets it opened, and what it reported.
 */
function harness(tokens: (string | null)[]) {
  const sockets: FakeSocket[] = [];
  const messages: WsServerMessage[] = [];
  const statuses: LiveStatus[] = [];
  const refresh = vi.fn(async () => Promise.resolve('token-2'));
  let reads = 0;

  const client = new LiveClient({
    url: 'ws://test/api/v1/ws',
    readAccessToken: () => tokens[Math.min(reads++, tokens.length - 1)] ?? null,
    refreshAccessToken: refresh,
    onMessage: (message) => {
      messages.push(message);
    },
    onStatus: (status) => {
      statuses.push(status);
    },
    openSocket: () => {
      const socket = new FakeSocket();

      sockets.push(socket);

      return socket;
    },
    delayFor: (attempt) => attempt * 1000,
  });

  return { client, sockets, messages, statuses, refresh };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LiveClient', () => {
  it('authenticates with the token, subscribes once welcomed, and hands messages on', () => {
    const { client, sockets, messages, statuses } = harness(['token-1']);

    client.start();

    const socket = sockets[0];

    expect(socket).toBeDefined();
    socket?.open();
    expect(socket?.sent).toEqual([
      JSON.stringify({ type: 'authenticate', accessToken: 'token-1' }),
    ]);

    socket?.deliver(WELCOME);
    expect(socket?.sent.slice(1)).toEqual([
      JSON.stringify({ type: 'subscribe', topic: 'state' }),
      JSON.stringify({ type: 'subscribe', topic: 'devices' }),
      JSON.stringify({ type: 'subscribe', topic: 'discovery' }),
      JSON.stringify({ type: 'subscribe', topic: 'containers' }),
      JSON.stringify({ type: 'subscribe', topic: 'backups' }),
      JSON.stringify({ type: 'subscribe', topic: 'packages' }),
      JSON.stringify({ type: 'subscribe', topic: 'automations' }),
      JSON.stringify({ type: 'subscribe', topic: 'system' }),
    ]);
    expect(statuses).toEqual(['connecting', 'live']);

    socket?.deliver(CHANGE);
    expect(messages).toEqual([WELCOME, CHANGE]);
  });

  it('refreshes the token and comes straight back when the server closes for expiry', async () => {
    const { client, sockets, refresh, statuses } = harness(['token-1', 'token-2']);

    client.start();
    sockets[0]?.open();
    sockets[0]?.deliver(WELCOME);
    sockets[0]?.closeFromServer(WS_CLOSE_TOKEN_EXPIRED);

    await vi.waitFor(() => {
      expect(sockets).toHaveLength(2);
    });
    expect(refresh).toHaveBeenCalledOnce();

    sockets[1]?.open();
    expect(sockets[1]?.sent).toEqual([
      JSON.stringify({ type: 'authenticate', accessToken: 'token-2' }),
    ]);
    expect(statuses).toEqual(['connecting', 'live', 'offline', 'connecting']);
  });

  it('waits before trying again after any other close, longer each time', () => {
    const { client, sockets } = harness(['token-1']);

    client.start();
    sockets[0]?.closeFromServer(1006);
    expect(sockets).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);

    sockets[1]?.closeFromServer(1006);
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);

    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(3);
  });

  it('stops for good when told to, closing what was open', () => {
    const { client, sockets, statuses } = harness(['token-1']);

    client.start();
    client.stop();

    expect(sockets[0]?.isClosed).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(statuses.at(-1)).toBe('offline');
  });

  it('opens a fresh socket on reconnect, so the server decides again what it may hear', () => {
    const { client, sockets } = harness(['token-1']);

    client.start();
    sockets[0]?.open();
    sockets[0]?.deliver(WELCOME);

    client.reconnect();

    expect(sockets[0]?.isClosed).toBe(true);
    expect(sockets).toHaveLength(2);
  });

  it('stays offline without a token, and opens nothing', () => {
    const { client, sockets, statuses } = harness([null]);

    client.start();

    expect(sockets).toHaveLength(0);
    expect(statuses).toEqual(['offline']);
  });
});
