/**
 * The dashboard editor under Configuration: a copy of the layout edited until Done, saved whole,
 * and thrown away on Cancel - both going back to the list.
 *
 * The API modules are stood in for; the session, the live store and the draft are the real ones.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseEntityId, type DashboardView } from '@nebulahome/contracts';

import { useSession } from '@/auth/session-store';
import { fetchManagedDashboards, updateDashboard } from '@/dashboard/api';
import {
  fetchAreas,
  fetchDevices,
  fetchEntities,
  fetchIcons,
  fetchScenes,
  fetchTags,
} from '@/library/api';
import { useLive } from '@/live/live-store';
import { anEntity } from '@/testing/fixtures';

import { useDashboardDraft } from './dashboard-draft';
import { DashboardEditorPage } from './dashboard-editor-page';

vi.mock('@/dashboard/api', () => ({
  fetchDashboards: vi.fn(),
  fetchManagedDashboards: vi.fn(),
  fetchAssignees: vi.fn(),
  updateDashboard: vi.fn(),
  DASHBOARD_QUERY_KEYS: {
    dashboards: ['dashboards'],
    managed: ['dashboards', 'manage'],
    assignees: ['dashboards', 'assignees'],
  },
}));

vi.mock('@/library/api', () => ({
  applyScene: vi.fn(),
  commandEntity: vi.fn(),
  createTag: vi.fn(),
  fetchAreas: vi.fn(),
  fetchDevices: vi.fn(),
  fetchEntities: vi.fn(),
  fetchIcons: vi.fn(),
  fetchScenes: vi.fn(),
  fetchStateHistory: vi.fn(),
  fetchTags: vi.fn(),
  fetchTelemetry: vi.fn(),
  LIBRARY_QUERY_KEYS: {
    areas: ['library', 'areas'],
    devices: ['library', 'devices'],
    entities: ['library', 'entities'],
    history: ['library', 'history'],
    icons: ['library', 'icons'],
    scenes: ['library', 'scenes'],
    tags: ['library', 'tags'],
  },
}));

/** A lamp on at 60%, in the kitchen. */
const LAMP = anEntity({
  entityId: 'light.kitchen_ceiling',
  name: 'Kitchen ceiling',
  capabilities: [
    { capability: 'on_off', params: {} },
    { capability: 'level', params: {} },
  ],
  state: { on_off: { isOn: true }, level: { level: 60 } },
});

/** A dashboard with the lamp as a tall card, and a card for an entity that is gone. */
const HOME: DashboardView = {
  id: '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f',
  name: 'Home',
  icon: null,
  layoutVersion: 1,
  userIds: [],
  createdAt: new Date('2026-09-24T08:00:00.000Z'),
  updatedAt: new Date('2026-09-24T08:00:00.000Z'),
  layout: {
    cards: [
      {
        id: 'lampcard01',
        type: 'entity',
        x: 0,
        y: 0,
        w: 1,
        h: 2,
        entityId: LAMP.entityId,
        title: null,
        icon: null,
        range: null,
      },
      {
        id: 'gonecard01',
        type: 'entity',
        x: 1,
        y: 0,
        w: 1,
        h: 1,
        entityId: parseEntityId('switch.removed_plug'),
        title: null,
        icon: null,
        range: null,
      },
    ],
  },
};

/**
 * Renders the editor for the home dashboard, with somebody who manages dashboards.
 */
function renderEditor(): void {
  useSession.setState({
    status: 'signed-in',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      username: 'mattia',
      displayName: 'Mattia Carli',
      role: 'owner',
      permissions: ['entity:read', 'dashboard:manage'].map((key) => ({
        key,
        scope: '*',
        effect: 'allow' as const,
      })),
      avatarUrl: null,
      locale: 'it',
      houseLocale: 'en',
      timezone: 'Europe/Rome',
      isTwoFactorEnabled: false,
      mustChangePassword: false,
    },
  });

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[`/configuration/dashboards/${HOME.id}/edit`]}>
        <Routes>
          <Route path="/configuration/dashboards" element={<p>The list of dashboards</p>} />
          <Route
            path="/configuration/dashboards/:dashboardId/edit"
            element={<DashboardEditorPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom lays nothing out; the grid measures itself, so it is told it is a desktop's width.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: 0, y: 0, width: 1000, height: 0 }),
  );
  useLive.getState().reset();
  useDashboardDraft.getState().end();
  vi.mocked(fetchManagedDashboards).mockResolvedValue([HOME]);
  vi.mocked(fetchEntities).mockResolvedValue([LAMP]);
  vi.mocked(fetchDevices).mockResolvedValue([]);
  vi.mocked(fetchAreas).mockResolvedValue([]);
  vi.mocked(fetchIcons).mockResolvedValue([]);
  vi.mocked(fetchTags).mockResolvedValue([]);
  vi.mocked(fetchScenes).mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DashboardEditorPage', () => {
  it('edits a copy, saves the whole layout on Done, and goes back to the list', async () => {
    vi.mocked(updateDashboard).mockImplementation(async (id, request) =>
      Promise.resolve({
        ...HOME,
        ...(request.layout === undefined ? {} : { layout: request.layout }),
      }),
    );
    renderEditor();

    fireEvent.click(await screen.findByRole('button', { name: 'Remove switch.removed_plug' }));

    // Nothing is sent until Done.
    expect(updateDashboard).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => {
      expect(updateDashboard).toHaveBeenCalledWith(HOME.id, {
        layout: { cards: [HOME.layout.cards[0]] },
      });
    });
    expect(await screen.findByText('The list of dashboards')).toBeTruthy();
    expect(useDashboardDraft.getState().layout).toBeNull();
  });

  it('throws the copy away on Cancel, and goes back to the list', async () => {
    renderEditor();

    fireEvent.click(await screen.findByRole('button', { name: 'Remove switch.removed_plug' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText('The list of dashboards')).toBeTruthy();
    expect(updateDashboard).not.toHaveBeenCalled();
    expect(useDashboardDraft.getState().layout).toBeNull();
  });
});
