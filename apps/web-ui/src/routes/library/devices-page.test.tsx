/**
 * The registry page: a device with its entities, the readings under it, and the live channel
 * changing them while the page is open.
 *
 * The API module is stood in for; the live store is the real one, fed the way the channel would
 * feed it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { entityIdSchema, type DeviceView, type EntityView } from '@nebula-home/contracts';

import { useSession } from '@/auth/session-store';
import { fetchDevices, fetchEntities } from '@/library/api';
import { useLive } from '@/live/live-store';

import { DevicesPage } from './devices-page';

vi.mock('@/library/api', () => ({
  fetchDevices: vi.fn(),
  fetchEntities: vi.fn(),
  fetchIntegrations: vi.fn(async () => Promise.resolve([])),
  fetchCandidates: vi.fn(),
  startDiscovery: vi.fn(),
  adoptCandidate: vi.fn(),
  LIBRARY_QUERY_KEYS: {
    devices: ['library', 'devices'],
    entities: ['library', 'entities'],
    integrations: ['library', 'integrations'],
    candidates: ['library', 'candidates'],
  },
}));

const NOZZLE_ID = entityIdSchema.parse('sensor.d_01p00a000000042_nozzle_temperature');
const LIGHT_ID = entityIdSchema.parse('light.d_01p00a000000042_chamber_light');

/** The printer, as the registry lists it. */
const PRINTER: DeviceView = {
  id: '00000000-0000-4000-8000-000000000010',
  owner: { kind: 'integration', id: 'bambu-lab-1' },
  externalId: '01P00A000000042',
  name: '01P00A000000042',
  manufacturer: 'Bambu Lab',
  model: 'P1S',
  swVersion: null,
  hwVersion: null,
  areaKey: null,
  areaName: null,
  viaDeviceId: null,
  isEnabled: true,
  lastSeenAt: null,
  entityIds: [NOZZLE_ID, LIGHT_ID],
};

/**
 * An entity of the printer that has never reported.
 *
 * @param entityId - Its address.
 * @param name - What it is called.
 * @param overrides - What differs from a thermometer.
 * @returns The entity.
 */
function entity(
  entityId: EntityView['entityId'],
  name: string,
  overrides: Partial<EntityView> = {},
): EntityView {
  return {
    entityId,
    domain: entityId.split('.')[0] ?? '',
    name,
    icon: null,
    areaKey: null,
    areaName: null,
    deviceId: PRINTER.id,
    source: 'bambu-lab-1',
    unitOfMeasurement: '°C',
    deviceClass: 'temperature',
    isEnabled: true,
    isHidden: false,
    capabilities: [{ capability: 'sensor_numeric', params: {} }],
    searchAliases: [],
    state: null,
    attributes: {},
    isAvailable: true,
    lastChanged: null,
    lastUpdated: null,
    ...overrides,
  };
}

/** Renders the page with an owner signed in. */
function renderPage(): void {
  useSession.setState({
    status: 'signed-in',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      username: 'mattia',
      displayName: 'Mattia Carli',
      role: 'owner',
      permissions: [{ key: 'device:write', scope: '*', effect: 'allow' }],
      avatarUrl: null,
      locale: 'it',
      timezone: 'Europe/Rome',
      isTwoFactorEnabled: false,
      mustChangePassword: false,
    },
  });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/devices']}>
        <DevicesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useLive.getState().reset();
  vi.mocked(fetchDevices).mockResolvedValue([PRINTER]);
  vi.mocked(fetchEntities).mockResolvedValue([
    entity(NOZZLE_ID, 'Nozzle temperature'),
    entity(LIGHT_ID, 'Chamber light', {
      unitOfMeasurement: null,
      deviceClass: null,
      capabilities: [{ capability: 'on_off', params: {} }],
    }),
  ]);
});

describe('DevicesPage', () => {
  it('lists the device under its owner, silent until something reports', async () => {
    renderPage();

    const row = await screen.findByRole('button', { name: /01P00A000000042/u });

    expect(row.textContent).toContain('bambu-lab-1');
    expect(row.textContent).toContain('Silent');
    expect(row.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens to the entities, each with its address, its capability and its reading', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /01P00A000000042/u }));

    expect(screen.getByText(NOZZLE_ID)).toBeTruthy();
    expect(screen.getByText('Nozzle temperature')).toBeTruthy();
    expect(screen.getByText('sensor_numeric')).toBeTruthy();
    expect(screen.getAllByTitle('Never reported')).toHaveLength(2);
  });

  it('shows what the channel delivers, and turns the device to reporting', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /01P00A000000042/u }));

    useLive.getState().apply({
      type: 'state_changed',
      entityId: NOZZLE_ID,
      state: { sensor_numeric: { value: 215 } },
      attributes: {},
      isAvailable: true,
      changedAt: new Date(),
    });

    await waitFor(() => {
      expect(screen.getByText('215 °C')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /01P00A000000042/u }).textContent).toContain(
      'Reporting',
    );
  });

  it('narrows the list by what is typed, through the entities too', async () => {
    renderPage();
    await screen.findByRole('button', { name: /01P00A000000042/u });

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'chamber' } });
    expect(screen.getByRole('button', { name: /01P00A000000042/u })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'shelly' } });
    expect(screen.queryByRole('button', { name: /01P00A000000042/u })).toBeNull();
    expect(screen.getByText(/Nothing matches/u)).toBeTruthy();
  });
});
