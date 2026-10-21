/**
 * One container: how it stands, how busy it is, what it runs, how it is attached to the machine,
 * and what it last wrote.
 *
 * As the board draws a detail page: the way back, the container's glyph, its name and what it is
 * for, its state as a Pill with its version and who runs it, its actions on the right - then the
 * tabs. Overview opens with the health strip (Runtime, Image, Used by), then its usage, ports,
 * storage and details; Environment is every variable it was started with; Log is what it wrote.
 *
 * The buttons that start, stop, restart, update and remove it are absent for the platform's own
 * containers and for one an integration runs: the first would stop the page asking, the second is
 * the integration's to manage - its details say which runs it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import type { ContainerAction } from '@nebulahome/contracts';
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
  toast,
  type MenuItem,
} from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { LogViewer } from '@/components/log-viewer';
import {
  CONTAINER_QUERY_KEYS,
  controlContainer,
  fetchContainer,
  fetchContainerLogs,
  removeContainer,
  updateContainer,
} from '@/containers/api';
import { projectTitle } from '@/containers/container-groups';
import { containerPill, containerPurpose } from '@/containers/container-health';
import { toMessage } from '@/lib/error-message';
import { useTab } from '@/lib/use-tab';
import { composePath } from '@/routes/containers/container-card';
import { ContainerEnvironment } from '@/routes/containers/container-environment';
import { ContainerOverview } from '@/routes/containers/container-overview';
import { ContainerTile } from '@/routes/containers/container-parts';
import { BackLink, DetailFrame } from '@/routes/library/detail-page';

/** The tabs of the page; the first is the page itself. */
const TABS = ['overview', 'environment', 'log'] as const;

/** One tab. */
type ContainerTab = (typeof TABS)[number];

/**
 * Renders one container's page.
 *
 * @returns The page.
 */
