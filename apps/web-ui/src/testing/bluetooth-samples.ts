/**
 * The house's Bluetooth broker as the boards draw it, for the gallery: this server's Intel
 * adapter and three Shelly proxies - one with an outdated script - six devices of the house, two
 * found that the house does not have, and what is heard nearby.
 */
import type { QueryClient } from '@tanstack/react-query';

import type {
  BluetoothDevice,
  BluetoothFound,
  BluetoothHearing,
  BluetoothMap,
  BluetoothNearby,
  BluetoothProxyCandidate,
  BluetoothScanner,
  BluetoothStatus,
} from '@nebulahome/contracts';

import { BLUETOOTH_QUERY_KEYS } from '@/library/bluetooth-api';
import { brokerSampleCache, SAMPLE_ROOMS, sampleDevice } from '@/testing/broker-samples';

/**
 * A moment some seconds before the sample's now.
 *
 * @param seconds - How long ago.
 * @returns The moment.
 */
const ago = (seconds: number): Date => new Date(Date.now() - seconds * 1000);

/**
 * One scanner hearing a device.
 *
 * @param scannerId - The scanner.
 * @param scannerName - Its name.
 * @param rssi - How loud.
 * @returns The hearing.
 */
function heard(scannerId: string, scannerName: string, rssi: number): BluetoothHearing {
  return { scannerId, scannerName, rssi, at: ago(12) };
}

/** The scanners, as the boards name them. */
const HCI0 = ['adapter:hci0', 'hci0'] as const;
const KITCHEN = ['proxy:kitchen-plug', 'Kitchen Plug S'] as const;
const BATHROOM = ['proxy:bathroom-plug', 'Bathroom Plug S'] as const;
const GARAGE = ['proxy:garage-plug', 'Garage Plug'] as const;

/** Where the sample broker stands. */
export const BLUETOOTH_SAMPLE_STATUS: BluetoothStatus = {
  state: 'running',
  error: null,
  adapter: {
    id: 'hci0',
    name: 'Intel AX211',
    address: '6C:2F:80:1B:9E:44',
    isPowered: true,
    scanMode: 'active',
    canPassive: true,
    connections: { used: 1, max: 5 },
  },
  adapters: [{ id: 'hci0', name: 'Intel AX211', address: '6C:2F:80:1B:9E:44', isPowered: true }],
  adapterProblem: null,
  proxies: { total: 3, reporting: 3 },
  heard: { devices: 41, advertsPerMinute: 380 },
  isMatterPairing: false,
  isForwardingAll: false,
  settings: {
    localEnabled: true,
    adapterId: 'hci0',
    localScanMode: 'active',
    proxyScanMode: 'passive',
    forgetAfterDays: 7,
    showPrivate: false,
  },
  devices: { total: 6, online: 6 },
};

/** The same broker on a host whose Bluetooth the container cannot reach. */
export const BLUETOOTH_SAMPLE_NO_ADAPTER: BluetoothStatus = {
  ...BLUETOOTH_SAMPLE_STATUS,
  state: 'unavailable',
  adapter: null,
  adapters: [],
  adapterProblem: 'desktop',
  proxies: { total: 0, reporting: 0 },
  heard: { devices: 0, advertsPerMinute: 0 },
  devices: { total: 0, online: 0 },
};

/**
 * One device of the house on Bluetooth.
 *
 * @param fields - What tells it apart.
 * @returns The device.
 */
function device(
  fields: Partial<BluetoothDevice> & Pick<BluetoothDevice, 'deviceId' | 'name' | 'address'>,
): BluetoothDevice {
  return {
    vendorId: 'shelly',
    areaId: null,
    rssi: -67,
    heardBy: [],
    lastHeardAt: ago(12),
    link: 'listening',
    addedAt: null,
    ...fields,
  };
}

