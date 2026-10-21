/**
 * The house's MQTT broker: how it stands, the devices it hears, who may connect, the devices mapped
 * by hand, and the topics it carries.
 *
 * As the board draws a detail page: the way back, the mark, the name and its line, the state as a
 * Pill and the port, **Add client** and **Settings** at the top right, then the tabs. Overview is
 * the health strip and how a device connects, with a callout when the broker could not listen.
 * Devices is every device it hears, added to the house at once, a removed one offered back.
 * Clients is who may connect; Mappings the devices mapped by hand; Topics the last message of
 * every topic. What a press did - a device added back, a client removed - is said in a toast.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { MqttStatus } from '@nebulahome/contracts';
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
import { LIBRARY_QUERY_KEYS } from '@/library/api';
import {
  BROKER_QUERY_KEYS,
  fetchMqttClients,
  fetchMqttDevices,
  fetchMqttMappings,
  fetchMqttStatus,
  removeMqttClient,
  removeMqttMapping,
  restoreMqttDevice,
} from '@/library/brokers-api';
import { AddClientDialog, MqttClients } from '@/routes/library/broker-mqtt/mqtt-clients';
import { MqttDevices } from '@/routes/library/broker-mqtt/mqtt-devices';
import { MapTopicDialog, MqttMappings } from '@/routes/library/broker-mqtt/mqtt-mappings';
import { MqttOverview } from '@/routes/library/broker-mqtt/mqtt-overview';
import { MqttSettingsDialog } from '@/routes/library/broker-mqtt/mqtt-settings-dialog';
import { MqttTopics } from '@/routes/library/broker-mqtt/mqtt-topics';
import { brokerStateOf, BrokerMark } from '@/routes/library/brokers-page';
import { BackLink, DetailFrame } from '@/routes/library/detail-page';
import { useVendorsById } from '@/routes/library/transport-marks';

/** The tabs of the page; the first is the page itself. */
const TABS = ['overview', 'devices', 'clients', 'mappings', 'topics'] as const;

/** One tab. */
type MqttTab = (typeof TABS)[number];

/** How often the broker is read again. */
const REFRESH_MS = 5000;

/**
 * Renders the MQTT broker's page.
 *
 * @returns The page.
 */
