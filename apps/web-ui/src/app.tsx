/**
 * The root: the providers, and what belongs to no page - the toasts, and the screens a restore, a
 * restart or an update of Nebula Home puts over every page.
 *
 * The router wraps everything rather than only the signed-in half. Which screen is on and what
 * the address says about it is one question, answered in one place - see `session-routes.tsx`.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';

import { Toaster } from '@nebulahome/ui';

import { CatalogueIcons } from '@/components/catalogue-icons';
import { MaintenanceOverlay } from '@/components/maintenance-overlay';
import { PlatformOverlay, PlatformStage } from '@/components/platform-overlay';
import { queryClient } from '@/lib/query-client';
import { SessionRoutes } from '@/routes/session-routes';

/**
 * Renders the application.
 *
 * @returns The root element tree.
 */
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <CatalogueIcons>
        <PlatformStage>
          <BrowserRouter>
            <SessionRoutes />
          </BrowserRouter>
        </PlatformStage>
        <PlatformOverlay />
        <MaintenanceOverlay />
        <Toaster />
      </CatalogueIcons>
    </QueryClientProvider>
  );
}
