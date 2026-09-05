/**
 * The root: providers, and the one decision about which half of the application to show.
 *
 * The session status picks the tree, and the router only exists inside the signed-in half. That
 * ordering is deliberate. A guard implemented as a redirect - render the page, notice there is
 * no session, navigate away - means the protected page mounts and fires its requests before it
 * is taken down again. Choosing the tree from the status means it never mounts at all.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';

import { useSession } from '@/auth/session-store';
import { AuthLayout } from '@/routes/auth-layout';
import { FirstRun } from '@/routes/first-run';
import { PagePlaceholder, Shell } from '@/routes/shell';
import { SignIn } from '@/routes/sign-in';
import { TwoFactor } from '@/routes/two-factor';

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
 * Renders whichever half of the application the session calls for.
 *
 * @returns The tree.
 */
function Router() {
  const status = useSession((state) => state.status);
  const initialise = useSession((state) => state.initialise);

  useEffect(() => {
    void initialise();
  }, [initialise]);

  if (status === 'starting') {
    // The same frame the sign-in screen uses, with its card collapsed. The mark is the one
    // element that survives the transition, which is what lets it move rather than swap.
    return <AuthLayout isLoading />;
  }

  if (status === 'setup-required') {
    return <FirstRun />;
  }

  if (status === 'awaiting-second-factor') {
    return <TwoFactor />;
  }

  if (status === 'signed-out') {
    return <SignIn />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/dashboards" replace />} />
          <Route path="/dashboards" element={<PagePlaceholder />} />
          <Route path="/automations" element={<PagePlaceholder />} />
          <Route path="/scenes" element={<PagePlaceholder />} />
          <Route path="/devices" element={<PagePlaceholder />} />
          <Route path="/aliases" element={<PagePlaceholder />} />
          <Route path="/packages" element={<PagePlaceholder />} />
          <Route path="/settings" element={<PagePlaceholder />} />
          <Route path="*" element={<PagePlaceholder />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

/**
 * Renders the application.
 *
 * @returns The root element tree.
 */
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router />
    </QueryClientProvider>
  );
}
