/**
 * The house's Thread network as the boards draw it, for the gallery: the platform's border router
 * on a SkyConnect, leader of NebulaHome-1A2B on channel 15, three routers, end devices and sleepy
 * ones off them, an unknown node, and two other border routers heard - a HomePod on this network
 * and a Nest Hub on another.
 */
import type { QueryClient } from '@tanstack/react-query';

import type {
  ThreadBorderRouter,
  ThreadDevice,
  ThreadRadio,
  ThreadStatus,
} from '@nebulahome/contracts';

import { THREAD_QUERY_KEYS } from '@/library/thread-api';
import { brokerSampleCache, SAMPLE_ROOMS } from '@/testing/broker-samples';

/**
 * A moment some seconds before the sample's now.
 *
 * @param seconds - How long ago.
 * @returns The moment.
 */
const ago = (seconds: number): Date => new Date(Date.now() - seconds * 1000);

/** Where the sample network stands. */
export const THREAD_SAMPLE_STATUS: ThreadStatus = {
  state: 'running',
  error: null,
  mode: 'local',
  setupBlockedBy: null,
  borderRouter: { isRunning: true, version: 'OTBR 2026.10.0', url: 'http://127.0.0.1:8081' },
  radio: {
    portId: '5e000000-0000-4000-8000-000000000001',
    name: 'SkyConnect',
    path: '/dev/ttyUSB0',
    firmware: 'SL-OPENTHREAD/2.4.4.0',
    isConnected: true,
  },
  network: {
    name: 'NebulaHome-1A2B',
    channel: 15,
    panId: '0x1a2b',
    extPanId: 'dead00beef00cafe',
    meshLocalPrefix: 'fd11:22::/64',
    role: 'leader',
  },
  devices: { routers: 3, endDevices: 2, sleepy: 2, total: 6, online: 6 },
  ipv6: { isOk: true, interface: 'eth0', fixes: [] },
  useForMatter: true,
  setup: null,
};

/** The same network on a host that does not take the border router's routes. */
export const THREAD_SAMPLE_IPV6: ThreadStatus = {
  ...THREAD_SAMPLE_STATUS,
  ipv6: {
    isOk: false,
    interface: 'eth0',
    fixes: [
      { key: 'net.ipv6.conf.eth0.accept_ra', current: '1', wanted: '2' },
      { key: 'net.ipv6.conf.eth0.accept_ra_rt_info_max_plen', current: '0', wanted: '64' },
    ],
  },
};

/** Thread before it is set up, a radio plugged in. */
export const THREAD_SAMPLE_BEFORE: ThreadStatus = {
  ...THREAD_SAMPLE_STATUS,
  state: 'disabled',
  mode: 'none',
  borderRouter: null,
  radio: null,
  network: null,
  devices: { routers: 0, endDevices: 0, sleepy: 0, total: 0, online: 0 },
};

/** Thread on a bridge network: Set up cannot run. */
export const THREAD_SAMPLE_NO_HOST: ThreadStatus = {
  ...THREAD_SAMPLE_BEFORE,
  setupBlockedBy: 'bridge',
};

/**
 * One device on the network.
 *
 * @param fields - What tells it apart.
 * @returns The device.
 */
function node(
  fields: Partial<ThreadDevice> & Pick<ThreadDevice, 'extAddress' | 'role'>,
): ThreadDevice {
  return {
    deviceId: null,
    name: null,
    areaId: null,
    parentExtAddress: null,
    parentName: null,
    linkQuality: 3,
    rssi: -60,
    lastSeenAt: ago(10),
    ...fields,
  };
}

