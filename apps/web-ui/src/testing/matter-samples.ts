/**
 * The Matter broker as its boards draw it, for the gallery and the page's tests: a fabric made on
 * 12 September with six devices - a Shelly plug the house also reaches over RPC, a Nanoleaf bulb,
 * an IKEA bridge with a lamp and a blind behind it, and an Eve plug silent for three hours - and
 * a commissioning in each of the states its dialog shows.
 */
import { QueryClient } from '@tanstack/react-query';

import type {
  DeviceView,
  DeviceWay,
  IconView,
  IntegrationVendorView,
  LinkSuggestionView,
  MatterCommissioning,
  MatterCommissioningStep,
  MatterIdentity,
  MatterNetwork,
  MatterNetworkNode,
  MatterNode,
  MatterStatus,
} from '@nebulahome/contracts';
import { BUILTIN_UI_FRAME, BUILTIN_UI_NODES } from '@nebulahome/ui';

import { LIBRARY_QUERY_KEYS } from '@/library/api';
import { BROKER_QUERY_KEYS } from '@/library/brokers-api';
import { LINK_QUERY_KEYS } from '@/library/links-api';
import { aDevice, aVendor } from '@/testing/fixtures';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * A moment before now.
 *
 * @param ms - How long before.
 * @returns The moment.
 */
function ago(ms: number): Date {
  return new Date(Date.now() - ms);
}

/** Shelly, whose plug is also on the fabric, and Nanoleaf, whose bulb came in through Matter. */
export const MATTER_SAMPLE_VENDORS: IntegrationVendorView[] = [
  aVendor({ id: 'shelly', name: 'Shelly', color: '#62a9ff', transports: ['shelly/rpc', 'matter'] }),
  aVendor({ id: 'nanoleaf', name: 'Nanoleaf', color: '#2ecc71', transports: ['matter'] }),
];

/**
 * Who a Matter device says it is.
 *
 * @param nodeId - Its node.
 * @param overrides - What it says.
 * @returns The identity.
 */
function identity(nodeId: string, overrides: Partial<MatterIdentity>): MatterIdentity {
  return {
    nodeId,
    endpoint: null,
    vendorId: null,
    productId: null,
    vendorName: null,
    productName: null,
    productLabel: null,
    nodeLabel: null,
    serialNumber: null,
    uniqueId: null,
    hardwareVersion: null,
    hardwareVersionString: null,
    softwareVersion: null,
    softwareVersionString: null,
    macAddresses: [],
    deviceTypes: [],
    clusters: [],
    isBridge: false,
    isBridged: false,
    ...overrides,
  };
}

/**
 * One way into a linked device.
 *
 * @param overrides - What differs.
 * @returns The way.
 */
function way(overrides: Partial<DeviceWay> & Pick<DeviceWay, 'deviceId'>): DeviceWay {
  return {
    kind: 'shelly/plug',
    vendorId: 'shelly',
    transport: 'shelly/rpc',
    driverName: 'Plug',
    state: 'running',
    isAvailable: true,
    isPreferred: false,
    externalId: null,
    address: null,
    nodeId: null,
    swVersion: '1.4.2',
    lastUpdatedAt: null,
    createdAt: ago(30 * DAY),
    ...overrides,
  };
}

