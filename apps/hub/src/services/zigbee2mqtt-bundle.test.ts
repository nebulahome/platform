/**
 * The Zigbee2MQTT bundle: how a device's `exposes` become entities, states and commands, and how
 * its transport and its listener read the broker - against payloads as Zigbee2MQTT 2 publishes
 * them, and a fake MQTT session the test drives.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  declaredCapabilitiesSchema,
  getSensorClass,
  parseEntityId,
  sensorRegistrationIssue,
  type EntityId,
} from '@nebula-home/contracts';
import { createLogger } from '@nebula-home/logging';
import {
  defineAccount,
  defineStreamSource,
  defineTransport,
  type BundleSdk,
  type DiscoverySource,
  type EntityDescriptor,
  type Integration,
  type ManagedMqtt,
  type ManagedMqttOptions,
  type Transport,
  type TransportInbound,
} from '@nebula-home/package-runtime';

/** A vendor with nothing saved: what a listener that needs no settings is handed. */
const NO_SETTINGS = { settings: async (): Promise<Record<string, never>> => Promise.resolve({}) };

/** The bundle, where it ships. */
const BUNDLE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../bundles/zigbee2mqtt');

/** What `exposes.js` exports. */
type ExposesModule = {
  readonly SENSOR_CLASSES: Readonly<
    Record<string, { deviceClass: string; unit: string; from: Record<string, number> }[]>
  >;
  readonly xyToHs: (x: number, y: number) => { hue: number; saturation: number };
};

/** A lamp with colour and colour temperature, as `bridge/devices` lists it. */
const LAMP = {
  ieee_address: '0x001788010b2c3d4e',
  friendly_name: 'Living room lamp',
  type: 'Router',
  supported: true,
  disabled: false,
  interview_state: 'SUCCESSFUL',
  software_build_id: '1.93.11',
  definition: {
    model: '9290022166',
    vendor: 'Philips',
    description: 'Hue white and color ambiance E27',
    supports_ota: true,
    exposes: [
      {
        type: 'light',
        features: [
          {
            type: 'binary',
            name: 'state',
            property: 'state',
            access: 7,
            value_on: 'ON',
            value_off: 'OFF',
          },
          {
            type: 'numeric',
            name: 'brightness',
            property: 'brightness',
            access: 7,
            value_min: 0,
            value_max: 254,
          },
          {
            type: 'numeric',
            name: 'color_temp',
            property: 'color_temp',
            access: 7,
            value_min: 153,
            value_max: 500,
            unit: 'mired',
          },
          {
            type: 'composite',
            name: 'color_xy',
            property: 'color',
            access: 7,
            features: [
              { type: 'numeric', name: 'x', property: 'x', access: 7 },
              { type: 'numeric', name: 'y', property: 'y', access: 7 },
            ],
          },
        ],
      },
      {
        type: 'numeric',
        name: 'linkquality',
        property: 'linkquality',
        access: 1,
        unit: 'lqi',
        category: 'diagnostic',
      },
    ],
  },
};

/** A door sensor with a battery and a button, as `bridge/devices` lists it. */
const DOOR = {
  ieee_address: '0x00158d0001a2b3c4',
  friendly_name: 'hall/front door',
  type: 'EndDevice',
  supported: true,
  interview_state: 'SUCCESSFUL',
  definition: {
    model: 'MCCGQ11LM',
    vendor: 'Aqara',
    exposes: [
      {
        type: 'binary',
        name: 'contact',
        property: 'contact',
        access: 1,
        value_on: true,
        value_off: false,
      },
      { type: 'numeric', name: 'battery', property: 'battery', access: 1, unit: '%' },
      { type: 'numeric', name: 'temperature', property: 'temperature', access: 1, unit: '°C' },
      { type: 'numeric', name: 'pressure', property: 'pressure', access: 1, unit: 'psi-ish' },
      { type: 'binary', name: 'led', property: 'led', access: 7, value_on: true, value_off: false },
      { type: 'enum', name: 'action', property: 'action', access: 1, values: ['single', 'double'] },
    ],
  },
};

/** The coordinator, which is never offered. */
const COORDINATOR = {
  ieee_address: '0x00124b0021aabbcc',
  friendly_name: 'Coordinator',
  type: 'Coordinator',
  interview_state: 'SUCCESSFUL',
  definition: null,
};

