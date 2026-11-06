/**
 * How the page looks for Nebula Home while it restarts or updates itself
 * (docs/releases-and-updates.md 4, What every page shows): whether it answers (`/api/versions`, no
 * sign-in), then what it says of itself (`GET /system/platform`), then - for a restart - the live
 * channel coming back.
 *
 * The live channel dropping is only a fast hint that the server went away: a socket also drops
 * when its token expires. Once the server answers, what it says decides: an operation still at an
 * earlier phase is the version that was running, still at work, and the page goes back to it.
 */
import type { QueryClient } from '@tanstack/react-query';

import { useLive } from '@/live/live-store';
import { fetchPlatformState, isPlatformUp, UPDATES_QUERY_KEY } from '@/settings/updates-api';
import { isEnded, stageRank, usePlatform } from '@/system/platform-store';

/** How often the page looks for the server while it is away, and how long one question may take. */
export const POLL_MS = 1500;

/** The look under way, which a second one waits for instead of asking again. */
let looking: Promise<void> | null = null;

/**
 * Looks once at where Nebula Home is, and moves the watch on.
 *
 * @param queryClient - Where the list of updates is read again once an update gave up.
 * @returns Once it has looked; the look already under way, when there is one.
 */
export async function look(queryClient: QueryClient): Promise<void> {
  looking ??= lookOnce(queryClient).finally(() => {
    looking = null;
  });

  return looking;
}

/**
 * Looks once.
 *
 * @param queryClient - Where the list of updates is read again once an update gave up.
 */
async function lookOnce(queryClient: QueryClient): Promise<void> {
  const { watch, reach, fail, follow, dismiss, setMachine } = usePlatform.getState();

  if (watch === null || isEnded(watch.stage)) {
    return;
  }

  if (!(await isPlatformUp(AbortSignal.timeout(POLL_MS)))) {
    reach('away');

    return;
  }

  if (watch.stage === 'away') {
    reach('back');
  }

  // Still the version that was running, before it went away: nothing to read yet.
  if (stageRank(usePlatform.getState().watch?.stage ?? 'stopping') < stageRank('back')) {
    return;
  }

  try {
    const state = await fetchPlatformState(AbortSignal.timeout(POLL_MS));
    const { kind, toVersion, startedAt } = watch.operation;
    const last = state.lastUpdate;

    setMachine(state.machine);

    if (kind === 'restart') {
      // Still stopping: the page took a dropped socket for the restart. Over once the server says
      // nothing is under way and the live channel is back.
      if (state.operation !== null) {
        follow(state.operation);
      } else if (useLive.getState().status === 'live') {
        reach('done');
      }

      return;
    }

    if (
      last !== null &&
      last.toVersion === toVersion &&
      new Date(last.finishedAt).getTime() >= new Date(startedAt).getTime()
    ) {
      if (last.status === 'success') {
        reach('done');
      } else {
        fail(last);
      }
    } else if (state.operation !== null) {
      // The version that was running, still at it; or the new one while the updater checks it.
      follow(state.operation);
    } else if (state.version === toVersion) {
      // The new version runs and no updater checks it any longer: it is in.
      reach('done');
    } else {
      // The version that was running gave the update up before replacing anything: Software says
      // why.
      dismiss();
      void queryClient.invalidateQueries({ queryKey: UPDATES_QUERY_KEY });
    }
  } catch {
    // Its services are still coming up.
  }
}
