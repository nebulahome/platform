/**
 * Configuration › Dashboards: every dashboard with who it is shown to, the way into its layout,
 * and the dialog that assigns it.
 *
 * The API modules are stood in for; the session is the real one.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DashboardAssignee, DashboardView } from '@nebula-home/contracts';

import { useSession } from '@/auth/session-store';
import {
  createDashboard,
  fetchAssignees,
  fetchManagedDashboards,
  updateDashboard,
} from '@/dashboard/api';
import {
  fetchAreas,
  fetchDevices,
  fetchEntities,
  fetchIcons,
  fetchScenes,
  fetchTags,
} from '@/library/api';

import { DashboardsManagePage } from './dashboards-manage-page';

vi.mock('@/dashboard/api', () => ({
  fetchDashboards: vi.fn(),
  fetchManagedDashboards: vi.fn(),
  fetchAssignees: vi.fn(),
  createDashboard: vi.fn(),
  updateDashboard: vi.fn(),
  deleteDashboard: vi.fn(),
  exportDashboard: vi.fn(),
  importDashboard: vi.fn(),
  DASHBOARD_QUERY_KEYS: {
    dashboards: ['dashboards'],
    managed: ['dashboards', 'manage'],
    assignees: ['dashboards', 'assignees'],
  },
}));

vi.mock('@/library/api', () => ({
  createTag: vi.fn(),
  fetchAreas: vi.fn(),
  fetchDevices: vi.fn(),
  fetchEntities: vi.fn(),
  fetchIcons: vi.fn(),
  fetchScenes: vi.fn(),
  fetchTags: vi.fn(),
  LIBRARY_QUERY_KEYS: {
    areas: ['library', 'areas'],
    devices: ['library', 'devices'],
    entities: ['library', 'entities'],
    icons: ['library', 'icons'],
    scenes: ['library', 'scenes'],
    tags: ['library', 'tags'],
  },
}));

const SELF_ID = '00000000-0000-4000-8000-000000000001';
const GIULIA_ID = '00000000-0000-4000-8000-000000000002';

/** The two people in the house. */
const PEOPLE: DashboardAssignee[] = [
  { id: SELF_ID, username: 'mattia', displayName: 'Mattia Carli', avatarUrl: null },
  { id: GIULIA_ID, username: 'giulia', displayName: 'Giulia Rossi', avatarUrl: null },
];

/** A dashboard shown to Giulia. */
const KITCHEN: DashboardView = {
  id: '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f',
  name: 'Kitchen',
  icon: null,
  layoutVersion: 1,
  userIds: [GIULIA_ID],
  createdAt: new Date('2026-09-24T08:00:00.000Z'),
  updatedAt: new Date('2026-09-24T08:00:00.000Z'),
  layout: { cards: [] },
};

/**
 * Renders the page for somebody who manages dashboards.
 */
function renderPage(): void {
  useSession.setState({
    status: 'signed-in',
    user: {
      id: SELF_ID,
      username: 'mattia',
      displayName: 'Mattia Carli',
      role: 'owner',
      permissions: [{ key: 'dashboard:manage', scope: '*', effect: 'allow' as const }],
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
      <MemoryRouter initialEntries={['/configuration/dashboards']}>
        <Routes>
          <Route path="/configuration/dashboards" element={<DashboardsManagePage />} />
          <Route path="/configuration/dashboards/:dashboardId/edit" element={<p>The editor</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchManagedDashboards).mockResolvedValue([KITCHEN]);
  vi.mocked(fetchAssignees).mockResolvedValue(PEOPLE);
  vi.mocked(fetchEntities).mockResolvedValue([]);
  vi.mocked(fetchDevices).mockResolvedValue([]);
  vi.mocked(fetchAreas).mockResolvedValue([]);
  vi.mocked(fetchIcons).mockResolvedValue([]);
  vi.mocked(fetchTags).mockResolvedValue([]);
  vi.mocked(fetchScenes).mockResolvedValue([]);
});

describe('DashboardsManagePage', () => {
  it('lists every dashboard with who it is shown to', async () => {
    renderPage();

    const row = (await screen.findByText('Kitchen')).closest('li');

    expect(row).not.toBeNull();
    await waitFor(() => {
      expect(within(row ?? document.body).getByText('Giulia Rossi')).toBeTruthy();
    });
    expect(within(row ?? document.body).getByText('0 cards')).toBeTruthy();
  });

  it('leads from a row to the layout editor', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit the layout of Kitchen' }));

    expect(await screen.findByText('The editor')).toBeTruthy();
  });

  it('assigns a dashboard from its dialog, sending who it is shown to', async () => {
    vi.mocked(updateDashboard).mockResolvedValue({ ...KITCHEN, userIds: [GIULIA_ID, SELF_ID] });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Configure Kitchen' }));

    const dialog = within(screen.getByRole('dialog'));

    fireEvent.click(await dialog.findByLabelText(/Mattia Carli/u));
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateDashboard).toHaveBeenCalledWith(KITCHEN.id, {
        name: 'Kitchen',
        icon: null,
        userIds: [GIULIA_ID, SELF_ID],
      });
    });
  });

  it('makes a new dashboard shown to its maker, and opens it to be laid out', async () => {
    vi.mocked(createDashboard).mockResolvedValue({
      ...KITCHEN,
      id: '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e70',
      name: 'Hall',
      userIds: [SELF_ID],
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'New dashboard' }));

    const dialog = within(screen.getByRole('dialog'));

    fireEvent.change(dialog.getByLabelText('Name'), { target: { value: 'Hall' } });
    expect(await dialog.findByLabelText<HTMLInputElement>(/Mattia Carli/u)).toHaveProperty(
      'checked',
      true,
    );
    fireEvent.click(dialog.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(createDashboard).toHaveBeenCalledWith({
        name: 'Hall',
        icon: null,
        userIds: [SELF_ID],
      });
    });
    expect(await screen.findByText('The editor')).toBeTruthy();
  });
});