/** The house's devices the fabric's are, the Shelly plug reached both ways. */
export const MATTER_SAMPLE_DEVICES: DeviceView[] = [
  aDevice({
    id: 'shelly-dryer',
    name: 'Dryer plug',
    icon: 'plug',
    kind: 'shelly/plug',
    model: 'Shelly Plug S Gen3',
    areaName: 'Utility',
    linked: {
      preferred: 'shelly-dryer',
      ways: [
        way({ deviceId: 'shelly-dryer', isPreferred: true, address: '192.168.178.112' }),
        way({
          deviceId: 'matter-1f',
          transport: 'matter',
          nodeId: '0x1F',
          createdAt: ago(2 * HOUR),
        }),
      ],
    },
  }),
  aDevice({
    id: 'matter-2a',
    name: 'Bedroom lamp',
    icon: 'lightbulb',
    kind: 'nanoleaf/bulb',
    vendorId: 'nanoleaf',
    transport: 'matter',
    model: 'Nanoleaf Essentials A19',
    areaName: 'Bedroom',
  }),
  aDevice({
    id: 'matter-3b',
    name: 'DIRIGERA hub',
    icon: 'router',
    kind: 'matter/bridge',
    vendorId: 'matter',
    transport: 'matter',
    model: 'IKEA DIRIGERA',
    areaName: 'Living room',
  }),
  aDevice({
    id: 'matter-3b-1',
    name: 'Sofa lamp',
    icon: 'lightbulb',
    kind: 'matter/light',
    vendorId: 'matter',
    transport: 'matter',
    model: 'IKEA TRÅDFRI E27',
    areaName: 'Living room',
  }),
  aDevice({
    id: 'matter-3b-2',
    name: 'Sofa blind',
    icon: 'blinds',
    kind: 'matter/cover',
    vendorId: 'matter',
    transport: 'matter',
    model: 'IKEA PRAKTLYSING',
    areaName: 'Living room',
  }),
  aDevice({
    id: 'matter-4c',
    name: 'Hallway plug',
    icon: 'plug',
    kind: 'matter/plug',
    vendorId: 'matter',
    transport: 'matter',
    model: 'Eve Energy',
    areaName: 'Hallway',
  }),
];

/** The fabric's nodes, the bridge's devices behind it. */
export const MATTER_SAMPLE_NODES: MatterNode[] = [
  {
    nodeId: '0x1F',
    isAvailable: true,
    commissionedAt: ago(2 * HOUR),
    offlineSince: null,
    devices: [
      {
        identity: identity('0x1F', {
          productName: 'Shelly Plug S Gen3',
          vendorName: 'Shelly',
          deviceTypes: [0x01_0a],
        }),
        mappedClusters: [6],
        unmappedClusters: [],
        deviceId: 'matter-1f',
        kind: 'shelly/plug',
        claimedBy: ['shelly'],
        isRemoved: false,
      },
    ],
  },
  {
    nodeId: '0x2A',
    isAvailable: true,
    commissionedAt: ago(5 * DAY),
    offlineSince: null,
    devices: [
      {
        identity: identity('0x2A', {
          productName: 'Nanoleaf Essentials A19',
          deviceTypes: [0x01_0d],
        }),
        mappedClusters: [6, 8, 768],
        unmappedClusters: [],
        deviceId: 'matter-2a',
        kind: 'nanoleaf/bulb',
        claimedBy: ['nanoleaf'],
        isRemoved: false,
      },
    ],
  },
  {
    nodeId: '0x3B',
    isAvailable: true,
    commissionedAt: ago(9 * DAY),
    offlineSince: null,
    devices: [
      {
        identity: identity('0x3B', { productName: 'IKEA DIRIGERA', isBridge: true }),
        mappedClusters: [],
        unmappedClusters: [],
        deviceId: 'matter-3b',
        kind: 'matter/bridge',
        claimedBy: [],
        isRemoved: false,
      },
      {
        identity: identity('0x3B', {
          endpoint: 1,
          productName: 'IKEA TRÅDFRI E27',
          deviceTypes: [0x01_01],
          isBridged: true,
        }),
        mappedClusters: [6, 8],
        unmappedClusters: [],
        deviceId: 'matter-3b-1',
        kind: 'matter/light',
        claimedBy: [],
        isRemoved: false,
      },
      {
        identity: identity('0x3B', {
          endpoint: 2,
          productName: 'IKEA PRAKTLYSING',
          deviceTypes: [0x02_02],
          isBridged: true,
        }),
        mappedClusters: [258],
        unmappedClusters: [],
        deviceId: 'matter-3b-2',
        kind: 'matter/cover',
        claimedBy: [],
        isRemoved: false,
      },
    ],
  },
  {
    nodeId: '0x4C',
    isAvailable: false,
    commissionedAt: ago(20 * DAY),
    offlineSince: ago(3 * HOUR),
    devices: [
      {
        identity: identity('0x4C', { productName: 'Eve Energy', deviceTypes: [0x01_0a] }),
        mappedClusters: [6],
        unmappedClusters: [],
        deviceId: 'matter-4c',
        kind: 'matter/plug',
        claimedBy: [],
        isRemoved: false,
      },
    ],
  },
];

