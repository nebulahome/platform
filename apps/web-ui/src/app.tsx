/**
 * The root: the providers, and nothing else.
 *
 * The router wraps everything rather than only the signed-in half. Which screen is on and what
 * the address says about it is one question, answered in one place - see `session-routes.tsx`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';

import { CatalogueIcons } from '@/components/catalogue-icons';
import { MaintenanceOverlay } from '@/components/maintenance-overlay';
import { SessionRoutes } from '@/routes/session-routes';

const queryClient = new QueryClient({
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

/**
 * Renders the application.
 *
 * @returns The root element tree.
 */
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <CatalogueIcons>
        <BrowserRouter>
          <SessionRoutes />
        </BrowserRouter>
        <MaintenanceOverlay />
      </CatalogueIcons>
    </QueryClientProvider>
  );
}