export function ContainerPage() {
  const { t } = useTranslation();

  const { name = '' } = useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const can = useSession((state) => state.can);
  const canControl = can('container:control');
  const canInstall = can('container:install');
  const [isRemoving, setRemoving] = useState(false);
  const [removeVolumes, setRemoveVolumes] = useState(false);
  const [tab, setTab] = useTab<ContainerTab>(TABS);
  const logKey = useMemo(() => CONTAINER_QUERY_KEYS.logs(name), [name]);

  const container = useQuery({
    queryKey: CONTAINER_QUERY_KEYS.one(name),

    /**
     * Reads the container.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request.
     * @returns The container.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchContainer(name, signal),
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  /** Reads everything about containers again after an action. */
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: CONTAINER_QUERY_KEYS.all });
  };

  /** What the container is called in a toast. */
  const shownName = container.data?.displayName ?? name;

  const control = useMutation({
    /**
     * Starts, stops or restarts it.
     *
     * @param action - What to do.
     * @returns The container as it now is.
     */
    mutationFn: async (action: ContainerAction) => controlContainer(name, action),

    /**
     * Says what it did, and reads again.
     *
     * @param unused - The container as it now is.
     * @param action - What was done.
     */
    onSuccess: (unused, action) => {
      toast.success({
        title:
          action === 'start'
            ? t('containers.containerPage.started', '{{name}} started', { name: shownName })
            : action === 'stop'
              ? t('containers.containerPage.stopped', '{{name}} stopped', { name: shownName })
              : t('containers.containerPage.restarted', '{{name}} restarted', { name: shownName }),
      });
      refresh();
    },

    /**
     * Says why it did not work.
     *
     * @param error - What the server answered.
     */
    onError: (error) => {
      toast.error({
        title: t('containers.containerPage.controlFailed', 'Couldn’t control {{name}}', {
          name: shownName,
        }),
        message: toMessage(error),
      });
    },
  });
  const update = useMutation({
    /**
     * Starts the update.
     *
     * @returns Once the supervisor took it.
     */
    mutationFn: async () => updateContainer(name),

    /** Says it is under way, and reads again. */
    onSuccess: () => {
      toast.info({
        title: t('containers.containerPage.updating', '{{name}} is updating', { name: shownName }),
        message: t(
          'containers.containerPage.updatingLine',
          'It takes the newer image and starts again with it.',
        ),
      });
      refresh();
    },

    /**
     * Says why it did not work.
     *
     * @param error - What the server answered.
     */
    onError: (error) => {
      toast.error({
        title: t('containers.containerPage.updateFailed', 'Couldn’t update {{name}}', {
          name: shownName,
        }),
        message: toMessage(error),
      });
    },
  });

  const removal = useMutation({
    /**
     * Stops and removes it.
     *
     * @returns Once it is gone.
     */
    mutationFn: async () => removeContainer(name, removeVolumes),

    /** Goes back to the grid, which no longer has it. */
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CONTAINER_QUERY_KEYS.all });
      setRemoving(false);
      void navigate('/containers');
    },
  });

  const view = container.data;
  const isControllable = view?.refusal === null;
  const isRunning = view?.state === 'running';
  const isBusy =
    control.isPending ||
    update.isPending ||
    removal.isPending ||
    view?.update.isInstalling === true;
  const canUpdate =
    view !== undefined &&
    isControllable &&
    canInstall &&
    view.update.isAvailable &&
    !view.update.isInstalling;
  const pill = view === undefined ? null : containerPill(view);

  const menu: MenuItem[] =
    view !== undefined && isControllable && canInstall
      ? [
          {
            label: t('common.remove', 'Remove'),
            icon: 'trash-2',
            tone: 'danger',
            disabled: isBusy,
            /** Asks first, and whether its volumes go with it. */
            onSelect: () => {
              setRemoveVolumes(false);
              setRemoving(true);
            },
          },
        ]
      : [];

  return (
    <>
      <DetailFrame
        isPending={container.isPending}
        error={container.error}
        isFilled={tab === 'log'}
        hero={
          <DetailHero
            back={
              view?.compose === null || view?.compose === undefined ? (
                <BackLink to="/containers">
                  {t('containers.container.containers', 'Containers')}
                </BackLink>
              ) : (
                <BackLink to={composePath(view.compose.project)}>
                  {projectTitle(view.compose.project, view.isSystem)}
                </BackLink>
              )
            }
            mark={
              view === undefined ? undefined : (
                <ContainerTile name={view.name} icon="container" size={56} />
              )
            }
            title={view?.displayName ?? name}
            description={view === undefined ? undefined : containerPurpose(view)}
            facts={
              view === undefined || pill === null ? undefined : (
                <>
                  <Pill tone={pill.tone}>{pill.label}</Pill>
                  {view.version === null ? null : <HeroFact>{view.version}</HeroFact>}
                  {view.managedBy !== null && !view.managedBy.isReleased ? (
                    <HeroFact icon="lock">
                      {t('containers.container.runByTheSupervisor', 'Run by the supervisor')}
                    </HeroFact>
                  ) : view.isSystem ? (
                    <HeroFact icon="lock">
                      {t('containers.container.partOfThePlatform', 'Part of the platform')}
                    </HeroFact>
                  ) : null}
                </>
              )
            }
            actions={
              view === undefined || !isControllable ? undefined : (
                <>
                  {canUpdate ? (
                    <Button
                      isBusy={update.isPending}
                      disabled={isBusy}
                      onClick={() => {
                        update.mutate();
                      }}
                    >
                      <AppIcon id="circle-arrow-up" size={16} />
                      {t('containers.container.updateTo', 'Update to')}{' '}
                      {view.update.latestVersion ?? t('containers.container.newest', 'the newest')}
                    </Button>
                  ) : null}
                  {canControl && isRunning ? (
                    <>
                      <Button
                        variant="ghost"
                        isBusy={control.isPending && control.variables === 'restart'}
                        disabled={isBusy}
                        onClick={() => {
                          control.mutate('restart');
                        }}
                      >
                        <AppIcon id="rotate-ccw" size={15} />
                        {t('containers.container.restart', 'Restart')}
                      </Button>
                      <Button
                        variant="ghost"
                        isBusy={control.isPending && control.variables === 'stop'}
                        disabled={isBusy}
                        onClick={() => {
                          control.mutate('stop');
                        }}
                      >
                        <AppIcon id="square" size={14} />
                        {t('containers.container.stop', 'Stop')}
                      </Button>
                    </>
                  ) : null}
                  {canControl && !isRunning ? (
                    <Button
                      variant={canUpdate ? 'ghost' : 'primary'}
                      isBusy={control.isPending && control.variables === 'start'}
                      disabled={isBusy}
                      onClick={() => {
                        control.mutate('start');
                      }}
                    >
                      <AppIcon id="play" size={15} />
                      {t('containers.container.start', 'Start')}
                    </Button>
                  ) : null}
                  <OverflowMenu items={menu} />
                </>
              )
            }
            tabs={
              view === undefined ? undefined : (
                <Tabs
                  label={view.displayName}
                  idPrefix="container"
                  value={tab}
                  onChange={setTab}
                  items={[
                    { id: 'overview', label: t('containers.container.overview', 'Overview') },
                    {
                      id: 'environment',
                      label: t('containers.container.environment', 'Environment'),
                      count: view.env.length,
                    },
                    { id: 'log', label: t('containers.container.log', 'Log') },
                  ]}
                />
              )
            }
          />
        }
      >
        {view === undefined ? null : (
          <>
            {tab === 'overview' ? (
              <TabPanel idPrefix="container" id="overview">
                <ContainerOverview
                  container={view}
                  isUpdating={update.isPending}
                  {...(canUpdate
                    ? {
                        /** Updates it to the newer image. */
                        onUpdate: () => {
                          update.mutate();
                        },
                      }
                    : {})}
                />
              </TabPanel>
            ) : null}

            {tab === 'environment' ? (
              <TabPanel idPrefix="container" id="environment">
                <ContainerEnvironment container={view} />
              </TabPanel>
            ) : null}

            {tab === 'log' ? (
              <TabPanel idPrefix="container" id="log" className="flex min-h-0 grow flex-col">
                <LogViewer
                  isFilled
                  queryKey={logKey}
                  fileName={view.name}
                  read={async (tail, since, signal) =>
                    fetchContainerLogs(view.name, tail, since, signal)
                  }
                />
              </TabPanel>
            ) : null}
          </>
        )}
      </DetailFrame>

      <Modal
        isOpen={isRemoving}
        onClose={() => {
          setRemoving(false);
        }}
        size="small"
        title={t('containers.container.removeName', 'Remove {{name}}?', {
          name: view?.displayName ?? name,
        })}
        description={t(
          'containers.container.itIsStoppedAnd',
          'It is stopped and removed. Its named volumes and the folders it was given stay.',
        )}
        footer={
          <>
            {removal.error === null ? null : (
              <p role="alert" className="mr-auto text-ui text-danger">
                {toMessage(removal.error)}
              </p>
            )}
            <Button
              variant="ghost"
              disabled={removal.isPending}
              onClick={() => {
                setRemoving(false);
              }}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              variant="danger"
              isBusy={removal.isPending}
              onClick={() => {
                removal.mutate();
              }}
            >
              {t('common.remove', 'Remove')}
            </Button>
          </>
        }
      >
        <div className="px-5 py-4">
          <Switch
            label={t(
              'containers.container.alsoDeleteTheVolumes',
              'Also delete the volumes Docker made for it alone',
            )}
            isOn={removeVolumes}
            onChange={setRemoveVolumes}
          />
        </div>
      </Modal>
    </>
  );
}
