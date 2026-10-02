/**
 * The alias editor page: name with id caption, formula, sources with picker, no Enabled control.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { entityIdSchema, type AliasView, type EntityView } from '@nebulahome/contracts';

import { useSession } from '@/auth/session-store';
import { ApiError } from '@/lib/api-error';
import {
  createAlias,
  deleteAlias,
  fetchAliases,
  fetchEntities,
  previewAlias,
  updateAlias,
} from '@/library/api';

import { AliasEditor, removalMessage } from './alias-editor';

vi.mock('@/library/api', () => ({
  fetchAliases: vi.fn(),
  fetchEntities: vi.fn(),
  fetchDevices: vi.fn().mockResolvedValue([]),
  fetchAreas: vi.fn().mockResolvedValue([]),
  fetchIcons: vi.fn().mockResolvedValue([]),
  createAlias: vi.fn(),
  updateAlias: vi.fn(),
  deleteAlias: vi.fn(),
  previewAlias: vi.fn(),
  LIBRARY_QUERY_KEYS: {
    aliases: ['library', 'aliases'],
    areas: ['library', 'areas'],
    devices: ['library', 'devices'],
    entities: ['library', 'entities'],
    icons: ['library', 'icons'],
  },
}));

const AVERAGE_ID = entityIdSchema.parse('alias.kitchen_average');

/** A calculated average of two temperatures. */
const AVERAGE: AliasView = {
  id: '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f',
  entityId: AVERAGE_ID,
  name: 'Kitchen average',
  kind: 'calculated',
  domain: 'sensor',
  capability: 'sensor_numeric',
  capabilities: ['sensor_numeric'],
  expression: '(t1 + t2) / 2',
  debounceMs: 0,
  fallbackPolicy: 'unavailable',
  isEnabled: true,
  lastError: null,
  lastEvaluatedAt: null,
  unitOfMeasurement: '?C',
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

const KITCHEN: EntityView = {
  entityId: entityIdSchema.parse('sensor.kitchen_temperature'),
  domain: 'sensor',
  name: 'Kitchen temperature',
  icon: null,
  areaKey: 'kitchen',
  areaName: 'Kitchen',
  deviceId: null,
  source: 'shelly-bench',
  unitOfMeasurement: '?C',
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
};

/**
 * Renders the editor at the given address.
 *
 * @param path - `/aliases/new` or `/aliases/:id`.
 */
function renderEditor(path: string): void {
  useSession.setState({
    status: 'signed-in',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      username: 'mattia',
      displayName: 'Mattia Carli',
      role: 'owner',
      permissions: [
        { key: 'alias:read', scope: '*', effect: 'allow' },
        { key: 'alias:write', scope: '*', effect: 'allow' },
      ],
      avatarUrl: null,
      locale: 'it',
      timezone: 'Europe/Rome',
      isTwoFactorEnabled: false,
      mustChangePassword: false,
    },
  });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/aliases/new" element={<AliasEditor />} />
          <Route path="/aliases/:aliasId" element={<AliasEditor />} />
          <Route path="/aliases" element={<div data-testid="aliases-list" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(fetchAliases).mockResolvedValue([AVERAGE]);
  vi.mocked(fetchEntities).mockResolvedValue([KITCHEN]);
  vi.mocked(createAlias).mockReset();
  vi.mocked(updateAlias).mockReset();
  vi.mocked(deleteAlias).mockReset();
  vi.mocked(previewAlias).mockReset();
});