/** The house's Bluetooth devices. */
export const BLUETOOTH_SAMPLE_DEVICES: BluetoothDevice[] = [
  device({
    deviceId: 'bt-bathroom-ht',
    name: 'Bathroom H&T',
    address: '7C:C6:B6:61:2A:0F',
    areaId: SAMPLE_ROOMS.bathroom,
    rssi: -67,
    heardBy: [heard(...BATHROOM, -67), heard(...HCI0, -79), heard(...KITCHEN, -88)],
    addedAt: ago(86_400),
  }),
  device({
    deviceId: 'bt-living-climate',
    name: 'Living room climate',
    vendorId: 'xiaomi',
    address: 'A4:C1:38:0D:7E:52',
    areaId: SAMPLE_ROOMS.living,
    rssi: -61,
    heardBy: [heard(...HCI0, -61)],
  }),
  device({
    deviceId: 'bt-front-lock',
    name: 'Front door lock',
    vendorId: 'nuki',
    address: 'D8:2C:5E:41:03:9A',
    areaId: SAMPLE_ROOMS.hall,
    rssi: -55,
    heardBy: [heard(...HCI0, -55)],
    lastHeardAt: ago(1),
    link: 'connected',
    addedAt: new Date('2026-10-22T10:00:00Z'),
  }),
  device({
    deviceId: 'bt-basil',
    name: 'Basil',
    vendorId: 'xiaomi',
    address: 'C4:7C:8D:6A:51:E0',
    areaId: SAMPLE_ROOMS.kitchen,
    rssi: -89,
    heardBy: [heard(...KITCHEN, -89)],
    lastHeardAt: ago(240),
  }),
  device({
    deviceId: 'bt-toothbrush',
    name: 'Toothbrush',
    vendorId: 'oralb',
    address: '5C:F8:21:9B:44:D7',
    areaId: SAMPLE_ROOMS.bathroom,
    rssi: -78,
    heardBy: [heard(...BATHROOM, -78)],
    lastHeardAt: ago(14_400),
  }),
  device({
    deviceId: 'bt-hall-motion',
    name: 'Hall motion',
    address: '38:39:8F:A2:10:6C',
    areaId: SAMPLE_ROOMS.hall,
    rssi: -66,
    heardBy: [heard(...GARAGE, -66), heard(...HCI0, -84)],
    lastHeardAt: ago(120),
  }),
];

/** The devices an integration recognises that the house does not have. */
export const BLUETOOTH_SAMPLE_FOUND: BluetoothFound[] = [
  {
    address: 'A4:C1:38:5E:91:0B',
    name: 'LYWSD03MMC',
    rssi: -71,
    scannerName: 'Kitchen Plug S',
    claims: [{ vendorId: 'xiaomi', vendorName: 'Xiaomi BLE', kind: null, model: 'LYWSD03MMC' }],
    foundAt: ago(600),
  },
  {
    address: 'D4:0B:7A:22:14:C3',
    name: 'Meter Plus',
    rssi: -64,
    scannerName: 'hci0',
    claims: [{ vendorId: 'switchbot', vendorName: 'SwitchBot', kind: null, model: 'Meter Plus' }],
    foundAt: ago(900),
  },
];

/**
 * One scanner.
 *
 * @param fields - What tells it apart.
 * @returns The scanner.
 */
function scanner(
  fields: Partial<BluetoothScanner> & Pick<BluetoothScanner, 'id' | 'name'>,
): BluetoothScanner {
  return {
    kind: 'proxy',
    deviceId: null,
    vendorId: 'shelly',
    areaId: null,
    address: null,
    chip: null,
    isOnline: true,
    isEnabled: true,
    scanMode: 'passive',
    canPassive: true,
    advertsPerMinute: 70,
    connections: null,
    forwarding: 'house',
    lastReportAt: ago(3),
    script: { version: '1.4', shipped: '1.4', isOutdated: false },
    hearsBest: [],
    ...fields,
  };
}

/** The scanners: the adapter and three proxies. */
export const BLUETOOTH_SAMPLE_SCANNERS: BluetoothScanner[] = [
  scanner({
    id: HCI0[0],
    kind: 'adapter',
    name: 'This server',
    vendorId: null,
    address: '6C:2F:80:1B:9E:44',
    chip: 'Intel AX211',
    scanMode: 'active',
    advertsPerMinute: 120,
    connections: { used: 1, max: 5 },
    forwarding: null,
    script: null,
    hearsBest: [
      { address: 'A4:C1:38:0D:7E:52', name: 'Living room climate', deviceId: null, rssi: -61 },
      { address: 'D8:2C:5E:41:03:9A', name: 'Front door lock', deviceId: null, rssi: -55 },
    ],
  }),
  scanner({
    id: KITCHEN[0],
    name: KITCHEN[1],
    deviceId: 'shelly-kitchen-plug',
    areaId: SAMPLE_ROOMS.kitchen,
    scanMode: 'active',
    advertsPerMinute: 140,
    hearsBest: [
      { address: 'A4:C1:38:0D:7E:52', name: 'Living room climate', deviceId: null, rssi: -61 },
      { address: 'A4:C1:38:5E:91:0B', name: 'LYWSD03MMC', deviceId: null, rssi: -71 },
      { address: 'C4:7C:8D:6A:51:E0', name: 'Basil', deviceId: null, rssi: -89 },
      ...Array.from({ length: 11 }, (unused, index) => ({
        address: `00:00:00:00:00:${String(index).padStart(2, '0')}`,
        name: null,
        deviceId: null,
        rssi: -90,
      })),
    ],
  }),
  scanner({
    id: BATHROOM[0],
    name: BATHROOM[1],
    deviceId: 'shelly-bathroom-plug',
    areaId: SAMPLE_ROOMS.bathroom,
    lastReportAt: ago(5),
  }),
  scanner({
    id: GARAGE[0],
    name: GARAGE[1],
    deviceId: 'shelly-garage-plug',
    areaId: SAMPLE_ROOMS.garage,
    advertsPerMinute: 50,
    script: { version: '1.2', shipped: '1.4', isOutdated: true },
  }),
];

