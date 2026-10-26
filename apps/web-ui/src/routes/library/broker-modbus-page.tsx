/**
 * The house's Modbus broker: the hub's Modbus TCP client, the gateways and devices it reads, the
 * network search, and the templates that say what a device's registers mean.
 *
 * As the board draws a detail page: the way back, the mark, the name and its line, the state and
 * `Modbus TCP`, **Add device** and **Settings** at the top right, then the tabs. Overview is the
 * health strip and the gateways with their devices; Devices every device in a table; Discovery how
 * the network search went and what it found; Templates the owner's and the integrations'. The
 * template editor is a page of its own (`broker-modbus/template-editor`).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import type {
  ModbusDevice,
  ModbusFound,
  ModbusTemplate,
  ModbusTemplateRecord,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  DetailHero,
  HeroFact,
  Modal,
  Note,
  Pill,
  TabPanel,
  Tabs,
  toast,
} from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { toMessage } from '@/lib/error-message';
import { useTab } from '@/lib/use-tab';
import { fetchAreas, fetchDevices, LIBRARY_QUERY_KEYS } from '@/library/api';
import {
  fetchModbusDevices,
  fetchModbusFound,
  fetchModbusStatus,
  fetchModbusTemplates,
  ignoreModbus,
  MODBUS_QUERY_KEYS,
  removeModbusDevice,
  removeModbusTemplate,
  saveModbusTemplate,
  searchModbus,
} from '@/library/modbus-api';
import { ModbusAddDialog } from '@/routes/library/broker-modbus/modbus-add-dialog';
import { ModbusDevices } from '@/routes/library/broker-modbus/modbus-devices';
import { ModbusDiscovery } from '@/routes/library/broker-modbus/modbus-discovery';
import { ModbusOverview } from '@/routes/library/broker-modbus/modbus-overview';
import { ModbusSettingsDialog } from '@/routes/library/broker-modbus/modbus-settings-dialog';
import { ModbusTemplates } from '@/routes/library/broker-modbus/modbus-templates';
import { brokerStateOf, BrokerMark } from '@/routes/library/brokers-page';
import { BackLink, DetailFrame } from '@/routes/library/detail-page';
import { useVendorsById } from '@/routes/library/transport-marks';

/** The tabs of the page; the first is the page itself. */
const TABS = ['overview', 'devices', 'discovery', 'templates'] as const;

/** One tab. */
type ModbusTab = (typeof TABS)[number];

/** How often the broker is read again. */
const REFRESH_MS = 5000;

/**
 * Renders the Modbus broker's page.
 *
 * @returns The page.
 */
