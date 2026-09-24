/**
 * The aliases page: a table of derived entities, search and standing filters, and the editor.
 *
 * The API module is stood in for; the live store is the real one, fed the way the channel would
 * feed it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { entityIdSchema, type AliasView, type EntityView } from '@nebula-home/contracts';

import { useSession } from '@/auth/session-store';
import {
  createAlias,
  deleteAlias,
  fetchAliases,
  fetchEntities,
  previewAlias,
  updateAlias,
} from '@/library/api';
import { useLive } from '@/live/live-store';

import { AliasesPage } from './aliases-page';

/**
 * Shows the current path so navigation assertions have something to read.
 *
 * @returns The path, in a test id.
 */
function LocationProbe() {
  const location = useLocation();

  return <div data-testid="location">{location.pathname}</div>;
}

vi.mock('@/library/api', () => ({
  fetchAliases: vi.fn(),
  fetchEntities: vi.fn(),
  createAlias: vi.fn(),
  updateAlias: vi.fn(),
  deleteAlias: vi.fn(),
  previewAlias: vi.fn(),
  LIBRARY_QUERY_KEYS: {
    aliases: ['library', 'aliases'],
    entities: ['library', 'entities'],
  },
}));

const AVERAGE_ID = entityIdSchema.parse('alias.kitchen_average');
const HELPER_ID = entityIdSchema.parse('alias.porch_light');

/** A calculated average of three temperatures. */
const AVERAGE: AliasView = {
  id: '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f',
  entityId: AVERAGE_ID,
  name: 'Kitchen average',
  kind: 'calculated',
  domain: 'sensor',
  capability: 'sensor_numeric',
  capabilities: ['sensor_numeric'],
  expression: '(t1 + t2 + t3) / 3',
  debounceMs: 0,
  fallbackPolicy: 'unavailable',
  isEnabled: true,
  lastError: null,
  lastEvaluatedAt: null,
  unitOfMeasurement: '°C',
  deviceClass: 'temperature',
  min: null,
  max: null,
  step: null,
  sources: [
    {
      variableName: 't1',
      entityId: entityIdSchema.parse('sensor.kitchen_temperature'),
      entityName: 'Kitchen temperature',
      areaName: 'Kitchen',
    },
    {
      variableName: 't2',
      entityId: entityIdSchema.parse('sensor.living_room_temperature'),
      entityName: 'Living room temperature',
      areaName: 'Living room',
    },
  ],
};

/** A stored light helper that is switched off. */
const HELPER: AliasView = {
  id: '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e70',
  entityId: HELPER_ID,
  name: 'Porch light',
  kind: 'stored',
  domain: 'light',
  capability: 'on_off',
  capabilities: ['on_off', 'level'],
  expression: '',
  debounceMs: 0,
  fallbackPolicy: 'unavailable',
  isEnabled: false,
  lastError: 'last write failed',
  lastEvaluatedAt: null,
  unitOfMeasurement: null,
  deviceClass: null,
  min: null,
  max: null,
  step: null,
  sources: [],
};

/**
 * The entity the average produces, as the registry lists it.
 *
 * @param overrides - What differs from a quiet sensor.
 * @returns The entity.
 */
function averageEntity(overrides: Partial<EntityView> = {}): EntityView {
  return {
    entityId: AVERAGE_ID,
    domain: 'alias',
    name: 'Kitchen average',
    icon: null,
    areaKey: null,
    areaName: null,
    deviceId: null,
    source: 'alias',
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
    tagIds: [],
    ...overrides,
  };
}

/**
 * Renders the page with the given permissions.
 *
 * @param permissions - What they hold.
 */
