/**
 * The tab's one query cache, emptied whenever the session ends.
 *
 * Signed out by hand or by the server alike: on a shared wall tablet the next person, perhaps
 * with fewer permissions, must not be shown what the last one was answered.
 */
import { QueryClient } from '@tanstack/react-query';

import { useSession } from '@/auth/session-store';

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

useSession.subscribe((state, previous) => {
  if (previous.status === 'signed-in' && state.status !== 'signed-in') {
    queryClient.clear();
  }
});