describe('AliasEditor', () => {
  it('shows New alias with a derived id caption and no Enabled control', async () => {
    renderEditor('/aliases/new');

    expect(await screen.findByRole('heading', { name: /New alias/u })).toBeTruthy();
    expect(screen.getByLabelText('Name')).toBeTruthy();
    expect(screen.getByText('alias.…')).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: /Enabled/iu })).toBeNull();
    expect(screen.queryByLabelText('Object id')).toBeNull();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Hall average' } });
    expect(screen.getByText('alias.hall_average')).toBeTruthy();
    expect(screen.getByLabelText('Formula')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a source' })).toBeTruthy();
  });

  it('loads an existing alias and keeps the saved address under the name', async () => {
    renderEditor(`/aliases/${AVERAGE.id}`);

    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('Kitchen average');
    });

    expect(screen.getByText(AVERAGE_ID)).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Formula').value).toBe('(t1 + t2) / 2');
    expect(screen.queryByRole('radiogroup', { name: /Enabled/iu })).toBeNull();
  });

  it('creates a calculated alias enabled, without sending isEnabled on update', async () => {
    vi.mocked(createAlias).mockResolvedValue(AVERAGE);
    renderEditor('/aliases/new');

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Hall average' } });
    fireEvent.change(screen.getByLabelText('Formula'), { target: { value: 't1' } });

    fireEvent.click(await screen.findByRole('button', { name: /Entity read as t1/u }));
    fireEvent.click(
      await screen.findByRole('button', { name: /Kitchen temperature/u, pressed: false }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use this one' }));

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(createAlias).toHaveBeenCalled();
    });

    const body = vi.mocked(createAlias).mock.calls[0]![0];
    expect(body).toMatchObject({
      kind: 'calculated',
      objectId: 'hall_average',
      name: 'Hall average',
      isEnabled: true,
      expression: 't1',
    });
  });

  it('selects the class canonical unit when the device class changes', async () => {
    renderEditor('/aliases/new');
    await screen.findByLabelText('Name');

    fireEvent.click(screen.getByRole('combobox', { name: /Device class/u }));
    fireEvent.click(screen.getByRole('option', { name: 'Temperature' }));

    expect(screen.getByRole('combobox', { name: /Unit/u }).textContent).toContain('°C');
  });

  it('opens the entity picker from a source row, and never offers the alias itself', async () => {
    vi.mocked(fetchEntities).mockResolvedValue([
      KITCHEN,
      { ...KITCHEN, entityId: AVERAGE_ID, name: 'Kitchen average', source: 'derived' },
    ]);
    renderEditor(`/aliases/${AVERAGE.id}`);
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('Kitchen average');
    });

    fireEvent.click(await screen.findByRole('button', { name: /Entity read as t1/u }));

    expect(await screen.findByRole('dialog', { name: 'Which one is t1?' })).toBeTruthy();
    expect(screen.getByLabelText('Search')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Kitchen average/u, pressed: false })).toBeNull();
  });

  it('says what the formula reads now, and names a variable that is not a source', async () => {
    vi.mocked(fetchEntities).mockResolvedValue([
      { ...KITCHEN, state: { sensor_numeric: { value: 21 } } },
      {
        ...KITCHEN,
        entityId: entityIdSchema.parse('sensor.living_room_temperature'),
        name: 'Living room temperature',
        state: { sensor_numeric: { value: 23 } },
      },
    ]);
    renderEditor(`/aliases/${AVERAGE.id}`);

    expect(await screen.findByText(/^Reads 22/u)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Formula'), { target: { value: 't1 + t3' } });
    expect(screen.getByText('t3 is not one of the sources.')).toBeTruthy();
    expect(screen.getByLabelText('Formula').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('removalMessage', () => {
  it('names the aliases that still read this one, when the refusal lists them', () => {
    const refusal = new ApiError({
      code: 'CONFLICT',
      status: 409,
      message: 'Other aliases still read this one',
      details: { dependents: [{ entityId: 'alias.house_total', name: 'House total' }] },
    });

    expect(removalMessage(refusal)).toBe(
      'Other aliases still read this one: House total. Change their formulas first.',
    );
  });

  it('says what the API said when the refusal names nobody', () => {
    const refusal = new ApiError({
      code: 'CONFLICT',
      status: 409,
      message: 'Other aliases still read this one',
      details: { entityId: 'alias.kitchen_average' },
    });

    expect(removalMessage(refusal)).toBe('Other aliases still read this one');
  });
});
