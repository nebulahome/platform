/**
 * The house's Serial broker: the serial ports the server sees - USB adapters, built-in RS-232/485,
 * ports on the network - and who holds each one.
 *
 * As the boards draw a broker: the way back, the lit mark, the name and its line, the state and
 * how many ports are in use, **Add network port** and **Settings** top right - no primary button,
 * since devices are added from a port (Use with…), not from nothing - then Overview, Ports and
 * Devices. Release, Forget and the Console are a port's menu.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import type { IntegrationVendorView, SerialLine, SerialPort } from '@nebulahome/contracts';
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
  type MenuItem,
} from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { toMessage } from '@/lib/error-message';
import { useTab } from '@/lib/use-tab';
import { fetchAreas, fetchDevices, LIBRARY_QUERY_KEYS } from '@/library/api';
import {
  fetchSerialDevices,
  fetchSerialPorts,
  fetchSerialStatus,
  forgetSerialPort,
  ignoreSerialPort,
  releaseSerialPort,
  SERIAL_QUERY_KEYS,
} from '@/library/serial-api';
import {
  ConsoleDialog,
  NetworkPortDialog,
  SerialSettingsDialog,
  UseWithDialog,
} from '@/routes/library/broker-serial/serial-dialogs';
import {
  SerialDevices,
  SerialOverview,
  SerialPorts,
} from '@/routes/library/broker-serial/serial-tabs';
import { brokerStateOf, BrokerMark } from '@/routes/library/brokers-page';
import { BackLink, DetailFrame } from '@/routes/library/detail-page';
import { devicePath } from '@/routes/library/device/device-path';
import { DeviceDialog } from '@/routes/library/device-dialog';
import { useVendorsById } from '@/routes/library/transport-marks';

/** The tabs of the page; the first is the page itself. */
const TABS = ['overview', 'ports', 'devices'] as const;

/** One tab. */
type SerialTab = (typeof TABS)[number];

/** How often the broker is read again. */
const REFRESH_MS = 5000;

/** A dialog the page has open. */
type Open =
  | { readonly kind: 'use'; readonly port: SerialPort }
  | {
      readonly kind: 'device';
      readonly port: SerialPort;
      readonly vendor: IntegrationVendorView;
      readonly driverKind: string;
      readonly line: SerialLine;
    }
  | { readonly kind: 'release'; readonly port: SerialPort }
  | { readonly kind: 'console'; readonly port: SerialPort }
  | { readonly kind: 'network' }
  | { readonly kind: 'settings' };

/**
 * Renders the Serial broker's page.
 *
 * @returns The page.
 */