/** What `bridge/info` says. */
const INFO = {
  version: '2.14.1',
  permit_join: false,
  coordinator: { ieee_address: '0x00124b0021aabbcc', type: 'EmberZNet' },
};

/** A fake MQTT session the test drives. */
type FakeMqtt = {
  readonly options: ManagedMqttOptions;
  readonly topics: string[];
  readonly published: { topic: string; payload: string }[];
  closes: number;
};

/**
 * An SDK whose MQTT sessions the test holds, on a platform with a broker.
 *
 * @param sessions - Where each opened session goes.
 * @returns The SDK.
 */
function sdkWith(sessions: FakeMqtt[]): BundleSdk {
  return {
    version: '1.3.0',
    z,
    logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
    defineTransport,
    openWebSocket: () => {
      throw new Error('unused');
    },
    openUdpSocket: () => {
      throw new Error('unused');
    },
    openMqtt: (options): ManagedMqtt => {
      const fake: FakeMqtt = { options, topics: [], published: [], closes: 0 };

      sessions.push(fake);

      return {
        isConnected: true,
        subscribe: (topic) => {
          fake.topics.push(topic);
        },
        unsubscribe: () => undefined,
        publish: (topic, payload) => {
          fake.published.push({ topic, payload: payload.toString() });

          return Promise.resolve();
        },
        close: () => {
          fake.closes += 1;

          return Promise.resolve();
        },
      };
    },
    defineStreamSource,
    defineAccount,
    openRtsp: () => {
      throw new Error('unused');
    },
    platform: { mqtt: { url: 'mqtt://127.0.0.1:1884', username: 'nebula', password: 'secret' } },
  };
}

/**
 * Hands a fake session a message, as the broker would.
 *
 * @param session - The session.
 * @param topic - Where it arrives.
 * @param payload - What it says, as JSON.
 */
function arrive(session: FakeMqtt | undefined, topic: string, payload: unknown): void {
  session?.options.onMessage(topic, Buffer.from(JSON.stringify(payload)));
}

let exposes: ExposesModule;
let createDevice: (sdk: BundleSdk) => Integration;
let createTransport: (sdk: BundleSdk) => Transport;
let createDiscovery: (sdk: BundleSdk, options?: { silenceMs?: number }) => DiscoverySource;

beforeAll(async () => {
  exposes = (await import(
    pathToFileURL(path.join(BUNDLE, 'device/exposes.js')).href
  )) as ExposesModule;
  createDevice = (
    (await import(pathToFileURL(path.join(BUNDLE, 'device/index.js')).href)) as {
      default: typeof createDevice;
    }
  ).default;
  createTransport = (
    (await import(pathToFileURL(path.join(BUNDLE, 'mqtt/transport.js')).href)) as {
      default: typeof createTransport;
    }
  ).default;
  createDiscovery = (
    (await import(pathToFileURL(path.join(BUNDLE, 'mqtt/discovery.js')).href)) as {
      default: typeof createDiscovery;
    }
  ).default;
});

/**
 * The device driver's claim and entity ids for one device, as the hub would hold them.
 *
 * @param device - The device's entry.
 * @returns The driver, its claim, its entities, and the ids the hub would have given them.
 * @throws {Error} When the driver does not claim the device.
 */
function held(device: Record<string, unknown>) {
  const driver = createDevice(sdkWith([]));
  const claim = driver.claim(
    {
      deviceKey: String(device['ieee_address']),
      payload: { role: 'device', ieee: device['ieee_address'], device },
    },
    {},
  );

  if (claim === null) {
    throw new Error('not claimed');
  }

  const described = driver.describe(claim, {});
  const entities = new Map<string, EntityId>(
    described.entities.map((entity) => [
      entity.objectId ?? '',
      parseEntityId(`${entity.domain}.dev_${entity.objectId ?? ''}`),
    ]),
  );
  const context = { options: {}, claim, entities, lastState: () => undefined };

  return { driver, claim, described, entities, context };
}

/**
 * A message from the transport.
 *
 * @param deviceKey - Which device.
 * @param payload - What the transport handed on.
 * @returns The message.
 */
function inbound(deviceKey: string, payload: unknown): TransportInbound {
  return { connectionKey: 'test', deviceKey, payload };
}

