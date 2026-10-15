/**
 * The automations page and the editor share a cache. An automation switched on from its row and
 * then opened must open switched on: the editor reads the automation under its own key, and a
 * copy of it left there from before the flip is what it would start from - and save back.
 *
 * The API module is stood in for; the cache and the router are the real ones.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AutomationView } from '@nebulahome/contracts';

import { useSession } from '@/auth/session-store';
import {
  deleteAutomation,
  fetchAreas,
  fetchAutomations,
  fetchDevices,
  fetchEntities,
  fetchIcons,
  fetchScenes,
  updateAutomation,
} from '@/library/api';
import { useLive } from '@/live/live-store';

import { AutomationsPage } from './automations-page';

vi.mock('@/library/api', () => ({
  fetchAreas: vi.fn(),
  fetchAutomations: vi.fn(),
  fetchDevices: vi.fn(),
  fetchEntities: vi.fn(),
  fetchIcons: vi.fn(),
  fetchScenes: vi.fn(),
  updateAutomation: vi.fn(),
  deleteAutomation: vi.fn(),
  LIBRARY_QUERY_KEYS: {
    areas: ['library', 'areas'],
    automations: ['library', 'automations'],
    devices: ['library', 'devices'],
    entities: ['library', 'entities'],
    icons: ['library', 'icons'],
    scenes: ['library', 'scenes'],
  },
}));

/** An automation that is turned off. */
const EVENING: AutomationView = {
  id: '00000000-0000-4000-8000-0000000000e1',
  key: 'evening_lights',
  name: 'Evening lights',
  description: '',
  definition: { triggers: [{ type: 'manual' }], then: [{ type: 'stop' }] },
  definitionVersion: 1,
  mode: 'single',
  maxRuntimeMs: 300_000,
  isEnabled: false,
  lastTriggeredAt: null,
  lastRun: null,
};

/** Where the editor reads it. */
const EDITOR_KEY = ['library', 'automations', EVENING.id];

/**
 * Renders the page with an owner signed in, over a cache that already holds the automation as
 * the editor last read it.
 *
 * @returns The cache.
 */
function renderPage(): QueryClient {
  useSession.setState({
    status: 'signed-in',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      username: 'mattia',
      displayName: 'Mattia Carli',
      role: 'owner',
      permissions: [{ key: 'automation:write', scope: '*', effect: 'allow' }],
      avatarUrl: null,
      locale: 'it',
      houseLocale: 'en',
      timezone: 'Europe/Rome',
      isTwoFactorEnabled: false,
      mustChangePassword: false,
    },
  });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  client.setQueryData(EDITOR_KEY, EVENING);

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/automations']}>
        <AutomationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return client;
}

beforeEach(() => {
  useLive.getState().reset();
  vi.mocked(fetchAreas).mockResolvedValue([]);
  vi.mocked(fetchAutomations).mockResolvedValue([EVENING]);
  vi.mocked(fetchDevices).mockResolvedValue([]);
  vi.mocked(fetchEntities).mockResolvedValue([]);
  vi.mocked(fetchIcons).mockResolvedValue([]);
  vi.mocked(fetchScenes).mockResolvedValue([]);
  vi.mocked(updateAutomation).mockImplementation((automationId, request) =>
    Promise.resolve({
      ...EVENING,
      id: automationId,
      ...(request.isEnabled === undefined ? {} : { isEnabled: request.isEnabled }),
    }),
  );
  vi.mocked(deleteAutomation).mockResolvedValue(EVENING);
});

describe('turning an automation on from its row', () => {
  it('writes the answer where the editor reads it', async () => {
    const client = renderPage();

    fireEvent.click(await screen.findByRole('switch', { name: 'Evening lights enabled' }));

    await waitFor(() => {
      expect(client.getQueryData<AutomationView>(EDITOR_KEY)?.isEnabled).toBe(true);
    });
    expect(updateAutomation).toHaveBeenCalledWith(EVENING.id, { isEnabled: true });
  });

  it('forgets a deleted automation where the editor reads it', async () => {
    const client = renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'More for Evening lights' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete/u }));
    fireEvent.click(await screen.findByRole('button', { name: /^Delete/u }));

    await waitFor(() => {
      expect(client.getQueryData(EDITOR_KEY)).toBeUndefined();
    });
  });
});
