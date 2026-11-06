import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlatformOperation, PlatformState } from '@nebulahome/contracts';

import { useLive } from '@/live/live-store';
import { fetchPlatformState, isPlatformUp, UPDATES_QUERY_KEY } from '@/settings/updates-api';
import { look } from '@/system/platform-look';
import { usePlatform } from '@/system/platform-store';

vi.mock('@/settings/updates-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isPlatformUp: vi.fn(),
  fetchPlatformState: vi.fn(),
}));

const STARTED = new Date('2026-11-14T03:00:00Z');

/**
 * An update as the supervisor tells it.
 *
 * @param overrides - What differs.
 * @returns It.
 */
function operation(overrides: Partial<PlatformOperation> = {}): PlatformOperation {
  return {
    kind: 'update',
    phase: 'downloading',
    fromVersion: '2026.10.1',
    toVersion: '2026.11.0',
    percent: 40,
    backupBytes: null,
    downloadBytes: null,
    startedAt: STARTED,
    ...overrides,
  };
}

/** The restart the supervisor tells. */
const RESTART = operation({ kind: 'restart', phase: 'stopping', toVersion: null, percent: null });

/**
 * Has the server answer, and say this of itself.
 *
 * @param state - What differs from the version that was running, with nothing under way.
 */
function answers(state: Partial<PlatformState> = {}): void {
  vi.mocked(isPlatformUp).mockResolvedValue(true);
  vi.mocked(fetchPlatformState).mockResolvedValue({
    version: '2026.10.1',
    machine: 'nuc',
    startedAt: STARTED,
    operation: null,
    lastUpdate: null,
    ...state,
  });
}

/**
 * Has the page take a dropped socket for the server gone, then look once.
 *
 * @param queryClient - The cache.
 */
async function lookAfterADrop(queryClient: QueryClient): Promise<void> {
  usePlatform.getState().reach('away');
  await look(queryClient);
}

describe('looking for Nebula Home', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.mocked(isPlatformUp).mockReset();
    vi.mocked(fetchPlatformState).mockReset();
    usePlatform.getState().dismiss();
    useLive.getState().setStatus('live');
    queryClient = new QueryClient();
  });

  it('takes the server not answering for it gone', async () => {
    vi.mocked(isPlatformUp).mockResolvedValue(false);
    usePlatform.getState().follow(operation({ phase: 'installing' }));

    await look(queryClient);

    expect(usePlatform.getState().watch?.stage).toBe('away');
  });

  it('goes back to the download a dropped socket hid', async () => {
    usePlatform.getState().follow(operation());
    answers({ operation: operation({ percent: 55 }) });

    await lookAfterADrop(queryClient);

    const watch = usePlatform.getState().watch;

    expect(watch?.stage).toBe('downloading');
    expect(watch?.operation.percent).toBe(55);
    expect(Object.keys(watch?.seenAt ?? {})).toEqual(['downloading']);
  });

  it('lets an update go that the version running gave up before replacing anything', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    usePlatform.getState().follow(operation());
    answers();

    await lookAfterADrop(queryClient);

    expect(usePlatform.getState().watch).toBeNull();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: UPDATES_QUERY_KEY });
  });

  it('waits while the updater checks the new version', async () => {
    usePlatform.getState().follow(operation({ phase: 'installing' }));
    answers({ version: '2026.11.0', operation: operation({ phase: 'checking', percent: null }) });

    await lookAfterADrop(queryClient);

    expect(usePlatform.getState().watch?.stage).toBe('checking');
  });

  it('takes the new version running with nothing checked any longer as done', async () => {
    usePlatform.getState().follow(operation({ phase: 'installing' }));
    answers({ version: '2026.11.0' });

    await lookAfterADrop(queryClient);

    expect(usePlatform.getState().watch?.stage).toBe('done');
  });

  it('says how an update ended, not how an older one did', async () => {
    const outcome = {
      fromVersion: '2026.10.1',
      toVersion: '2026.11.0',
      status: 'rolled_back' as const,
      error: 'The new version did not start',
      log: [],
      restoredInMs: 9000,
    };

    usePlatform.getState().follow(operation({ phase: 'installing' }));
    answers({ lastUpdate: { ...outcome, finishedAt: new Date(STARTED.getTime() - 60_000) } });

    await lookAfterADrop(queryClient);

    // The outcome is of an attempt before this one: this one gave up without one.
    expect(usePlatform.getState().watch).toBeNull();

    usePlatform.getState().follow(operation({ phase: 'installing' }));
    answers({ lastUpdate: { ...outcome, finishedAt: new Date(STARTED.getTime() + 60_000) } });

    await lookAfterADrop(queryClient);

    expect(usePlatform.getState().watch?.stage).toBe('failed');
  });

  it('goes back to a restart still stopping, and ends it once the server is new', async () => {
    usePlatform.getState().follow(RESTART);
    answers({ operation: RESTART });

    await lookAfterADrop(queryClient);

    expect(usePlatform.getState().watch?.stage).toBe('stopping');

    answers();
    usePlatform.getState().reach('away');
    useLive.getState().setStatus('connecting');
    await look(queryClient);

    // Back, but the live channel is not yet.
    expect(usePlatform.getState().watch?.stage).toBe('back');

    useLive.getState().setStatus('live');
    await look(queryClient);

    expect(usePlatform.getState().watch?.stage).toBe('done');
  });

  it('asks once for two looks at the same time', async () => {
    usePlatform.getState().follow(operation());
    answers({ operation: operation() });

    await Promise.all([look(queryClient), look(queryClient)]);

    expect(isPlatformUp).toHaveBeenCalledTimes(1);
  });
});