describe('describing a device from its exposes', () => {
  it('makes a light of a lamp, with colour, temperature, brightness and its firmware', () => {
    const { described } = held(LAMP);

    expect(described).toMatchObject({
      externalId: LAMP.ieee_address,
      name: 'Living room lamp',
      manufacturer: 'Philips',
      model: '9290022166',
      swVersion: '1.93.11',
    });
    expect(described.entities.map((entity) => `${entity.domain}.${entity.objectId ?? ''}`)).toEqual(
      ['light.light', 'sensor.linkquality', 'update.firmware'],
    );
    expect(described.entities[0]?.capabilities).toEqual({
      on_off: {},
      level: { hasTransition: true },
      color_temp: { minMireds: 153, maxMireds: 500 },
      color_hs: {},
    });
  });

  it('reads a sensor, keeps a class only for a unit it takes, and leaves settings out', () => {
    const { described } = held(DOOR);
    const byId = new Map(described.entities.map((entity) => [entity.objectId, entity]));

    expect([...byId.keys()]).toEqual(['contact', 'battery', 'temperature', 'pressure', 'action']);
    expect(byId.get('contact')).toMatchObject({ domain: 'binary_sensor', deviceClass: 'door' });
    expect(byId.get('temperature')).toMatchObject({
      deviceClass: 'temperature',
      unitOfMeasurement: '°C',
    });
    expect(byId.get('pressure')).not.toHaveProperty('deviceClass');
    expect(byId.get('action')).toMatchObject({
      domain: 'sensor',
      capabilities: { sensor_text: {} },
    });
  });

  it('describes only entities the platform will register', () => {
    for (const device of [LAMP, DOOR]) {
      for (const entity of held(device).described.entities as EntityDescriptor[]) {
        expect(declaredCapabilitiesSchema.safeParse(entity.capabilities).success).toBe(true);
        expect(sensorRegistrationIssue(entity)).toBe(undefined);
      }
    }
  });

  it('names only sensor classes the platform has, with units they take', () => {
    for (const candidates of Object.values(exposes.SENSOR_CLASSES)) {
      for (const candidate of candidates) {
        const known = getSensorClass(candidate.deviceClass);

        expect(known, candidate.deviceClass).toBeDefined();

        expect(
          sensorRegistrationIssue({
            deviceClass: candidate.deviceClass,
            unitOfMeasurement: candidate.unit,
          }),
          `${candidate.deviceClass} ${candidate.unit}`,
        ).toBe(undefined);
        expect(candidate.from[candidate.unit]).toBe(1);
      }
    }
  });
});

describe('reading what a device says', () => {
  it('reads a lamp’s state, its colour given as x and y, and its offered firmware', () => {
    const { driver, context, entities } = held(LAMP);
    const reports = driver.toState(
      inbound(LAMP.ieee_address, {
        kind: 'state',
        state: {
          state: 'ON',
          brightness: 127,
          color_temp: 370,
          color: { x: 0.64, y: 0.33 },
          linkquality: 87,
          update: { state: 'available', installed_version: 16_782_848, latest_version: 16_782_850 },
        },
      }),
      context,
    );

    expect(reports).toContainEqual({
      entityId: entities.get('light'),
      state: {
        on_off: { isOn: true },
        level: { level: 50 },
        color_temp: { mireds: 370 },
        color_hs: { hue: 0, saturation: 100 },
      },
      isAvailable: true,
    });
    expect(reports).toContainEqual({
      entityId: entities.get('firmware'),
      state: {
        update: {
          installedVersion: '16782848',
          latestVersion: '16782850',
          isInstalling: false,
          progress: null,
        },
      },
      isAvailable: true,
    });
  });

  it('reads a closed door as closed, and only what the message says', () => {
    const { driver, context, entities } = held(DOOR);
    const reports = driver.toState(
      inbound(DOOR.ieee_address, { kind: 'state', state: { contact: true } }),
      context,
    );

    expect(reports).toEqual([
      {
        entityId: entities.get('contact'),
        state: { sensor_binary: { isOn: false } },
        isAvailable: true,
      },
    ]);
  });

  it('makes every entity unavailable when Zigbee2MQTT says the device went away', () => {
    const { driver, context } = held(DOOR);
    const reports = driver.toState(
      inbound(DOOR.ieee_address, { kind: 'availability', isOnline: false }),
      context,
    );

    expect(reports).toHaveLength(5);
    expect(reports.every((report) => report.isAvailable === false)).toBe(true);
  });
});

