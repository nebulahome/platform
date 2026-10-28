/**
 * The house's Bluetooth broker: this server's adapter, the proxies that listen for the house, and
 * what they hear.
 *
 * As the boards draw a broker: the way back, the lit mark, the name and its line, the state and
 * how many adapters and proxies, **Settings** and **Add proxy** top right, then Overview, Devices,
 * Map, Nearby and Scanners. Proxies only listen: only the adapter can connect to a device, and the
 * page keeps that difference visible.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import type { BluetoothScanMode, BluetoothScanner } from '@nebulahome/contracts';
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
  addBluetoothDevice,
  BLUETOOTH_QUERY_KEYS,
  fetchBluetoothDevices,
  fetchBluetoothFound,
  fetchBluetoothMap,
  fetchBluetoothNearby,
  fetchBluetoothScanners,
  fetchBluetoothStatus,
  ignoreBluetooth,
  removeBluetoothProxy,
  saveBluetoothSettings,
  setBluetoothProxyMode,
  updateBluetoothProxy,
} from '@/library/bluetooth-api';
import {
  AddProxyDialog,
  AdapterOffConfirm,
  BluetoothSettingsDialog,
  StopProxyConfirm,
} from '@/routes/library/broker-bluetooth/bluetooth-dialogs';
import { BluetoothMapView } from '@/routes/library/broker-bluetooth/bluetooth-map';
import { BluetoothNearbyView } from '@/routes/library/broker-bluetooth/bluetooth-nearby';
import {
  BluetoothDevices,
  BluetoothOverview,
  BluetoothScanners,
} from '@/routes/library/broker-bluetooth/bluetooth-tabs';
import { brokerStateOf, BrokerMark } from '@/routes/library/brokers-page';
import { BackLink, DetailFrame } from '@/routes/library/detail-page';
import { devicePath } from '@/routes/library/device/device-path';
import { useVendorsById } from '@/routes/library/transport-marks';

/** The tabs of the page; the first is the page itself. */
const TABS = ['overview', 'devices', 'map', 'nearby', 'scanners'] as const;

/** One tab. */
type BluetoothTab = (typeof TABS)[number];

/** How often the broker is read again. */
const REFRESH_MS = 5000;

/** What the page's gallery samples change. */
export type BluetoothBrokerPageProps = {
  /** Whether Nearby holds the lease that makes proxies forward everything; true but in the gallery. */
  readonly holdsLease?: boolean;

  /** A Nearby row open at first, for the gallery. */
  readonly openAddress?: string;
};

/**
 * Renders the Bluetooth broker's page.
 *
 * @param props - See {@link BluetoothBrokerPageProps}.
 * @returns The page.
 */
