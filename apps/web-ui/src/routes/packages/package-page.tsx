/**
 * One package: who it is, how it stands, what it needs and what needs it, and its own page.
 *
 * As the board draws a detail page: the way back, the package's logo, name and line, its state as a
 * Pill with its version and whether it is part of the platform, its actions on the right - then the
 * tabs. Overview opens with the health strip (Runtime, Needs, Used by, Updates), then what it
 * provides and About; Configuration is the settings its `setup.json` asks for; Log is its process's
 * output, for a package that runs one.
 *
 * A package with a page of its own is opened from here - Open, while it runs - and from the sidebar
 * when it asks for an entry there; the page is its own address, `/packages/<id>/app`. Start, Stop
 * and Restart are for whoever may configure packages; Update and Remove for whoever may install
 * them. A package that is part of the platform is never removed, only restarted, and the page says
 * so rather than offering a button that would be refused. Stopping a package others need asks
 * first, naming them: they stop with it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import type { ApiPackageDetail } from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  DetailHero,
  HeroFact,
  Modal,
  OverflowMenu,
  Pill,
  Switch,
  TabPanel,
  Tabs,
  type MenuItem,
  type PillTone,
} from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { LogViewer } from '@/components/log-viewer';
import { toMessage } from '@/lib/error-message';
import { useTab } from '@/lib/use-tab';
import {
  controlPackage,
  fetchAvailablePackages,
  fetchPackage,
  fetchPackageLogs,
  PACKAGE_QUERY_KEYS,
  removePackage,
  updatePackage,
} from '@/packages/api';
import { listed } from '@/packages/package-health';
import { packageAppPath } from '@/packages/package-paths';
import { BackLink, DetailFrame } from '@/routes/library/detail-page';
import { PackageConfiguration } from '@/routes/packages/package-configuration';
import { PackageOverview } from '@/routes/packages/package-overview';
import { PACKAGE_STATE_OF, PackageLogo } from '@/routes/packages/package-tile';

/** The tabs of the page; the first is the page itself. */
const TABS = ['overview', 'configuration', 'log'] as const;

/** One tab. */
type PackageTab = (typeof TABS)[number];

/**
 * The Pill tone of a state's badge tone: the same words, in the colours a Pill has.
 *
 * @param tone - The badge tone.
 * @returns The Pill tone.
 */
function pillTone(tone: string): PillTone {
  return tone === 'success' || tone === 'warning' || tone === 'danger' || tone === 'accent'
    ? tone
    : 'neutral';
}

/** What the removal dialog needs. */
type RemoveDialogProps = {
  readonly found: ApiPackageDetail | null;
  readonly onClose: () => void;
  readonly onRemoved: () => void;
};

/**
 * Asks before a package goes, and whether what it kept goes with it.
 *
 * @param props - See {@link RemoveDialogProps}.
 * @returns The dialog.
 */
