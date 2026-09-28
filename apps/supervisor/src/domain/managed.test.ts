import { describe, expect, it } from 'vitest';

import type { ManagedContainerSpec } from '@nebula-home/contracts';

import {
  fillPlaceholders,
  isAnotherInstallations,
  MANAGED_LABELS,
  managedCreateBody,
  managedName,
  platformValues,
  volumeFolder,
  type PlatformContext,
} from './managed.js';

const SPEC: ManagedContainerSpec = {
  vendorId: 'zigbee2mqtt',
  dependencyId: 'zigbee2mqtt',
  name: 'Zigbee2MQTT',
  image: 'koenkk/zigbee2mqtt',
  minVersion: '2.1.0',
  env: [
    { name: 'ZIGBEE2MQTT_CONFIG_MQTT_SERVER', value: '{platform.mqtt.url}' },
    { name: 'ZIGBEE2MQTT_CONFIG_MQTT_PASSWORD', value: '{platform.mqtt.password}' },
    { name: 'TZ', value: '{platform.timezone}' },
  ],
  volumes: [{ name: 'data', path: '/app/data', isCache: false }],
  devices: [{ host: '/dev/serial/by-id/usb-sonoff', container: '/dev/zigbee' }],
  ports: [{ container: 8099, host: 8099, protocol: 'tcp' }],
  seed: [],
  webPort: 8099,
};

const BRIDGE: PlatformContext = {
  network: 'bridge',
  installationId: 'test',
  networkName: 'nebulahome',
  platformAlias: 'nebulahome',
  mqtt: { url: 'mqtt://127.0.0.1:1884', username: 'nebula', password: 'secret' },
  timezone: 'Europe/Rome',
  dataMount: { kind: 'volume', volume: 'nebulahome_nebula-data' },
};

describe('managedName', () => {
  it("names a vendor's container after the vendor, and a second one after both", () => {
    expect(managedName(SPEC)).toBe('nebulahome-zigbee2mqtt');
    expect(managedName({ vendorId: 'tasmota', dependencyId: 'mosquitto' })).toBe(
      'nebulahome-tasmota-mosquitto',
    );
  });
});

describe('platformValues', () => {
  it('points the broker at the platform container by name on a bridge', () => {
    expect(platformValues(BRIDGE)['platform.mqtt.url']).toBe('mqtt://nebulahome:1884');
  });

  it("keeps the platform's loopback on the host network", () => {
    expect(platformValues({ ...BRIDGE, network: 'host' })['platform.mqtt.url']).toBe(
      'mqtt://127.0.0.1:1884',
    );
  });

  it("points at Docker's name for the machine when the platform is not in a container", () => {
    expect(platformValues({ ...BRIDGE, network: 'native' })['platform.mqtt.url']).toBe(
      'mqtt://host.docker.internal:1884',
    );
  });
});

describe('isAnotherInstallations', () => {
  it('leaves a container another installation made to it, and takes one made before labels', () => {
    const made = managedCreateBody(SPEC, '2.14.1', BRIDGE).body['Labels'] as Record<string, string>;

    expect(made[MANAGED_LABELS.installation]).toBe('test');
    expect(isAnotherInstallations(made, 'test')).toBe(false);
    expect(isAnotherInstallations(made, 'development')).toBe(true);
    expect(isAnotherInstallations({ [MANAGED_LABELS.managed]: 'true' }, 'test')).toBe(false);
  });

  it('makes a container again for another installation, which has another hash', () => {
    expect(managedCreateBody(SPEC, '2.14.1', BRIDGE).hash).not.toBe(
      managedCreateBody(SPEC, '2.14.1', { ...BRIDGE, installationId: 'development' }).hash,
    );
  });
});

describe('fillPlaceholders', () => {
  it("fills the platform's placeholders and leaves any other brace alone", () => {
    expect(fillPlaceholders('{platform.timezone} {other}', { 'platform.timezone': 'UTC' })).toBe(
      'UTC {other}',
    );
  });
});

describe('volumeFolder', () => {
  it('keeps a volume under containers/, or under the cache when it can be made again', () => {
    expect(volumeFolder(SPEC, { name: 'data', path: '/app/data', isCache: false })).toBe(
      'containers/zigbee2mqtt/data',
    );
    expect(volumeFolder(SPEC, { name: 'log', path: '/app/log', isCache: true })).toBe(
      'cache/containers/zigbee2mqtt/log',
    );
  });
});

describe('managedCreateBody', () => {
  it("mounts its volume inside the platform's data volume, on the shared network", () => {
    const { body, hash } = managedCreateBody(SPEC, '2.14.1', BRIDGE);

    expect(body['Image']).toBe('koenkk/zigbee2mqtt:2.14.1');
    expect(body['Env']).toEqual([
      'ZIGBEE2MQTT_CONFIG_MQTT_SERVER=mqtt://nebulahome:1884',
      'ZIGBEE2MQTT_CONFIG_MQTT_PASSWORD=secret',
      'TZ=Europe/Rome',
    ]);
    expect(body['HostConfig']).toMatchObject({
      NetworkMode: 'nebulahome',
      RestartPolicy: { Name: 'unless-stopped' },
      Mounts: [
        {
          Type: 'volume',
          Source: 'nebulahome_nebula-data',
          Target: '/app/data',
          VolumeOptions: { Subpath: 'containers/zigbee2mqtt/data' },
        },
      ],
      Devices: [
        {
          PathOnHost: '/dev/serial/by-id/usb-sonoff',
          PathInContainer: '/dev/zigbee',
          CgroupPermissions: 'rwm',
        },
      ],
      PortBindings: { '8099/tcp': [{ HostPort: '8099' }] },
    });
    expect(body['Labels']).toMatchObject({
      'io.nebulahome.managed': 'true',
      'io.nebulahome.vendor': 'zigbee2mqtt',
      'io.nebulahome.spec': hash,
    });
  });

  it('publishes nothing on the host network, where the container is on the ports itself', () => {
    const { body } = managedCreateBody(SPEC, '2.14.1', { ...BRIDGE, network: 'host' });

    expect(body['HostConfig']).toMatchObject({ NetworkMode: 'host' });
    expect(body['HostConfig']).not.toHaveProperty('PortBindings');
    expect(body).not.toHaveProperty('NetworkingConfig');
  });

  it('changes its hash when a setting changes, and not when the release does', () => {
    const before = managedCreateBody(SPEC, '2.14.0', BRIDGE).hash;

    expect(managedCreateBody(SPEC, '2.14.1', BRIDGE).hash).toBe(before);
    expect(
      managedCreateBody(
        { ...SPEC, devices: [{ host: '/dev/ttyUSB1', container: '/dev/zigbee' }] },
        '2.14.1',
        BRIDGE,
      ).hash,
    ).not.toBe(before);
  });
});
