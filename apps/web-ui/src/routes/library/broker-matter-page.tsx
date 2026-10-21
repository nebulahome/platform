/**
 * The house's Matter fabric: how its controller stands, every device commissioned into it, and the
 * way a new one comes in.
 *
 * As the board draws a detail page: the way back, the mark, the name and its line, the state as a
 * Pill and whether the house's network is heard, **Add device** at the top right, then the tabs.
 * Overview is the health strip, the devices added last and what the broker is, with a callout
 * when the controller failed or cannot hear the house's network. Devices is every device of the
 * fabric, a bridge with each device behind it. Add device opens the dialog that takes the pairing
 * code another app shares and follows the commissioning; closing it does not stop it.
 *
 * A node is added to the house the moment it is commissioned: an integration whose rules
 * recognise it takes it, and the platform takes the rest. A device is removed from its own page.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { MatterIdentity, MatterNode, MatterStatus } from '@nebulahome/contracts';
import { AppIcon, Button, DetailHero, HeroFact, Note, Pill, TabPanel, Tabs } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { toMessage } from '@/lib/error-message';
import { useTab } from '@/lib/use-tab';
import { fetchDevices, LIBRARY_QUERY_KEYS } from '@/library/api';
import {
  BROKER_QUERY_KEYS,
  fetchMatterNodes,
  fetchMatterStatus,
  restoreMatterDevice,
} from '@/library/brokers-api';
import { AddMatterDialog } from '@/routes/library/broker-matter/add-dialog';
import { MatterDevices } from '@/routes/library/broker-matter/matter-devices';
import { MatterOverview } from '@/routes/library/broker-matter/matter-overview';
import { everyRow, rowsOf } from '@/routes/library/broker-matter/matter-rows';
import { brokerStateOf, BrokerMark } from '@/routes/library/brokers-page';
import { BackLink, DetailFrame } from '@/routes/library/detail-page';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import { useVendorsById } from '@/routes/library/transport-marks';

/** The tabs of the page; the first is the page itself. */
const TABS = ['overview', 'devices'] as const;

/** One tab. */
type MatterTab = (typeof TABS)[number];

/** How often the fabric is read again, and how often while a device is being commissioned. */
const REFRESH_MS = 10_000;
const COMMISSIONING_REFRESH_MS = 2000;

/**
 * Whether a commissioning is under way: running, or waiting for an answer.
 *
 * @param status - The fabric's state.
 * @returns True while it is.
 */
function isUnderWay(status: MatterStatus | undefined): boolean {
  const state = status?.commissioning?.state;

  return state === 'running' || state === 'needs-answer';
}

/**
 * Renders the Matter broker's page.
 *
 * @returns The page.
 */