/**
 * One point of the network, as the controller reports it.
 *
 * @param id - Its id.
 * @param overrides - What it says.
 * @returns The point.
 */
function networkPoint(id: string, overrides: Partial<MatterNetworkNode>): MatterNetworkNode {
  return {
    id,
    kind: 'matter',
    network: 'thread',
    nodeId: id,
    role: null,
    isAvailable: true,
    isBridge: false,
    networkName: null,
    channel: null,
    ssid: null,
    bssid: null,
    extAddress: null,
    ...overrides,
  };
}

/**
 * The fabric's network, as the board draws it: the Shelly plug and the IKEA bridge on the Wi-Fi,
 * the Nanoleaf bulb a Thread router under a HomePod, and the Eve plug behind the bulb, silent.
 */
export const MATTER_SAMPLE_NETWORK: MatterNetwork = {
  collectedAt: new Date(Date.now() - 30_000),
  nodes: [
    networkPoint('ap_3810D5A1B2C3', {
      kind: 'wifi_ap',
      network: 'wifi',
      nodeId: null,
      isAvailable: null,
      bssid: '38:10:D5:A1:B2:C3',
    }),
    networkPoint('0x1F', {
      network: 'wifi',
      role: 'station',
      channel: 6,
      ssid: 'Casa',
      extAddress: null,
    }),
    networkPoint('0x3B', {
      network: 'wifi',
      role: 'station',
      isBridge: true,
      channel: 6,
      ssid: 'Casa',
    }),
    networkPoint('unknown_8E2F11A04C7D9B21', {
      kind: 'thread_unknown',
      nodeId: null,
      isAvailable: null,
      role: 'leader',
      extAddress: '8E2F11A04C7D9B21',
    }),
    networkPoint('0x2A', {
      role: 'router',
      networkName: 'Casa',
      channel: 15,
      extAddress: 'F412FA3C8801A7E2',
    }),
    networkPoint('0x4C', {
      role: 'sleepy_end_device',
      isAvailable: false,
      networkName: 'Casa',
      channel: 15,
      extAddress: '0A11B3C4D5E6F708',
    }),
  ],
  links: [
    {
      source: '0x1F',
      target: 'ap_3810D5A1B2C3',
      network: 'wifi',
      strength: 'strong',
      lqi: null,
      rssi: -52,
    },
    {
      source: '0x3B',
      target: 'ap_3810D5A1B2C3',
      network: 'wifi',
      strength: 'medium',
      lqi: null,
      rssi: -61,
    },
    {
      source: '0x2A',
      target: 'unknown_8E2F11A04C7D9B21',
      network: 'thread',
      strength: 'strong',
      lqi: 3,
      rssi: -58,
    },
    {
      source: '0x4C',
      target: '0x2A',
      network: 'thread',
      strength: 'weak',
      lqi: 1,
      rssi: -84,
    },
  ],
};

/** The fabric, running for three days. */
export const MATTER_SAMPLE_STATUS: MatterStatus = {
  state: 'running',
  error: null,
  fabricId: '4487ed36b44eba3c',
  isLanReachable: true,
  nodes: { total: 4, online: 3 },
  commissioning: null,
  startedAt: ago(3 * DAY),
  controllerVersion: '0.17',
  port: 5540,
  fabricCreatedAt: new Date('2026-09-12T10:00:00Z'),
};

/**
 * One step of a commissioning.
 *
 * @param id - Which.
 * @param state - How it stands.
 * @param detail - What it found.
 * @returns The step.
 */
function step(
  id: MatterCommissioningStep['id'],
  state: MatterCommissioningStep['state'],
  detail: Partial<MatterCommissioningStep['detail']> = {},
): MatterCommissioningStep {
  return {
    id,
    state,
    detail: {
      discriminator: null,
      isQrCode: false,
      address: null,
      product: null,
      vendorId: null,
      productId: null,
      ...detail,
    },
  };
}

