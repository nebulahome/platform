/**
 * The house's MQTT broker for real: aedes on a port of its own, clients over TCP.
 *
 * What is asserted is that nobody connects without a password, and the hub with its own; that a
 * container's and a device's client are held to their topics; that an announcement and a state
 * become a device the platform's mapping reads, and a command the payload its topic expects; that
 * a removed client is dropped at once; that what was retained - and the hub's password - are still
 * there after a restart; that a port another program holds leaves the broker failed and trying
 * again; and that a device removed from the house is remembered until it is brought back.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import mqtt, { type MqttClient } from 'mqtt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from '@nebulahome/logging';
import { mqttStateOf } from '@nebulahome/package-runtime';

import { MqttBroker } from './broker.js';

const logger = createLogger({ service: 'hub', version: '0.0.0', level: 'fatal' });

let storageDir: string;
const brokers: MqttBroker[] = [];
const clients: MqttClient[] = [];

/**
 * A broker in the test's folder.
 *
 * @param port - Its port; one the system picks when not said.
 * @param retryMs - How often it tries again.
 * @returns It, started.
 */
async function started(port = 0, retryMs = 10_000): Promise<MqttBroker> {
  const broker = new MqttBroker({ storageDir, port, logger, retryMs });

  brokers.push(broker);
  await broker.start();

  return broker;
}

/**
 * Connects a client.
 *
 * @param port - The broker's port.
 * @param username - Its username; none for an anonymous one.
 * @param password - Its password.
 * @returns It, connected, or the error it was refused with.
 */
async function connect(port: number, username?: string, password?: string): Promise<MqttClient> {
  const client = mqtt.connect(`mqtt://127.0.0.1:${String(port)}`, {
    ...(username === undefined ? {} : { username, password: password ?? '' }),
    reconnectPeriod: 0,
    connectTimeout: 3000,
  });

  clients.push(client);

  return new Promise((resolve, reject) => {
    client.once('connect', () => {
      resolve(client);
    });
    client.once('error', reject);
  });
}

/**
 * The broker's port, once it listens.
 *
 * @param broker - The broker.
 * @returns The port.
 */
function portOf(broker: MqttBroker): number {
  return broker.status().port;
}

/**
 * Connects as the hub does.
 *
 * @param broker - The broker.
 * @returns The hub's client.
 */
async function connectAsHub(broker: MqttBroker): Promise<MqttClient> {
  const hub = broker.hubConnection();

  return connect(portOf(broker), hub?.username, hub?.password);
}

/**
 * Publishes and waits for the broker to have it.
 *
 * @param client - Who publishes.
 * @param topic - Where.
 * @param payload - What.
 * @param retain - Whether it is kept.
 */
async function publish(
  client: MqttClient,
  topic: string,
  payload: string,
  retain = false,
): Promise<void> {
  await client.publishAsync(topic, payload, { qos: 1, retain });
}

/** A plug that announces itself the way Tasmota does. */
const ANNOUNCEMENT = JSON.stringify({
  name: null,
  uniq_id: 'C82B96_RL_1',
  stat_t: 'stat/plug/POWER',
  cmd_t: 'cmnd/plug/POWER',
  avty_t: 'tele/plug/LWT',
  pl_avail: 'Online',
  pl_not_avail: 'Offline',
  dev: { ids: ['C82B96'], name: 'Desk lamp', mf: 'Itead', mdl: 'Sonoff S26' },
  o: { name: 'Tasmota' },
});

beforeEach(() => {
  storageDir = mkdtempSync(path.join(os.tmpdir(), 'hub-mqtt-'));
});

afterEach(async () => {
  await Promise.all(
    clients.splice(0).map(
      async (client) =>
        new Promise<void>((resolve) => {
          client.end(true, {}, () => {
            resolve();
          });
        }),
    ),
  );
  await Promise.all(brokers.splice(0).map(async (broker) => broker.stop()));
  rmSync(storageDir, { recursive: true, force: true });
});