export function MatterBrokerPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const can = useSession((state) => state.can);
  const canWrite = can('device:write');
  const [tab, setTab] = useTab<MatterTab>(TABS);
  const [isAdding, setIsAdding] = useState(false);

  const status = useQuery<MatterStatus>({
    queryKey: BROKER_QUERY_KEYS.matterStatus,

    /**
     * Reads the fabric's state, faster while a device is being commissioned.
     *
     * @param query - The query, with what it read last.
     * @returns How often to read it again.
     */
    refetchInterval: (query) =>
      isUnderWay(query.state.data) ? COMMISSIONING_REFRESH_MS : REFRESH_MS,

    /**
     * Reads the fabric's state.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The state.
     */
    queryFn: async ({ signal }) => fetchMatterStatus(signal),
  });
  const isCommissioning = isUnderWay(status.data);

  const nodes = useQuery({
    queryKey: BROKER_QUERY_KEYS.matterNodes,
    refetchInterval: isCommissioning ? COMMISSIONING_REFRESH_MS : REFRESH_MS,

    /**
     * Reads the nodes.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The nodes.
     */
    queryFn: async ({ signal }) => fetchMatterNodes(signal),
  });

  const devices = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.devices,
    refetchInterval: isCommissioning ? COMMISSIONING_REFRESH_MS : REFRESH_MS,

    /**
     * Reads the devices, for the names, rooms and links of those the nodes are.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The devices.
     */
    queryFn: async ({ signal }) => fetchDevices(signal),
  });

  const vendors = useVendorsById();

  /** Reads everything the fabric touches again. */
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['brokers'] });
    void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices });
    void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.vendors });
  };

  const restore = useMutation({
    /**
     * Brings a device back into the house.
     *
     * @param device - The device.
     * @returns Whether it was removed.
     */
    mutationFn: async (device: MatterIdentity) =>
      restoreMatterDevice(device.nodeId, device.endpoint),

    /** Reads everything again. */
    onSettled: refresh,
  });

  const found = status.data;
  const all: readonly MatterNode[] = nodes.data ?? [];
  const rows = rowsOf(all, devices.data ?? [], t('brokers.matter.bridge', 'bridge'));
  const icons = useCatalogueIcons(everyRow(rows).map((row) => row.view?.icon ?? null));
  const vendorNames = new Map([...vendors].map(([id, vendor]) => [id, vendor.name]));
  const state = found === undefined ? null : brokerStateOf(found.state);
  const count = everyRow(rows).filter((row) => !row.device.isRemoved).length;

  return (
    <DetailFrame
      isPending={status.isPending}
      error={status.error}
      hero={
        <DetailHero
          back={<BackLink to="/brokers">{t('brokers.title', 'Brokers')}</BackLink>}
          mark={<BrokerMark size={56} isLit />}
          title={t('library.matterTag', 'Matter')}
          description={t(
            'brokers.matter.description',
            "The house's Matter fabric: every Matter device is reached through it, whoever makes it.",
          )}
          facts={
            found === undefined || state === null ? undefined : (
              <>
                <Pill tone={state.tone}>{state.label}</Pill>
                <HeroFact icon="network">
                  {found.isLanReachable
                    ? t('brokers.matter.localNetwork', 'Local network')
                    : t('brokers.matter.noNetwork', 'Network not heard')}
                </HeroFact>
              </>
            )
          }
          actions={
            canWrite && found?.state === 'running' ? (
              <Button
                onClick={() => {
                  setIsAdding(true);
                }}
              >
                <AppIcon id="plus" size={15} />
                {t('brokers.matter.addDevice', 'Add device')}
              </Button>
            ) : undefined
          }
          tabs={
            <Tabs
              label={t('library.matterTag', 'Matter')}
              idPrefix="matter"
              value={tab}
              onChange={setTab}
              items={[
                { id: 'overview', label: t('brokers.matter.overview', 'Overview') },
                { id: 'devices', label: t('brokers.matter.devices', 'Devices'), count },
              ]}
            />
          }
        />
      }
    >
      {found === undefined ? null : (
        <>
          {found.state === 'failed' && found.error !== null ? (
            <Note tone="danger">
              {t('brokers.matter.failed', 'The Matter controller did not start: {{error}}', {
                error: found.error,
              })}
            </Note>
          ) : null}
          {found.isLanReachable ? null : (
            <Note tone="warning">
              {t(
                'brokers.matter.needsHostNetwork',
                "Matter finds its devices over mDNS and IPv6, which the platform's bridge network does not carry. Run the platform on the host's network (NEBULA_NETWORK=host) for Matter devices to answer.",
              )}
            </Note>
          )}

          {tab === 'overview' ? (
            <TabPanel idPrefix="matter" id="overview">
              <MatterOverview
                status={found}
                rows={rows}
                icons={icons}
                vendors={vendors}
                onSeeDevices={() => {
                  setTab('devices');
                }}
              />
            </TabPanel>
          ) : null}

          {tab === 'devices' ? (
            <TabPanel idPrefix="matter" id="devices">
              <div className="flex flex-col gap-3.5">
                {restore.error === null ? null : (
                  <Note tone="danger">{toMessage(restore.error)}</Note>
                )}
                <MatterDevices
                  rows={rows}
                  icons={icons}
                  vendorNames={vendorNames}
                  isRestoring={restore.isPending}
                  {...(canWrite
                    ? {
                        /**
                         * Adds a device back into the house.
                         *
                         * @param identity - The device.
                         */
                        onRestore: (identity: MatterIdentity) => {
                          restore.mutate(identity);
                        },
                      }
                    : {})}
                />
              </div>
            </TabPanel>
          ) : null}

          {canWrite ? (
            <AddMatterDialog
              isOpen={isAdding}
              job={found.commissioning}
              onClose={() => {
                setIsAdding(false);
                refresh();
              }}
            />
          ) : null}
        </>
      )}
    </DetailFrame>
  );
}