/**
 * One address heard nearby.
 *
 * @param fields - What tells it apart.
 * @returns The address.
 */
function near(
  fields: Partial<BluetoothNearby> & Pick<BluetoothNearby, 'address' | 'rssi'>,
): BluetoothNearby {
  return {
    addressType: 'public',
    isPrivate: false,
    name: null,
    maker: null,
    companyId: null,
    serviceUuids: [],
    heardBy: [],
    lastHeardAt: ago(20),
    claims: [],
    deviceId: null,
    isIgnored: false,
    manufacturerData: {},
    serviceData: {},
    ...fields,
  };
}

/** Everything heard nearby. */
export const BLUETOOTH_SAMPLE_NEARBY: BluetoothNearby[] = [
  near({
    address: 'A4:C1:38:5E:91:0B',
    name: 'ATC_5E910B',
    maker: 'Xiaomi',
    rssi: -62,
    serviceUuids: ['fcd2'],
    heardBy: [heard(...KITCHEN, -62), heard(...HCI0, -77), heard(...GARAGE, -90)],
    claims: [{ vendorId: 'xiaomi', vendorName: 'Xiaomi BLE', kind: null, model: 'LYWSD03MMC' }],
    serviceData: { fcd2: '4000a4016402ca0803bf13' },
  }),
  near({
    address: 'D4:0B:7A:22:14:C3',
    name: 'Meter Plus',
    maker: 'SwitchBot',
    rssi: -64,
    serviceUuids: ['fd3d'],
    heardBy: [heard(...HCI0, -64)],
    claims: [{ vendorId: 'switchbot', vendorName: 'SwitchBot', kind: null, model: 'Meter Plus' }],
  }),
  near({
    address: 'F1:9E:03:7B:C2:58',
    maker: 'Tile',
    rssi: -80,
    serviceUuids: ['feed'],
    heardBy: [heard(...BATHROOM, -80)],
  }),
  near({
    address: '6C:AC:C2:10:7F:31',
    name: 'Galaxy Buds2',
    maker: 'Samsung',
    rssi: -86,
    serviceUuids: ['fd69'],
    heardBy: [heard(...HCI0, -86)],
  }),
  near({
    address: '7C:C6:B6:61:2A:0F',
    name: 'Bathroom H&T',
    maker: 'Shelly',
    rssi: -67,
    serviceUuids: ['fcd2'],
    heardBy: [heard(...BATHROOM, -67), heard(...HCI0, -79)],
    claims: [{ vendorId: 'shelly', vendorName: 'Shelly', kind: null, model: 'BLU H&T' }],
    deviceId: 'bt-bathroom-ht',
  }),
];

/** Who hears what, as the map reads it. */
export const BLUETOOTH_SAMPLE_MAP: BluetoothMap = {
  collectedAt: ago(10),
  nodes: [
    {
      id: 'server',
      kind: 'server',
      name: 'Nebula Home',
      deviceId: null,
      address: null,
      isOnline: true,
    },
    { id: HCI0[0], kind: 'adapter', name: 'hci0', deviceId: null, address: null, isOnline: true },
    ...BLUETOOTH_SAMPLE_SCANNERS.filter((each) => each.kind === 'proxy').map((each) => ({
      id: each.id,
      kind: 'proxy' as const,
      name: each.name,
      deviceId: each.deviceId,
      address: null,
      isOnline: each.isOnline,
    })),
    ...BLUETOOTH_SAMPLE_DEVICES.map((each) => ({
      id: each.address,
      kind: 'device' as const,
      name: each.name,
      deviceId: each.deviceId,
      address: each.address,
      isOnline: true,
    })),
  ],
  links: [
    { source: 'server', target: HCI0[0], network: 'ble', strength: 'strong', rssi: null },
    ...[KITCHEN, BATHROOM, GARAGE].map(([id]) => ({
      source: 'server',
      target: id,
      network: 'wifi' as const,
      strength: 'unknown' as const,
      rssi: null,
    })),
    ...BLUETOOTH_SAMPLE_DEVICES.map((each) => {
      const [best] = each.heardBy;
      const rssi = best?.rssi ?? -100;

      return {
        source: best?.scannerId ?? HCI0[0],
        target: each.address,
        network: 'ble' as const,
        strength:
          rssi >= -70 ? ('strong' as const) : rssi >= -85 ? ('medium' as const) : ('weak' as const),
        rssi,
      };
    }),
  ],
};

