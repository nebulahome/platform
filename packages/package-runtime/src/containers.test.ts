import { describe, expect, it } from 'vitest';

import { integrationSetupSchema } from '@nebulahome/contracts';

import {
  containerDependenciesSchema,
  containerDependencyProblems,
  renderContainers,
} from './containers.js';

const DECLARED = containerDependenciesSchema.parse([
  {
    id: 'zigbee2mqtt',
    name: 'Zigbee2MQTT',
    image: 'koenkk/zigbee2mqtt',
    minVersion: '2.1.0',
    volumes: [{ name: 'data', path: '/app/data' }],
    env: [
      { name: 'ZIGBEE2MQTT_CONFIG_MQTT_SERVER', value: '{platform.mqtt.url}' },
      {
        name: 'ZIGBEE2MQTT_CONFIG_SERIAL_PORT',
        value: '/dev/zigbee',
        when: { key: 'connection', equals: ['usb'] },
      },
      {
        name: 'ZIGBEE2MQTT_CONFIG_SERIAL_PORT',
        value: '{setup.networkAddress}',
        when: { key: 'connection', equals: ['network'] },
      },
      { name: 'ZIGBEE2MQTT_CONFIG_ADVANCED_CHANNEL', value: '{setup.channel}' },
      { name: 'ZIGBEE2MQTT_CONFIG_ADVANCED_LOG_LEVEL', value: 'level {setup.logLevel}' },
    ],
    devices: [
      {
        host: '{setup.serialPath}',
        container: '/dev/zigbee',
        when: { key: 'connection', equals: ['usb'] },
      },
    ],
    ports: [
      {
        container: '{setup.webPort}',
        host: '{setup.webPort}',
        when: { key: 'webInterface', equals: [true] },
      },
    ],
    seed: [{ volume: 'data', path: 'configuration.yaml', content: 'version: 4\n' }],
    webPort: '{setup.webPort}',
    webPortWhen: { key: 'webInterface', equals: [true] },
  },
]);

const SETUP = integrationSetupSchema.parse({
  transport: { fields: [] },
  options: {
    fields: [
      {
        key: 'connection',
        type: 'choice',
        label: 'Adapter connection',
        choices: [
          { value: 'usb', label: 'USB' },
          { value: 'network', label: 'Network' },
        ],
        default: 'usb',
      },
      { key: 'serialPath', type: 'text', label: 'Serial port' },
      { key: 'networkAddress', type: 'text', label: 'Address' },
      { key: 'webInterface', type: 'boolean', label: 'Web interface' },
      { key: 'webPort', type: 'number', label: 'Port' },
      { key: 'channel', type: 'number', label: 'Channel' },
      { key: 'logLevel', type: 'text', label: 'Log level' },
    ],
  },
});

describe('containerDependenciesSchema', () => {
  it('refuses an image with a tag: the release is the platform’s to choose', () => {
    expect(
      containerDependenciesSchema.safeParse([
        { id: 'z', name: 'Z', image: 'koenkk/zigbee2mqtt:latest', minVersion: '2.1.0' },
      ]).success,
    ).toBe(false);
  });

  it('refuses a seeded file that would climb out of its volume', () => {
    expect(
      containerDependenciesSchema.safeParse([
        {
          id: 'zz',
          name: 'Z',
          image: 'z/z',
          minVersion: '1.0.0',
          volumes: [{ name: 'data', path: '/data' }],
          seed: [{ volume: 'data', path: '../../etc/passwd', content: '' }],
        },
      ]).success,
    ).toBe(false);
  });
});

describe('containerDependencyProblems', () => {
  it('finds nothing wrong when every setting read is one the vendor asks', () => {
    expect(containerDependencyProblems(DECLARED, SETUP)).toEqual([]);
  });

  it('names a setting the vendor does not ask', () => {
    expect(containerDependencyProblems(DECLARED, undefined)).toContain(
      "zigbee2mqtt reads the setting serialPath, which the vendor's setup.json does not ask",
    );
  });
});

