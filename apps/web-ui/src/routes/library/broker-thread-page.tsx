/**
 * The house's Thread network: the border router that joins it to the house's network, its radio,
 * and the devices that talk over it.
 *
 * Before setup the page is the panel that says Thread needs a radio, with Set up; a page opened
 * from Serial's Use with… (`?setup=<port>`) opens Set up at that port. Once set up: the way back,
 * the lit mark, the name and its line, the state, the network's name and channel, **Settings**
 * top right, then Overview, Devices, Network and Border routers.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import type { ThreadStatus } from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  DetailHero,
  HeroFact,
  Note,
  Pill,
  TabPanel,
  Tabs,
  toast,
} from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { toMessage } from '@/lib/error-message';
import { useTab } from '@/lib/use-tab';
import { fetchAreas, LIBRARY_QUERY_KEYS } from '@/library/api';
import {
  fetchThreadBorderRouters,
  fetchThreadDevices,
  fetchThreadStatus,
  restartThread,
  THREAD_QUERY_KEYS,
} from '@/library/thread-api';
import {
  Ipv6FixDialog,
  ThreadSettingsDialog,
  ThreadSetupDialog,
} from '@/routes/library/broker-thread/thread-dialogs';
import { ThreadNetworkView } from '@/routes/library/broker-thread/thread-map';
import {
  BeforeSetup,
  ThreadBorderRouters,
  ThreadDevices,
  ThreadOverview,
} from '@/routes/library/broker-thread/thread-tabs';
import { brokerStateOf, BrokerMark } from '@/routes/library/brokers-page';
import { BackLink, DetailFrame } from '@/routes/library/detail-page';

/** The tabs of the page once Thread is set up. */
const TABS = ['overview', 'devices', 'network', 'border-routers'] as const;

/** One tab. */
type ThreadTab = (typeof TABS)[number];

/** How often the network is read again. */
const REFRESH_MS = 5000;

/** How often the network is read while it is being set up. */
const SETUP_MS = 1500;

/** A dialog the page has open. */
type Open = 'setup' | 'settings' | 'ipv6';

/**
 * Renders the Thread broker's page.
 *
 * @returns The page.
 */
