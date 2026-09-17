/**
 * Which screen is on, and what the address bar says about it.
 *
 * There are two regimes here and the boundary between them is the session.
 *
 * **Signed in, the address is the authority.** Which page you are looking at is a thing you
 * chose, it belongs in the url, and `Routes` reads it.
 *
 * **Signed out, the session is the authority and the address follows it.** Which screen you see
 * is not a thing you chose - it is a fact about your credentials. An address is a request, and a
 * request to see the dashboard without a session has to be refused. So the status decides the
 * screen, and an effect writes the matching address; the two cannot disagree because only one of
 * them is ever deciding.
 *
 * That is also why the two-factor screen has an address at all but cannot be reached by typing
 * it: arriving there without a challenge sends you back to the password step, because there is
 * nothing to complete.
 *
 * The frame is rendered here rather than by each screen, and that is load-bearing. React
 * replaces a subtree when the element type at a position changes, so a screen that brought its
 * own `AuthLayout` got a brand new one every time the screen changed - and a card that has just
 * been created has nothing to animate from. One frame, changing children, is what lets the mark
 * travel instead of jumping.
 */
import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';

import { useSession, type SessionStatus } from '@/auth/session-store';
import { AuthLayout } from '@/routes/auth-layout';
import { FirstRunForm } from '@/routes/first-run';
import { AliasesPage } from '@/routes/library/aliases-page';
import { AutomationEditor } from '@/routes/library/automation-editor';
import { AutomationsPage } from '@/routes/library/automations-page';
import { DevicesPage } from '@/routes/library/devices-page';
import { IntegrationsPage } from '@/routes/library/integrations-page';
import { PackagesPage } from '@/routes/library/packages-page';
import { ScenesPage } from '@/routes/library/scenes-page';
import { VendorPage } from '@/routes/library/vendor-page';
import { RETURN_TO_PARAM, safeReturnTo } from '@/routes/return-to';
import { AccountSettings } from '@/routes/settings/account-settings';
import { DataAndRetention } from '@/routes/settings/data-and-retention';
import { IconsPanel } from '@/routes/settings/icons-panel';
import { InterfaceSettings } from '@/routes/settings/interface-settings';
import { RequiresPermission } from '@/routes/settings/requires-permission';
import { DEFAULT_SETTINGS_SECTION, SettingsLayout } from '@/routes/settings/settings-layout';
import { UsersAndRoles } from '@/routes/settings/users-and-roles';
import { PagePlaceholder, Shell } from '@/routes/shell';
import { SignInForm } from '@/routes/sign-in';
import { TwoFactorFooter, TwoFactorForm } from '@/routes/two-factor';
import { useIntroHold } from '@/routes/use-intro-hold';
import { usePreferences } from '@/settings/preferences';

/** A status that means nobody is signed in yet. */
type UnauthenticatedStatus = Exclude<SessionStatus, 'starting' | 'signed-in'>;

/** What one unauthenticated screen is, and where it lives. */
type Screen = {
  /** Its address. */
  readonly path: string;

  /** The heading on the card. */
  readonly title: string;

  /** The line under it. */
  readonly subtitle: string;

  /** The form. */
  readonly form: ReactNode;

  /** Anything below the card. */
  readonly footer?: ReactNode;
};

/**
 * The three screens, by the status that produces them.
 *
 * One table, so that the address, the heading and the form cannot be changed independently of
 * each other - which is exactly how a url comes to say one thing while the page says another.
 */
const SCREENS: Readonly<Record<UnauthenticatedStatus, Screen>> = {
  'setup-required': {
    path: '/setup',
    title: 'Set up Nebula Home',
    subtitle: 'This home has no accounts yet. The first one is yours, and it owns everything.',
    form: <FirstRunForm />,
  },
  'signed-out': {
    path: '/sign-in',
    title: 'Sign in',
    subtitle: 'Welcome back to your home.',
    form: <SignInForm />,
  },
  'awaiting-second-factor': {
    path: '/sign-in/two-factor',
    title: 'One more step',
    subtitle: 'Enter the code from your authenticator, or one of your recovery codes.',
    form: <TwoFactorForm />,
    footer: <TwoFactorFooter />,
  },
};

/** Every address an unauthenticated screen occupies. */
const AUTH_PATHS = new Set(Object.values(SCREENS).map((screen) => screen.path));

/**
 * Reads the screen a status calls for.
 *
 * @param status - Where the session is.
 * @returns The screen, or undefined when the session is not in an unauthenticated state.
 */
function screenFor(status: SessionStatus): Screen | undefined {
  return status === 'starting' || status === 'signed-in' ? undefined : SCREENS[status];
}

