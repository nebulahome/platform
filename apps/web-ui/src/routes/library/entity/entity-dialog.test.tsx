/**
 * An entity's dialog over a page: `?entity=` in the address opens it, Close takes only that out
 * of the address, `entity-view` raises a sheet, and a disabled entity is enabled again through
 * the entity change.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EntityView } from '@nebulahome/contracts';

import { useSession } from '@/auth/session-store';
import type * as LibraryApi from '@/library/api';
import { fetchEntities, fetchEntity, updateEntity } from '@/library/api';
import { useLive } from '@/live/live-store';
import { EntityDialogHost } from '@/routes/library/entity/entity-dialog';
import { anEntity } from '@/testing/fixtures';

vi.mock('@/library/api', async (original) => ({
  ...(await original<typeof LibraryApi>()),
  fetchEntity: vi.fn(),
  fetchEntities: vi.fn(),
  fetchDevices: vi.fn(async () => Promise.resolve([])),
  fetchTags: vi.fn(async () => Promise.resolve([])),
  fetchIcons: vi.fn(async () => Promise.resolve([])),
  fetchVendors: vi.fn(async () => Promise.resolve([])),
  fetchStateHistory: vi.fn(async () => Promise.resolve([])),
  fetchTelemetry: vi.fn(async () => Promise.resolve([])),
  updateEntity: vi.fn(),
}));

/** A relay that is switched on. */
const RELAY = anEntity({ name: 'Garage relay', state: { on_off: { isOn: true } } });

/** The battery sensor on the relay's device. */
const BATTERY = anEntity({
  entityId: 'sensor.garage_battery',
  name: 'Garage battery',
  deviceClass: 'battery',
  capabilities: [{ capability: 'sensor_numeric', params: {} }],
  state: { sensor_numeric: { value: 42 } },
});

/**
 * Shows the address's query.
 *
 * @returns The query.
 */
function Query() {
  return <output aria-label="Query">{useLocation().search}</output>;
}

/**
 * Draws a page with the dialog's host, at an address.
 *
 * @param entity - The entity the API answers with.
 * @param address - Where the page is.
 */
function show(entity: EntityView, address: string): void {
  vi.mocked(fetchEntity).mockResolvedValue(entity);
  vi.mocked(fetchEntities).mockResolvedValue([entity, BATTERY]);

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[address]}>
        <Routes>
          <Route
            path="/devices"
            element={
              <>
                <Query />
                <EntityDialogHost />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useLive.getState().reset();
  vi.mocked(updateEntity).mockReset();
  useSession.setState({
    status: 'signed-in',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      username: 'mattia',
      displayName: 'Mattia Carli',
      role: 'owner',
      permissions: ['entity:read', 'entity:write', 'entity:control', 'tag:write'].map((key) => ({
        key,
        scope: '*',
        effect: 'allow' as const,
      })),
      avatarUrl: null,
      locale: 'en',
      houseLocale: 'en',
      timezone: 'Europe/Rome',
      isTwoFactorEnabled: false,
      mustChangePassword: false,
    },
  });
});

describe('the entity dialog over a page', () => {
  it('opens for ?entity= and puts away only its own part of the address', async () => {
    show(RELAY, `/devices?q=garage&entity=${RELAY.entityId}`);

    expect(await screen.findByRole('dialog', { name: 'Garage relay' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Garage relay' })).toBeNull();
    });
    expect(screen.getByRole('status', { name: 'Query' }).textContent).toBe('?q=garage');
  });

  it('opens on its settings when the address asks', async () => {
    show(RELAY, `/devices?entity=${RELAY.entityId}&entity-view=settings`);

    expect(await screen.findByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('enables a disabled entity through the entity change', async () => {
    vi.mocked(updateEntity).mockResolvedValue({ ...RELAY, isEnabled: true });
    show({ ...RELAY, isEnabled: false }, `/devices?entity=${RELAY.entityId}`);

    fireEvent.click(await screen.findByRole('button', { name: 'Enable' }));

    await waitFor(() => {
      expect(updateEntity).toHaveBeenCalledWith(RELAY.entityId, { isEnabled: true });
    });
  });
});
