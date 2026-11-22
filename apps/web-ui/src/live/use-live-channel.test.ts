/**
 * Which lists a message from the live channel has read again, and when the channel opens again
 * without waiting.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BROKER_EVENT_PARTS,
  BROKER_IDS,
  LIBRARY_KINDS,
  wsServerMessageSchema,
  type WsServerMessage,
} from '@nebulahome/contracts';
import { toast } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { BACKUP_QUERY_KEYS } from '@/backup/api';
import { LIBRARY_QUERY_KEYS } from '@/library/api';
import { BROKER_QUERY_KEYS } from '@/library/brokers-api';
import { INFRARED_QUERY_KEYS } from '@/library/infrared-api';
import { LINK_QUERY_KEYS } from '@/library/links-api';
import { useLive } from '@/live/live-store';

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

/**
 * A broker event, as the server sends it.
 *
 * @param broker - Which broker.
 * @param part - Which part of its page.
 * @returns The message.
 */
function brokerEvent(broker: string, part: string): WsServerMessage {
  return wsServerMessageSchema.parse({ type: 'broker_event', broker, part });
}

/** Every broker, with every part of its page the hub names. */
const BROKER_PARTS = BROKER_IDS.flatMap((broker) => {
  const parts: readonly string[] = BROKER_EVENT_PARTS[broker];

  return parts.map((part) => ({ broker, part }));
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
  ...BROKER_PARTS.map(({ broker, part }) => brokerEvent(broker, part)),
];

describe('staleAfter', () => {
  it('reads the vendor Found tab again when what discovery proposes changes', () => {
    expect(staleAfter(DISCOVERY)).toContainEqual(LINK_QUERY_KEYS.found);
  });

  it('reads the entities again for a device described again, not for one only updated', () => {
    expect(staleAfter(deviceEvent('updated'))).toEqual([
      LIBRARY_QUERY_KEYS.devices,
      { queryKey: BROKER_QUERY_KEYS.brokers, exact: true },
    ]);
    expect(
      staleAfter(deviceEvent('updated', { described: { added: [], removed: [] } })),
    ).toContainEqual(LIBRARY_QUERY_KEYS.entities);
  });

  it("reads only the brokers' cards again for a device, not every broker's page", () => {
    for (const event of ['added', 'removed', 'updated']) {
      expect(staleAfter(deviceEvent(event))).toContainEqual({
        queryKey: BROKER_QUERY_KEYS.brokers,
        exact: true,
      });
      expect(staleAfter(deviceEvent(event))).not.toContainEqual(BROKER_QUERY_KEYS.brokers);
    }
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
    for (const message of MESSAGES) {
      for (const stale of staleAfter(message)) {
        const key = 'queryKey' in stale ? stale.queryKey : stale;
        const isKept = KEPT_FRESH.some((kept) => {
          // A list kept fresh alone covers itself, not the queries under its key.
          const isAlone = 'queryKey' in kept;
          const keptKey = isAlone ? kept.queryKey : kept;

          return (
            (!isAlone || keptKey.length === key.length) &&
            keptKey.every((part, index) => Object.is(part, key[index]))
          );
        });

        expect(isKept, JSON.stringify(key)).toBe(true);
      }
    }
  });

  it('reads the automations list alone and that automation’s runs when a run moves on', () => {
    const run = wsServerMessageSchema.parse({
      type: 'automation_event',
      automationId: '018f2f9c-7d3e-7000-8000-000000000002',
      payload: {
        kind: 'finished',
        runId: '018f2f9c-7d3e-7000-8000-000000000003',
        time: '2026-11-04T10:00:00.000Z',
      },
    });

    expect(staleAfter(run)).toEqual([
      { queryKey: LIBRARY_QUERY_KEYS.automations, exact: true },
      [...LIBRARY_QUERY_KEYS.automationRuns, '018f2f9c-7d3e-7000-8000-000000000002'],
      LIBRARY_QUERY_KEYS.webhookCalls,
    ]);
  });

  it('reads again the one part of a broker’s page that changed, for every part the hub names', () => {
    for (const { broker, part } of BROKER_PARTS) {
      expect(staleAfter(brokerEvent(broker, part)), `${broker} ${part}`).toEqual([
        ['brokers', broker, part],
        ...(part === 'status' ? [{ queryKey: ['brokers'], exact: true }] : []),
        ...(broker === 'infrared' && part === 'remotes' ? [INFRARED_QUERY_KEYS.remote] : []),
      ]);
    }
  });

  it('reads the Brokers page’s cards alone, not every broker’s queries, when a broker’s state changes', () => {
    expect(staleAfter(brokerEvent('matter', 'status'))).toEqual([
      BROKER_QUERY_KEYS.matterStatus,
      { queryKey: BROKER_QUERY_KEYS.brokers, exact: true },
    ]);
    expect(staleAfter(brokerEvent('matter', 'nodes'))).toEqual([BROKER_QUERY_KEYS.matterNodes]);
  });

  it('reads each remote’s own page again when the remotes change', () => {
    expect(staleAfter(brokerEvent('infrared', 'remotes'))).toContainEqual(
      INFRARED_QUERY_KEYS.remote,
    );
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

/** The server's welcome on a socket. */
const WELCOME = {
  type: 'welcome',
  userId: '00000000-0000-4000-8000-000000000001',
  traceId: 'trace',
  expiresAt: '2026-09-12T00:15:00.000Z',
};

/** A light's state, as the channel says it. */
const STATE = {
  type: 'state_changed',
  entityId: 'light.bench',
  state: { on_off: { isOn: true } },
  attributes: {},
  isAvailable: true,
  changedAt: '2026-09-12T00:00:00.000Z',
};

/**
 * Wraps the hook in a query client and a router.
 *
 * @param queryClient - The client.
 * @returns The wrapper.
 */
function wrapperOf(queryClient: QueryClient) {
  /**
   * Wraps.
   *
   * @param props - What to wrap.
   * @param props.children - The hook's host.
   * @returns The wrapped host.
   */
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(MemoryRouter, null, children),
    );
  }

  return Wrapper;
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
    vi.restoreAllMocks();
  });

  it('reads the entities once on first welcome, and opens one socket for a burst of devices', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    renderHook(useLiveChannel, {
      wrapper: ({ children }) =>
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(MemoryRouter, null, children),
        ),
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

  it('keeps the readings and reads only the entities when it opened a socket afresh for devices', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    renderHook(useLiveChannel, { wrapper: wrapperOf(queryClient) });
    FakeWebSocket.opened[0]?.deliver(WELCOME);
    FakeWebSocket.opened[0]?.deliver(STATE);
    useLive.getState().flush();
    FakeWebSocket.opened[0]?.deliver(deviceEvent('added'));
    vi.advanceTimersByTime(1000);
    invalidate.mockClear();

    FakeWebSocket.opened[1]?.deliver(WELCOME);
    vi.advanceTimersByTime(200);

    expect(useLive.getState().readings['light.bench']).toBeDefined();
    expect(invalidate.mock.calls).toEqual([[{ queryKey: LIBRARY_QUERY_KEYS.entities }]]);
  });

  it('reads the devices list at most once in five seconds, and the last change of a burst too', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    /**
     * How many times the devices list was read again.
     *
     * @returns The count.
     */
    const devicesRead = (): number =>
      invalidate.mock.calls.filter(
        ([filters]) =>
          JSON.stringify(filters?.queryKey) === JSON.stringify(LIBRARY_QUERY_KEYS.devices),
      ).length;

    renderHook(useLiveChannel, { wrapper: wrapperOf(queryClient) });
    FakeWebSocket.opened[0]?.deliver(WELCOME);

    FakeWebSocket.opened[0]?.deliver(deviceEvent('updated'));
    vi.advanceTimersByTime(200);
    expect(devicesRead()).toBe(1);

    FakeWebSocket.opened[0]?.deliver(deviceEvent('updated'));
    vi.advanceTimersByTime(1000);
    FakeWebSocket.opened[0]?.deliver(deviceEvent('updated'));
    vi.advanceTimersByTime(1000);
    expect(devicesRead()).toBe(1);

    vi.advanceTimersByTime(3000);
    expect(devicesRead()).toBe(2);
  });

  it('marks the Brokers page’s cards stale alone when a broker’s state changes', () => {
    const queryClient = new QueryClient();

    queryClient.setQueryData(BROKER_QUERY_KEYS.brokers, { items: [] });
    queryClient.setQueryData(BROKER_QUERY_KEYS.matterStatus, {});
    queryClient.setQueryData(BROKER_QUERY_KEYS.mqttStatus, {});
    queryClient.setQueryData(INFRARED_QUERY_KEYS.remotes, []);
    /**
     * Whether a query was marked stale.
     *
     * @param queryKey - Its key.
     * @returns True once it was.
     */
    const isStale = (queryKey: readonly unknown[]): boolean | undefined =>
      queryClient.getQueryState(queryKey)?.isInvalidated;

    renderHook(useLiveChannel, { wrapper: wrapperOf(queryClient) });
    FakeWebSocket.opened[0]?.deliver(WELCOME);
    vi.advanceTimersByTime(200);
    FakeWebSocket.opened[0]?.deliver({ type: 'broker_event', broker: 'matter', part: 'status' });
    vi.advanceTimersByTime(200);

    expect(isStale(BROKER_QUERY_KEYS.brokers)).toBe(true);
    expect(isStale(BROKER_QUERY_KEYS.matterStatus)).toBe(true);
    expect(isStale(BROKER_QUERY_KEYS.mqttStatus)).toBe(false);
    expect(isStale(INFRARED_QUERY_KEYS.remotes)).toBe(false);
  });

  it('says a device removed as a duplicate is already in the house, and leads to it', () => {
    const queryClient = new QueryClient();
    const { result } = renderHook(
      () => {
        useLiveChannel();

        return useLocation();
      },
      {
        wrapper: ({ children }) =>
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(MemoryRouter, null, children),
          ),
      },
    );

    const warning = vi.spyOn(toast, 'warning');

    FakeWebSocket.opened[0]?.deliver(deviceEvent('removed'));
    expect(warning).not.toHaveBeenCalled();

    FakeWebSocket.opened[0]?.deliver(
      deviceEvent('removed', {
        name: '192.168.1.50 unit 1',
        reason: 'duplicate',
        duplicateOf: { id: 'solax-inverter', name: 'Inverter garage' },
      }),
    );

    const shown = warning.mock.calls[0]?.[0];

    expect(shown?.title).toBe('Already in the house');
    expect(shown?.message).toBe(
      '192.168.1.50 unit 1 is already Inverter garage, so the device you just added was removed.',
    );
    expect(shown?.action?.label).toBe('Open Inverter garage');

    act(() => {
      shown?.action?.onSelect();
    });
    expect(result.current.pathname).toBe('/devices/solax-inverter');
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