export function SerialBrokerPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const can = useSession((state) => state.can);
  const canConfigure = can('integration:configure');
  const canWrite = can('device:write');
  const canDelete = can('device:delete');
  const [tab, setTab] = useTab<SerialTab>(TABS);
  const [open, setOpen] = useState<Open | null>(null);
  const vendors = useVendorsById();

  const status = useQuery({
    queryKey: SERIAL_QUERY_KEYS.status,
    refetchInterval: REFRESH_MS,

    /**
     * Reads the broker's state.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The state.
     */
    queryFn: async ({ signal }) => fetchSerialStatus(signal),
  });
  const ports = useQuery({
    queryKey: SERIAL_QUERY_KEYS.ports,
    refetchInterval: REFRESH_MS,

    /**
     * Reads the ports.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The ports.
     */
    queryFn: async ({ signal }) => fetchSerialPorts(signal),
  });
  const devices = useQuery({
    queryKey: SERIAL_QUERY_KEYS.devices,
    refetchInterval: REFRESH_MS,

    /**
     * Reads the devices on a port.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The devices.
     */
    queryFn: async ({ signal }) => fetchSerialDevices(signal),
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
  const houseDevices = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.devices,

    /**
     * Reads the house's devices, for the ids taken.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The devices.
     */
    queryFn: async ({ signal }) => fetchDevices(signal),
  });

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

  const ignore = useMutation({
    /**
     * Ignores a port.
     *
     * @param port - The port.
     * @returns It.
     */
    mutationFn: async (port: SerialPort) => ignoreSerialPort(port.id, true),
    onSettled: refresh,
    onError: failed(t('brokers.serial.ignoreFailed', 'Couldn’t ignore the port')),
  });
  const release = useMutation({
    /**
     * Takes a port from its holder.
     *
     * @param port - The port.
     * @returns It, free.
     */
    mutationFn: async (port: SerialPort) => releaseSerialPort(port.id),
    onSettled: refresh,

    /** Closes the confirmation. */
    onSuccess: () => {
      setOpen(null);
    },
    onError: failed(t('brokers.serial.releaseFailed', 'Couldn’t release the port')),
  });
  const forget = useMutation({
    /**
     * Forgets a port.
     *
     * @param port - The port.
     * @returns Once forgotten.
     */
    mutationFn: async (port: SerialPort) => forgetSerialPort(port.id),
    onSettled: refresh,
    onError: failed(t('brokers.serial.forgetFailed', 'Couldn’t forget the port')),
  });

  const current = status.data;
  const state = current === undefined ? null : brokerStateOf(current.state);
  const portList = ports.data ?? [];
  const deviceList = devices.data ?? [];
  const roomNames = new Map((areas.data ?? []).map((area) => [area.id, area.name]));
  const vendorNames = new Map([...vendors].map(([id, vendor]) => [id, vendor.name]));

  /**
   * The name of a room.
   *
   * @param areaId - The room.
   * @returns Its name, or null.
   */
  const roomOf = (areaId: string | null): string | null =>
    areaId === null ? null : (roomNames.get(areaId) ?? null);

  /**
   * What can be done to a port, as its menu.
   *
   * @param port - The port.
   * @returns The menu's items.
   */
  const menuOf = (port: SerialPort): MenuItem[] => {
    const isFree = port.holder === null && port.isConnected;
    const items: MenuItem[] = [];

    if (isFree && canWrite) {
      items.push({
        label: t('brokers.serial.menu.useWith', 'Use with…'),
        icon: 'plug',
        /** Opens Use with…. */
        onSelect: () => {
          setOpen({ kind: 'use', port });
        },
      });
    }

    if (port.holder !== null && port.holder.kind !== 'container' && canConfigure) {
      items.push({
        label: t('brokers.serial.release', 'Release'),
        icon: 'unlink-2',
        /** Asks first. */
        onSelect: () => {
          setOpen({ kind: 'release', port });
        },
      });
    }

    if (isFree && canConfigure) {
      items.push({
        label: t('brokers.serial.menu.console', 'Console'),
        icon: 'terminal',
        /** Opens the console on the port. */
        onSelect: () => {
          setOpen({ kind: 'console', port });
        },
      });
    }

    if ((!port.isConnected || port.kind === 'network') && canDelete) {
      items.push({
        label: t('brokers.serial.forget', 'Forget'),
        icon: 'trash-2',
        tone: 'danger',
        /** Forgets the port. */
        onSelect: () => {
          forget.mutate(port);
        },
      });
    }

    return items;
  };

  return (
    <DetailFrame
      isPending={status.isPending}
      error={status.error}
      hero={
        <DetailHero
          back={<BackLink to="/brokers">{t('brokers.title', 'Brokers')}</BackLink>}
          mark={<BrokerMark broker="serial" size={56} isLit />}
          title={t('brokers.serial.name', 'Serial')}
          description={t(
            'brokers.serial.description',
            'The serial ports this server sees, and who uses each one.',
          )}
          facts={
            current === undefined || state === null ? undefined : (
              <>
                <Pill tone={state.tone}>{state.label}</Pill>
                <HeroFact icon="usb">
                  {current.ports.seen === 0
                    ? t('brokers.serial.zeroPorts', '0 ports')
                    : t('brokers.serial.portsInUse', '{{seen}} ports · {{inUse}} in use', {
                        seen: current.ports.seen,
                        inUse: current.ports.inUse,
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
                      setOpen({ kind: 'settings' });
                    }}
                  >
                    <AppIcon id="settings" size={15} />
                    {t('brokers.serial.openSettings', 'Settings')}
                  </Button>
                ) : null}
                {canWrite ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setOpen({ kind: 'network' });
                    }}
                  >
                    <AppIcon id="globe" size={15} />
                    {t('brokers.serial.addNetworkPort', 'Add network port')}
                  </Button>
                ) : null}
              </>
            )
          }
          tabs={
            <Tabs
              label={t('brokers.serial.name', 'Serial')}
              idPrefix="serial"
              value={tab}
              onChange={setTab}
              items={[
                { id: 'overview', label: t('brokers.serial.overview', 'Overview') },
                {
                  id: 'ports',
                  label: t('brokers.serial.ports', 'Ports'),
                  count: portList.length,
                },
                {
                  id: 'devices',
                  label: t('brokers.serial.devices', 'Devices'),
                  count: deviceList.length,
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
              {t('brokers.serial.failed', 'The Serial broker is not running: {{error}}', {
                error: current.error,
              })}
            </Note>
          ) : null}

          {tab === 'overview' ? (
            <TabPanel idPrefix="serial" id="overview">
              <SerialOverview
                status={current}
                ports={portList}
                onAccess={() => {
                  setTab('ports');
                }}
                onUse={
                  canWrite
                    ? (port) => {
                        setOpen({ kind: 'use', port });
                      }
                    : undefined
                }
                onIgnore={
                  canWrite
                    ? (port) => {
                        ignore.mutate(port);
                      }
                    : undefined
                }
              />
            </TabPanel>
          ) : null}

          {tab === 'ports' ? (
            <TabPanel idPrefix="serial" id="ports">
              <SerialPorts
                status={current}
                ports={portList}
                menuOf={menuOf}
                onNetworkPort={
                  canWrite
                    ? () => {
                        setOpen({ kind: 'network' });
                      }
                    : undefined
                }
              />
            </TabPanel>
          ) : null}

          {tab === 'devices' ? (
            <TabPanel idPrefix="serial" id="devices">
              <SerialDevices devices={deviceList} roomOf={roomOf} vendorNames={vendorNames} />
            </TabPanel>
          ) : null}

          {open?.kind === 'use' ? (
            <UseWithDialog
              port={open.port}
              vendors={[...vendors.values()]}
              onClose={() => {
                setOpen(null);
              }}
              onThread={() => {
                setOpen(null);
                void navigate(`/brokers/thread?setup=${open.port.id}`);
              }}
              onDevice={(vendor, driverKind, line) => {
                setOpen({ kind: 'device', port: open.port, vendor, driverKind, line });
              }}
            />
          ) : null}
          {open?.kind === 'device' ? (
            <DeviceDialog
              target={{
                mode: 'create',
                vendor: open.vendor,
                existingIds: (houseDevices.data ?? []).map((device) => device.id),
                kind: open.driverKind,
                serial: { portId: open.port.id, line: open.line },
              }}
              onClose={() => {
                setOpen(null);
              }}
              onSaved={(device) => {
                setOpen(null);
                refresh();
                void navigate(devicePath(device.id));
              }}
            />
          ) : null}
          {open?.kind === 'network' ? (
            <NetworkPortDialog
              onClose={() => {
                setOpen(null);
              }}
            />
          ) : null}
          {open?.kind === 'settings' ? (
            <SerialSettingsDialog
              status={current}
              ports={portList}
              onClose={() => {
                setOpen(null);
              }}
            />
          ) : null}
          {open?.kind === 'console' ? (
            <ConsoleDialog
              port={open.port}
              onClose={() => {
                setOpen(null);
                refresh();
              }}
            />
          ) : null}
          <Modal
            isOpen={open?.kind === 'release'}
            onClose={() => {
              setOpen(null);
            }}
            size="small"
            title={t('brokers.serial.releaseTitle', 'Release {{port}}?', {
              port: open?.kind === 'release' ? open.port.name : '',
            })}
            description={t(
              'brokers.serial.releaseLine',
              '{{holder}} stops using this port. Its device stays in the house but goes offline until it gets a port again.',
              { holder: open?.kind === 'release' ? (open.port.holder?.name ?? '') : '' },
            )}
            footer={
              <>
                <Button
                  variant="bare"
                  onClick={() => {
                    setOpen(null);
                  }}
                >
                  {t('common.cancel', 'Cancel')}
                </Button>
                <Button
                  variant="danger"
                  isBusy={release.isPending}
                  onClick={() => {
                    if (open?.kind === 'release') {
                      release.mutate(open.port);
                    }
                  }}
                >
                  {t('brokers.serial.release', 'Release')}
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
