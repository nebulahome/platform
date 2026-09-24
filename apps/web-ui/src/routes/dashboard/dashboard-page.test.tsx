/**
 * The dashboards page: what a person with none is offered, a dashboard's cards drawn from what
 * their entities can do, and editing that works on a copy until Done.
 *
 * The API modules are stood in for; the session, the live store and the draft are the real ones.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseEntityId, type DashboardView } from '@nebula-home/contracts';

import { useSession } from '@/auth/session-store';
import { fetchDashboards, updateDashboard } from '@/dashboard/api';
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
import { DashboardPage } from './dashboard-page';

vi.mock('@/dashboard/api', () => ({
  fetchDashboards: vi.fn(),
  createDashboard: vi.fn(),
  updateDashboard: vi.fn(),
  deleteDashboard: vi.fn(),
  exportDashboard: vi.fn(),
  importDashboard: vi.fn(),
  DASHBOARD_QUERY_KEYS: { dashboards: ['dashboards'] },
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
  areaName: 'Kitchen',
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
 * Renders the page for a signed-in owner.
 *
 * @param address - Where it opens.
 */
function renderPage(address = '/dashboards'): void {
  useSession.setState({
    status: 'signed-in',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      username: 'mattia',
      displayName: 'Mattia Carli',
      role: 'owner',
      permissions: ['entity:read', 'entity:control', 'scene:read', 'scene:apply'].map((key) => ({
        key,
        scope: '*',
        effect: 'allow' as const,
      })),
      avatarUrl: null,
      locale: 'it',
      timezone: 'Europe/Rome',
      isTwoFactorEnabled: false,
      mustChangePassword: false,
    },
  });

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[address]}>
        <Routes>
          <Route path="/dashboards" element={<DashboardPage />} />
          <Route path="/dashboards/:dashboardId" element={<DashboardPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // jsdom lays nothing out; the grid measures itself, so it is told it is a desktop's width.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: 0, y: 0, width: 1000, height: 0 }),
  );
  useLive.getState().reset();
  useDashboardDraft.getState().end();
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

describe('a person with no dashboard', () => {
  it('is offered to make one', async () => {
    vi.mocked(fetchDashboards).mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText(/No dashboard yet/u)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New dashboard' })).toBeTruthy();
  });
});

describe('a dashboard', () => {
  it('opens the first one, and draws its cards from what their entities can do', async () => {
    vi.mocked(fetchDashboards).mockResolvedValue([HOME]);
    renderPage();

    const lamp = await screen.findByRole('article', { name: 'Kitchen ceiling' });

    expect(within(lamp).getByText('60%')).toBeTruthy();
    expect(within(lamp).getByRole('switch', { name: 'Kitchen ceiling' })).toBeTruthy();
    expect(screen.getByText('switch.removed_plug')).toBeTruthy();
  });

  it('edits a copy, and saves the whole layout on Done', async () => {
    vi.mocked(fetchDashboards).mockResolvedValue([HOME]);
    vi.mocked(updateDashboard).mockImplementation(async (id, request) =>
      Promise.resolve({
        ...HOME,
        ...(request.layout === undefined ? {} : { layout: request.layout }),
      }),
    );
    renderPage(`/dashboards/${HOME.id}`);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit layout' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove switch.removed_plug' }));

    // Nothing is sent until Done.
    expect(updateDashboard).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => {
      expect(updateDashboard).toHaveBeenCalledWith(HOME.id, {
        layout: { cards: [HOME.layout.cards[0]] },
      });
    });
    expect(await screen.findByRole('button', { name: 'Edit layout' })).toBeTruthy();
  });

  it('throws the copy away on Cancel', async () => {
    vi.mocked(fetchDashboards).mockResolvedValue([HOME]);
    renderPage(`/dashboards/${HOME.id}`);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit layout' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove switch.removed_plug' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText('switch.removed_plug')).toBeTruthy();
    expect(updateDashboard).not.toHaveBeenCalled();
  });
});
