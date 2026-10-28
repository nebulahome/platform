/**
 * The hub's Thread, Bluetooth, Serial and Infrared brokers and Matter's networks, on the
 * harness's bus.
 *
 * Each method a route test drives is served with the contracts' own request schema, so a body the
 * api builds wrong fails here as it would in the hub. What each was asked is kept in order in
 * {@link brokerRequests}; a status method named in {@link failingStatuses} refuses, as a broker
 * the hub cannot read would.
 */
import { z } from 'zod';

import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  bluetoothAddRequestSchema,
  bluetoothNearbyLeaseRequestSchema,
  bluetoothProxyAddRequestSchema,
  bluetoothProxyDeviceRequestSchema,
  bluetoothProxyJobRequestSchema,
  bluetoothProxyModeRequestSchema,
  bluetoothSettingsSchema,
  busSubjects,
  ConflictError,
  HUB_BLUETOOTH_ADD_METHOD,
  HUB_BLUETOOTH_DEVICES_METHOD,
  HUB_BLUETOOTH_NEARBY_LEASE_METHOD,
  HUB_BLUETOOTH_PROXY_ADD_METHOD,
  HUB_BLUETOOTH_PROXY_JOB_METHOD,
  HUB_BLUETOOTH_PROXY_MODE_METHOD,
  HUB_BLUETOOTH_PROXY_REMOVE_METHOD,
  HUB_BLUETOOTH_STATUS_METHOD,
  HUB_INFRARED_BUTTON_PRESS_METHOD,
  HUB_INFRARED_BUTTON_REMOVE_METHOD,
  HUB_INFRARED_BUTTON_SAVE_METHOD,
  HUB_INFRARED_LEARN_METHOD,
  HUB_INFRARED_REMOTE_REMOVE_METHOD,
  HUB_INFRARED_REMOTE_SAVE_METHOD,
  HUB_INFRARED_REMOTES_METHOD,
  HUB_INFRARED_STATUS_METHOD,
  HUB_MATTER_ANSWER_METHOD,
  HUB_MATTER_NETWORKS_METHOD,
  HUB_MATTER_NETWORKS_SAVE_METHOD,
  HUB_SERIAL_CONSOLE_OPEN_METHOD,
  HUB_SERIAL_CONSOLE_READ_METHOD,
  HUB_SERIAL_CONSOLE_WRITE_METHOD,
  HUB_SERIAL_FORGET_METHOD,
  HUB_SERIAL_NETWORK_PORT_SAVE_METHOD,
  HUB_SERIAL_PORTS_METHOD,
  HUB_SERIAL_SETTINGS_METHOD,
  HUB_SERIAL_STATUS_METHOD,
  HUB_SERVICE,
  HUB_THREAD_DATASET_METHOD,
  HUB_THREAD_JOIN_METHOD,
  HUB_THREAD_NETWORK_KEY_METHOD,
  HUB_THREAD_REMOVE_METHOD,
  HUB_THREAD_SETUP_METHOD,
  HUB_THREAD_STATUS_METHOD,
  infraredButtonSaveRequestSchema,
  infraredIdRequestSchema,
  infraredLearnRequestSchema,
  infraredRemoteSaveRequestSchema,
  matterAnswerRequestSchema,
  matterNetworksSaveRequestSchema,
  serialConsoleOpenRequestSchema,
  serialConsoleReadRequestSchema,
  serialConsoleWriteRequestSchema,
  serialNetworkPortSaveRequestSchema,
  serialPortIdRequestSchema,
  serialSettingsSchema,
  threadJoinRequestSchema,
  threadSetupRequestSchema,
  type BluetoothDevice,
  type BluetoothProxyJob,
  type BluetoothStatus,
  type InfraredButton,
  type InfraredRemote,
  type InfraredStatus,
  type MatterCommissioning,
  type MatterNetworks,
  type SerialPort,
  type SerialStatus,
  type ThreadStatus,
} from '@nebulahome/contracts';

/** What the fake brokers were asked, in order, with the request as the hub parsed it. */
export const brokerRequests: { method: string; request: unknown }[] = [];

/** The status methods that refuse, for a test of a broker the hub cannot read. */
export const failingStatuses = new Set<string>();

/** A moment the fixtures share. */
const AT = new Date('2026-10-28T08:00:00Z');

