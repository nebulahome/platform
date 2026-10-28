/**
 * The house's Infrared broker: the remotes learned through IR blasters, each button a button of
 * the house, and the blasters integrations provide.
 *
 * As the boards draw a broker: the way back, the lit mark, the name and its line, the state and
 * how many blasters, **Add remote** top right (disabled, with why, until there is a blaster), then
 * Overview, Remotes and Blasters. A remote's keypad is a page of its own
 * (`broker-infrared/remote-page`).
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, Button, DetailHero, HeroFact, Note, Pill, TabPanel, Tabs } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { useTab } from '@/lib/use-tab';
import { fetchAreas, LIBRARY_QUERY_KEYS } from '@/library/api';
import {
  fetchInfraredBlasters,
  fetchInfraredRemotes,
  fetchInfraredStatus,
  INFRARED_QUERY_KEYS,
} from '@/library/infrared-api';
import { AddRemoteDialog } from '@/routes/library/broker-infrared/add-remote-dialog';
import {
  InfraredBlasters,
  InfraredOverview,
  InfraredRemotes,
} from '@/routes/library/broker-infrared/infrared-tabs';
import { brokerStateOf, BrokerMark } from '@/routes/library/brokers-page';
import { BackLink, DetailFrame } from '@/routes/library/detail-page';

/** The tabs of the page; the first is the page itself. */
const TABS = ['overview', 'remotes', 'blasters'] as const;

/** One tab. */
type InfraredTab = (typeof TABS)[number];

/** How often the broker is read again. */
const REFRESH_MS = 5000;

/**
 * Renders the Infrared broker's page.
 *
 * @returns The page.
 */
export function InfraredBrokerPage() {
  const { t } = useTranslation();
  const can = useSession((state) => state.can);
  const canWrite = can('device:write');
  const [tab, setTab] = useTab<InfraredTab>(TABS);
  const [isAdding, setAdding] = useState(false);

  const status = useQuery({
    queryKey: INFRARED_QUERY_KEYS.status,
    refetchInterval: REFRESH_MS,

    /**
     * Reads the broker's state.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The state.
     */
    queryFn: async ({ signal }) => fetchInfraredStatus(signal),
  });
  const remotes = useQuery({
    queryKey: INFRARED_QUERY_KEYS.remotes,
    refetchInterval: REFRESH_MS,

    /**
     * Reads the remotes.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The remotes.
     */
    queryFn: async ({ signal }) => fetchInfraredRemotes(signal),
  });
  const blasters = useQuery({
    queryKey: INFRARED_QUERY_KEYS.blasters,
    refetchInterval: REFRESH_MS,

    /**
     * Reads the blasters.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The blasters.
     */
    queryFn: async ({ signal }) => fetchInfraredBlasters(signal),
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

  const current = status.data;
  const state = current === undefined ? null : brokerStateOf(current.state);
  const remoteList = remotes.data ?? [];
  const blasterList = blasters.data ?? [];
  const roomNames = new Map((areas.data ?? []).map((area) => [area.id, area.name]));

  /**
   * The name of a room.
   *
   * @param areaId - The room.
   * @returns Its name, or null.
   */
  const roomOf = (areaId: string | null): string | null =>
    areaId === null ? null : (roomNames.get(areaId) ?? null);
  const hasBlaster = blasterList.some((blaster) => blaster.isOnline);

  return (
    <DetailFrame
      isPending={status.isPending}
      error={status.error}
      hero={
        <DetailHero
          back={<BackLink to="/brokers">{t('brokers.title', 'Brokers')}</BackLink>}
          mark={<BrokerMark broker="infrared" size={56} isLit />}
          title={t('brokers.infrared.name', 'Infrared')}
          description={t(
            'brokers.infrared.description',
            'Remotes the house has learned: each button becomes a button of the house, sent through an IR blaster.',
          )}
          facts={
            current === undefined || state === null ? undefined : (
              <>
                <Pill tone={state.tone}>{state.label}</Pill>
                <HeroFact icon="radio">
                  {t('brokers.infrared.blasterCount', {
                    count: current.blasters.total,
                    defaultValue_one: '{{count}} blaster',
                    defaultValue_other: '{{count}} blasters',
                  })}
                </HeroFact>
              </>
            )
          }
          actions={
            current === undefined || !canWrite ? undefined : (
              <>
                {hasBlaster ? null : (
                  <span className="text-caption text-foreground-subtle">
                    {t('brokers.infrared.addBlasterFirst', 'Add an IR blaster first')}
                  </span>
                )}
                <Button
                  disabled={!hasBlaster}
                  onClick={() => {
                    setAdding(true);
                  }}
                >
                  <AppIcon id="plus" size={15} />
                  {t('brokers.infrared.addRemote', 'Add remote')}
                </Button>
              </>
            )
          }
          tabs={
            <Tabs
              label={t('brokers.infrared.name', 'Infrared')}
              idPrefix="infrared"
              value={tab}
              onChange={setTab}
              items={[
                { id: 'overview', label: t('brokers.infrared.overview', 'Overview') },
                {
                  id: 'remotes',
                  label: t('brokers.infrared.remotes', 'Remotes'),
                  count: remoteList.length,
                },
                {
                  id: 'blasters',
                  label: t('brokers.infrared.blasters', 'Blasters'),
                  count: blasterList.length,
                },
              ]}
            />
          }
        />
      }
    >
      {current === undefined ? null : (
        <>
          {current.state === 'failed' && current.error !== null ? (
            <Note tone="danger">
              {t('brokers.infrared.failed', 'The Infrared broker is not running: {{error}}', {
                error: current.error,
              })}
            </Note>
          ) : null}

          {tab === 'overview' ? (
            <TabPanel idPrefix="infrared" id="overview">
              <InfraredOverview
                status={current}
                remotes={remoteList}
                blasters={blasterList}
                roomOf={roomOf}
                onTab={setTab}
              />
            </TabPanel>
          ) : null}

          {tab === 'remotes' ? (
            <TabPanel idPrefix="infrared" id="remotes">
              <InfraredRemotes remotes={remoteList} blasters={blasterList} roomOf={roomOf} />
            </TabPanel>
          ) : null}

          {tab === 'blasters' ? (
            <TabPanel idPrefix="infrared" id="blasters">
              <InfraredBlasters blasters={blasterList} roomOf={roomOf} />
            </TabPanel>
          ) : null}

          {isAdding ? (
            <AddRemoteDialog
              isOpen
              blasters={blasterList}
              rooms={(areas.data ?? []).filter((area) => area.kind === 'room')}
              roomOf={roomOf}
              onClose={() => {
                setAdding(false);
              }}
            />
          ) : null}
        </>
      )}
    </DetailFrame>
  );
}
