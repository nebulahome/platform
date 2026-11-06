/**
 * The screen of an update that did not finish: Try again waits for its answer, and what it was
 * refused stays with that screen, not the next one. The API is stood in for.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlatformOperation, PlatformUpdateOutcome } from '@nebulahome/contracts';

import { useSession } from '@/auth/session-store';
import { runSystemUpdates } from '@/settings/updates-api';
import { usePlatform } from '@/system/platform-store';

import { PlatformOverlay } from './platform-overlay';

vi.mock('@/settings/updates-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runSystemUpdates: vi.fn(),
}));

/** The update that did not finish. */
const UPDATE: PlatformOperation = {
  kind: 'update',
  phase: 'installing',
  fromVersion: '2026.10.1',
  toVersion: '2026.11.0',
  percent: null,
  backupBytes: null,
  downloadBytes: null,
  startedAt: new Date('2026-11-14T03:00:00Z'),
};

/** How it ended. */
const ROLLED_BACK: PlatformUpdateOutcome = {
  fromVersion: '2026.10.1',
  toVersion: '2026.11.0',
  status: 'rolled_back',
  finishedAt: new Date('2026-11-14T03:05:00Z'),
  error: 'The new version did not start',
  log: [],
  restoredInMs: 9000,
};

/** Shows the screen of the update that did not finish, for somebody who may update. */
function renderFailed(): void {
  useSession.setState({
    status: 'signed-in',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      username: 'mattia',
      displayName: 'Mattia Carli',
      role: 'owner',
      permissions: [{ key: 'system:update', scope: '*', effect: 'allow' as const }],
      avatarUrl: null,
      locale: 'en',
      houseLocale: 'en',
      timezone: 'Europe/Rome',
      isTwoFactorEnabled: false,
      mustChangePassword: false,
    },
  });
  usePlatform.getState().follow(UPDATE);
  usePlatform.getState().fail(ROLLED_BACK);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PlatformOverlay />
    </QueryClientProvider>,
  );
}

/**
 * The screen's Try again.
 *
 * @returns It.
 */
function tryAgain(): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>('button', { name: 'Try again' });
}

describe('Try again', () => {
  beforeEach(() => {
    usePlatform.getState().dismiss();
    vi.mocked(runSystemUpdates).mockReset();
  });

  it('is busy until the server answers', async () => {
    vi.mocked(runSystemUpdates).mockReturnValue(new Promise(() => undefined));
    renderFailed();

    fireEvent.click(tryAgain());

    await waitFor(() => {
      expect(tryAgain().disabled).toBe(true);
    });
    expect(runSystemUpdates).toHaveBeenCalledWith([{ kind: 'core', version: '2026.11.0' }]);
  });

  it('says why it was refused, on that screen only', async () => {
    vi.mocked(runSystemUpdates).mockRejectedValue(
      new Error('Nebula Home 2026.11.0 is not the update offered'),
    );
    renderFailed();

    fireEvent.click(tryAgain());

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Nebula Home 2026.11.0 is not the update offered')).toBeTruthy();

    // Another attempt that did not finish either: its screen starts without the old refusal.
    usePlatform.getState().follow({ ...UPDATE, phase: 'downloading' });
    usePlatform.getState().fail({ ...ROLLED_BACK, finishedAt: new Date('2026-11-14T03:15:00Z') });

    await waitFor(() => {
      expect(screen.queryByText('Nebula Home 2026.11.0 is not the update offered')).toBeNull();
    });
  });
});