/** The one serial port: a USB adapter, free. */
export const SERIAL_PORT: SerialPort = {
  id: '5b0e2f6a-1c3d-4e5f-8a9b-0c1d2e3f4a5b',
  kind: 'usb',
  name: 'CP2102 USB to UART',
  path: '/dev/serial/by-id/usb-Silicon_Labs_CP2102-if00-port0',
  devicePath: '/dev/ttyUSB0',
  usb: {
    vendorId: '10c4',
    productId: 'ea60',
    serialNumber: null,
    manufacturer: 'Silicon Labs',
    product: 'CP2102',
  },
  network: null,
  holder: null,
  line: null,
  isConnected: true,
  isIgnored: false,
  claims: [],
  lastSeenAt: AT,
};

/** Where the Serial broker stands. */
const SERIAL_STATUS: SerialStatus = {
  state: 'running',
  error: null,
  access: 'ok',
  ports: { seen: 1, inUse: 0 },
  hotplug: { isWatching: true, lastChangeAt: null },
  conflicts: [],
  settings: { showBuiltin: false },
  devices: { total: 1, online: 1 },
};

/** The house's one Bluetooth device: a BTHome sensor. */
export const BLUETOOTH_SENSOR: BluetoothDevice = {
  deviceId: 'bluetooth-a4c138f0e1d2',
  name: 'Bedroom sensor',
  vendorId: 'bluetooth',
  areaId: null,
  address: 'A4:C1:38:F0:E1:D2',
  rssi: -71,
  heardBy: [],
  lastHeardAt: AT,
  link: 'listening',
  addedAt: AT,
};

/** Where the Bluetooth broker stands. */
const BLUETOOTH_STATUS: BluetoothStatus = {
  state: 'running',
  error: null,
  adapter: null,
  adapters: [],
  adapterProblem: 'no-adapter',
  proxies: { total: 1, reporting: 1 },
  heard: { devices: 3, advertsPerMinute: 40 },
  isMatterPairing: false,
  isForwardingAll: false,
  settings: bluetoothSettingsSchema.parse({}),
  devices: { total: 2, online: 1 },
};

/** A job making a plug a proxy, just started. */
const PROXY_JOB: BluetoothProxyJob = {
  id: 'proxy-1',
  state: 'running',
  startedAt: AT,
  finishedAt: null,
  error: null,
  steps: [{ id: 'installing', state: 'running', message: null }],
  deviceId: 'shelly-plug-1',
  mode: 'passive',
};

/** The house's one remote: a TV, its device not added yet. */
export const INFRARED_REMOTE: InfraredRemote = {
  id: '3d1f0c2b-4a5e-4b6c-8d7e-9f0a1b2c3d4e',
  name: 'Living room TV',
  kind: 'tv',
  blasterId: 'broadlink-rm4',
  blasterName: 'RM4 mini',
  isBlasterOnline: true,
  canRf: false,
  columns: 3,
  deviceId: null,
  areaId: null,
  buttonCount: 1,
  lastPressedAt: null,
};

/** The remote's one button. */
export const INFRARED_BUTTON: InfraredButton = {
  id: '7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d',
  remoteId: INFRARED_REMOTE.id,
  name: 'Power',
  icon: null,
  cell: 0,
  code: {
    signal: 'ir',
    carrierHz: 38_000,
    pulses: [9000, 4500, 560, 560],
    protocol: { name: 'nec', address: 4, command: 8 },
  },
  lastPressedAt: null,
};

/** Where the Infrared broker stands. */
const INFRARED_STATUS: InfraredStatus = {
  state: 'running',
  error: null,
  blasters: { total: 1, online: 1 },
  remotes: 1,
  lastSent: null,
  learning: [],
  devices: { total: 1, online: 1 },
};

/** Where the Thread broker stands: the platform's border router, leading the house's network. */
const THREAD_STATUS: ThreadStatus = {
  state: 'running',
  error: null,
  mode: 'local',
  setupBlockedBy: null,
  borderRouter: { isRunning: true, version: null, url: 'http://127.0.0.1:8081' },
  radio: null,
  network: {
    name: 'NebulaHome',
    channel: 15,
    panId: '0x1a2b',
    extPanId: '0011223344556677',
    meshLocalPrefix: 'fd11:22::/64',
    role: 'leader',
  },
  devices: { routers: 1, endDevices: 2, sleepy: 1, total: 3, online: 2 },
  ipv6: { isOk: true, interface: 'eth0', fixes: [] },
  useForMatter: true,
  setup: null,
};