describe('the house’s MQTT broker', () => {
  it('lets nobody in without a password, and the hub in with its own', async () => {
    const broker = await started();
    const port = portOf(broker);

    expect(broker.status().state).toBe('running');
    await expect(connect(port)).rejects.toThrow();
    await expect(connect(port, 'nebula-hub', 'wrong')).rejects.toThrow();
    await expect(connectAsHub(broker)).resolves.toBeDefined();
    expect(broker.hubConnection()?.url).toBe(`mqtt://127.0.0.1:${String(port)}`);
  });

  it('listens again once restarted', async () => {
    const broker = await started();

    expect((await broker.restart()).state).toBe('running');
    await expect(connectAsHub(broker)).resolves.toBeDefined();
  });

  it('holds a container and a device to their topics', async () => {
    const broker = await started();
    const port = portOf(broker);
    const container = await broker.containerCredentials('vendor:zigbee2mqtt', ['zigbee2mqtt/#']);
    const password = await broker.addClient({ username: 'plug', label: '', access: 'prefix' });

    expect(container).toMatchObject({ username: 'nebula-vendor-zigbee2mqtt', port });

    const z2m = await connect(port, container.username, container.password);
    const plug = await connect(port, 'plug', password);

    await publish(z2m, 'zigbee2mqtt/bridge/state', 'online');
    await publish(plug, 'plug/relay/0', 'on');
    await publish(plug, 'homeassistant/switch/plug/config', '');

    // A publish outside what it may reach closes its connection.
    const closed = new Promise<void>((resolve) => {
      plug.once('close', () => {
        resolve();
      });
    });

    plug.publish('zigbee2mqtt/bridge/request/permit_join', '{}', { qos: 0 });
    await closed;
    expect(broker.topics('', 10).items.map((topic) => topic.topic)).toContain('plug/relay/0');
  });

  it('turns an announcement and a state into a device, and a command into its payload', async () => {
    const broker = await started();
    const hub = await connectAsHub(broker);
    const heard = vi.fn<(deviceKey: string, changed: readonly string[] | null) => void>();

    broker.onDevice(heard);
    await publish(hub, 'homeassistant/switch/C82B96_RL_1/config', ANNOUNCEMENT, true);
    await publish(hub, 'tele/plug/LWT', 'Online', true);
    await publish(hub, 'stat/plug/POWER', 'ON');

    await vi.waitFor(() => {
      expect(heard).toHaveBeenCalledWith('C82B96', ['stat/plug/POWER']);
    });

    const device = broker.device('C82B96');
    const entity = device?.entities[0];

    expect(device?.identity).toMatchObject({
      name: 'Desk lamp',
      manufacturer: 'Itead',
      model: 'Sonoff S26',
      originName: 'Tasmota',
    });
    expect(
      entity === undefined || device === undefined
        ? undefined
        : mqttStateOf(entity, (topic) => broker.textsOf(device)[topic], undefined),
    ).toEqual({ state: { on_off: { isOn: true } }, isAvailable: true });

    await hub.subscribeAsync('cmnd/plug/POWER');

    const command = new Promise<string>((resolve) => {
      hub.on('message', (topic, payload) => {
        if (topic === 'cmnd/plug/POWER') {
          resolve(payload.toString());
        }
      });
    });

    await broker.publish([{ topic: 'cmnd/plug/POWER', payload: 'OFF' }]);
    expect(await command).toBe('OFF');
  });

  it('drops a removed client at once, and refuses it after', async () => {
    const broker = await started();
    const port = portOf(broker);
    const password = await broker.addClient({ username: 'sensor', label: 'Garden', access: 'all' });
    const client = await connect(port, 'sensor', password);
    const closed = new Promise<void>((resolve) => {
      client.once('close', () => {
        resolve();
      });
    });

    expect(broker.removeClient('sensor')).toBe(true);
    await closed;
    await expect(connect(port, 'sensor', password)).rejects.toThrow();
  });

  it('keeps what was retained, and the hub’s password, across a restart', async () => {
    const first = await started();
    const password = first.hubConnection()?.password;
    const hub = await connectAsHub(first);

    await publish(hub, 'homeassistant/switch/C82B96_RL_1/config', ANNOUNCEMENT, true);
    await publish(hub, 'stat/plug/POWER', 'ON', true);
    hub.end(true);
    await first.stop();

    const second = await started();

    expect(second.hubConnection()?.password).toBe(password);
    expect(second.devices().map((each) => each.deviceKey)).toContain('C82B96');
    expect(second.topics('stat/', 10).items[0]).toMatchObject({
      topic: 'stat/plug/POWER',
      isRetained: true,
    });
  });

  it('waits for a port another program holds, and takes it once it is free', async () => {
    const holder = net.createServer();
    const port = await new Promise<number>((resolve) => {
      holder.listen(0, () => {
        const address = holder.address();

        resolve(typeof address === 'object' && address !== null ? address.port : 0);
      });
    });
    const broker = await started(port, 50);

    expect(broker.status()).toMatchObject({ state: 'failed', port });
    expect(broker.status().error).toMatch(/in use/u);
    expect(broker.hubConnection()).not.toBeNull();
    await expect(broker.containerCredentials('vendor:zigbee2mqtt', undefined)).rejects.toThrow(
      /not running/u,
    );

    await new Promise<void>((resolve) => {
      holder.close(() => {
        resolve();
      });
    });
    await vi.waitFor(() => {
      expect(broker.status().state).toBe('running');
    });
    await expect(connectAsHub(broker)).resolves.toBeDefined();
  });

  it('remembers a device removed from the house until it is brought back', async () => {
    const broker = await started();
    const hub = await connectAsHub(broker);

    await publish(hub, 'homeassistant/switch/C82B96_RL_1/config', ANNOUNCEMENT, true);
    await vi.waitFor(() => {
      expect(broker.devices().map((each) => each.deviceKey)).toContain('C82B96');
    });

    broker.release('C82B96');
    expect(broker.devices().map((each) => each.deviceKey)).not.toContain('C82B96');
    expect(broker.isRemoved('C82B96')).toBe(true);
    expect(broker.restore('C82B96')).toBe(true);
    expect(broker.devices().map((each) => each.deviceKey)).toContain('C82B96');
  });

  it('maps a device by hand, and reads announcements again under a new prefix', async () => {
    const broker = await started();
    const hub = await connectAsHub(broker);
    const mapping = broker.saveMapping({
      name: 'Garden temperature',
      component: 'sensor',
      stateTopic: 'tele/garden/SENSOR',
      valuePath: 'AM2301.Temperature',
      unit: '°C',
      deviceClass: 'temperature',
      payloadOn: 'ON',
      payloadOff: 'OFF',
    });

    expect(broker.devices().map((each) => each.deviceKey)).toContain(`mapping-${mapping.id}`);
    expect(broker.removeMapping(mapping.id)).toBe(true);
    expect(broker.devices().map((each) => each.deviceKey)).not.toContain(`mapping-${mapping.id}`);

    await publish(hub, 'devices/switch/C82B96_RL_1/config', ANNOUNCEMENT, true);
    expect(broker.devices().map((each) => each.deviceKey)).not.toContain('C82B96');

    const status = await broker.saveSettings({
      allowAnonymous: false,
      isDiscoveryEnabled: true,
      discoveryPrefix: 'devices',
    });

    expect(status).toMatchObject({ state: 'running', settings: { discoveryPrefix: 'devices' } });
    expect(broker.devices().map((each) => each.deviceKey)).toContain('C82B96');
  });
});