function renderPage(permissions: string[] = ['alias:read', 'alias:write']): void {
  useSession.setState({
    status: 'signed-in',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      username: 'mattia',
      displayName: 'Mattia Carli',
      role: 'owner',
      permissions: permissions.map((key) => ({ key, scope: '*', effect: 'allow' as const })),
      avatarUrl: null,
      locale: 'it',
      timezone: 'Europe/Rome',
      isTwoFactorEnabled: false,
      mustChangePassword: false,
    },
  });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/aliases']}>
        <Routes>
          <Route path="/aliases" element={<AliasesPage />} />
          <Route path="/aliases/new" element={<LocationProbe />} />
          <Route path="/aliases/:aliasId" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useLive.getState().reset();
  vi.mocked(fetchAliases).mockResolvedValue([AVERAGE, HELPER]);
  vi.mocked(fetchEntities).mockResolvedValue([averageEntity()]);
  vi.mocked(createAlias).mockReset();
  vi.mocked(updateAlias).mockReset();
  vi.mocked(deleteAlias).mockReset();
  vi.mocked(previewAlias).mockReset();
});

describe('AliasesPage', () => {
  it('lists aliases by name, address, domain and standing', async () => {
    renderPage();

    expect(await screen.findByText('Kitchen average')).toBeTruthy();
    expect(screen.getAllByText(AVERAGE_ID).length).toBeGreaterThan(0);
    expect(screen.getAllByText('sensor').length).toBeGreaterThan(0);
    expect(screen.getByText('Porch light')).toBeTruthy();
    expect(screen.getAllByText(HELPER_ID).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Off').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Failing').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'New alias' })).toBeTruthy();
  });

  it('hides New and Edit without alias:write', async () => {
    renderPage(['alias:read']);

    await screen.findByText('Kitchen average');

    expect(screen.queryByRole('button', { name: 'New alias' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('narrows the list by what is typed, through source names too', async () => {
    renderPage();
    await screen.findByText('Kitchen average');

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'living room' } });
    expect(screen.getByText('Kitchen average')).toBeTruthy();
    expect(screen.queryByText('Porch light')).toBeNull();

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'nothing here' } });
    expect(screen.queryByText('Kitchen average')).toBeNull();
    expect(screen.getByText(/Nothing matches/u)).toBeTruthy();
  });

  it('narrows the list by domain and by what is wrong, from the filter in the header', async () => {
    renderPage();
    await screen.findByText('Kitchen average');

    fireEvent.click(screen.getByRole('button', { name: /Filter/u }));
    fireEvent.click(await screen.findByRole('combobox', { name: /domain/iu }));
    fireEvent.click(screen.getByRole('option', { name: 'light' }));

    expect(screen.queryByText('Kitchen average')).toBeNull();
    expect(screen.getByText('Porch light')).toBeTruthy();

    fireEvent.click(screen.getByRole('combobox', { name: /domain/iu }));
    fireEvent.click(screen.getByRole('option', { name: 'Any domain' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Failing' }));

    expect(screen.queryByText('Kitchen average')).toBeNull();
    expect(screen.getByText('Porch light')).toBeTruthy();
  });

  it('shows what the channel delivers as the current reading', async () => {
    renderPage();
    await screen.findByText('Kitchen average');

    useLive.getState().apply({
      type: 'state_changed',
      entityId: AVERAGE_ID,
      state: { sensor_numeric: { value: 215 } },
      attributes: {},
      isAvailable: true,
      changedAt: new Date(),
    });

    await waitFor(() => {
      expect(screen.getAllByText(/215/u).length).toBeGreaterThan(0);
    });
  });

  it('opens the calculated editor from New alias', async () => {
    renderPage();
    await screen.findByText('Kitchen average');

    fireEvent.click(screen.getByRole('button', { name: 'New alias' }));

    expect((await screen.findByTestId('location')).textContent).toBe('/aliases/new');
  });

  it('opens an existing alias for editing from Edit', async () => {
    renderPage();
    await screen.findByText('Kitchen average');

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);

    expect((await screen.findByTestId('location')).textContent).toBe(`/aliases/${AVERAGE.id}`);
  });
});
