/**
 * Which lists a message from the live channel has read again, and when the channel opens again
 * without waiting.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIBRARY_KINDS, wsServerMessageSchema, type WsServerMessage } from '@nebulahome/contracts';

import { useSession } from '@/auth/session-store';
import { BACKUP_QUERY_KEYS } from '@/backup/api';
import { LIBRARY_QUERY_KEYS } from '@/library/api';
import { LINK_QUERY_KEYS } from '@/library/links-api';

import { KEPT_FRESH, reconnectsNow, staleAfter, useLiveChannel } from './use-live-channel';

/**
 * A device event, as the server sends it.
 *
 * @param event - Which.
 * @param extra - More of its payload.
 * @returns The message.
 */
function deviceEvent(event: string, extra: object = {}): WsServerMessage {
  return wsServerMessageSchema.parse({
    type: 'device_event',
    event,
    payload: {
      deviceId: 'shelly-1pm-mini',
      source: 'shelly-1pm-mini',
      name: 'Bench relay',
      entityIds: [],
      ...extra,
    },
  });
}

const DISCOVERY = wsServerMessageSchema.parse({
  type: 'discovery_event',
  event: 'changed',
  count: 3,
});

const BACKUP = wsServerMessageSchema.parse({
  type: 'backup_event',
  payload: {
    runId: '018f2f9c-7d3e-7000-8000-000000000001',
    kind: 'backup',
    phase: null,
    status: 'success',
  },
});

const MESSAGES: readonly WsServerMessage[] = [
  deviceEvent('added'),
  deviceEvent('updated'),
  deviceEvent('updated', { described: { added: [], removed: [] } }),
  DISCOVERY,
  wsServerMessageSchema.parse({ type: 'integration_event', vendorId: 'shelly' }),
  BACKUP,
  wsServerMessageSchema.parse({
    type: 'container_event',
    payload: { name: 'nebula-mosquitto', event: 'changed' },
  }),
  wsServerMessageSchema.parse({ type: 'package_event', event: 'installed', payload: {} }),
  wsServerMessageSchema.parse({
    type: 'automation_event',
    automationId: '018f2f9c-7d3e-7000-8000-000000000002',
    payload: {
      kind: 'started',
      runId: '018f2f9c-7d3e-7000-8000-000000000003',
      time: '2026-11-04T10:00:00.000Z',
    },
  }),
  wsServerMessageSchema.parse({ type: 'platform_event', payload: { operation: null } }),
  ...LIBRARY_KINDS.map((kind) => wsServerMessageSchema.parse({ type: 'library_event', kind })),
];

describe('staleAfter', () => {
  it('reads the vendor Found tab again when what discovery proposes changes', () => {
    expect(staleAfter(DISCOVERY)).toContainEqual(LINK_QUERY_KEYS.found);
  });

  it('reads the entities again for a device described again, not for one only updated', () => {
    expect(staleAfter(deviceEvent('updated'))).toEqual([LIBRARY_QUERY_KEYS.devices]);
    expect(
      staleAfter(deviceEvent('updated', { described: { added: [], removed: [] } })),
    ).toContainEqual(LIBRARY_QUERY_KEYS.entities);
  });

  it('reads the links offered again when a device is added', () => {
    expect(staleAfter(deviceEvent('added'))).toContainEqual(LINK_QUERY_KEYS.suggestions);
  });

  it('reads the archives again when a backup moves on', () => {
    expect(staleAfter(BACKUP)).toContainEqual(BACKUP_QUERY_KEYS.archives);
  });

  it('reads a list edited in another browser again', () => {
    expect(
      staleAfter(wsServerMessageSchema.parse({ type: 'library_event', kind: 'scenes' })),
    ).toEqual([LIBRARY_QUERY_KEYS.scenes]);
    expect(
      staleAfter(wsServerMessageSchema.parse({ type: 'library_event', kind: 'areas' })),
    ).toContainEqual(LIBRARY_QUERY_KEYS.entities);
  });

  it('keeps fresh, after a drop, every list a message can make stale', () => {
    const kept = new Set(KEPT_FRESH.map((key) => JSON.stringify(key)));

    for (const message of MESSAGES) {
      for (const key of staleAfter(message)) {
        expect(kept, JSON.stringify(key)).toContain(JSON.stringify(key));
      }
    }
  });
});

/** A browser socket the test drives by hand. */
class FakeWebSocket {
  /** Every socket opened, in order. */
  public static opened: FakeWebSocket[] = [];

  readonly #listeners = new Map<string, ((event: unknown) => void)[]>();

  public constructor() {
    FakeWebSocket.opened.push(this);
  }

  /** Sends nothing anywhere. */
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- nobody is listening
  public send(): void {}

  /** Closes nothing: the client stops listening to a socket it closed. */
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- see above
  public close(): void {}

  /**
   * Remembers a listener.
   *
   * @param type - Which event.
   * @param listener - Who hears it.
   */
  public addEventListener(type: string, listener: (event: unknown) => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }

  /**
   * Delivers one message from the server.
   *
   * @param message - What it says.
   */
  public deliver(message: object): void {
    for (const listener of this.#listeners.get('message') ?? []) {
      listener({ data: JSON.stringify(message) });
    }
  }
}

describe('useLiveChannel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.opened = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('fetch', async () => new Promise(() => undefined));
    useSession.setState({ status: 'signed-in', accessToken: 'token' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    useSession.setState({ status: 'signed-out', accessToken: null });
  });

  it('reads the entities once on first welcome, and opens one socket for a burst of devices', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    renderHook(useLiveChannel, {
      wrapper: ({ children }) =>
        createElement(QueryClientProvider, { client: queryClient }, children),
    });

    FakeWebSocket.opened[0]?.deliver({
      type: 'welcome',
      userId: '00000000-0000-4000-8000-000000000001',
      traceId: 'trace',
      expiresAt: '2026-09-12T00:15:00.000Z',
    });
    vi.advanceTimersByTime(200);
    expect(invalidate.mock.calls).toEqual([[{ queryKey: LIBRARY_QUERY_KEYS.entities }]]);

    for (let index = 0; index < 3; index += 1) {
      FakeWebSocket.opened[0]?.deliver(deviceEvent('added'));
    }

    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.opened).toHaveLength(2);
  });
});

describe('reconnectsNow', () => {
  it('opens the channel at once as Nebula Home answers again', () => {
    expect(reconnectsNow('back', 'away', 'offline')).toBe(true);
  });

  it('opens it once, not on every look while the server is back', () => {
    expect(reconnectsNow('back', 'back', 'offline')).toBe(false);
  });

  it('leaves a socket already opening, or open, alone', () => {
    expect(reconnectsNow('back', 'away', 'connecting')).toBe(false);
    expect(reconnectsNow('back', 'away', 'live')).toBe(false);
  });

  it('waits while the server is still away', () => {
    expect(reconnectsNow('away', 'stopping', 'offline')).toBe(false);
    expect(reconnectsNow(undefined, undefined, 'offline')).toBe(false);
  });
});
