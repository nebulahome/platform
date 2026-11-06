/**
 * The Software page's buttons: what Update all leaves out, one round at a time from one page, and
 * a check that failed saying so. The API is stood in for; the cache starts with the board's
 * sample list.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SystemUpdatesView } from '@nebulahome/contracts';

import { useSession } from '@/auth/session-store';
import { ApiError } from '@/lib/api-error';
import { checkSystemUpdates, runSystemUpdates, UPDATES_QUERY_KEY } from '@/settings/updates-api';
import { SAMPLE_UPDATES, softwareSampleCache } from '@/testing/software-samples';

import { SoftwareSettings } from './software-settings';

vi.mock('@/settings/updates-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  checkSystemUpdates: vi.fn(),
  runSystemUpdates: vi.fn(),
}));

/**
 * Renders the page for somebody who may update, over the sample list or another.
 *
 * @param updates - The list, when not the sample's.
 */
function renderPage(updates: SystemUpdatesView = SAMPLE_UPDATES): void {
  const client = softwareSampleCache();

  client.setQueryData(UPDATES_QUERY_KEY, updates);
  useSession.setState({
    status: 'signed-in',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      username: 'mattia',
      displayName: 'Mattia Carli',
      role: 'owner',
      permissions: ['system:read', 'system:update', 'settings:write'].map((key) => ({
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
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SoftwareSettings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * The hero's Update all.
 *
 * @returns It.
 */
function updateAll(): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>('button', { name: 'Update all' });
}

describe('the Software page', () => {
  beforeEach(() => {
    vi.mocked(checkSystemUpdates).mockReset();
    vi.mocked(runSystemUpdates).mockReset();
  });

  it('has nothing for Update all when Nebula Home alone is offered and cannot update here', () => {
    const refusal = 'Updating needs the Docker socket, which this container is not given';

    renderPage({
      ...SAMPLE_UPDATES,
      core: SAMPLE_UPDATES.core === null ? null : { ...SAMPLE_UPDATES.core, refusal },
      rows: SAMPLE_UPDATES.rows.filter((row) => row.item.kind === 'core'),
    });

    expect(updateAll().disabled).toBe(true);
    expect(screen.getByText(refusal)).toBeTruthy();
  });

  it('starts one round from a double click on a row', async () => {
    vi.mocked(runSystemUpdates).mockReturnValue(new Promise(() => undefined));
    renderPage();

    const first = screen.getAllByRole<HTMLButtonElement>('button', { name: 'Update' })[0];

    if (first === undefined) {
      throw new Error('No row to update');
    }

    fireEvent.click(first);
    await waitFor(() => {
      expect(first.disabled).toBe(true);
    });
    fireEvent.click(first);

    expect(runSystemUpdates).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getAllByRole<HTMLButtonElement>('button', { name: 'Update' })
        .every((button) => button.disabled),
    ).toBe(true);
  });

  it('says why Check now did not run', async () => {
    vi.mocked(checkSystemUpdates).mockRejectedValue(
      new ApiError({
        code: 'DEVICE_UNAVAILABLE',
        status: 503,
        message: 'The supervisor did not answer',
      }),
    );
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));

    expect(await screen.findByText('The check for updates did not run')).toBeTruthy();
    expect(screen.getByText('The supervisor did not answer')).toBeTruthy();
  });
});
