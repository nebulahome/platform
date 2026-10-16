/**
 * The past as a package reads it: each entity's points oldest first, in the SDK's shape, a
 * relative window resolved when it is read, the resolution picked by its length, and an entity
 * the viewer may not read left out rather than failing the rest.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type * as Api from '@/library/api';
import { fetchStateHistory, fetchTelemetry } from '@/library/api';
import { useStateHistory, useTelemetry } from '@/packages/sdk-history';

vi.mock('@/library/api', async (original) => ({
  ...(await original<typeof Api>()),
  fetchStateHistory: vi.fn(),
  fetchTelemetry: vi.fn(),
}));

/**
 * A fresh query cache around what is rendered.
 *
 * @param props - What is rendered.
 * @param props.children - It.
 * @returns It, with the cache.
 */
function Cache(props: { readonly children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return <QueryClientProvider client={client}>{props.children}</QueryClientProvider>;
}

describe('useStateHistory', () => {
  it("answers each entity's changes in the SDK's shape, leaving out one it may not read", async () => {
    vi.mocked(fetchStateHistory).mockImplementation(async (window) => {
      if (window.entityId === 'light.secret') {
        throw new Error('Not found');
      }

      return Promise.resolve([
        {
          time: new Date('2026-10-02T07:00:00Z'),
          entityId: 'light.hall',
          state: { on_off: { isOn: true } },
          previousState: { on_off: { isOn: false } },
          attributes: {},
          isAvailable: true,
          source: 'shelly',
          context: { type: 'user' as const, id: '0199f0e0-0000-7000-8000-000000000001' },
        },
      ] as never);
    });

    const { result } = renderHook(
      () =>
        useStateHistory({
          entityIds: ['light.hall', 'light.secret', 'light.hall'],
          window: { from: '2026-10-02T00:00:00Z', to: '2026-10-03T00:00:00Z' },
        }),
      { wrapper: Cache },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(vi.mocked(fetchStateHistory)).toHaveBeenCalledTimes(2);
    expect(result.current.series).toEqual({
      'light.hall': [
        {
          time: '2026-10-02T07:00:00.000Z',
          state: { on_off: { isOn: true } },
          previousState: { on_off: { isOn: false } },
          attributes: {},
          isAvailable: true,
          source: 'shelly',
          cause: { type: 'user', id: '0199f0e0-0000-7000-8000-000000000001' },
        },
      ],
    });
    expect(result.current.window).toEqual({
      from: Date.parse('2026-10-02T00:00:00Z'),
      to: Date.parse('2026-10-03T00:00:00Z'),
    });
    expect(result.current.error).toBeNull();
  });
});

describe('useTelemetry', () => {
  it('reads the last day in minutes, the window ending when it is read', async () => {
    vi.mocked(fetchTelemetry).mockResolvedValue([
      { time: new Date('2026-10-02T07:00:00Z'), value: 21.5, min: 21, max: 22, count: 3 },
    ]);

    const before = Date.now();
    const { result } = renderHook(
      () =>
        useTelemetry({ entityIds: ['sensor.kitchen_temperature'], window: { lastMs: 86_400_000 } }),
      { wrapper: Cache },
    );

    await waitFor(() => {
      expect(result.current.series['sensor.kitchen_temperature']).toBeDefined();
    });

    const [window, resolution] = vi.mocked(fetchTelemetry).mock.calls[0] ?? [];

    expect(resolution).toBe('1m');
    expect(result.current.resolution).toBe('1m');
    expect(window?.to.getTime()).toBeGreaterThanOrEqual(before);
    expect((window?.to.getTime() ?? 0) - (window?.from.getTime() ?? 0)).toBe(86_400_000);
    expect(result.current.series['sensor.kitchen_temperature']).toEqual([
      { time: '2026-10-02T07:00:00.000Z', value: 21.5, min: 21, max: 22, count: 3 },
    ]);
  });
});