export function MqttBrokerPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const can = useSession((state) => state.can);
  const canConfigure = can('integration:configure');
  const canWrite = can('device:write');
  const canDelete = can('device:delete');
  const [tab, setTab] = useTab<MqttTab>(TABS);
  const [isAddingClient, setIsAddingClient] = useState(false);
  const [isMapping, setIsMapping] = useState(false);
  const [isConfiguring, setIsConfiguring] = useState(false);
  const vendors = useVendorsById();

  const status = useQuery<MqttStatus>({
    queryKey: BROKER_QUERY_KEYS.mqttStatus,
    refetchInterval: REFRESH_MS,

    /**
     * Reads the broker's state.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The state.
     */
    queryFn: async ({ signal }) => fetchMqttStatus(signal),
  });
  const devices = useQuery({
    queryKey: BROKER_QUERY_KEYS.mqttDevices,
    refetchInterval: REFRESH_MS,

    /**
     * Reads the devices the broker hears.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The devices.
     */
    queryFn: async ({ signal }) => fetchMqttDevices(signal),
  });
  const clients = useQuery({
    queryKey: BROKER_QUERY_KEYS.mqttClients,
    refetchInterval: REFRESH_MS,

    /**
     * Reads who may connect.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The usernames, and the connections without one.
     */
    queryFn: async ({ signal }) => fetchMqttClients(signal),
  });
  const mappings = useQuery({
    queryKey: BROKER_QUERY_KEYS.mqttMappings,

    /**
     * Reads the mappings.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns Them.
     */
    queryFn: async ({ signal }) => fetchMqttMappings(signal),
  });

  /** Reads everything the broker touches again. */
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['brokers'] });
    void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices });
  };

  const restore = useMutation({
    mutationFn: restoreMqttDevice,
    onSettled: refresh,

    /** Says it is back. */
    onSuccess: () => {
      toast.success({ title: t('brokers.mqtt.restored', 'Added back to the house') });
    },

    /**
     * Says why it is not.
     *
     * @param error - What failed.
     */
    onError: (error) => {
      toast.error({
        title: t('brokers.mqtt.restoreFailed', 'Couldn’t add the device back'),
        message: toMessage(error),
      });
    },
  });
  const removeClient = useMutation({
    mutationFn: removeMqttClient,
    onSettled: refresh,

    /** Says it is gone. */
    onSuccess: () => {
      toast.success({ title: t('brokers.mqtt.clientRemoved', 'Client removed') });
    },

    /**
     * Says why it is not.
     *
     * @param error - What failed.
     */
    onError: (error) => {
      toast.error({
        title: t('brokers.mqtt.removeClientFailed', 'Couldn’t remove the client'),
        message: toMessage(error),
      });
    },
  });
  const removeMapping = useMutation({
    mutationFn: removeMqttMapping,
    onSettled: refresh,

    /** Says it is gone. */
    onSuccess: () => {
      toast.success({ title: t('brokers.mqtt.mappingRemoved', 'Mapping removed') });
    },

    /**
     * Says why it is not.
     *
     * @param error - What failed.
     */
    onError: (error) => {
      toast.error({
        title: t('brokers.mqtt.removeMappingFailed', 'Couldn’t remove the mapping'),
        message: toMessage(error),
      });
    },
  });

  const found = status.data;
  const state = found === undefined ? null : brokerStateOf(found.state);
  const heard = devices.data ?? [];
  const vendorNames = new Map([...vendors].map(([id, vendor]) => [id, vendor.name]));

  return (
    <DetailFrame
      isPending={status.isPending}
      error={status.error}
      hero={
        <DetailHero
          back={<BackLink to="/brokers">{t('brokers.title', 'Brokers')}</BackLink>}
          mark={<BrokerMark broker="mqtt" size={56} isLit />}
          title={t('brokers.mqtt.title', 'MQTT')}
          description={t(
            'brokers.mqtt.description',
            "The house's MQTT broker: every MQTT device and program of the house meets on it.",
          )}
          facts={
            found === undefined || state === null ? undefined : (
              <>
                <Pill tone={state.tone}>{state.label}</Pill>
                <HeroFact icon="network">
                  {t('brokers.mqtt.tcpPort', 'TCP {{port}}', { port: found.port })}
                </HeroFact>
              </>
            )
          }
          actions={
            canConfigure && found !== undefined ? (
              <>
                {found.state === 'running' ? (
                  <Button
                    onClick={() => {
                      setIsAddingClient(true);
                    }}
                  >
                    <AppIcon id="plus" size={15} />
                    {t('brokers.mqtt.addClientButton', 'Add client')}
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  onClick={() => {
                    setIsConfiguring(true);
                  }}
                >
                  <AppIcon id="settings" size={15} />
                  {t('brokers.mqtt.settings', 'Settings')}
                </Button>
              </>
            ) : undefined
          }
          tabs={
            <Tabs
              label={t('brokers.mqtt.title', 'MQTT')}
              idPrefix="mqtt"
              value={tab}
              onChange={setTab}
              items={[
                { id: 'overview', label: t('brokers.mqtt.overview', 'Overview') },
                {
                  id: 'devices',
                  label: t('brokers.mqtt.devices', 'Devices'),
                  count: heard.filter((device) => !device.isRemoved).length,
                },
                {
                  id: 'clients',
                  label: t('brokers.mqtt.clients', 'Clients'),
                  count: clients.data?.items.length ?? 0,
                },
                {
                  id: 'mappings',
                  label: t('brokers.mqtt.mappings', 'Mappings'),
                  count: mappings.data?.length ?? 0,
                },
                { id: 'topics', label: t('brokers.mqtt.topics', 'Topics') },
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
              {t('brokers.mqtt.failed', 'The MQTT broker is not listening: {{error}}', {
                error: found.error,
              })}
            </Note>
          ) : null}

          {tab === 'overview' ? (
            <TabPanel idPrefix="mqtt" id="overview">
              <MqttOverview
                status={found}
                onSeeDevices={() => {
                  setTab('devices');
                }}
              />
            </TabPanel>
          ) : null}

          {tab === 'devices' ? (
            <TabPanel idPrefix="mqtt" id="devices">
              <div className="flex flex-col gap-3.5">
                <MqttDevices
                  devices={heard}
                  vendorNames={vendorNames}
                  isRestoring={restore.isPending}
                  {...(canWrite
                    ? {
                        /**
                         * Adds a device back into the house.
                         *
                         * @param deviceKey - The device.
                         */
                        onRestore: (deviceKey: string) => {
                          restore.mutate(deviceKey);
                        },
                      }
                    : {})}
                />
              </div>
            </TabPanel>
          ) : null}

          {tab === 'clients' ? (
            <TabPanel idPrefix="mqtt" id="clients">
              <MqttClients
                items={clients.data?.items ?? []}
                anonymous={clients.data?.anonymous ?? []}
                {...(canConfigure
                  ? {
                      /**
                       * Removes a device's client.
                       *
                       * @param username - Which.
                       */
                      onRemove: (username: string) => {
                        removeClient.mutate(username);
                      },
                    }
                  : {})}
              />
            </TabPanel>
          ) : null}

          {tab === 'mappings' ? (
            <TabPanel idPrefix="mqtt" id="mappings">
              <div className="flex flex-col gap-3.5">
                {canWrite ? (
                  <Button
                    variant="ghost"
                    className="self-end"
                    onClick={() => {
                      setIsMapping(true);
                    }}
                  >
                    <AppIcon id="plus" size={15} />
                    {t('brokers.mqtt.mapTopic', 'Map a topic')}
                  </Button>
                ) : null}
                <MqttMappings
                  mappings={mappings.data ?? []}
                  {...(canDelete
                    ? {
                        /**
                         * Removes a mapping and its device.
                         *
                         * @param id - Which.
                         */
                        onRemove: (id: string) => {
                          removeMapping.mutate(id);
                        },
                      }
                    : {})}
                />
              </div>
            </TabPanel>
          ) : null}

          {tab === 'topics' ? (
            <TabPanel idPrefix="mqtt" id="topics">
              <MqttTopics />
            </TabPanel>
          ) : null}

          {canConfigure ? (
            <MqttSettingsDialog
              key={String(isConfiguring)}
              isOpen={isConfiguring}
              saved={found.settings}
              onClose={() => {
                setIsConfiguring(false);
              }}
            />
          ) : null}
          {canConfigure ? (
            <AddClientDialog
              isOpen={isAddingClient}
              port={found.port}
              onClose={() => {
                setIsAddingClient(false);
              }}
              onAdded={refresh}
            />
          ) : null}
          {canWrite ? (
            <MapTopicDialog
              isOpen={isMapping}
              onClose={() => {
                setIsMapping(false);
              }}
              onSaved={refresh}
            />
          ) : null}
        </>
      )}
    </DetailFrame>
  );
}