/**
 * Keeps the address in step with the session.
 *
 * Runs as an effect rather than by rendering a `Navigate`, for one reason: the address has to be
 * corrected even when the screen is already right. Somebody who is signed out and types
 * `/devices` should end up at `/sign-in` whether or not anything re-renders in between.
 *
 * @param status - Where the session is.
 * @param startPage - Where somebody with no particular destination ends up. A preference rather
 * than a constant: "open on Devices" is a thing this browser was told, and being sent to the
 * sign-in form should not quietly forget it.
 */
function useAddressFollowsSession(status: SessionStatus, startPage: string): void {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (status === 'starting') {
      return;
    }

    const screen = screenFor(status);

    if (screen === undefined) {
      // Signed in, and standing on a sign-in screen. Go where they were headed before they were
      // asked to sign in, or to the dashboard when they came here of their own accord.
      if (AUTH_PATHS.has(location.pathname)) {
        const requested = new URLSearchParams(location.search).get(RETURN_TO_PARAM);

        // No destination at all is not the same as a destination that turned out to be no good.
        // The first goes wherever this browser was told to open; the second is caller input that
        // failed, and it lands on the dashboard rather than on anything a link could choose.
        void navigate(requested === null ? startPage : safeReturnTo(requested), { replace: true });
      }

      return;
    }

    if (location.pathname === screen.path) {
      return;
    }

    // Where they were trying to go, kept so they land there rather than on the dashboard. A
    // sign-in address carries the destination it was already given; anywhere else *is* the
    // destination.
    const intended = AUTH_PATHS.has(location.pathname)
      ? new URLSearchParams(location.search).get(RETURN_TO_PARAM)
      : `${location.pathname}${location.search}`;
    const destination = safeReturnTo(intended);
    const query =
      destination === startPage ? '' : `?${RETURN_TO_PARAM}=${encodeURIComponent(destination)}`;

    // Replace, not push: being sent to the sign-in screen is a correction, and a correction
    // that lands in the history means the back button walks into the page you cannot see.
    void navigate(`${screen.path}${query}`, { replace: true });
  }, [status, startPage, location.pathname, location.search, navigate]);
}

/**
 * Renders whichever half of the application the session calls for.
 *
 * @returns The tree.
 */
export function SessionRoutes() {
  const status = useSession((state) => state.status);
  const initialise = useSession((state) => state.initialise);
  const isWaitingForApi = useSession((state) => state.isWaitingForApi);
  const isHeld = useIntroHold(status !== 'starting');
  const startPage = usePreferences((state) => state.startPage);

  useAddressFollowsSession(status, startPage);

  useEffect(() => {
    void initialise();
  }, [initialise]);

  const screen = screenFor(status);
  const isIntro = status === 'starting' || isHeld;

  if (isIntro || screen !== undefined) {
    return (
      <AuthLayout
        isLoading={isIntro}
        loadingNote={isWaitingForApi ? 'Waiting for Nebula to answer…' : undefined}
        title={screen?.title ?? ''}
        subtitle={screen?.subtitle ?? ''}
        {...(screen?.footer === undefined ? {} : { footer: screen.footer })}
      >
        {screen?.form}
      </AuthLayout>
    );
  }

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Navigate to={startPage} replace />} />
        <Route path="/dashboards" element={<PagePlaceholder />} />
        <Route path="/automations" element={<AutomationsPage />} />
        <Route path="/automations/new" element={<AutomationEditor />} />
        <Route path="/automations/:automationId" element={<AutomationEditor />} />
        <Route path="/scenes" element={<ScenesPage />} />
        <Route path="/devices" element={<DevicesPage />} />
        <Route path="/aliases" element={<AliasesPage />} />
        <Route
          path="/integrations"
          element={
            <RequiresPermission permission="integration:read" section="Integrations">
              <IntegrationsPage />
            </RequiresPermission>
          }
        />
        <Route
          path="/integrations/:vendorId"
          element={
            <RequiresPermission permission="integration:read" section="Integrations">
              <VendorPage />
            </RequiresPermission>
          }
        />
        <Route path="/packages" element={<PackagesPage />} />

        <Route path="/settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to={DEFAULT_SETTINGS_SECTION} replace />} />
          <Route path="account" element={<AccountSettings />} />
          <Route path="interface" element={<InterfaceSettings />} />

          <Route
            path="users"
            element={
              <RequiresPermission permission="user:read" section="Users and roles">
                <UsersAndRoles />
              </RequiresPermission>
            }
          />

          <Route
            path="data"
            element={
              <RequiresPermission permission="settings:read" section="Data and retention">
                <DataAndRetention />
              </RequiresPermission>
            }
          />

          <Route
            path="icons"
            element={
              <RequiresPermission permission="settings:read" section="Icons">
                <IconsPanel />
              </RequiresPermission>
            }
          />
        </Route>
        <Route path="*" element={<PagePlaceholder />} />
      </Route>
    </Routes>
  );
}