export function ModbusBrokerPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const can = useSession((state) => state.can);
  const canConfigure = can('integration:configure');
  const canWrite = can('device:write');
  const canDelete = can('device:delete');
  const [tab, setTab] = useTab<ModbusTab>(TABS);
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [adding, setAdding] = useState<{ readonly found: ModbusFound | null } | null>(null);
  const [removing, setRemoving] = useState<ModbusDevice | null>(null);
  const vendors = useVendorsById();

  const status = useQuery({
    queryKey: MODBUS_QUERY_KEYS.status,
    refetchInterval: REFRESH_MS,

    /**
     * Reads the broker's state.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The state.
     */
    queryFn: async ({ signal }) => fetchModbusStatus(signal),
  });
  const devices = useQuery({
    queryKey: MODBUS_QUERY_KEYS.devices,
    refetchInterval: REFRESH_MS,

    /**
     * Reads the devices.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The devices.
     */
    queryFn: async ({ signal }) => fetchModbusDevices(signal),
  });
  const templates = useQuery({
    queryKey: MODBUS_QUERY_KEYS.templates,

    /**
     * Reads the templates.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The templates.
     */
    queryFn: async ({ signal }) => fetchModbusTemplates(signal),
  });
  const found = useQuery({
    queryKey: MODBUS_QUERY_KEYS.found,
    refetchInterval: REFRESH_MS,

    /**
     * Reads the servers found.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns Them, and those ignored.
     */
    queryFn: async ({ signal }) => fetchModbusFound(signal),
  });
  const houseDevices = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.devices,

    /**
     * Reads the house's devices, for each device's room.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The devices.
     */
    queryFn: async ({ signal }) => fetchDevices(signal),
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

  /** Reads everything the broker touches again. */
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['brokers'] });
    void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices });
  };

  const remove = useMutation({
    /**
     * Removes a device from the house.
     *
     * @param device - Which.
     * @returns Once removed.
     */
    mutationFn: async (device: ModbusDevice) => removeModbusDevice(device.id),
    onSettled: refresh,

    /** Says it is gone. */
    onSuccess: () => {
      toast.success({ title: t('brokers.modbus.removed', 'Device removed') });
      setRemoving(null);
    },

    /**
     * Says why it is not.
     *
     * @param error - What failed.
     */
    onError: (error) => {
      toast.error({
        title: t('brokers.modbus.removeFailed', 'Couldn’t remove the device'),
        message: toMessage(error),
      });
    },
  });
  const ignore = useMutation({
    mutationFn: ignoreModbus,
    onSettled: refresh,

    /**
     * Says why it is not.
     *
     * @param error - What failed.
     */
    onError: (error) => {
      toast.error({
        title: t('brokers.modbus.ignoreFailed', 'Couldn’t change what is ignored'),
        message: toMessage(error),
      });
    },
  });
  const search = useMutation({
    mutationFn: searchModbus,
    onSettled: refresh,

    /**
     * Says why it is not searching.
     *
     * @param error - What failed.
     */
    onError: (error) => {
      toast.error({
        title: t('brokers.modbus.searchFailed', 'Couldn’t search the network'),
        message: toMessage(error),
      });
    },
  });
  const create = useMutation({
    /**
     * Saves a template as a new one of the owner's.
     *
     * @param document - The template.
     * @returns It, saved.
     */
    mutationFn: async (document: ModbusTemplate) => saveModbusTemplate({ id: undefined, document }),
    onSettled: refresh,

    /**
     * Opens it in the editor.
     *
     * @param saved - The template saved.
     */
    onSuccess: (saved) => {
      void navigate(`/brokers/modbus/templates/${saved.id}`);
    },

    /**
     * Says why it is not.
     *
     * @param error - What failed.
     */
    onError: (error) => {
      toast.error({
        title: t('brokers.modbus.createFailed', 'Couldn’t save the template'),
        message: toMessage(error),
      });
    },
  });
  const removeTemplate = useMutation({
    /**
     * Removes one of the owner's templates.
     *
     * @param template - Which.
     * @returns Once removed.
     */
    mutationFn: async (template: ModbusTemplateRecord) => removeModbusTemplate(template.id),
    onSettled: refresh,

    /** Says it is gone. */
    onSuccess: () => {
      toast.success({ title: t('brokers.modbus.templateRemoved', 'Template removed') });
    },

    /**
     * Says why it is not.
     *
     * @param error - What failed.
     */
    onError: (error) => {
      toast.error({
        title: t('brokers.modbus.removeTemplateFailed', 'Couldn’t remove the template'),
        message: toMessage(error),
      });
    },
  });

  const current = status.data;
  const state = current === undefined ? null : brokerStateOf(current.state);
  const list = devices.data ?? [];
  const vendorNames = new Map([...vendors].map(([id, vendor]) => [id, vendor.name]));
  const roomNames = new Map((areas.data ?? []).map((area) => [area.id, area.name]));

  /**
   * The room a device of the house is in.
   *
   * @param deviceId - The device, once it is in the house.
   * @returns The room's name, or null.
   */
  const areaOf = (deviceId: string | null): string | null => {
    const areaId = houseDevices.data?.find((device) => device.id === deviceId)?.areaId ?? null;

    return areaId === null ? null : (roomNames.get(areaId) ?? null);
  };

  /**
   * Opens the add dialog at a server found.
   *
   * @param server - The server.
   */
  const addFound = (server: ModbusFound): void => {
    setAdding({ found: server });
  };

  /**
   * Ignores a server found.
   *
   * @param server - The server.
   */
  const ignoreFound = (server: ModbusFound): void => {
    ignore.mutate({ host: server.host, port: server.port, isIgnored: true });
  };

  return (
    <DetailFrame
      isPending={status.isPending}
      error={status.error}
      hero={
        <DetailHero
          back={<BackLink to="/brokers">{t('brokers.title', 'Brokers')}</BackLink>}
          mark={<BrokerMark broker="modbus" size={56} isLit />}
          title={t('brokers.modbus.title', 'Modbus')}
          description={t(
            'brokers.modbus.description',
            'The house’s Modbus TCP client: every gateway is reached through one connection, whoever’s devices are behind it.',
          )}
          facts={
            current === undefined || state === null ? undefined : (
              <>
                <Pill tone={state.tone}>{state.label}</Pill>
                <HeroFact icon="network">{t('brokers.modbus.modbusTcp', 'Modbus TCP')}</HeroFact>
              </>
            )
          }
          actions={
            current === undefined ? undefined : (
              <>
                {canWrite ? (
                  <Button
                    onClick={() => {
                      setAdding({ found: null });
                    }}
                  >
                    <AppIcon id="plus" size={15} />
                    {t('brokers.modbus.addDevice', 'Add device')}
                  </Button>
                ) : null}
                {canConfigure ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setIsConfiguring(true);
                    }}
                  >
                    <AppIcon id="settings" size={15} />
                    {t('brokers.modbus.settings', 'Settings')}
                  </Button>
                ) : null}
              </>
            )
          }
          tabs={
            <Tabs
              label={t('brokers.modbus.title', 'Modbus')}
              idPrefix="modbus"
              value={tab}
              onChange={setTab}
              items={[
                { id: 'overview', label: t('brokers.modbus.overview', 'Overview') },
                {
                  id: 'devices',
                  label: t('brokers.modbus.devices', 'Devices'),
                  count: list.length,
                },
                {
                  id: 'discovery',
                  label: t('brokers.modbus.discovery', 'Discovery'),
                  count: found.data?.items.length ?? 0,
                },
                {
                  id: 'templates',
                  label: t('brokers.modbus.templates', 'Templates'),
                  count: templates.data?.length ?? 0,
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
              {t('brokers.modbus.failed', 'The Modbus client is not running: {{error}}', {
                error: current.error,
              })}
            </Note>
          ) : null}

          {tab === 'overview' ? (
            <TabPanel idPrefix="modbus" id="overview">
              <ModbusOverview
                status={current}
                devices={list}
                found={found.data?.items ?? []}
                areaOf={areaOf}
                vendorNames={vendorNames}
                onAdd={canWrite ? addFound : undefined}
                onIgnore={canWrite ? ignoreFound : undefined}
              />
            </TabPanel>
          ) : null}

          {tab === 'devices' ? (
            <TabPanel idPrefix="modbus" id="devices">
              <ModbusDevices
                devices={list}
                areaOf={areaOf}
                vendorNames={vendorNames}
                onRemove={canDelete ? setRemoving : undefined}
              />
            </TabPanel>
          ) : null}

          {tab === 'discovery' ? (
            <TabPanel idPrefix="modbus" id="discovery">
              <ModbusDiscovery
                status={current}
                found={found.data?.items ?? []}
                ignored={found.data?.ignored ?? []}
                devices={list}
                isSearching={search.isPending}
                onSettings={
                  canConfigure
                    ? () => {
                        setIsConfiguring(true);
                      }
                    : undefined
                }
                onSearch={
                  canConfigure
                    ? () => {
                        search.mutate();
                      }
                    : undefined
                }
                onAdd={canWrite ? addFound : undefined}
                onIgnore={
                  canWrite
                    ? (host, port, isIgnored) => {
                        ignore.mutate({ host, port, isIgnored });
                      }
                    : undefined
                }
                onSeeDevices={() => {
                  setTab('devices');
                }}
              />
            </TabPanel>
          ) : null}

          {tab === 'templates' ? (
            <TabPanel idPrefix="modbus" id="templates">
              <ModbusTemplates
                templates={templates.data ?? []}
                onCreate={
                  canWrite
                    ? (document) => {
                        create.mutate(document);
                      }
                    : undefined
                }
                onRemove={
                  canWrite
                    ? (template) => {
                        removeTemplate.mutate(template);
                      }
                    : undefined
                }
              />
            </TabPanel>
          ) : null}

          {canConfigure ? (
            <ModbusSettingsDialog
              key={String(isConfiguring)}
              isOpen={isConfiguring}
              saved={current.settings}
              lastRun={current.search.lastRun}
              onClose={() => {
                setIsConfiguring(false);
              }}
            />
          ) : null}
          {canWrite && adding !== null ? (
            <ModbusAddDialog
              isOpen
              found={adding.found}
              templates={templates.data ?? []}
              onClose={() => {
                setAdding(null);
              }}
              onAdded={refresh}
            />
          ) : null}
          <Modal
            isOpen={removing !== null}
            onClose={() => {
              setRemoving(null);
            }}
            size="small"
            title={t('brokers.modbus.removeTitle', 'Remove {{name}}?', {
              name: removing?.name ?? '',
            })}
            description={t(
              'brokers.modbus.removeLine',
              'Its entities leave the house, and the automations that use them stop finding them.',
            )}
            footer={
              <>
                <Button
                  variant="bare"
                  onClick={() => {
                    setRemoving(null);
                  }}
                >
                  {t('common.cancel', 'Cancel')}
                </Button>
                <Button
                  variant="danger"
                  isBusy={remove.isPending}
                  onClick={() => {
                    if (removing !== null) {
                      remove.mutate(removing);
                    }
                  }}
                >
                  {t('brokers.modbus.remove', 'Remove')}
                </Button>
              </>
            }
          >
            {null}
          </Modal>
        </>
      )}
    </DetailFrame>
  );
}