/** The network key the fake border router holds. */
export const THREAD_NETWORK_KEY = '00112233445566778899aabbccddeeff';

/** The active dataset the fake border router holds. */
export const THREAD_DATASET = '0e080000000000010000000300000f35060004001fffe0';

/** The networks a new Matter device is given. */
const MATTER_NETWORKS: MatterNetworks = {
  wifi: { ssid: 'Casa', hasPassword: true },
  thread: { networkName: 'NebulaHome', channel: 15 },
};

/**
 * Serves the brokers on the hub's side of the bus.
 *
 * @param hub - The hub's client.
 * @returns The subscriptions, for the harness to end.
 */
export function serveBrokersFake(hub: BusClient): BusSubscription[] {
  /**
   * Serves one method, keeping what it was asked.
   *
   * @param method - The method.
   * @param schema - What it is asked, as the hub checks it.
   * @param answer - What it answers.
   * @returns The subscription.
   */
  const serve = <TSchema extends z.ZodType>(
    method: string,
    schema: TSchema,
    answer: (request: z.output<TSchema>) => unknown,
  ): BusSubscription =>
    hub.serve(busSubjects.service(HUB_SERVICE, method), schema, (request: z.output<TSchema>) => {
      if (failingStatuses.has(method)) {
        throw new ConflictError(`The fake hub refuses ${method}`);
      }

      brokerRequests.push({ method, request });

      return answer(request);
    });
  const empty = z.object({});

  return [
    serve(HUB_SERIAL_STATUS_METHOD, empty, () => SERIAL_STATUS),
    serve(HUB_SERIAL_PORTS_METHOD, empty, () => ({ items: [SERIAL_PORT] })),
    serve(HUB_SERIAL_SETTINGS_METHOD, serialSettingsSchema, (settings) => ({
      ...SERIAL_STATUS,
      settings,
    })),
    serve(HUB_SERIAL_NETWORK_PORT_SAVE_METHOD, serialNetworkPortSaveRequestSchema, (port) => ({
      ...SERIAL_PORT,
      id: port.id ?? '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
      kind: 'network',
      name: port.name,
      path: `tcp://${port.host}:${String(port.port)}`,
      devicePath: null,
      usb: null,
      network: { host: port.host, port: port.port, protocol: port.protocol },
    })),
    serve(HUB_SERIAL_FORGET_METHOD, serialPortIdRequestSchema, (request) => ({
      isRemoved: request.portId === SERIAL_PORT.id,
    })),
    serve(HUB_SERIAL_CONSOLE_OPEN_METHOD, serialConsoleOpenRequestSchema, (request) => ({
      consoleId: 'console-1',
      portId: request.portId,
      line: request.line,
      openedAt: AT,
    })),
    serve(HUB_SERIAL_CONSOLE_READ_METHOD, serialConsoleReadRequestSchema, (request) => ({
      chunks: [{ seq: 1, at: AT, direction: 'in', data: '4f4b0d0a' }],
      cursor: 1,
      isTruncated: false,
      isOpen: request.consoleId === 'console-1',
      error: null,
    })),
    serve(HUB_SERIAL_CONSOLE_WRITE_METHOD, serialConsoleWriteRequestSchema, (request) => ({
      bytes: request.data.length / 2 + (request.lineEnding === 'crlf' ? 2 : 0),
    })),

    serve(HUB_BLUETOOTH_STATUS_METHOD, empty, () => BLUETOOTH_STATUS),
    serve(HUB_BLUETOOTH_DEVICES_METHOD, empty, () => ({ items: [BLUETOOTH_SENSOR] })),
    serve(HUB_BLUETOOTH_NEARBY_LEASE_METHOD, bluetoothNearbyLeaseRequestSchema, (request) => ({
      isForwardingAll: request.isHeld,
      expiresAt: request.isHeld ? AT : null,
    })),
    serve(HUB_BLUETOOTH_ADD_METHOD, bluetoothAddRequestSchema, (request) => ({
      deviceId: `bluetooth-${request.address.replaceAll(':', '').toLowerCase()}`,
    })),
    serve(HUB_BLUETOOTH_PROXY_ADD_METHOD, bluetoothProxyAddRequestSchema, (request) => ({
      ...PROXY_JOB,
      deviceId: request.deviceId,
      mode: request.mode,
    })),
    serve(HUB_BLUETOOTH_PROXY_JOB_METHOD, bluetoothProxyJobRequestSchema, () => PROXY_JOB),
    serve(HUB_BLUETOOTH_PROXY_MODE_METHOD, bluetoothProxyModeRequestSchema, (request) => ({
      id: request.deviceId,
      kind: 'proxy',
      name: 'Kitchen plug',
      deviceId: request.deviceId,
      vendorId: 'shelly',
      areaId: null,
      address: null,
      chip: null,
      isOnline: true,
      isEnabled: true,
      scanMode: request.mode,
      canPassive: true,
      advertsPerMinute: 12,
      connections: null,
      forwarding: 'house',
      lastReportAt: AT,
      script: { version: '1.0.0', shipped: '1.0.0', isOutdated: false },
      hearsBest: [],
    })),
    serve(HUB_BLUETOOTH_PROXY_REMOVE_METHOD, bluetoothProxyDeviceRequestSchema, (request) => ({
      isRemoved: request.deviceId === PROXY_JOB.deviceId,
    })),

    serve(HUB_INFRARED_STATUS_METHOD, empty, () => INFRARED_STATUS),
    serve(HUB_INFRARED_REMOTES_METHOD, empty, () => ({ items: [INFRARED_REMOTE] })),
    serve(HUB_INFRARED_REMOTE_SAVE_METHOD, infraredRemoteSaveRequestSchema, (request) => ({
      ...INFRARED_REMOTE,
      id: request.id ?? '6e5d4c3b-2a1f-4e0d-9c8b-7a6f5e4d3c2b',
      name: request.name,
      kind: request.kind,
      blasterId: request.blasterId,
      buttonCount: 0,
    })),
    serve(HUB_INFRARED_REMOTE_REMOVE_METHOD, infraredIdRequestSchema, () => ({ isRemoved: true })),
    serve(HUB_INFRARED_BUTTON_SAVE_METHOD, infraredButtonSaveRequestSchema, (request) => ({
      ...INFRARED_BUTTON,
      ...request,
      id: request.id ?? INFRARED_BUTTON.id,
      cell: request.cell ?? 1,
    })),
    serve(HUB_INFRARED_BUTTON_REMOVE_METHOD, infraredIdRequestSchema, (request) => ({
      isRemoved: request.id === INFRARED_BUTTON.id,
    })),
    serve(HUB_INFRARED_BUTTON_PRESS_METHOD, infraredIdRequestSchema, () => ({ pressedAt: AT })),
    serve(HUB_INFRARED_LEARN_METHOD, infraredLearnRequestSchema, (request) => ({
      id: 'learn-1',
      blasterId: request.blasterId,
      blasterName: 'RM4 mini',
      signal: request.signal,
      phase: 'listening',
      startedAt: AT,
      finishedAt: null,
      endsAt: AT,
      frequencyHz: null,
      code: null,
      error: null,
    })),

    serve(HUB_THREAD_STATUS_METHOD, empty, () => THREAD_STATUS),
    serve(HUB_THREAD_SETUP_METHOD, threadSetupRequestSchema, () => THREAD_STATUS),
    serve(HUB_THREAD_JOIN_METHOD, threadJoinRequestSchema, () => THREAD_STATUS),
    serve(HUB_THREAD_REMOVE_METHOD, empty, () => ({ isRemoved: true })),
    serve(HUB_THREAD_NETWORK_KEY_METHOD, empty, () => ({ networkKey: THREAD_NETWORK_KEY })),
    serve(HUB_THREAD_DATASET_METHOD, empty, () => ({ dataset: THREAD_DATASET })),

    serve(HUB_MATTER_NETWORKS_METHOD, empty, () => MATTER_NETWORKS),
    serve(HUB_MATTER_NETWORKS_SAVE_METHOD, matterNetworksSaveRequestSchema, (request) => ({
      ...MATTER_NETWORKS,
      wifi: { ssid: request.wifi?.ssid ?? null, hasPassword: request.wifi !== null },
    })),
    serve(HUB_MATTER_ANSWER_METHOD, matterAnswerRequestSchema, (request): MatterCommissioning => ({
      id: request.jobId,
      state: request.isAccepted ? 'running' : 'cancelled',
      startedAt: AT,
      finishedAt: null,
      nodeId: null,
      error: null,
      steps: [],
      deviceId: null,
    })),
  ];
}