/** A Shelly plug being added: joining the fabric. */
export const MATTER_SAMPLE_ADDING: MatterCommissioning = {
  id: 'job-1',
  state: 'running',
  startedAt: ago(20_000),
  finishedAt: null,
  nodeId: null,
  error: null,
  deviceId: null,
  steps: [
    step('code', 'done', { discriminator: 3840 }),
    step('found', 'done', {
      address: 'fe80::a8f9:e0ff:fe12:4c7a',
      product: 'Shelly Plug S Gen3',
    }),
    step('certificate', 'done'),
    step('joining', 'running'),
    step('reading', 'pending'),
    step('in-house', 'pending'),
  ],
};

/** A development sample stopped on its test certificate. */
export const MATTER_SAMPLE_TEST: MatterCommissioning = {
  ...MATTER_SAMPLE_ADDING,
  id: 'job-2',
  state: 'needs-answer',
  steps: [
    step('code', 'done', { discriminator: 1207 }),
    step('found', 'done', {
      address: 'fe80::42:acff:fe11:9b02',
      vendorId: 0xff_f1,
      productId: 0x80_01,
    }),
    step('certificate', 'warning'),
    step('joining', 'pending'),
    step('reading', 'pending'),
    step('in-house', 'pending'),
  ],
};

/** The Shelly plug just added through Matter, offered to link with the one the house had. */
export const MATTER_SAMPLE_TWIN: LinkSuggestionView = {
  id: '00000000-0000-4000-8000-0000000000a1',
  vendorId: 'shelly',
  device: {
    id: 'shelly-dryer',
    name: 'Dryer plug',
    model: 'Shelly Plug S Gen3',
    vendorId: 'shelly',
    transport: 'shelly/rpc',
    createdAt: ago(30 * DAY),
  },
  twin: {
    id: 'matter-1f',
    name: 'Shelly Plug S Gen3',
    model: 'Shelly Plug S Gen3',
    vendorId: 'shelly',
    transport: 'matter',
    createdAt: ago(60_000),
  },
  reasons: [
    { kind: 'mac', value: '08:f9:e0:12:4c:7a' },
    { kind: 'serial', value: 'SPS3-124C7A' },
    { kind: 'model', value: 'Plug S Gen3' },
  ],
  dismissedAt: null,
  createdAt: ago(60_000),
};

/**
 * The catalogue's drawing of a built-in glyph, as the catalogue serves it.
 *
 * @param id - The glyph.
 * @returns The icon.
 */
function builtIn(id: 'plug' | 'lightbulb' | 'router' | 'blinds'): IconView {
  return {
    id,
    name: id,
    keywords: [],
    origin: 'builtin',
    isOverridden: false,
    node: BUILTIN_UI_NODES[id],
    frame: BUILTIN_UI_FRAME,
  };
}

/**
 * A cache already holding the fabric, for a page drawn with no server.
 *
 * @param commissioning - The last commissioning, if any.
 * @returns The cache.
 */
export function matterSampleCache(commissioning: MatterCommissioning | null = null): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchInterval: false } },
  });
  const icons = ['blinds', 'lightbulb', 'plug', 'router'] as const;

  client.setQueryData(BROKER_QUERY_KEYS.matterStatus, { ...MATTER_SAMPLE_STATUS, commissioning });
  client.setQueryData(BROKER_QUERY_KEYS.matterNodes, MATTER_SAMPLE_NODES);
  client.setQueryData(BROKER_QUERY_KEYS.matterNetwork, MATTER_SAMPLE_NETWORK);
  client.setQueryData(LIBRARY_QUERY_KEYS.devices, MATTER_SAMPLE_DEVICES);
  client.setQueryData(LIBRARY_QUERY_KEYS.vendors, MATTER_SAMPLE_VENDORS);
  client.setQueryData(
    [...LIBRARY_QUERY_KEYS.icons, 'ids', icons.join(',')],
    new Map(icons.map((id) => [id, builtIn(id)])),
  );
  client.setQueryData([...LINK_QUERY_KEYS.suggestionOf, 'matter-1f'], MATTER_SAMPLE_TWIN);

  return client;
}
