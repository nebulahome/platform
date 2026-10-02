/**
 * The broker's rules, without a broker: who may publish and subscribe where, which templates
 * are read, and what an announcement becomes.
 */
import { describe, expect, it } from 'vitest';

import { clientAccess, filterWithin, mayPublish, maySubscribe, topicMatches } from './acl.js';
import { readAnnouncement, slugOf } from './discovery.js';
import { shapeOf } from './house.js';
import { readTemplate, valueAt } from './templates.js';

describe('topic filters', () => {
  it('match as MQTT says', () => {
    expect(topicMatches('a/+/c', 'a/b/c')).toBe(true);
    expect(topicMatches('a/#', 'a')).toBe(true);
    expect(topicMatches('a/#', 'a/b/c')).toBe(true);
    expect(topicMatches('a/+', 'a/b/c')).toBe(false);
    expect(topicMatches('#', '$SYS/broker')).toBe(false);
  });

  it('hold a subscription to what it may read, wildcards included', () => {
    expect(filterWithin('zigbee2mqtt/+/set', 'zigbee2mqtt/#')).toBe(true);
    expect(filterWithin('zigbee2mqtt/#', 'zigbee2mqtt/#')).toBe(true);
    expect(filterWithin('#', 'zigbee2mqtt/#')).toBe(false);
    expect(filterWithin('+/bridge', 'zigbee2mqtt/#')).toBe(false);
    expect(filterWithin('a/b', 'a/+')).toBe(true);
    expect(filterWithin('a/+', 'a/b')).toBe(false);
  });

  it("give a device its own topics and the announcements, and nobody the broker's", () => {
    const access = clientAccess('shelly-plug', 'prefix', 'homeassistant');

    expect(mayPublish(access, 'shelly-plug/relay/0')).toBe(true);
    expect(mayPublish(access, 'homeassistant/switch/plug/config')).toBe(true);
    expect(mayPublish(access, 'zigbee2mqtt/bridge/request/permit_join')).toBe(false);
    expect(maySubscribe(access, 'shelly-plug/#')).toBe(true);
    expect(maySubscribe(access, '#')).toBe(false);
    expect(mayPublish(clientAccess('x', 'all', 'homeassistant'), '$SYS/broker/uptime')).toBe(false);
  });
});

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
  it('becomes an entity of its device, abbreviations and base topic read', () => {
    const reading = readAnnouncement(
      'homeassistant',
      'homeassistant/sensor/kitchen/temperature/config',
      JSON.stringify({
        '~': 'tele/kitchen',
        name: 'Temperature',
        uniq_id: 'kitchen-temp',
        stat_t: '~/SENSOR',
        val_tpl: '{{ value_json.AM2301.Temperature }}',
        unit_of_meas: '°F',
        dev_cla: 'temperature',
        stat_cla: 'measurement',
        dev: { ids: ['kitchen'], name: 'Kitchen', mf: 'Tasmota', mdl: 'Sonoff TH' },
      }),
    );

    expect(reading.kind).toBe('entity');

    if (reading.kind !== 'entity') {
      return;
    }

    expect(reading.entity).toMatchObject({
      key: 'kitchen-temp',
      component: 'sensor',
      name: 'Kitchen Temperature',
      objectId: 'kitchen_temp',
      device: { id: 'kitchen', name: 'Kitchen', manufacturer: 'Tasmota', model: 'Sonoff TH' },
      config: { state_topic: 'tele/kitchen/SENSOR' },
      value: { kind: 'path', path: ['AM2301', 'Temperature'] },
    });

    // Kept in the platform's unit for a temperature, converted as it is reported.
    expect(shapeOf(reading.entity)).toEqual({
      shape: {
        domain: 'sensor',
        capabilities: { sensor_numeric: {} },
        stateClass: 'measurement',
        deviceClass: 'temperature',
        unitOfMeasurement: '°C',
      },
      nativeUnit: '°F',
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

  it('names its entity with what an entity id can hold', () => {
    expect(slugOf('0x00158d0001-Temp.Sensor')).toBe('0x00158d0001_temp_sensor');
    expect(slugOf('---')).toBe('entity');
  });
});
