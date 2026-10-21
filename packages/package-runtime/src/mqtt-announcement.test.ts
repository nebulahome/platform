/**
 * What a device says of itself on the house's broker, read: templates, announcements, mappings
 * and the device they add up to.
 */
import { describe, expect, it } from 'vitest';

import {
  mqttDeviceSnapshotOf,
  mqttEntityOfMapping,
  readAnnouncement,
  readTemplate,
  slugOf,
  valueAt,
  type MqttEntity,
} from './mqtt-announcement.js';

/**
 * Reads an announcement that must become an entity.
 *
 * @param topic - Where it was published.
 * @param document - What.
 * @returns The entity.
 * @throws {Error} When the announcement is not one.
 */
function entityOf(topic: string, document: Record<string, unknown>): MqttEntity {
  const reading = readAnnouncement('homeassistant', topic, JSON.stringify(document));

  if (reading.kind !== 'entity') {
    throw new Error(`Not an entity: ${reading.kind}`);
  }

  return reading.entity;
}

describe('value templates', () => {
  it('are read as the path they name', () => {
    expect(readTemplate(undefined)).toEqual({ kind: 'path', path: [] });
    expect(readTemplate('{{ value }}')).toEqual({ kind: 'path', path: [] });
    expect(readTemplate('{{ value_json.AM2301.Temperature }}')).toEqual({
      kind: 'path',
      path: ['AM2301', 'Temperature'],
    });
    expect(readTemplate("{{value_json['temp']}}")).toEqual({ kind: 'path', path: ['temp'] });
    expect(readTemplate('{{ value_json.values[0] }}')).toEqual({
      kind: 'path',
      path: ['values', '0'],
    });
  });

  it('are refused when they are more than a path', () => {
    expect(readTemplate('{{ value_json.temp | float * 2 }}').kind).toBe('unsupported');
    expect(readTemplate('{% if value %}on{% endif %}').kind).toBe('unsupported');
  });

  it('read a payload along the path', () => {
    expect(valueAt('{"AM2301":{"Temperature":21.5}}', ['AM2301', 'Temperature'])).toBe(21.5);
    expect(valueAt('ON', [])).toBe('ON');
    expect(valueAt('not json', ['a'])).toBeUndefined();
  });
});

describe('an announcement', () => {
  it('becomes an entity of its device, abbreviations, base topic and origin read', () => {
    const entity = entityOf('homeassistant/sensor/kitchen/temperature/config', {
      '~': 'tele/kitchen',
      name: 'Temperature',
      uniq_id: 'kitchen-temp',
      stat_t: '~/SENSOR',
      val_tpl: '{{ value_json.AM2301.Temperature }}',
      unit_of_meas: '°F',
      dev_cla: 'temperature',
      stat_cla: 'measurement',
      dev: {
        ids: ['kitchen'],
        cns: [['mac', 'AA:BB:CC:DD:EE:FF']],
        name: 'Kitchen',
        mf: 'Itead',
        mdl: 'Sonoff TH',
        sw: '14.2.0',
      },
      o: { name: 'Tasmota', sw: '14.2.0' },
    });

    expect(entity).toMatchObject({
      key: 'kitchen-temp',
      origin: 'discovery',
      component: 'sensor',
      name: 'Kitchen Temperature',
      // The device's identifier, which every entity of it repeats, is left out.
      objectId: 'temp',
      device: {
        id: 'kitchen',
        name: 'Kitchen',
        manufacturer: 'Itead',
        model: 'Sonoff TH',
        swVersion: '14.2.0',
        macAddresses: ['aa:bb:cc:dd:ee:ff'],
        originName: 'Tasmota',
      },
      config: {
        state_topic: 'tele/kitchen/SENSOR',
        value_template: '{{ value_json.AM2301.Temperature }}',
      },
    });
  });

  it('is taken back with an empty payload, and skipped with the reason when it cannot be read', () => {
    expect(readAnnouncement('homeassistant', 'homeassistant/switch/plug/config', '')).toEqual({
      kind: 'removed',
      key: 'switch/plug',
    });

    const climate = readAnnouncement(
      'homeassistant',
      'homeassistant/climate/hall/config',
      '{"name":"Hall"}',
    );

    expect(climate.kind === 'skipped' ? climate.skipped.reason : '').toContain('climate');
    expect(
      readAnnouncement(
        'homeassistant',
        'homeassistant/sensor/x/config',
        JSON.stringify({ stat_t: 'x', val_tpl: '{{ value | int }}' }),
      ),
    ).toMatchObject({ kind: 'skipped' });
    expect(readAnnouncement('homeassistant', 'tele/kitchen/SENSOR', '{}')).toEqual({
      kind: 'ignored',
    });
  });

  it('names its entity with what an entity id can hold, the end kept', () => {
    expect(slugOf('0x00158d0001-Temp.Sensor')).toBe('0x00158d0001_temp_sensor');
    expect(slugOf('---')).toBe('entity');
    expect(slugOf(`${'a'.repeat(80)}_humidity`)).toHaveLength(40);
    expect(slugOf(`${'a'.repeat(80)}_humidity`).endsWith('_humidity')).toBe(true);
  });
});

describe('a device', () => {
  it('is its entities, who the first says it is, and every component once', () => {
    const relay = entityOf('homeassistant/switch/C82B96_RL_1/config', {
      name: 'Relay',
      uniq_id: 'C82B96_RL_1',
      stat_t: 'stat/plug/POWER',
      cmd_t: 'cmnd/plug/POWER',
      dev: { ids: ['C82B96'], name: 'Plug', mf: 'Tasmota' },
      o: { name: 'Tasmota' },
    });
    const power = entityOf('homeassistant/sensor/C82B96_power/config', {
      name: 'Power',
      uniq_id: 'C82B96_power',
      stat_t: 'tele/plug/SENSOR',
      val_tpl: '{{ value_json.ENERGY.Power }}',
      unit_of_meas: 'W',
      dev_cla: 'power',
      dev: { ids: ['C82B96'] },
    });
    const device = mqttDeviceSnapshotOf([relay, power]);

    expect(device?.deviceKey).toBe('C82B96');
    expect(device?.identity).toMatchObject({
      deviceKey: 'C82B96',
      source: 'announced',
      name: 'Plug',
      manufacturer: 'Tasmota',
      originName: 'Tasmota',
      identifiers: ['C82B96'],
      components: ['switch', 'sensor'],
    });
    expect(device?.entities.map((entity) => entity.objectId)).toEqual(['rl_1', 'power']);
  });

  it('is mapped by hand as a device of its own, its path a template', () => {
    const entity = mqttEntityOfMapping({
      id: 'garden-1',
      name: 'Garden temperature',
      component: 'sensor',
      stateTopic: 'tele/garden/SENSOR',
      valuePath: 'AM2301.Temperature',
      unit: '°C',
      deviceClass: 'temperature',
      payloadOn: 'ON',
      payloadOff: 'OFF',
    });

    expect(entity.config).toMatchObject({
      state_topic: 'tele/garden/SENSOR',
      value_template: "{{ value_json['AM2301']['Temperature'] }}",
    });
    expect(readTemplate(entity.config['value_template'] as string)).toEqual({
      kind: 'path',
      path: ['AM2301', 'Temperature'],
    });
    expect(mqttDeviceSnapshotOf([entity])?.identity).toMatchObject({
      deviceKey: 'mapping-garden-1',
      source: 'mapped',
      model: 'Mapped by hand',
    });
  });
});