export function BluetoothBrokerPage(props: BluetoothBrokerPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const can = useSession((state) => state.can);
  const canConfigure = can('integration:configure');
  const canWrite = can('device:write');
  const [tab, setTab] = useTab<BluetoothTab>(TABS);
  const [isAddingProxy, setAddingProxy] = useState(false);
  const [isConfiguring, setConfiguring] = useState(false);
  const [stopping, setStopping] = useState<BluetoothScanner | null>(null);
  const [isTurningOff, setTurningOff] = useState(false);
  const vendors = useVendorsById();

  /**
   * One of the broker's lists, read again with the page.
   *
   * @param key - Its cache key.
   * @param read - Reads it.
   * @param isPolled - Whether it is read again every few seconds.
   * @returns The query's options.
   */
  const listOf = <TData,>(
    key: readonly string[],
    read: (signal: AbortSignal) => Promise<TData>,
    isPolled = true,
  ) => ({
    queryKey: key,
    refetchInterval: isPolled ? REFRESH_MS : (false as const),

    /**
     * Reads it.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns It.
     */
    queryFn: async ({ signal }: { readonly signal: AbortSignal }) => read(signal),
  });

  const status = useQuery(listOf(BLUETOOTH_QUERY_KEYS.status, fetchBluetoothStatus));
  const devices = useQuery(listOf(BLUETOOTH_QUERY_KEYS.devices, fetchBluetoothDevices));
  const found = useQuery(listOf(BLUETOOTH_QUERY_KEYS.found, fetchBluetoothFound));
  const scanners = useQuery(listOf(BLUETOOTH_QUERY_KEYS.scanners, fetchBluetoothScanners));
  const map = useQuery({
    ...listOf(BLUETOOTH_QUERY_KEYS.map, fetchBluetoothMap),
    enabled: tab === 'map',
  });
  const nearby = useQuery({
    ...listOf(BLUETOOTH_QUERY_KEYS.nearby, fetchBluetoothNearby),
    enabled: tab === 'nearby',
  });
  const areas = useQuery(listOf(LIBRARY_QUERY_KEYS.areas, fetchAreas, false));

  /** Reads the broker again. */
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['brokers'] });
  };

  /**
   * Says why something did not happen.
   *
   * @param title - What did not.
   * @returns The handler.
   */
  const failed =
    (title: string) =>
    (error: Error): void => {
      toast.error({ title, message: toMessage(error) });
    };

  const add = useMutation({
    /**
     * Adds a device heard to the house.
     *
     * @param request - Its address, and the driver when several recognise it.
     * @param request.address - The address.
     * @param request.kind - The driver.
     * @returns Its id.
     */
    mutationFn: async (request: { readonly address: string; readonly kind: string | null }) =>
      addBluetoothDevice(request.address, request.kind ?? undefined),
    onSettled: refresh,

    /**
     * Opens it.
     *
     * @param deviceId - The device.
     */
    onSuccess: (deviceId) => {
      void navigate(devicePath(deviceId));
    },
    onError: failed(t('brokers.bluetooth.addFailed', 'Couldn’t add the device')),
  });
  const ignore = useMutation({
    /**
     * Ignores an address, or stops.
     *
     * @param request - The address, and whether to ignore it.
     * @param request.address - The address.
     * @param request.isIgnored - Whether to ignore it.
     * @returns How many are ignored.
     */
    mutationFn: async (request: { readonly address: string; readonly isIgnored: boolean }) =>
      ignoreBluetooth(request.address, request.isIgnored),
    onSettled: refresh,
    onError: failed(t('brokers.bluetooth.ignoreFailed', 'Couldn’t change what is ignored')),
  });
  const mode = useMutation({
    /**
     * Changes a scanner's scan mode: a proxy's own, or the adapter's in Settings.
     *
     * @param request - The scanner and the mode.
     * @param request.scanner - The scanner.
     * @param request.mode - The mode.
     * @returns Once changed.
     */
    mutationFn: async (request: {
      readonly scanner: BluetoothScanner;
      readonly mode: BluetoothScanMode;
    }) =>
      request.scanner.kind === 'proxy'
        ? setBluetoothProxyMode(request.scanner.deviceId ?? '', request.mode)
        : saveBluetoothSettings({
            ...(status.data?.settings ?? DEFAULTS),
            localScanMode: request.mode,
          }),
    onSettled: refresh,
    onError: failed(t('brokers.bluetooth.modeFailed', 'Couldn’t change the scan mode')),
  });
  const adapter = useMutation({
    /**
     * Turns the server's adapter on or off.
     *
     * @param isOn - Whether to use it.
     * @returns Where the broker stands.
     */
    mutationFn: async (isOn: boolean) =>
      saveBluetoothSettings({ ...(status.data?.settings ?? DEFAULTS), localEnabled: isOn }),
    onSettled: refresh,

    /** Closes the confirmation. */
    onSuccess: () => {
      setTurningOff(false);
    },
    onError: failed(t('brokers.bluetooth.adapterFailed', 'Couldn’t change the adapter')),
  });
  const update = useMutation({
    /**
     * Updates a proxy's script.
     *
     * @param scanner - The proxy.
     * @returns The job.
     */
    mutationFn: async (scanner: BluetoothScanner) => updateBluetoothProxy(scanner.deviceId ?? ''),
    onSettled: refresh,

    /** Says it is under way. */
    onSuccess: () => {
      toast.success({ title: t('brokers.bluetooth.updating', 'Updating the script') });
    },
    onError: failed(t('brokers.bluetooth.updateFailed', 'Couldn’t update the script')),
  });
  const stop = useMutation({
    /**
     * Stops a device being a proxy.
     *
     * @param scanner - The proxy.
     * @returns Once its script is removed.
     */
    mutationFn: async (scanner: BluetoothScanner) => removeBluetoothProxy(scanner.deviceId ?? ''),
    onSettled: refresh,

    /** Closes the confirmation. */
    onSuccess: () => {
      setStopping(null);
    },
    onError: failed(t('brokers.bluetooth.stopFailed', 'Couldn’t remove the script')),
  });

  const current = status.data;
  const state = current === undefined ? null : brokerStateOf(current.state);
  const deviceList = devices.data ?? [];
  const scannerList = scanners.data ?? [];
  const vendorNames = new Map([...vendors].map(([id, vendor]) => [id, vendor.name]));
  const roomNames = new Map((areas.data ?? []).map((area) => [area.id, area.name]));

  /**
   * The name of a room.
   *
   * @param areaId - The room.
   * @returns Its name, or null.
   */
  const roomOf = (areaId: string | null): string | null =>
    areaId === null ? null : (roomNames.get(areaId) ?? null);
  const openAddProxy = canConfigure
    ? () => {
        setAddingProxy(true);
      }
    : undefined;

  return (
    <DetailFrame
      isPending={status.isPending}
      error={status.error}
      hero={
        <DetailHero
          back={<BackLink to="/brokers">{t('brokers.title', 'Brokers')}</BackLink>}
          mark={<BrokerMark broker="bluetooth" size={56} isLit />}
          title={t('brokers.bluetooth.name', 'Bluetooth')}
          description={t(
            'brokers.bluetooth.description',
            'The house’s Bluetooth: this server’s adapter, the devices that listen for it, and what they hear.',
          )}
          facts={
            current === undefined || state === null ? undefined : (
              <>
                <Pill tone={state.tone}>{state.label}</Pill>
                <HeroFact icon="bluetooth">
                  {t('brokers.bluetooth.adaptersProxies', '{{adapters}} · {{proxies}}', {
                    adapters: t('brokers.bluetooth.adapterCount', {
                      count: current.adapter === null ? 0 : 1,
                      defaultValue_one: '{{count}} adapter',
                      defaultValue_other: '{{count}} adapters',
                    }),
                    proxies: t('brokers.bluetooth.proxyCount', {
                      count: current.proxies.total,
                      defaultValue_one: '{{count}} proxy',
                      defaultValue_other: '{{count}} proxies',
                    }),
                  })}
                </HeroFact>
              </>
            )
          }
          actions={
            current === undefined ? undefined : (
              <>
                {canConfigure ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setConfiguring(true);
                    }}
                  >
                    <AppIcon id="settings" size={15} />
                    {t('brokers.bluetooth.openSettings', 'Settings')}
                  </Button>
                ) : null}
                {openAddProxy === undefined ? null : (
                  <Button onClick={openAddProxy}>
                    <AppIcon id="plus" size={15} />
                    {t('brokers.bluetooth.addProxy', 'Add proxy')}
                  </Button>
                )}
              </>
            )
          }
          tabs={
            <Tabs
              label={t('brokers.bluetooth.name', 'Bluetooth')}
              idPrefix="bluetooth"
              value={tab}
              onChange={setTab}
              items={[
                { id: 'overview', label: t('brokers.bluetooth.overview', 'Overview') },
                {
                  id: 'devices',
                  label: t('brokers.bluetooth.devices', 'Devices'),
                  count: deviceList.length,
                },
                { id: 'map', label: t('brokers.bluetooth.map.tab', 'Map') },
                {
                  id: 'nearby',
                  label: t('brokers.bluetooth.nearby.tab', 'Nearby'),
                  count: current?.heard.devices ?? 0,
                },
                {
                  id: 'scanners',
                  label: t('brokers.bluetooth.scanners', 'Scanners'),
                  count: scannerList.length,
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
              {t('brokers.bluetooth.failed', 'The Bluetooth broker is not running: {{error}}', {
                error: current.error,
              })}
            </Note>
          ) : null}

          {tab === 'overview' ? (
            <TabPanel idPrefix="bluetooth" id="overview">
              <BluetoothOverview
                status={current}
                devices={deviceList}
                found={found.data?.items ?? []}
                ignored={found.data?.ignored ?? []}
                vendorNames={vendorNames}
                roomOf={roomOf}
                onScanners={() => {
                  setTab('scanners');
                }}
                onAddProxy={openAddProxy}
                onAdd={
                  canWrite
                    ? (each) => {
                        add.mutate({ address: each.address, kind: each.claims[0]?.kind ?? null });
                      }
                    : undefined
                }
                onIgnore={
                  canWrite
                    ? (address, isIgnored) => {
                        ignore.mutate({ address, isIgnored });
                      }
                    : undefined
                }
              />
            </TabPanel>
          ) : null}

          {tab === 'devices' ? (
            <TabPanel idPrefix="bluetooth" id="devices">
              <BluetoothDevices devices={deviceList} vendorNames={vendorNames} roomOf={roomOf} />
            </TabPanel>
          ) : null}

          {tab === 'map' ? (
            <TabPanel idPrefix="bluetooth" id="map">
              <BluetoothMapView
                map={map.data}
                devices={deviceList}
                roomOf={roomOf}
                onAddProxy={openAddProxy}
              />
            </TabPanel>
          ) : null}

          {tab === 'nearby' ? (
            <TabPanel idPrefix="bluetooth" id="nearby">
              <BluetoothNearbyView
                items={nearby.data ?? []}
                scanners={scannerList}
                isForwardingAll={current.isForwardingAll}
                holdsLease={props.holdsLease ?? true}
                {...(props.openAddress === undefined ? {} : { openAddress: props.openAddress })}
                onAdd={
                  canWrite
                    ? (item) => {
                        add.mutate({ address: item.address, kind: item.claims[0]?.kind ?? null });
                      }
                    : undefined
                }
                onIgnore={
                  canWrite
                    ? (item) => {
                        ignore.mutate({ address: item.address, isIgnored: true });
                      }
                    : undefined
                }
              />
            </TabPanel>
          ) : null}

          {tab === 'scanners' ? (
            <TabPanel idPrefix="bluetooth" id="scanners">
              <BluetoothScanners
                scanners={scannerList}
                vendorNames={vendorNames}
                roomOf={roomOf}
                onMode={
                  canConfigure
                    ? (scanner, next) => {
                        mode.mutate({ scanner, mode: next });
                      }
                    : undefined
                }
                onAdapter={
                  canConfigure
                    ? (isOn) => {
                        if (isOn) {
                          adapter.mutate(true);
                        } else {
                          setTurningOff(true);
                        }
                      }
                    : undefined
                }
                onUpdate={
                  canConfigure
                    ? (scanner) => {
                        update.mutate(scanner);
                      }
                    : undefined
                }
                onStop={canConfigure ? setStopping : undefined}
              />
            </TabPanel>
          ) : null}

          {isAddingProxy ? (
            <AddProxyDialog
              roomOf={roomOf}
              defaultMode={current.settings.proxyScanMode}
              onClose={() => {
                setAddingProxy(false);
              }}
            />
          ) : null}
          {isConfiguring ? (
            <BluetoothSettingsDialog
              status={current}
              onClose={() => {
                setConfiguring(false);
              }}
            />
          ) : null}
          <AdapterOffConfirm
            isOpen={isTurningOff}
            isBusy={adapter.isPending}
            onClose={() => {
              setTurningOff(false);
            }}
            onConfirm={() => {
              adapter.mutate(false);
            }}
          />
          <StopProxyConfirm
            name={stopping?.name ?? null}
            isBusy={stop.isPending}
            onClose={() => {
              setStopping(null);
            }}
            onConfirm={() => {
              if (stopping !== null) {
                stop.mutate(stopping);
              }
            }}
          />
        </>
      )}
    </DetailFrame>
  );
}

/** The settings a broker that has not answered yet is changed from. */
const DEFAULTS = {
  localEnabled: true,
  adapterId: null,
  localScanMode: 'active',
  proxyScanMode: 'passive',
  forgetAfterDays: 7,
  showPrivate: false,
} as const;