describe('renderContainers', () => {
  it('puts a USB adapter in the container and leaves the network address out', () => {
    const [spec] = renderContainers('zigbee2mqtt', DECLARED, {
      connection: 'usb',
      serialPath: '/dev/serial/by-id/usb-ITead_Sonoff',
      webInterface: false,
    });

    expect(spec?.devices).toEqual([
      { host: '/dev/serial/by-id/usb-ITead_Sonoff', container: '/dev/zigbee' },
    ]);
    expect(spec?.env).toEqual([
      { name: 'ZIGBEE2MQTT_CONFIG_MQTT_SERVER', value: '{platform.mqtt.url}' },
      { name: 'ZIGBEE2MQTT_CONFIG_SERIAL_PORT', value: '/dev/zigbee' },
      { name: 'ZIGBEE2MQTT_CONFIG_ADVANCED_LOG_LEVEL', value: 'level ' },
    ]);
    expect(spec?.ports).toEqual([]);
    expect(spec?.webPort).toBe(null);
    expect(spec?.volumes).toEqual([{ name: 'data', path: '/app/data', isCache: false }]);
  });

  it('points a network adapter at its address and publishes the web page when asked', () => {
    const [spec] = renderContainers('zigbee2mqtt', DECLARED, {
      connection: 'network',
      networkAddress: 'tcp://192.168.1.50:6638',
      webInterface: true,
      webPort: 8099,
    });

    expect(spec?.devices).toEqual([]);
    expect(spec?.env).toContainEqual({
      name: 'ZIGBEE2MQTT_CONFIG_SERIAL_PORT',
      value: 'tcp://192.168.1.50:6638',
    });
    expect(spec?.ports).toEqual([{ container: 8099, host: 8099, protocol: 'tcp' }]);
    expect(spec?.webPort).toBe(8099);
  });

  it('leaves out a variable that is one setting the owner has not set, and keeps it once set', () => {
    // A channel handed over empty would override the one the Zigbee network was formed on.
    const unset = renderContainers('zigbee2mqtt', DECLARED, {
      connection: 'usb',
      serialPath: '/dev/ttyUSB0',
    });
    const set = renderContainers('zigbee2mqtt', DECLARED, {
      connection: 'usb',
      serialPath: '/dev/ttyUSB0',
      channel: 15,
    });

    expect(unset[0]?.env.map((entry) => entry.name)).not.toContain(
      'ZIGBEE2MQTT_CONFIG_ADVANCED_CHANNEL',
    );
    expect(set[0]?.env).toContainEqual({
      name: 'ZIGBEE2MQTT_CONFIG_ADVANCED_CHANNEL',
      value: '15',
    });
  });

  it('hands over a command with its settings, a healthcheck and what a container starts after', () => {
    const declared = containerDependenciesSchema.parse([
      {
        id: 'db',
        name: 'Database',
        image: 'postgres',
        minVersion: '16.0.0',
        healthcheck: { test: ['CMD', 'pg_isready'], intervalMs: 5000 },
      },
      {
        id: 'server',
        name: 'Server',
        image: 'example/server',
        minVersion: '1.0.0',
        command: ['serve', '--channel', '{setup.channel}'],
        dependsOn: { db: 'healthy' },
      },
    ]);
    const [db, server] = renderContainers('nvr', declared, { channel: 15 }, 'package');

    expect(db?.healthcheck).toEqual({ test: ['CMD', 'pg_isready'], intervalMs: 5000 });
    expect(server).toMatchObject({
      command: ['serve', '--channel', '15'],
      dependsOn: { db: 'healthy' },
    });
  });

  it('refuses a device outside /dev', () => {
    expect(() =>
      renderContainers('zigbee2mqtt', DECLARED, { connection: 'usb', serialPath: '/etc/shadow' }),
    ).toThrow('which is not a device under /dev');
  });
});