describe('telling a device what to do', () => {
  it('sets the property the expose names, by IEEE address', () => {
    const { driver, context, entities } = held(LAMP);
    const light = entities.get('light');

    if (light === undefined) {
      throw new Error('no light');
    }

    expect(
      driver.toCommand(
        { entityId: light, capability: 'level', command: { command: 'set_level', level: 50 } },
        context,
      ),
    ).toEqual({ deviceKey: LAMP.ieee_address, op: 'set', args: { payload: { brightness: 127 } } });
    expect(
      driver.toCommand(
        { entityId: light, capability: 'on_off', command: { command: 'turn_off' } },
        context,
      ),
    ).toEqual({ deviceKey: LAMP.ieee_address, op: 'set', args: { payload: { state: 'OFF' } } });
  });

  it('asks the bridge to install an offered firmware', () => {
    const { driver, context, entities } = held(LAMP);
    const firmware = entities.get('firmware');

    if (firmware === undefined) {
      throw new Error('no firmware entity');
    }

    expect(
      driver.toCommand(
        { entityId: firmware, capability: 'update', command: { command: 'install' } },
        context,
      ),
    ).toMatchObject({ op: 'ota_update' });
  });
});

describe('xyToHs', () => {
  it('reads the sRGB primaries as their hues', () => {
    expect(exposes.xyToHs(0.64, 0.33)).toEqual({ hue: 0, saturation: 100 });
    expect(exposes.xyToHs(0.3, 0.6).hue).toBe(120);
    expect(exposes.xyToHs(0.15, 0.06).hue).toBe(240);
  });
});

