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
import { lazy, Suspense, useState } from 'react';
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
import { toastFailure } from '@/lib/error-message';
import { signalled } from '@/lib/signalled';
import { useTab } from '@/lib/use-tab';
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
  updateBluetoothProxy,
} from '@/library/bluetooth-api';
import { BROKER_QUERY_KEYS, BROKER_REFRESH_MS } from '@/library/brokers-api';
import {
  AddProxyDialog,
  AdapterOffConfirm,
  BluetoothSettingsDialog,
  StopProxyConfirm,
} from '@/routes/library/broker-bluetooth/bluetooth-dialogs';
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
import { useAreas } from '@/routes/library/use-areas';

/** The map, read only when its tab is opened: it brings the graph library with it. */
const BluetoothMapView = lazy(async () =>
  import('@/routes/library/broker-bluetooth/bluetooth-map').then((module) => ({
    default: module.BluetoothMapView,
  })),
);

/** The tabs of the page; the first is the page itself. */
const TABS = ['overview', 'devices', 'map', 'nearby', 'scanners'] as const;

/** One tab. */
type BluetoothTab = (typeof TABS)[number];

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

  const status = useQuery({
    queryKey: BLUETOOTH_QUERY_KEYS.status,
    refetchInterval: BROKER_REFRESH_MS,
    queryFn: signalled(fetchBluetoothStatus),
  });
  const devices = useQuery({
    queryKey: BLUETOOTH_QUERY_KEYS.devices,
    refetchInterval: BROKER_REFRESH_MS,
    queryFn: signalled(fetchBluetoothDevices),
  });
  const found = useQuery({
    queryKey: BLUETOOTH_QUERY_KEYS.found,
    refetchInterval: BROKER_REFRESH_MS,
    queryFn: signalled(fetchBluetoothFound),
  });
  const scanners = useQuery({
    queryKey: BLUETOOTH_QUERY_KEYS.scanners,
    refetchInterval: BROKER_REFRESH_MS,
    queryFn: signalled(fetchBluetoothScanners),
  });
  const map = useQuery({
    queryKey: BLUETOOTH_QUERY_KEYS.map,
    refetchInterval: BROKER_REFRESH_MS,
    queryFn: signalled(fetchBluetoothMap),
    enabled: tab === 'map',
  });
  const nearby = useQuery({
    queryKey: BLUETOOTH_QUERY_KEYS.nearby,
    refetchInterval: BROKER_REFRESH_MS,
    queryFn: signalled(fetchBluetoothNearby),
    enabled: tab === 'nearby',
  });
  const { roomOf } = useAreas();

  /** Reads the broker again. */
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: BROKER_QUERY_KEYS.brokers });
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
    onError: toastFailure(t('brokers.bluetooth.addFailed', 'Couldn’t add the device')),
  });
  const addingAddress = add.isPending ? add.variables.address : undefined;
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
    onError: toastFailure(t('brokers.bluetooth.ignoreFailed', 'Couldn’t change what is ignored')),
  });
  const mode = useMutation({
    /**
     * Changes the local adapter's scan mode, in Settings; proxies scan as the hub decides.
     *
     * @param next - The mode.
     * @returns Where the broker stands.
     */
    mutationFn: async (next: BluetoothScanMode) =>
      saveBluetoothSettings({ ...(status.data?.settings ?? DEFAULTS), localScanMode: next }),
    onSettled: refresh,
    onError: toastFailure(t('brokers.bluetooth.modeFailed', 'Couldn’t change the scan mode')),
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
    onError: toastFailure(t('brokers.bluetooth.adapterFailed', 'Couldn’t change the adapter')),
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
    onError: toastFailure(t('brokers.bluetooth.updateFailed', 'Couldn’t update the script')),
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
    onError: toastFailure(t('brokers.bluetooth.stopFailed', 'Couldn’t remove the script')),
  });

  const current = status.data;
  const state = current === undefined ? null : brokerStateOf(current.state);
  const deviceList = devices.data ?? [];
  const scannerList = scanners.data ?? [];
  const vendorNames = new Map([...vendors].map(([id, vendor]) => [id, vendor.name]));

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
                addingAddress={addingAddress}
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
              <Suspense fallback={null}>
                <BluetoothMapView
                  map={map.data}
                  devices={deviceList}
                  roomOf={roomOf}
                  onAddProxy={openAddProxy}
                />
              </Suspense>
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
                addingAddress={addingAddress}
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
                    ? (next) => {
                        mode.mutate(next);
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
  forgetAfterDays: 7,
  showPrivate: false,
} as const;
