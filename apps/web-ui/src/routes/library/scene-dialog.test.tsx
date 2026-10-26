/**
 * Creating a scene: the body carries the member target states the form edited.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { entityIdSchema, type EntityView, type SceneView } from '@nebulahome/contracts';

import { createScene, fetchEntities, fetchIcons } from '@/library/api';

import { SceneDialog } from './scene-dialog';

vi.mock('@/library/api', () => ({
  createScene: vi.fn(),
  updateScene: vi.fn(),
  deleteScene: vi.fn(),
  fetchEntities: vi.fn(),
  fetchDevices: vi.fn().mockResolvedValue([]),
  fetchAreas: vi.fn(),
  fetchIcons: vi.fn(),
  LIBRARY_QUERY_KEYS: {
    scenes: ['library', 'scenes'],
    devices: ['library', 'devices'],
    entities: ['library', 'entities'],
    areas: ['library', 'areas'],
    icons: ['library', 'icons'],
  },
}));

vi.mock('@/routes/library/use-areas', () => ({
  useAreas: () => ({ areas: [], tree: null, isPending: false, isError: false }),
}));

const LAMP: EntityView = {
  entityId: entityIdSchema.parse('light.hallway_ceiling'),
  domain: 'light',
  name: 'Ceiling',
  icon: 'lightbulb',
  areaKey: 'hallway',
  areaName: 'Hallway',
  deviceId: '00000000-0000-4000-8000-000000000010',
  source: 'shelly-bench',
  unitOfMeasurement: null,
  deviceClass: null,
  isEnabled: true,
  isHidden: false,
  capabilities: [
    { capability: 'on_off', params: {} },
    { capability: 'level', params: {} },
  ],
  searchAliases: [],
  state: { on_off: { isOn: true }, level: { level: 55 } },
  attributes: {},
  isAvailable: true,
  lastChanged: null,
  lastUpdated: null,
  tagIds: [],
  addresses: [],
  linked: null,
  key: null,
  createdAt: null,
  original: null,
};

const SAVED: SceneView = {
  id: '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f',
  key: 'evening',
  name: 'Evening',
  icon: null,
  areaKey: null,
  transitionMs: 0,
  rollbackOnPartialFailure: false,
  unresolvedMembers: [],
  members: [
    {
      entityId: LAMP.entityId,
      entityName: LAMP.name,
      targetState: { on_off: { isOn: true }, level: { level: 55 } },
      transitionMs: null,
    },
  ],
};

/**
 * Renders the create dialog.
 *
 * @returns The callbacks it was given.
 */
function renderCreate() {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const onDeleted = vi.fn();

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SceneDialog
        target={{ mode: 'create' }}
        onClose={onClose}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />
    </QueryClientProvider>,
  );

  return { onSaved, onClose, onDeleted };
}

beforeAll(() => {
  vi.mocked(fetchIcons).mockResolvedValue([]);
  vi.mocked(fetchEntities).mockResolvedValue([LAMP]);
});

beforeEach(() => {
  vi.mocked(createScene).mockClear();
});

describe('SceneDialog', () => {
  it('creates a scene whose member targetState carries isOn and level', async () => {
    vi.mocked(createScene).mockResolvedValue(SAVED);

    const { onSaved } = renderCreate();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Evening' } });

    expect(await screen.findByText('Members')).toBeTruthy();

    // The picker lists the house by floor and room; a lamp in a room with no floor is under
    // "Not in a room", and several may be added at once.
    fireEvent.click(screen.getByRole('button', { name: 'Add to the scene' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Ceiling/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 1' }));

    await screen.findByText('Ceiling');

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(createScene).toHaveBeenCalledOnce();
    });

    const body = vi.mocked(createScene).mock.calls[0]?.[0];

    expect(body?.key).toBe('evening');
    expect(body?.name).toBe('Evening');
    expect(body?.members).toHaveLength(1);
    expect(body?.members[0]?.targetState).toMatchObject({
      on_off: { isOn: true },
      level: { level: 55 },
    });
    expect(onSaved).toHaveBeenCalledWith(SAVED);
  });
});