function RemoveDialog(props: RemoveDialogProps) {
  const { found, onClose, onRemoved } = props;
  const [isDataRemoved, setDataRemoved] = useState(false);
  const remove = useMutation({
    /**
     * Removes it.
     *
     * @returns Nothing.
     */
    mutationFn: async () => removePackage(found?.id ?? '', isDataRemoved),
    onSuccess: onRemoved,
  });

  return (
    <Modal
      isOpen={found !== null}
      onClose={onClose}
      size="small"
      title={`Remove ${found?.name ?? ''}?`}
      description={
        found === null
          ? undefined
          : `Its ${String(found.deviceCount)} device${found.deviceCount === 1 ? '' : 's'} and ${String(found.entityCount)} entit${found.entityCount === 1 ? 'y' : 'ies'} go with it; its cards stay on the dashboards and say it is not installed.`
      }
      footer={
        <>
          <Button variant="ghost" disabled={remove.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            isBusy={remove.isPending}
            onClick={() => {
              remove.mutate();
            }}
          >
            Remove
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 text-ui">
          <span aria-hidden="true">Delete what it kept, too</span>
          <Switch label="Delete what it kept, too" isOn={isDataRemoved} onChange={setDataRemoved} />
        </div>
        <p className="text-caption text-foreground-subtle">
          {isDataRemoved
            ? 'Its data folder is deleted: installing it again starts from nothing.'
            : 'Its data folder is kept: installing it again picks up where it left off.'}
        </p>
        {remove.error === null ? null : (
          <p role="alert" className="text-ui text-danger">
            {toMessage(remove.error)}
          </p>
        )}
      </div>
    </Modal>
  );
}

/**
 * Renders one package's page.
 *
 * @returns The page.
 */
export function PackagePage() {
  const { packageId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const can = useSession((state) => state.can);
  const canConfigure = can('package:configure');
  const canInstall = can('package:install');
  const [isRemoving, setRemoving] = useState(false);
  const [isStopAsked, setStopAsked] = useState(false);
  const [tab, setTab] = useTab<PackageTab>(TABS);

  const detail = useQuery({
    queryKey: PACKAGE_QUERY_KEYS.one(packageId),

    /**
     * Reads the package.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns The package.
     */
    queryFn: async ({ signal }) => fetchPackage(packageId, signal),
  });
  const available = useQuery({
    queryKey: PACKAGE_QUERY_KEYS.available,
    staleTime: 5 * 60_000,

    /**
     * Reads what the index offers, for whether a newer release is out.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns The packages.
     */
    queryFn: async ({ signal }) => fetchAvailablePackages(signal),
  });

  /** Reads everything about packages again, after something was done to this one. */
  const settle = (): void => {
    void queryClient.invalidateQueries({ queryKey: PACKAGE_QUERY_KEYS.all });
  };

  const control = useMutation({
    /**
     * Starts, stops or restarts it.
     *
     * @param action - Which.
     * @returns It, as it now is.
     */
    mutationFn: async (action: 'start' | 'stop' | 'restart') => controlPackage(packageId, action),
    onSettled: settle,
  });
  const update = useMutation({
    /**
     * Updates it.
     *
     * @returns It, as it now is.
     */
    mutationFn: async () => updatePackage(packageId),
    onSettled: settle,
  });

  const found = detail.data;
  const offered = available.data?.items.find((each) => each.id === packageId);
  const newer = offered?.hasUpdate === true ? offered.latest?.version : undefined;
  // Another build of the version installed, in the platform's local folder.
  const hasNewBuild = newer === undefined && offered?.hasNewBuild === true;
  const isUp = found?.state === 'running' || found?.state === 'starting';
  const problem = control.error ?? update.error;
  const hasSetup = found?.setup !== null && found?.setup !== undefined;
  const hasLog = found?.runtime === 'node';
  const dependents = found?.usedBy ?? [];
  const hasPage = found?.ui?.page === true;
  const shownTab: PackageTab =
    (tab === 'configuration' && !hasSetup) || (tab === 'log' && !hasLog) ? 'overview' : tab;

  /** Stops it, asking first when something needs it. */
  const stop = (): void => {
    if (dependents.length > 0) {
      setStopAsked(true);
    } else {
      control.mutate('stop');
    }
  };

  const menu: MenuItem[] =
    found === undefined
      ? []
      : [
          ...(canInstall && newer !== undefined
            ? [
                {
                  label: `Update to v${newer}`,
                  icon: 'circle-arrow-up' as const,
                  disabled: update.isPending,
                  /** Installs the newer release. */
                  onSelect: () => {
                    update.mutate();
                  },
                },
              ]
            : []),
          ...(canInstall && hasNewBuild
            ? [
                {
                  label: 'Reinstall',
                  description: 'The build in the local folder',
                  icon: 'rotate-ccw' as const,
                  disabled: update.isPending,
                  /** Installs the rebuild of the same version. */
                  onSelect: () => {
                    update.mutate();
                  },
                },
              ]
            : []),
          ...(canConfigure && isUp
            ? [
                {
                  label: 'Restart',
                  icon: 'rotate-ccw' as const,
                  /** Restarts it. */
                  onSelect: () => {
                    control.mutate('restart');
                  },
                },
              ]
            : []),
          ...(canConfigure && isUp && !found.isSystem
            ? [{ label: 'Stop', icon: 'square' as const, onSelect: stop }]
            : []),
          ...(canInstall && !found.isSystem
            ? [
                {
                  label: 'Remove',
                  icon: 'trash-2' as const,
                  tone: 'danger' as const,
                  disabled: dependents.length > 0,
                  disabledReason: `${listed(dependents.map((each) => each.name))} need it`,
                  /** Asks first, and whether what it kept goes with it. */
                  onSelect: () => {
                    setRemoving(true);
                  },
                },
              ]
            : []),
        ];

  const state = found === undefined ? null : PACKAGE_STATE_OF[found.state];

  return (
    <>
      <DetailFrame
        isPending={detail.isPending}
        error={detail.error}
        isFilled={shownTab === 'log'}
        hero={
          <DetailHero
            back={<BackLink to="/packages">Packages</BackLink>}
            mark={found === undefined ? undefined : <PackageLogo found={found} size={56} />}
            title={found?.name ?? packageId}
            description={found?.description}
            facts={
              found === undefined || state === null ? undefined : (
                <>
                  <Pill tone={pillTone(state.tone)}>{state.label}</Pill>
                  <HeroFact>v{found.version}</HeroFact>
                  {found.isSystem ? <HeroFact icon="lock">System</HeroFact> : null}
                  {found.source === 'local' ? (
                    <HeroFact icon="hard-drive">Local file</HeroFact>
                  ) : null}
                </>
              )
            }
            actions={
              found === undefined ? undefined : (
                <>
                  {canConfigure && !isUp ? (
                    <Button
                      isBusy={control.isPending && control.variables === 'start'}
                      onClick={() => {
                        control.mutate('start');
                      }}
                    >
                      <AppIcon id="play" size={15} />
                      Start
                    </Button>
                  ) : null}
                  {hasPage ? (
                    <Button
                      variant={isUp ? 'primary' : 'ghost'}
                      disabled={found.state !== 'running'}
                      title={found.state === 'running' ? undefined : 'Its page opens while it runs'}
                      onClick={() => {
                        void navigate(packageAppPath(found.id));
                      }}
                    >
                      Open
                    </Button>
                  ) : null}
                  <OverflowMenu items={menu} />
                </>
              )
            }
            tabs={
              found === undefined ? undefined : (
                <Tabs
                  label={found.name}
                  idPrefix="package"
                  value={shownTab}
                  onChange={setTab}
                  items={[
                    { id: 'overview', label: 'Overview' },
                    ...(hasSetup ? [{ id: 'configuration' as const, label: 'Configuration' }] : []),
                    ...(hasLog ? [{ id: 'log' as const, label: 'Log' }] : []),
                  ]}
                />
              )
            }
          />
        }
      >
        {found === undefined ? null : (
          <>
            {problem === null ? null : (
              <p role="alert" className="text-ui text-danger">
                {toMessage(problem)}
              </p>
            )}

            {shownTab === 'overview' ? (
              <TabPanel idPrefix="package" id="overview">
                <PackageOverview
                  found={found}
                  newer={newer}
                  hasNewBuild={hasNewBuild}
                  isOffered={offered !== undefined}
                  isUpdating={update.isPending}
                  {...(canInstall
                    ? {
                        /** Updates it, or reinstalls the rebuild. */
                        onUpdate: () => {
                          update.mutate();
                        },
                      }
                    : {})}
                  {...(hasLog
                    ? {
                        /** Opens its log. */
                        onOpenLog: () => {
                          setTab('log');
                        },
                      }
                    : {})}
                />
              </TabPanel>
            ) : null}

            {shownTab === 'configuration' ? (
              <TabPanel idPrefix="package" id="configuration">
                <PackageConfiguration
                  key={found.updatedAt.toString()}
                  found={found}
                  canConfigure={canConfigure}
                  onSaved={settle}
                />
              </TabPanel>
            ) : null}

            {shownTab === 'log' ? (
              <TabPanel idPrefix="package" id="log" className="flex min-h-0 grow flex-col">
                <LogViewer
                  title="Log"
                  isFilled
                  queryKey={PACKAGE_QUERY_KEYS.logs(found.id)}
                  fileName={`package-${found.id}`}
                  read={async (tail, since, signal) =>
                    fetchPackageLogs(found.id, tail, since, signal)
                  }
                />
              </TabPanel>
            ) : null}
          </>
        )}
      </DetailFrame>

      {isRemoving && found !== undefined ? (
        <RemoveDialog
          found={found}
          onClose={() => {
            setRemoving(false);
          }}
          onRemoved={() => {
            setRemoving(false);
            settle();
            void navigate('/packages');
          }}
        />
      ) : null}

      <Modal
        isOpen={isStopAsked}
        onClose={() => {
          setStopAsked(false);
        }}
        size="small"
        title={`Stop ${found?.name ?? ''}?`}
        description={`${listed(dependents.map((each) => each.name))} need${dependents.length === 1 ? 's' : ''} it, and stop${dependents.length === 1 ? 's' : ''} with it until it is started again.`}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setStopAsked(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setStopAsked(false);
                control.mutate('stop');
              }}
            >
              Stop
            </Button>
          </>
        }
      >
        <span className="sr-only">Stopping it stops what needs it.</span>
      </Modal>
    </>
  );
}