/** The devices on the network, the house's first. */
export const THREAD_SAMPLE_DEVICES: ThreadDevice[] = [
  node({
    extAddress: '1a2b3c4d5e6f7081',
    role: 'router',
    deviceId: 'matter-kitchen-plug',
    name: 'Kitchen Plug',
    areaId: SAMPLE_ROOMS.kitchen,
    lastSeenAt: ago(5),
  }),
  node({
    extAddress: '2b3c4d5e6f708192',
    role: 'router',
    deviceId: 'matter-hallway-light',
    name: 'Hallway light',
    areaId: SAMPLE_ROOMS.hall,
    lastSeenAt: ago(12),
  }),
  node({
    extAddress: '3c4d5e6f708192a3',
    role: 'router',
    deviceId: 'matter-office-plug',
    name: 'Office Plug',
    areaId: SAMPLE_ROOMS.office,
    linkQuality: 2,
    lastSeenAt: ago(8),
  }),
  node({
    extAddress: '4d5e6f708192a3b4',
    role: 'end-device',
    deviceId: 'matter-living-blinds',
    name: 'Living room blinds',
    areaId: SAMPLE_ROOMS.living,
    parentExtAddress: '1a2b3c4d5e6f7081',
    parentName: 'Kitchen Plug',
    lastSeenAt: ago(30),
  }),
  node({
    extAddress: '5e6f708192a3b4c5',
    role: 'sleepy',
    deviceId: 'matter-bedroom-window',
    name: 'Bedroom window',
    areaId: SAMPLE_ROOMS.bedroom,
    parentExtAddress: '2b3c4d5e6f708192',
    parentName: 'Hallway light',
    linkQuality: 2,
    lastSeenAt: ago(240),
  }),
  node({
    extAddress: '6f708192a3b4c5d6',
    role: 'sleepy',
    deviceId: 'matter-terrace-weather',
    name: 'Terrace weather',
    parentExtAddress: '3c4d5e6f708192a3',
    parentName: 'Office Plug',
    linkQuality: 1,
    lastSeenAt: ago(540),
  }),
  node({
    extAddress: '6a3f9c210b4e7d10',
    role: 'end-device',
    parentExtAddress: '3c4d5e6f708192a3',
    parentName: 'Office Plug',
    linkQuality: 2,
    lastSeenAt: ago(60),
  }),
];

/** The border routers heard. */
export const THREAD_SAMPLE_BORDER_ROUTERS: ThreadBorderRouter[] = [
  {
    id: 'nebula',
    name: 'NebulaHome Border Router',
    vendor: 'NebulaHome',
    model: 'Border Router',
    networkName: 'NebulaHome-1A2B',
    extPanId: 'dead00beef00cafe',
    address: '192.168.1.10',
    isThisServer: true,
    isSameNetwork: true,
  },
  {
    id: 'homepod',
    name: 'Living room HomePod',
    vendor: 'Apple',
    model: 'HomePod mini',
    networkName: 'NebulaHome-1A2B',
    extPanId: 'dead00beef00cafe',
    address: '192.168.1.42',
    isThisServer: false,
    isSameNetwork: true,
  },
  {
    id: 'nest',
    name: 'Kitchen display',
    vendor: 'Google',
    model: 'Nest Hub (2nd gen)',
    networkName: 'NEST-PAN-7C21',
    extPanId: '7c21aa55c0ffee00',
    address: '192.168.1.57',
    isThisServer: false,
    isSameNetwork: false,
  },
];

/** The ports a radio could be on. */
export const THREAD_SAMPLE_RADIOS: ThreadRadio[] = [
  {
    portId: '5e000000-0000-4000-8000-000000000001',
    name: 'Nabu Casa SkyConnect',
    path: '/dev/serial/by-id/usb-Nabu_Casa_SkyConnect_v1.0_9e2adbd7…-if00-port0',
    model: 'SkyConnect',
    flasherUrl: null,
  },
  {
    portId: '5e000000-0000-4000-8000-000000000004',
    name: 'FTDI FT232R USB UART',
    path: '/dev/serial/by-id/usb-VictronEnergy_BV_VE_Direct_cable_VE4XQ2BC-if00-port0',
    model: null,
    flasherUrl: null,
  },
];

/**
 * A cache already holding the network, for its pages drawn with no server.
 *
 * @param status - Where the network stands.
 * @returns The cache.
 */
export function threadSampleCache(status: ThreadStatus = THREAD_SAMPLE_STATUS): QueryClient {
  const client = brokerSampleCache();

  client.setQueryData(THREAD_QUERY_KEYS.status, status);
  client.setQueryData(THREAD_QUERY_KEYS.devices, THREAD_SAMPLE_DEVICES);
  client.setQueryData(THREAD_QUERY_KEYS.borderRouters, THREAD_SAMPLE_BORDER_ROUTERS);
  client.setQueryData(THREAD_QUERY_KEYS.radios, THREAD_SAMPLE_RADIOS);
  client.setQueryData([...THREAD_QUERY_KEYS.radios, 'check', THREAD_SAMPLE_RADIOS[0]?.portId], {
    firmware: 'openthread-rcp',
    version: 'SL-OPENTHREAD/2.4.4.0',
    error: null,
  });
  client.setQueryData(['brokers', 'thread', 'dataset'], {
    dataset: '0e080000000000010000000300000f35060004001fffe0',
  });

  return client;
}
