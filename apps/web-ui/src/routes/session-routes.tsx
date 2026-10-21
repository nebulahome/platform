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
import { Fragment, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';

import { SetupSteps } from '@nebulahome/ui';

import { useSession, type SessionStatus } from '@/auth/session-store';
import { defineMessage, text, type Message } from '@/i18n/messages';
import { AuthLayout } from '@/routes/auth-layout';
import { ComposePage } from '@/routes/containers/compose-page';
import { ContainerPage } from '@/routes/containers/container-page';
import { ContainersPage } from '@/routes/containers/containers-page';
import { DashboardEditorPage } from '@/routes/dashboard/dashboard-editor-page';
import { DashboardPage } from '@/routes/dashboard/dashboard-page';
import { DashboardsManagePage } from '@/routes/dashboard/dashboards-manage-page';
import {
  FIRST_RUN_STEP_COUNT,
  FirstRunForm,
  firstRunHeading,
  firstRunSteps,
  useFirstRunStep,
} from '@/routes/first-run';
import { AliasEditor } from '@/routes/library/alias-editor';
import { AliasesPage } from '@/routes/library/aliases-page';
import { AreasPage } from '@/routes/library/areas-page';
import { AutomationEditor } from '@/routes/library/automation-editor';
import { AutomationsPage } from '@/routes/library/automations-page';
import { MatterBrokerPage } from '@/routes/library/broker-matter-page';
import { MqttBrokerPage } from '@/routes/library/broker-mqtt-page';
import { BrokersPage } from '@/routes/library/brokers-page';
import { DevicePage } from '@/routes/library/device/device-page';
import { DevicesPage } from '@/routes/library/devices-page';
import { EntityPage } from '@/routes/library/entity/entity-page';
import { IntegrationsPage } from '@/routes/library/integrations-page';
import { ScenePage } from '@/routes/library/scene-page';
import { ScenesPage } from '@/routes/library/scenes-page';
import { TagsPage } from '@/routes/library/tags-page';
import { VendorPage } from '@/routes/library/vendor-page';
import { PackageAppPage } from '@/routes/packages/package-app-page';
import { PackagePage } from '@/routes/packages/package-page';
import { PackagesPage } from '@/routes/packages/packages-page';
import { RETURN_TO_PARAM, safeReturnTo } from '@/routes/return-to';
import { AccountSettings } from '@/routes/settings/account-settings';
import { BackupSettings } from '@/routes/settings/backup-settings';
import { DataAndRetention } from '@/routes/settings/data-and-retention';
import { IconsPanel } from '@/routes/settings/icons-panel';
import { InterfaceSettings } from '@/routes/settings/interface-settings';
import { RequiresPermission } from '@/routes/settings/requires-permission';
import { DEFAULT_SETTINGS_SECTION, SettingsLayout } from '@/routes/settings/settings-layout';
import { SystemMonitor } from '@/routes/settings/system-monitor';
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
  readonly title: Message;

  /** The line under it. */
  readonly subtitle: Message;

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
    title: defineMessage('auth.setup.title', 'Set up Nebula Home'),
    subtitle: defineMessage(
      'auth.setup.subtitle',
      'This home has no accounts yet. The first one is yours, and it owns everything.',
    ),
    form: <FirstRunForm />,
  },
  'signed-out': {
    path: '/sign-in',
    title: defineMessage('auth.signIn.title', 'Sign in'),
    subtitle: defineMessage('auth.signIn.subtitle', 'Welcome back to your home.'),
    form: <SignInForm />,
  },
  'awaiting-second-factor': {
    path: '/sign-in/two-factor',
    title: defineMessage('auth.twoFactor.title', 'One more step'),
    subtitle: defineMessage(
      'auth.twoFactor.subtitle',
      'Enter the code from your authenticator, or one of your recovery codes.',
    ),
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
  const setupStep = useFirstRunStep((state) => state.step);

  // What is drawn below is drawn again whole when the language changes, keyed by it: a label
  // worked out once and kept - in a memo, a table, a query's selection - cannot then stay in the
  // language before. This component itself is not, so the session is not decided twice.
  const { t, i18n } = useTranslation();

  useAddressFollowsSession(status, startPage);

  useEffect(() => {
    void initialise();
  }, [initialise]);

  const screen = screenFor(status);
  const isIntro = status === 'starting' || isHeld;

  if (isIntro || screen !== undefined) {
    // The first run is two steps in one card: the card is titled by the step, and the steps
    // stand above it.
    const isSetup = status === 'setup-required' && !isIntro;
    const heading = isSetup ? firstRunHeading(setupStep) : undefined;

    return (
      <AuthLayout
        isLoading={isIntro}
        loadingNote={
          isWaitingForApi ? i18n.t('auth.waiting', 'Waiting for Nebula to answer…') : undefined
        }
        eyebrow={
          isSetup
            ? i18n.t('firstRun.stepOf', 'Step {{step}} of {{count}}', {
                step: setupStep + 1,
                count: FIRST_RUN_STEP_COUNT,
              })
            : undefined
        }
        title={heading?.title ?? (screen === undefined ? '' : text(screen.title))}
        subtitle={heading?.subtitle ?? (screen === undefined ? '' : text(screen.subtitle))}
        isWide={isSetup}
        {...(isSetup ? { steps: <SetupSteps steps={firstRunSteps()} current={setupStep} /> } : {})}
        {...(screen?.footer === undefined ? {} : { footer: screen.footer })}
      >
        <Fragment key={i18n.language}>{screen?.form}</Fragment>
      </AuthLayout>
    );
  }

  return (
    <Routes key={i18n.language}>
      <Route element={<Shell />}>
        <Route index element={<Navigate to={startPage} replace />} />
        <Route path="/dashboards" element={<DashboardPage />} />
        <Route path="/dashboards/:dashboardId" element={<DashboardPage />} />
        <Route
          path="/configuration/dashboards"
          element={
            <RequiresPermission
              permission="dashboard:manage"
              section={t('nav.dashboards', 'Dashboards')}
            >
              <DashboardsManagePage />
            </RequiresPermission>
          }
        />
        <Route
          path="/configuration/dashboards/:dashboardId/edit"
          element={
            <RequiresPermission
              permission="dashboard:manage"
              section={t('nav.dashboards', 'Dashboards')}
            >
              <DashboardEditorPage />
            </RequiresPermission>
          }
        />
        <Route path="/automations" element={<AutomationsPage />} />
        <Route path="/automations/new" element={<AutomationEditor />} />
        <Route path="/automations/:automationId" element={<AutomationEditor />} />
        <Route path="/scenes" element={<ScenesPage />} />
        <Route path="/scenes/new" element={<ScenePage />} />
        <Route path="/scenes/:sceneId" element={<ScenePage />} />
        <Route path="/devices" element={<DevicesPage />} />
        <Route path="/devices/entities/:entityId" element={<EntityPage />} />
        <Route path="/devices/:deviceId" element={<DevicePage />} />
        <Route path="/aliases" element={<AliasesPage />} />
        <Route path="/aliases/new" element={<AliasEditor />} />
        <Route path="/aliases/:aliasId" element={<AliasEditor />} />
        <Route
          path="/tags"
          element={
            <RequiresPermission permission="tag:read" section={t('nav.tags', 'Tags')}>
              <TagsPage />
            </RequiresPermission>
          }
        />
        <Route
          path="/areas"
          element={
            <RequiresPermission permission="area:read" section={t('nav.areas', 'Areas')}>
              <AreasPage />
            </RequiresPermission>
          }
        />
        <Route
          path="/integrations"
          element={
            <RequiresPermission
              permission="integration:read"
              section={t('nav.integrations', 'Integrations')}
            >
              <IntegrationsPage />
            </RequiresPermission>
          }
        />
        <Route
          path="/integrations/:vendorId"
          element={
            <RequiresPermission
              permission="integration:read"
              section={t('nav.integrations', 'Integrations')}
            >
              <VendorPage />
            </RequiresPermission>
          }
        />
        <Route
          path="/brokers"
          element={
            <RequiresPermission permission="device:read" section={t('nav.brokers', 'Brokers')}>
              <BrokersPage />
            </RequiresPermission>
          }
        />
        <Route
          path="/brokers/matter"
          element={
            <RequiresPermission permission="device:read" section={t('nav.brokers', 'Brokers')}>
              <MatterBrokerPage />
            </RequiresPermission>
          }
        />
        <Route
          path="/brokers/mqtt"
          element={
            <RequiresPermission permission="device:read" section={t('nav.brokers', 'Brokers')}>
              <MqttBrokerPage />
            </RequiresPermission>
          }
        />
        <Route
          path="/packages"
          element={
            <RequiresPermission permission="package:read" section={t('nav.packages', 'Packages')}>
              <PackagesPage />
            </RequiresPermission>
          }
        />
        <Route
          path="/packages/:packageId"
          element={
            <RequiresPermission permission="package:read" section={t('nav.packages', 'Packages')}>
              <PackagePage />
            </RequiresPermission>
          }
        />
        <Route
          path="/packages/:packageId/app/*"
          element={
            <RequiresPermission permission="package:read" section={t('nav.packages', 'Packages')}>
              <PackageAppPage />
            </RequiresPermission>
          }
        />
        <Route
          path="/containers"
          element={
            <RequiresPermission
              permission="container:read"
              section={t('nav.containers', 'Containers')}
            >
              <ContainersPage />
            </RequiresPermission>
          }
        />
        <Route
          path="/containers/compose/:project"
          element={
            <RequiresPermission
              permission="container:read"
              section={t('nav.containers', 'Containers')}
            >
              <ComposePage />
            </RequiresPermission>
          }
        />
        <Route
          path="/containers/:name"
          element={
            <RequiresPermission
              permission="container:read"
              section={t('nav.containers', 'Containers')}
            >
              <ContainerPage />
            </RequiresPermission>
          }
        />

        <Route path="/settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to={DEFAULT_SETTINGS_SECTION} replace />} />
          <Route path="account" element={<AccountSettings />} />
          <Route path="interface" element={<InterfaceSettings />} />

          <Route
            path="system"
            element={
              <RequiresPermission
                permission="system:read"
                section={t('settings.sections.system', 'System monitor')}
              >
                <SystemMonitor />
              </RequiresPermission>
            }
          />

          <Route
            path="users"
            element={
              <RequiresPermission
                permission="user:read"
                section={t('settings.sections.users', 'Users and roles')}
              >
                <UsersAndRoles />
              </RequiresPermission>
            }
          />

          <Route
            path="data"
            element={
              <RequiresPermission
                permission="settings:read"
                section={t('settings.sections.data', 'Data and retention')}
              >
                <DataAndRetention />
              </RequiresPermission>
            }
          />

          <Route
            path="backup"
            element={
              <RequiresPermission
                permission="settings:read"
                section={t('settings.sections.backup', 'Backup')}
              >
                <BackupSettings />
              </RequiresPermission>
            }
          />

          <Route
            path="icons"
            element={
              <RequiresPermission
                permission="settings:read"
                section={t('settings.sections.icons', 'Icons')}
              >
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
