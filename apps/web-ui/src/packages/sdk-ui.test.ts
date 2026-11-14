/**
 * A package's settings as its components read them: what was saved, with the defaults and the
 * secrets as whether one is saved; and, before anything is read, what the declaration gives.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { entityIdSchema } from '@nebulahome/contracts';
import { defineSettings, field } from '@nebulahome/package-sdk';

import type * as Api from '@/library/api';
import { fetchEntities } from '@/library/api';
import { useLive } from '@/live/live-store';
import { declaredSettingsOf, UI_HOST, visibleSettingsOf } from '@/packages/sdk-ui';
import { anEntity } from '@/testing/fixtures';

vi.mock('@/library/api', async (original) => ({
  ...(await original<typeof Api>()),
  fetchEntities: vi.fn(),
}));

describe('useEntity', () => {
  it('draws again for its own entity’s reading, not for another’s', async () => {
    const relay = anEntity();
    const lamp = anEntity({ entityId: 'light.porch' });
    const queryClient = new QueryClient();
    let renders = 0;

    vi.mocked(fetchEntities).mockResolvedValue([relay, lamp]);
    useLive.getState().reset();

    const { result } = renderHook(
      () => {
        renders += 1;

        return UI_HOST.useEntity(relay.entityId);
      },
      {
        wrapper: ({ children }) =>
          createElement(QueryClientProvider, { client: queryClient }, children),
      },
    );

    await waitFor(() => {
      expect(result.current?.state).toEqual({ on_off: { isOn: false } });
    });

    const before = renders;
    const change = {
      type: 'state_changed',
      state: { on_off: { isOn: true } },
      attributes: {},
      isAvailable: true,
      changedAt: new Date('2026-09-20T09:00:00.000Z'),
    } as const;

    act(() => {
      useLive.getState().apply({ ...change, entityId: entityIdSchema.parse('light.porch') });
      useLive.getState().flush();
    });
    expect(renders).toBe(before);

    act(() => {
      useLive.getState().apply({ ...change, entityId: relay.entityId });
      useLive.getState().flush();
    });
    expect(result.current?.state).toEqual({ on_off: { isOn: true } });
    expect(result.current?.lastChanged).toBe('2026-09-20T09:00:00.000Z');
  });
});

describe('visibleSettingsOf', () => {
  it('fills the defaults in, and reads a secret as whether one is saved', () => {
    expect(
      visibleSettingsOf(
        { interval: 4, token: { $sealed: true } },
        {
          transport: {
            constants: {},
            fields: [
              {
                key: 'interval',
                type: 'number',
                label: 'Tick every',
                isRequired: false,
                isInteger: true,
                default: 10,
              },
              {
                key: 'city',
                type: 'text',
                label: 'City',
                isRequired: false,
                maxLength: 512,
                default: 'Turin',
              },
              { key: 'token', type: 'secret', label: 'Token', isRequired: false, maxLength: 512 },
              { key: 'other', type: 'secret', label: 'Other', isRequired: false, maxLength: 512 },
            ],
          },
          options: { constants: {}, fields: [] },
        },
      ),
    ).toEqual({ interval: 4, city: 'Turin', token: true, other: false });
  });
});

describe('declaredSettingsOf', () => {
  it('gives each declared default, and no secret, before anything is read', () => {
    const settings = defineSettings({
      interval: field.number({ label: 'Tick every', default: 10 }),
      city: field.text({ label: 'City' }),
      token: field.secret({ label: 'Token' }),
    });

    expect(declaredSettingsOf(settings)).toEqual({ interval: 10, token: false });
    expect(declaredSettingsOf(undefined)).toEqual({});
  });
});