export function ThreadBrokerPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const can = useSession((state) => state.can);
  const canConfigure = can('integration:configure');
  const [tab, setTab] = useTab<ThreadTab>(TABS);
  const [params] = useSearchParams();
  const [open, setOpen] = useState<Open | null>(() =>
    params.has('setup') && canConfigure ? 'setup' : null,
  );

  const status = useQuery<ThreadStatus>({
    queryKey: THREAD_QUERY_KEYS.status,

    /**
     * Reads it again: often while a setup runs.
     *
     * @param query - The query, with what it read last.
     * @returns How soon.
     */
    refetchInterval: (query) =>
      query.state.data?.setup?.state === 'running' ? SETUP_MS : REFRESH_MS,

    /**
     * Reads where the network stands.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The state.
     */
    queryFn: async ({ signal }) => fetchThreadStatus(signal),
  });
  const isSetUp = status.data !== undefined && status.data.mode !== 'none';
  const devices = useQuery({
    queryKey: THREAD_QUERY_KEYS.devices,
    enabled: isSetUp,
    refetchInterval: REFRESH_MS,

    /**
     * Reads the nodes on the network.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns Them.
     */
    queryFn: async ({ signal }) => fetchThreadDevices(signal),
  });
  const borderRouters = useQuery({
    queryKey: THREAD_QUERY_KEYS.borderRouters,
    enabled: isSetUp,
    refetchInterval: REFRESH_MS * 6,

    /**
     * Reads the border routers heard.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns Them.
     */
    queryFn: async ({ signal }) => fetchThreadBorderRouters(signal),
  });
  const areas = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.areas,

    /**
     * Reads the rooms.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The rooms.
     */
    queryFn: async ({ signal }) => fetchAreas(signal),
  });
  const restart = useMutation({
    mutationFn: restartThread,

    /** Reads it again. */
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['brokers'] });
    },

    /**
     * Says why not.
     *
     * @param error - What failed.
     */
    onError: (error) => {
      toast.error({
        title: t('brokers.thread.restartFailed', 'Couldn’t restart the border router'),
        message: toMessage(error),
      });
    },
  });

  const current = status.data;
  const state = current === undefined ? null : brokerStateOf(current.state);
  const roomNames = new Map((areas.data ?? []).map((area) => [area.id, area.name]));

  /**
   * The name of a room.
   *
   * @param areaId - The room.
   * @returns Its name, or null.
   */
  const roomOf = (areaId: string | null): string | null =>
    areaId === null ? null : (roomNames.get(areaId) ?? null);
  const isRunningSetup = current?.setup?.state === 'running';

  return (
    <DetailFrame
      isPending={status.isPending}
      error={status.error}
      hero={
        <DetailHero
          back={<BackLink to="/brokers">{t('brokers.title', 'Brokers')}</BackLink>}
          mark={<BrokerMark broker="thread" size={56} isLit />}
          title={t('brokers.thread.name', 'Thread')}
          description={t(
            'brokers.thread.description',
            'The house’s Thread network: the border router that joins it to the house’s network, and the devices that talk over it.',
          )}
          facts={
            current === undefined || state === null ? undefined : (
              <>
                <Pill tone={state.tone}>{state.label}</Pill>
                {current.network === null ? null : (
                  <>
                    <HeroFact icon="waypoints">{current.network.name}</HeroFact>
                    <HeroFact icon="radio">
                      {t('brokers.thread.channelFact', 'Channel {{channel}}', {
                        channel: current.network.channel,
                      })}
                    </HeroFact>
                  </>
                )}
              </>
            )
          }
          actions={
            !isSetUp || !canConfigure ? undefined : (
              <Button
                variant="ghost"
                onClick={() => {
                  setOpen('settings');
                }}
              >
                <AppIcon id="settings" size={15} />
                {t('brokers.thread.openSettings', 'Settings')}
              </Button>
            )
          }
          tabs={
            !isSetUp ? undefined : (
              <Tabs
                label={t('brokers.thread.name', 'Thread')}
                idPrefix="thread"
                value={tab}
                onChange={setTab}
                items={[
                  { id: 'overview', label: t('brokers.thread.overview', 'Overview') },
                  {
                    id: 'devices',
                    label: t('brokers.thread.devices', 'Devices'),
                    count: devices.data?.length ?? current?.devices.total ?? 0,
                  },
                  { id: 'network', label: t('brokers.thread.networkTab', 'Network') },
                  {
                    id: 'border-routers',
                    label: t('brokers.thread.borderRouters', 'Border routers'),
                    count: borderRouters.data?.length ?? 0,
                  },
                ]}
              />
            )
          }
        />
      }
    >
      {current === undefined ? null : (
        <>
          {current.state === 'failed' && current.error !== null ? (
            <Note tone="danger">
              {t('brokers.thread.failed', 'The border router is not answering: {{error}}', {
                error: current.error,
              })}
            </Note>
          ) : null}
          {isRunningSetup && open !== 'setup' ? (
            <Note
              tone="accent"
              action={
                <Button
                  variant="ghost"
                  size="compact"
                  onClick={() => {
                    setOpen('setup');
                  }}
                >
                  {t('brokers.thread.follow', 'Follow it')}
                </Button>
              }
            >
              {t('brokers.thread.settingUp', 'Thread is being set up.')}
            </Note>
          ) : null}

          {!isSetUp ? (
            <BeforeSetup
              status={current}
              onSetUp={
                canConfigure
                  ? () => {
                      setOpen('setup');
                    }
                  : undefined
              }
            />
          ) : (
            <>
              {tab === 'overview' ? (
                <TabPanel idPrefix="thread" id="overview">
                  <ThreadOverview
                    status={current}
                    canConfigure={canConfigure}
                    onFix={() => {
                      setOpen('ipv6');
                    }}
                    onRestart={
                      canConfigure && current.mode === 'local'
                        ? () => {
                            restart.mutate();
                          }
                        : undefined
                    }
                  />
                </TabPanel>
              ) : null}
              {tab === 'devices' ? (
                <TabPanel idPrefix="thread" id="devices">
                  <ThreadDevices devices={devices.data ?? []} roomOf={roomOf} />
                </TabPanel>
              ) : null}
              {tab === 'network' ? (
                <TabPanel idPrefix="thread" id="network">
                  <ThreadNetworkView
                    devices={devices.data}
                    borderRouters={borderRouters.data ?? []}
                    roomOf={roomOf}
                  />
                </TabPanel>
              ) : null}
              {tab === 'border-routers' ? (
                <TabPanel idPrefix="thread" id="border-routers">
                  <ThreadBorderRouters
                    borderRouters={borderRouters.data ?? []}
                    onJoin={
                      canConfigure
                        ? () => {
                            setOpen('settings');
                          }
                        : undefined
                    }
                  />
                </TabPanel>
              ) : null}
            </>
          )}

          {open === 'setup' ? (
            <ThreadSetupDialog
              status={current}
              portId={params.get('setup')}
              onClose={() => {
                setOpen(null);
              }}
            />
          ) : null}
          {open === 'settings' ? (
            <ThreadSettingsDialog
              status={current}
              onClose={() => {
                setOpen(null);
              }}
            />
          ) : null}
          {open === 'ipv6' ? (
            <Ipv6FixDialog
              status={current}
              onClose={() => {
                setOpen(null);
              }}
            />
          ) : null}
        </>
      )}
    </DetailFrame>
  );
}