/** The devices an integration can make proxies. */
export const BLUETOOTH_SAMPLE_CANDIDATES: BluetoothProxyCandidate[] = [
  {
    deviceId: 'shelly-office-plug',
    name: 'Office Plug S Gen3',
    vendorId: 'shelly',
    areaId: SAMPLE_ROOMS.office,
    isOnline: true,
    wifiRssi: -58,
    proxy: { eligible: true, installed: false, shipped: '1.4', running: false },
    modes: ['passive', 'active'],
  },
  {
    deviceId: 'shelly-bedroom-pro',
    name: 'Bedroom Pro 1PM',
    vendorId: 'shelly',
    areaId: SAMPLE_ROOMS.bedroom,
    isOnline: true,
    wifiRssi: -66,
    proxy: { eligible: true, installed: false, shipped: '1.4', running: false },
    modes: ['passive', 'active'],
  },
  {
    deviceId: 'shelly-bathroom-ht',
    name: 'Bathroom H&T Gen3',
    vendorId: 'shelly',
    areaId: SAMPLE_ROOMS.bathroom,
    isOnline: true,
    wifiRssi: null,
    proxy: { eligible: false, reason: 'battery' },
    modes: [],
  },
  {
    deviceId: 'shelly-hall-1',
    name: 'Hallway Shelly 1',
    vendorId: 'shelly',
    areaId: SAMPLE_ROOMS.hall,
    isOnline: true,
    wifiRssi: null,
    proxy: { eligible: false, reason: 'gen1' },
    modes: [],
  },
  {
    deviceId: 'shelly-garden-plug',
    name: 'Garden Plus Plug S',
    vendorId: 'shelly',
    areaId: SAMPLE_ROOMS.garage,
    isOnline: true,
    wifiRssi: null,
    proxy: { eligible: false, reason: 'firmware', update: true },
    modes: [],
  },
];

/**
 * A cache already holding the broker, for its pages drawn with no server.
 *
 * @param hasNoAdapter - A host whose Bluetooth the container cannot reach.
 * @returns The cache.
 */
export function bluetoothSampleCache(hasNoAdapter = false): QueryClient {
  const client = brokerSampleCache([
    sampleDevice('bt-bathroom-ht', 'Bathroom H&T', 'bathroom', { model: 'Shelly BLU H&T' }),
    sampleDevice('bt-front-lock', 'Front door lock', 'hall', { model: 'Nuki Smart Lock 4' }),
  ]);

  client.setQueryData(
    BLUETOOTH_QUERY_KEYS.status,
    hasNoAdapter ? BLUETOOTH_SAMPLE_NO_ADAPTER : BLUETOOTH_SAMPLE_STATUS,
  );
  client.setQueryData(BLUETOOTH_QUERY_KEYS.devices, hasNoAdapter ? [] : BLUETOOTH_SAMPLE_DEVICES);
  client.setQueryData(BLUETOOTH_QUERY_KEYS.scanners, hasNoAdapter ? [] : BLUETOOTH_SAMPLE_SCANNERS);
  client.setQueryData(BLUETOOTH_QUERY_KEYS.nearby, hasNoAdapter ? [] : BLUETOOTH_SAMPLE_NEARBY);
  client.setQueryData(BLUETOOTH_QUERY_KEYS.map, BLUETOOTH_SAMPLE_MAP);
  client.setQueryData(BLUETOOTH_QUERY_KEYS.found, {
    items: hasNoAdapter ? [] : BLUETOOTH_SAMPLE_FOUND,
    ignored: hasNoAdapter
      ? []
      : [
          { address: '11:22:33:44:55:66', name: 'iBeacon', at: ago(86_400) },
          { address: '66:55:44:33:22:11', name: null, at: ago(172_800) },
        ],
  });
  client.setQueryData([...BLUETOOTH_QUERY_KEYS.candidates, ''], BLUETOOTH_SAMPLE_CANDIDATES);

  return client;
}