describe('the transport', () => {
  it('hands each message to the device it is about, by IEEE address, and the bridge its own', async () => {
    const sessions: FakeMqtt[] = [];
    const transport = createTransport(sdkWith(sessions));
    const delivered: TransportInbound[] = [];
    const connection = await transport.connect(
      {},
      {
        logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
        deliver: (message) => delivered.push(message),
        report: () => undefined,
      },
    );
    const [session] = sessions;

    expect(session?.topics).toEqual(['zigbee2mqtt/#']);

    arrive(session, 'zigbee2mqtt/bridge/devices', [COORDINATOR, LAMP, DOOR]);
    arrive(session, 'zigbee2mqtt/bridge/state', { state: 'online' });
    arrive(session, 'zigbee2mqtt/hall/front door', { contact: false });
    arrive(session, 'zigbee2mqtt/hall/front door/availability', { state: 'offline' });
    arrive(session, 'zigbee2mqtt/hall/front door/set', { state: 'ON' });

    expect(delivered.at(-1)).toEqual({
      connectionKey: connection.key,
      deviceKey: DOOR.ieee_address,
      payload: { kind: 'availability', isOnline: false },
    });
    expect(delivered).toContainEqual({
      connectionKey: connection.key,
      deviceKey: DOOR.ieee_address,
      payload: { kind: 'state', state: { contact: false } },
    });
    expect(delivered).toContainEqual({
      connectionKey: connection.key,
      deviceKey: 'bridge',
      payload: { state: 'online', info: null, deviceCount: 2 },
    });

    await connection.send(
      { deviceKey: LAMP.ieee_address, op: 'set', args: { payload: { state: 'ON' } } },
      AbortSignal.timeout(1000),
    );
    await connection.send(
      { deviceKey: 'bridge', op: 'permit_join', args: { time: 254 } },
      AbortSignal.timeout(1000),
    );

    expect(session?.published).toEqual([
      { topic: `zigbee2mqtt/${LAMP.ieee_address}/set`, payload: '{"state":"ON"}' },
      { topic: 'zigbee2mqtt/bridge/request/permit_join', payload: '{"time":254}' },
    ]);

    await connection.close();
  });

  it('hands on again what it heard before the devices were bound, when the instances change', async () => {
    // Zigbee2MQTT's retained messages arrive once, the moment the session subscribes - before
    // the hub has bound the bridge an instance is adding. Without the replay the pairing switch
    // would stay unknown until Zigbee2MQTT next said something about the bridge.
    const sessions: FakeMqtt[] = [];
    const transport = createTransport(sdkWith(sessions));
    const delivered: TransportInbound[] = [];
    const connection = await transport.connect(
      {},
      {
        logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
        deliver: (message) => delivered.push(message),
        report: () => undefined,
      },
    );
    const [session] = sessions;

    arrive(session, 'zigbee2mqtt/bridge/info', INFO);
    arrive(session, 'zigbee2mqtt/bridge/devices', [COORDINATOR, DOOR]);
    arrive(session, 'zigbee2mqtt/hall/front door/availability', { state: 'online' });
    arrive(session, 'zigbee2mqtt/hall/front door', { contact: true });
    delivered.length = 0;

    await connection.apply([]);

    expect(delivered).toContainEqual({
      connectionKey: connection.key,
      deviceKey: 'bridge',
      payload: { state: null, info: INFO, deviceCount: 1 },
    });
    expect(delivered).toContainEqual({
      connectionKey: connection.key,
      deviceKey: DOOR.ieee_address,
      payload: { kind: 'availability', isOnline: true },
    });
    expect(delivered).toContainEqual({
      connectionKey: connection.key,
      deviceKey: DOOR.ieee_address,
      payload: { kind: 'state', state: { contact: true } },
    });

    await connection.close();
  });

  it('hands nothing of the bridge on again before the bridge said anything', async () => {
    const sessions: FakeMqtt[] = [];
    const transport = createTransport(sdkWith(sessions));
    const delivered: TransportInbound[] = [];
    const connection = await transport.connect(
      {},
      {
        logger: createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' }),
        deliver: (message) => delivered.push(message),
        report: () => undefined,
      },
    );

    await connection.apply([]);

    expect(delivered).toEqual([]);
    await connection.close();
  });

  it('finds the bridge and the devices ready to add, never the coordinator', async () => {
    const sessions: FakeMqtt[] = [];
    const transport = createTransport(sdkWith(sessions));
    const abort = new AbortController();
    const found: unknown[] = [];
    const scanning = (async () => {
      for await (const discovered of transport.scan({}, {}, abort.signal)) {
        found.push(discovered.deviceKey);

        if (found.length === 3) {
          abort.abort();
        }
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 10));
    arrive(sessions[0], 'zigbee2mqtt/bridge/info', INFO);
    arrive(sessions[0], 'zigbee2mqtt/bridge/devices', [COORDINATOR, LAMP, DOOR]);
    await scanning;

    expect(found).toEqual(['bridge', LAMP.ieee_address, DOOR.ieee_address]);
    expect(sessions[0]?.closes).toBe(1);
  });
});

describe('the listener', () => {
  it('proposes the bridge and each device, and asks nothing of Zigbee2MQTT', async () => {
    const sessions: FakeMqtt[] = [];
    const listener = createDiscovery(sdkWith(sessions));
    const abort = new AbortController();
    const heard: Record<string, unknown>[] = [];
    const listening = (async () => {
      for await (const sighting of listener.listen(abort.signal, NO_SETTINGS)) {
        heard.push(sighting.payload);

        if (heard.length === 3) {
          abort.abort();
        }
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 10));
    arrive(sessions[0], 'zigbee2mqtt/bridge/info', INFO);
    arrive(sessions[0], 'zigbee2mqtt/bridge/devices', [COORDINATOR, LAMP, DOOR]);
    await listening;

    expect(heard.map((payload) => [payload['role'], payload['ieee']])).toEqual([
      ['bridge', '0x00124b0021aabbcc'],
      ['device', LAMP.ieee_address],
      ['device', DOOR.ieee_address],
    ]);
    // Pairing is the bridge's switch, not a side effect of looking: a network scan of every
    // vendor must not open the Zigbee network.
    expect(listener.scan).toBeUndefined();
    expect(sessions[0]?.published).toEqual([]);
  });

  it('says which devices it does not propose, and why', async () => {
    const sessions: FakeMqtt[] = [];
    const listener = createDiscovery(sdkWith(sessions));
    const abort = new AbortController();
    const passedOver: unknown[] = [];
    const listening = (async () => {
      for await (const sighting of listener.listen(abort.signal, {
        ...NO_SETTINGS,
        passedOver: (devices) => {
          passedOver.push(...devices);
          abort.abort();
        },
      })) {
        // Only what is passed over is looked at here.
        expect(sighting).toBeDefined();
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 10));
    arrive(sessions[0], 'zigbee2mqtt/bridge/devices', [
      COORDINATOR,
      { ...DOOR, interview_state: 'IN_PROGRESS' },
      { ...LAMP, supported: false, definition: null },
    ]);
    await listening;

    expect(passedOver).toEqual([
      expect.objectContaining({ id: DOOR.ieee_address, reason: 'Zigbee2MQTT is still pairing it' }),
      expect.objectContaining({
        id: LAMP.ieee_address,
        name: LAMP.friendly_name,
        reason: 'Zigbee2MQTT does not support this model yet',
      }),
    ]);
  });

  it('says so when it is connected but hears nothing of Zigbee2MQTT', async () => {
    // The one way this goes wrong is silently: Zigbee2MQTT on one broker, NebulaHome on another.
    const sessions: FakeMqtt[] = [];
    const listener = createDiscovery(sdkWith(sessions), { silenceMs: 20 });
    const abort = new AbortController();
    const statuses: { level: string; message: string }[] = [];
    const listening = (async () => {
      for await (const sighting of listener.listen(abort.signal, {
        ...NO_SETTINGS,
        status: (status) => {
          statuses.push(status);

          if (status.level === 'warning') {
            abort.abort();
          }
        },
      })) {
        // Nothing is heard here.
        expect(sighting).toBeDefined();
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 5));
    sessions[0]?.options.onConnect?.();
    await listening;

    expect(statuses.map((status) => status.level)).toEqual(['ok', 'warning']);
    expect(statuses[1]?.message).toContain('mqtt://127.0.0.1:1884');
  });

  it('says Zigbee2MQTT is online once it hears the bridge, and no warning after', async () => {
    const sessions: FakeMqtt[] = [];
    const listener = createDiscovery(sdkWith(sessions), { silenceMs: 20 });
    const abort = new AbortController();
    const statuses: string[] = [];
    const listening = (async () => {
      for await (const sighting of listener.listen(abort.signal, {
        ...NO_SETTINGS,
        status: (status) => {
          statuses.push(status.level);
        },
      })) {
        // Nothing is heard here.
        expect(sighting).toBeDefined();
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 5));
    sessions[0]?.options.onConnect?.();
    arrive(sessions[0], 'zigbee2mqtt/bridge/state', { state: 'online' });
    await new Promise((resolve) => setTimeout(resolve, 40));
    abort.abort();
    await listening;

    expect(statuses).toEqual(['ok', 'ok']);
  });

  it('says it cannot reach the broker when the session fails', async () => {
    const sessions: FakeMqtt[] = [];
    const listener = createDiscovery(sdkWith(sessions));
    const abort = new AbortController();
    const statuses: { level: string; message: string }[] = [];
    const listening = (async () => {
      for await (const sighting of listener.listen(abort.signal, {
        ...NO_SETTINGS,
        status: (status) => {
          statuses.push(status);
          abort.abort();
        },
      })) {
        // Nothing is heard here.
        expect(sighting).toBeDefined();
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 5));
    sessions[0]?.options.onClose?.('connect ECONNREFUSED 127.0.0.1:1884');
    await listening;

    expect(statuses[0]?.level).toBe('error');
    expect(statuses[0]?.message).toContain('ECONNREFUSED');
  });

  it('names a device just paired for what it is, not by its IEEE address', async () => {
    const sessions: FakeMqtt[] = [];
    const listener = createDiscovery(sdkWith(sessions));
    const abort = new AbortController();
    const heard: Record<string, unknown>[] = [];
    const listening = (async () => {
      for await (const sighting of listener.listen(abort.signal, NO_SETTINGS)) {
        heard.push(sighting.payload);
        abort.abort();
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 10));
    arrive(sessions[0], 'zigbee2mqtt/bridge/devices', [
      { ...DOOR, friendly_name: DOOR.ieee_address },
    ]);
    await listening;

    expect(heard[0]?.['name']).toBe(`${DOOR.definition.vendor} ${DOOR.definition.model}`);
  });
});
