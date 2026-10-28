/**
 * What a device's Connection card says of the broker it is reached through.
 *
 * A remote is "Sent through Living room RM4"; a serial device "On ttyUSB0 · 2400 8N1"; a
 * Bluetooth one "Heard by Kitchen Plug S · -71 dBm"; a Matter device on Thread "Router · parent
 * Kitchen Plug". Each is read from its broker's own list, only for a device that broker reaches,
 * and says nothing until it is read - or when the broker does not answer (Thread not set up).
 * A remote also gives the page its keypad's address, for Edit buttons.
 */
import { useQuery } from '@tanstack/react-query';

import {
  BLUETOOTH_TRANSPORT,
  INFRARED_TRANSPORT,
  MATTER_TRANSPORT,
  serialLineText,
  type DeviceView,
  type ThreadDeviceRole,
} from '@nebulahome/contracts';

import { translate } from '@/i18n/messages';
import { BLUETOOTH_QUERY_KEYS, fetchBluetoothDevices } from '@/library/bluetooth-api';
import { fetchInfraredRemotes, INFRARED_QUERY_KEYS } from '@/library/infrared-api';
import { fetchSerialDevices, SERIAL_QUERY_KEYS } from '@/library/serial-api';
import { fetchThreadDevices, THREAD_QUERY_KEYS } from '@/library/thread-api';

/** What the page shows of the broker a device is reached through. */
export type TransportFacts = {
  /** The Connection card's line; null when no broker says more than the device. */
  readonly line: string | null;

  /** The remote whose keypad Edit buttons opens, for an infrared remote. */
  readonly remoteId: string | null;
};

/**
 * A Thread role in words.
 *
 * @param role - The role.
 * @returns `Router`, `End device`…
 */
export function threadRoleName(role: ThreadDeviceRole): string {
  switch (role) {
    case 'leader':
      return translate('brokers.thread.role.leader', 'Leader');
    case 'router':
      return translate('brokers.thread.role.router', 'Router');
    case 'end-device':
      return translate('brokers.thread.role.endDevice', 'End device');
    case 'sleepy':
      return translate('brokers.thread.role.sleepy', 'Sleepy');
  }
}

/**
 * Reads what the broker that reaches a device says of it.
 *
 * @param device - The device; undefined while it is read.
 * @returns The line, and a remote's keypad.
 */
export function useTransportFacts(device: DeviceView | undefined): TransportFacts {
  const transport = device?.transport;
  const isSerial = device !== undefined && 'serial' in device.transportConfig;
  const options = { retry: false, staleTime: 10_000 } as const;

  const remotes = useQuery({
    ...options,
    queryKey: INFRARED_QUERY_KEYS.remotes,
    enabled: transport === INFRARED_TRANSPORT,

    /**
     * Reads the remotes, for this one's blaster.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The remotes.
     */
    queryFn: async ({ signal }) => fetchInfraredRemotes(signal),
  });
  const serial = useQuery({
    ...options,
    queryKey: SERIAL_QUERY_KEYS.devices,
    enabled: isSerial,

    /**
     * Reads the serial devices, for this one's port.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The devices.
     */
    queryFn: async ({ signal }) => fetchSerialDevices(signal),
  });
  const bluetooth = useQuery({
    ...options,
    queryKey: BLUETOOTH_QUERY_KEYS.devices,
    enabled: transport === BLUETOOTH_TRANSPORT,

    /**
     * Reads the Bluetooth devices, for who hears this one.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The devices.
     */
    queryFn: async ({ signal }) => fetchBluetoothDevices(signal),
  });
  const thread = useQuery({
    ...options,
    queryKey: THREAD_QUERY_KEYS.devices,
    enabled: transport === MATTER_TRANSPORT,

    /**
     * Reads the Thread devices, for this one's role.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The devices.
     */
    queryFn: async ({ signal }) => fetchThreadDevices(signal),
  });

  if (device === undefined) {
    return { line: null, remoteId: null };
  }

  if (transport === INFRARED_TRANSPORT) {
    const remote = remotes.data?.find((each) => each.deviceId === device.id);

    return {
      line:
        remote === undefined
          ? null
          : remote.blasterName === null
            ? translate('brokers.infrared.noBlaster', 'No blaster: pick another one')
            : translate('brokers.infrared.sentThroughBlaster', 'Sent through {{blaster}}', {
                blaster: remote.blasterName,
              }),
      remoteId: remote?.id ?? null,
    };
  }

  if (isSerial) {
    const found = serial.data?.find((each) => each.deviceId === device.id);

    return {
      line:
        found === undefined
          ? null
          : translate('brokers.serial.onPort', 'On {{port}} · {{line}}', {
              port: found.portName,
              line: serialLineText(found.line),
            }),
      remoteId: null,
    };
  }

  if (transport === BLUETOOTH_TRANSPORT) {
    const found = bluetooth.data?.find((each) => each.deviceId === device.id);
    const [best] = found?.heardBy ?? [];

    return {
      line:
        best === undefined
          ? null
          : translate('brokers.bluetooth.heardByAt', 'Heard by {{scanner}} · {{rssi}} dBm', {
              scanner: best.scannerName,
              rssi: best.rssi,
            }),
      remoteId: null,
    };
  }

  if (transport === MATTER_TRANSPORT) {
    const found = thread.data?.find((each) => each.deviceId === device.id);

    return {
      line:
        found === undefined
          ? null
          : found.parentName === null
            ? threadRoleName(found.role)
            : translate('brokers.thread.roleParent', '{{role}} · parent {{parent}}', {
                role: threadRoleName(found.role),
                parent: found.parentName,
              }),
      remoteId: null,
    };
  }

  return { line: null, remoteId: null };
}
