/**
 * The house's Serial broker as the boards draw it, for the gallery: a SkyConnect the Thread
 * broker holds, a zigbee2mqtt coordinator, a ser2net port on the network, a free VE.Direct cable
 * Victron recognises, and an unplugged CH340 kept for its solar charger.
 */
import type { QueryClient } from '@tanstack/react-query';

import type {
  IntegrationKind,
  SerialDevice,
  SerialPort,
  SerialStatus,
} from '@nebulahome/contracts';

import { LIBRARY_QUERY_KEYS } from '@/library/api';
import { SERIAL_QUERY_KEYS } from '@/library/serial-api';
import {
  brokerSampleCache,
  SAMPLE_ROOMS,
  SAMPLE_VENDORS,
  sampleDevice,
} from '@/testing/broker-samples';
import { aVendor } from '@/testing/fixtures';

/** The free VE.Direct cable, which Use with… opens on. */
export const SERIAL_SAMPLE_FREE_ID = '5e000000-0000-4000-8000-000000000004';

/** The line most of the house's ports run at. */
const LINE_8N1 = { dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' } as const;

/**
 * One sample port.
 *
 * @param fields - What tells it apart.
 * @returns The port.
 */
function port(fields: Partial<SerialPort> & Pick<SerialPort, 'id' | 'name' | 'path'>): SerialPort {
  return {
    kind: 'usb',
    devicePath: null,
    usb: null,
    network: null,
    holder: null,
    line: null,
    isConnected: true,
    isIgnored: false,
    claims: [],
    lastSeenAt: new Date('2026-10-27T10:12:00Z'),
    ...fields,
  };
}

/** The ports the server sees. */
export const SERIAL_SAMPLE_PORTS: SerialPort[] = [
  port({
    id: '5e000000-0000-4000-8000-000000000001',
    name: 'Nabu Casa SkyConnect v1.0',
    path: '/dev/serial/by-id/usb-Nabu_Casa_SkyConnect_v1.0_9e2adbd75b8beb119fe564a0f320645d-if00-port0',
    devicePath: '/dev/ttyUSB0',
    usb: {
      vendorId: '10c4',
      productId: 'ea60',
      serialNumber: '9e2adbd7',
      manufacturer: 'Nabu Casa',
      product: 'SkyConnect v1.0',
    },
    holder: {
      kind: 'broker',
      deviceId: null,
      vendorId: null,
      broker: 'thread',
      container: null,
      name: 'Thread broker',
    },
    line: { baudRate: 460_800, ...LINE_8N1 },
  }),
  port({
    id: '5e000000-0000-4000-8000-000000000002',
    name: 'Silicon Labs CP2102N USB to UART',
    path: '/dev/serial/by-id/usb-Silicon_Labs_CP2102N_USB_to_UART_Bridge_Controller_7a1c4e0b-if00-port0',
    devicePath: '/dev/ttyUSB1',
    usb: {
      vendorId: '10c4',
      productId: 'ea60',
      serialNumber: '7a1c4e0b',
      manufacturer: 'Silicon Labs',
      product: 'CP2102N USB to UART Bridge Controller',
    },
    holder: {
      kind: 'container',
      deviceId: null,
      vendorId: null,
      broker: null,
      container: 'zigbee2mqtt',
      name: 'zigbee2mqtt',
    },
  }),
  port({
    id: '5e000000-0000-4000-8000-000000000003',
    kind: 'network',
    name: 'Meter cabinet ser2net',
    path: 'tcp://192.168.1.50:6638',
    network: { host: '192.168.1.50', port: 6638, protocol: 'rfc2217' },
    holder: {
      kind: 'device',
      deviceId: 'dsmr-meter',
      vendorId: 'dsmr',
      broker: null,
      container: null,
      name: 'Utility meter',
    },
    line: { baudRate: 115_200, ...LINE_8N1 },
  }),
  port({
    id: SERIAL_SAMPLE_FREE_ID,
    name: 'FTDI FT232R USB UART',
    path: '/dev/serial/by-id/usb-VictronEnergy_BV_VE_Direct_cable_VE4XQ2BC-if00-port0',
    devicePath: '/dev/ttyUSB2',
    usb: {
      vendorId: '0403',
      productId: '6015',
      serialNumber: 'VE4XQ2BC',
      manufacturer: 'VictronEnergy BV',
      product: 'FT232R USB UART',
    },
    claims: [
      {
        kind: 'integration',
        vendorId: 'victron',
        vendorName: 'Victron VE.Direct',
        driverKind: 'victron/vedirect',
        model: 'VE.Direct cable',
      },
    ],
  }),
  port({
    id: '5e000000-0000-4000-8000-000000000005',
    name: 'QinHeng CH340',
    path: '/dev/serial/by-id/usb-1a86_USB_Serial-if00-port0',
    usb: {
      vendorId: '1a86',
      productId: '7523',
      serialNumber: null,
      manufacturer: 'QinHeng Electronics',
      product: 'CH340',
    },
    isConnected: false,
    holder: {
      kind: 'device',
      deviceId: 'victron-solar',
      vendorId: 'victron',
      broker: null,
      container: null,
      name: 'Solar charger',
    },
    line: { baudRate: 19_200, ...LINE_8N1 },
    lastSeenAt: new Date('2026-10-27T07:58:00Z'),
  }),
];

/** The devices reached through a port. */
export const SERIAL_SAMPLE_DEVICES: SerialDevice[] = [
  {
    deviceId: 'dsmr-meter',
    name: 'Utility meter',
    vendorId: 'dsmr',
    areaId: SAMPLE_ROOMS.utility,
    portId: '5e000000-0000-4000-8000-000000000003',
    portName: 'Meter cabinet ser2net',
    line: { baudRate: 115_200, ...LINE_8N1 },
    isOnline: true,
  },
  {
    deviceId: 'victron-solar',
    name: 'Solar charger',
    vendorId: 'victron',
    areaId: SAMPLE_ROOMS.garage,
    portId: '5e000000-0000-4000-8000-000000000005',
    portName: 'ttyUSB3',
    line: { baudRate: 19_200, ...LINE_8N1 },
    isOnline: false,
  },
];

/** Where the sample broker stands. */
export const SERIAL_SAMPLE_STATUS: SerialStatus = {
  state: 'running',
  error: null,
  access: 'ok',
  ports: { seen: 5, inUse: 3 },
  hotplug: { isWatching: true, lastChangeAt: new Date('2026-10-27T10:12:00Z') },
  conflicts: [],
  settings: { showBuiltin: false },
  devices: { total: 2, online: 1 },
};

/** The same broker in a container that sees no port. */
export const SERIAL_SAMPLE_NO_ACCESS: SerialStatus = {
  ...SERIAL_SAMPLE_STATUS,
  state: 'unavailable',
  access: 'none',
  ports: { seen: 0, inUse: 0 },
  hotplug: { isWatching: false, lastChangeAt: null },
  devices: { total: 0, online: 0 },
};

/**
 * A serial driver, as the catalogue lists one.
 *
 * @param vendorId - Its integration.
 * @param driverId - Its id there.
 * @param name - What it is called.
 * @param baudRate - Its line's speed.
 * @param model - The model it adds.
 * @returns The driver.
 */
function serialDriver(
  vendorId: string,
  driverId: string,
  name: string,
  baudRate: number,
  model: string,
): IntegrationKind {
  return {
    id: `${vendorId}/${driverId}`,
    vendorId,
    driverId,
    name,
    transport: `${vendorId}/serial`,
    models: [model],
    setup: {
      transport: { constants: {}, fields: [] },
      options: { constants: {}, fields: [] },
    },
    serial: { baudRate, ...LINE_8N1 },
  };
}

/** The integrations with serial drivers: Victron's VE.Direct, and DSMR's P1 port. */
export const SERIAL_SAMPLE_VENDORS = [
  ...SAMPLE_VENDORS.filter((vendor) => vendor.id !== 'victron'),
  aVendor({
    id: 'victron',
    name: 'Victron VE.Direct',
    description: 'Solar chargers, battery monitors and inverters on a VE.Direct cable.',
    color: '#2b6cff',
    drivers: [serialDriver('victron', 'vedirect', 'VE.Direct', 19_200, 'SmartShunt 500A')],
  }),
  aVendor({
    id: 'dsmr',
    name: 'DSMR',
    description: 'A smart meter’s P1 port.',
    color: '#38b26b',
    drivers: [serialDriver('dsmr', 'p1', 'P1 port', 115_200, 'Smart meter')],
  }),
];

/**
 * A cache already holding the broker, for its pages drawn with no server.
 *
 * @param hasNoAccess - A container that sees no port.
 * @returns The cache.
 */
export function serialSampleCache(hasNoAccess = false): QueryClient {
  const client = brokerSampleCache([
    sampleDevice('dsmr-meter', 'Utility meter', 'utility'),
    sampleDevice('victron-solar', 'Solar charger', 'garage'),
  ]);

  client.setQueryData(
    SERIAL_QUERY_KEYS.status,
    hasNoAccess ? SERIAL_SAMPLE_NO_ACCESS : SERIAL_SAMPLE_STATUS,
  );
  client.setQueryData(SERIAL_QUERY_KEYS.ports, hasNoAccess ? [] : SERIAL_SAMPLE_PORTS);
  client.setQueryData(SERIAL_QUERY_KEYS.devices, hasNoAccess ? [] : SERIAL_SAMPLE_DEVICES);
  client.setQueryData(LIBRARY_QUERY_KEYS.vendors, SERIAL_SAMPLE_VENDORS);

  return client;
}
