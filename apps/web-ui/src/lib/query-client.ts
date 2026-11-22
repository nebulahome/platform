/**
 * The tab's one query cache, emptied whenever the session ends.
 *
 * Signed out by hand or by the server alike: on a shared wall tablet the next person, perhaps
 * with fewer permissions, must not be shown what the last one was answered.
 */
import { QueryClient } from '@tanstack/react-query';

import { useSession } from '@/auth/session-store';
import { DASHBOARD_QUERY_KEYS } from '@/dashboard/api';
import { LIBRARY_QUERY_KEYS } from '@/library/api';
import { SETTINGS_QUERY_KEYS } from '@/settings/api';

/** How long an answer the live channel keeps fresh is kept before a page opening asks again. */
export const KEPT_FRESH_STALE_MS = 5 * 60_000;

/**
 * The answers that change only through an edit someone made, which the live channel announces to
 * every browser (`library_event`) and the editing page reads again itself: the dashboards (and who
 * they can be given to), the roles, the server's settings and the icons. A page opening does not
 * ask for them again. The other lists also change on their own - an entity's last report, a
 * device's integration, a location's last backup, a person's last sign-in - which nothing
 * announces, so they are still read whenever a page opens.
 */
const KEPT_FRESH_KEYS = [
  DASHBOARD_QUERY_KEYS.dashboards,
  SETTINGS_QUERY_KEYS.roles,
  SETTINGS_QUERY_KEYS.server,
  LIBRARY_QUERY_KEYS.icons,
] as const;

/** Every answer the API gave this tab. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A home dashboard is watched, not polled: the WebSocket pushes changes, so a window
      // regaining focus has nothing to catch up on and a refetch would only add load.
      refetchOnWindowFocus: false,

      /**
       * Never retries a refusal.
       *
       * A 401, a 403 or a 404 are answers, not failures, and asking three more times produces
       * the same answer three more times - while a 401 storm is exactly what would trip the
       * API's refresh-token reuse detection.
       *
       * @param failureCount - How many attempts have already been made.
       * @param error - What was thrown.
       * @returns Whether to try again.
       */
      retry: (failureCount: number, error: unknown): boolean => {
        const status = (error as { status?: unknown }).status;

        if (typeof status === 'number' && status >= 400 && status < 500) {
          return false;
        }

        return failureCount < 2;
      },
    },
  },
});

for (const queryKey of KEPT_FRESH_KEYS) {
  queryClient.setQueryDefaults(queryKey, { staleTime: KEPT_FRESH_STALE_MS });
}

useSession.subscribe((state, previous) => {
  if (previous.status === 'signed-in' && state.status !== 'signed-in') {
    queryClient.clear();
  }
});
