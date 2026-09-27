import { describe, expect, it } from 'vitest';

import { displayNameOf, humanize } from './display-name.js';

describe('humanize', () => {
  it('turns dashes and underscores into words, capitalised', () => {
    expect(humanize('festive_hopper')).toBe('Festive Hopper');
    expect(humanize('my-web-app')).toBe('My Web App');
  });

  it('spells the names people know otherwise as they are spelt', () => {
    expect(humanize('nats')).toBe('NATS');
    expect(humanize('postgres')).toBe('PostgreSQL');
    expect(humanize('zigbee2mqtt')).toBe('Zigbee2MQTT');
  });
});

describe('displayNameOf', () => {
  const base = { name: 'x', labels: {}, isSelf: false, managedName: null };

  it('calls the platform NebulaHome', () => {
    expect(displayNameOf({ ...base, name: 'nebulahome-nebulahome-1', isSelf: true })).toBe(
      'NebulaHome',
    );
  });

  it('calls a managed container what its integration does', () => {
    expect(
      displayNameOf({ ...base, name: 'nebulahome-zigbee2mqtt', managedName: 'Zigbee2MQTT' }),
    ).toBe('Zigbee2MQTT');
  });

  it('calls a compose container after its service, numbering replicas beyond the first', () => {
    const labels = {
      'com.docker.compose.service': 'mosquitto',
      'com.docker.compose.container-number': '1',
    };

    expect(displayNameOf({ ...base, name: 'nebulahome-mosquitto-1', labels })).toBe('Mosquitto');
    expect(
      displayNameOf({
        ...base,
        name: 'nebulahome-mosquitto-2',
        labels: { ...labels, 'com.docker.compose.container-number': '2' },
      }),
    ).toBe('Mosquitto 2');
  });

  it('makes a lone container its name in words', () => {
    expect(displayNameOf({ ...base, name: 'home-assistant' })).toBe('Home Assistant');
  });
});
