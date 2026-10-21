/**
 * The platform's mapping of the devices the house's broker hears: what each component is
 * registered as, what its topics say, what a command publishes, and the driver around them.
 */
import { describe, expect, it } from 'vitest';

import { formatEntityId, type CapabilityState, type EntityId } from '@nebulahome/contracts';

import type { MappingContext } from './integration.js';
import { type MqttEntitySnapshot } from './mqtt-announcement.js';
import {
  createMqttIntegration,
  mqttCommandOf,
  mqttShapeOf,
  mqttStateOf,
  mqttTopicsOf,
} from './mqtt-mapping.js';

/**
 * One entity.
 *
 * @param component - What it is.
 * @param config - Its announcement.
 * @returns The entity.
 */
function entity(
  component: MqttEntitySnapshot['component'],
  config: Record<string, unknown>,
): MqttEntitySnapshot {
  return { key: `${component}-1`, objectId: component, name: 'Thing', component, config };
}

/**
 * The texts of some topics.
 *
 * @param texts - Each topic's last text.
 * @returns What the mapping reads them with.
 */
function topics(texts: Record<string, string>): (topic: string) => string | undefined {
  return (topic) => texts[topic];
}

describe('what an entity is registered as', () => {
  it('a number in its class’s unit, text without a unit, a light by its topics', () => {
    expect(
      mqttShapeOf(
        entity('sensor', {
          state_topic: 't',
          unit_of_measurement: '°F',
          device_class: 'temperature',
          suggested_display_precision: 1,
        }),
      ),
    ).toEqual({
      domain: 'sensor',
      capabilities: { sensor_numeric: {} },
      deviceClass: 'temperature',
      unitOfMeasurement: '°C',
      stateClass: 'measurement',
      displayPrecision: 1,
    });
    expect(mqttShapeOf(entity('sensor', { state_topic: 't' }))).toEqual({
      domain: 'sensor',
      capabilities: { sensor_text: {} },
    });
    expect(
      mqttShapeOf(
        entity('light', {
          command_topic: 'l/set',
          brightness_command_topic: 'l/bri/set',
          color_temp_command_topic: 'l/ct/set',
        }),
      ).capabilities,
    ).toEqual({
      on_off: {},
      level: { hasTransition: false },
      color_temp: { minMireds: 153, maxMireds: 500 },
    });
  });

  it('keeps a unit its class cannot take, without the class', () => {
    expect(
      mqttShapeOf(entity('sensor', { unit_of_measurement: 'furlong', device_class: 'power' })),
    ).toEqual({
      domain: 'sensor',
      capabilities: { sensor_numeric: {} },
      unitOfMeasurement: 'furlong',
    });
  });
});

describe('what its topics say', () => {
  it('reads a number in the device’s unit into its class’s', () => {
    const sensor = entity('sensor', {
      state_topic: 'tele/kitchen/SENSOR',
      value_template: '{{ value_json.AM2301.Temperature }}',
      unit_of_measurement: '°F',
      device_class: 'temperature',
    });

    expect(
      mqttStateOf(
        sensor,
        topics({ 'tele/kitchen/SENSOR': '{"AM2301":{"Temperature":68}}' }),
        undefined,
      ),
    ).toEqual({ state: { sensor_numeric: { value: 20 } }, isAvailable: true });
  });

  it('says a device there only once an availability topic said so', () => {
    const plug = entity('switch', {
      state_topic: 'stat/plug/POWER',
      command_topic: 'cmnd/plug/POWER',
      availability_topic: 'tele/plug/LWT',
      payload_available: 'Online',
      payload_not_available: 'Offline',
    });

    expect(mqttTopicsOf(plug)).toEqual(['stat/plug/POWER', 'tele/plug/LWT']);
    expect(mqttStateOf(plug, topics({ 'stat/plug/POWER': 'ON' }), undefined)).toEqual({
      state: { on_off: { isOn: true } },
      isAvailable: false,
    });
    expect(
      mqttStateOf(plug, topics({ 'stat/plug/POWER': 'OFF', 'tele/plug/LWT': 'Online' }), undefined),
    ).toEqual({ state: { on_off: { isOn: false } }, isAvailable: true });
  });

  it('reads an entity with no state topic from what it was last told', () => {
    const relay = entity('switch', { command_topic: 'cmnd/pump/POWER' });
    const lock = entity('lock', { command_topic: 'door/set' });

    expect(mqttTopicsOf(relay)).toEqual(['cmnd/pump/POWER']);
    expect(mqttStateOf(relay, topics({ 'cmnd/pump/POWER': 'ON' }), undefined)?.state).toEqual({
      on_off: { isOn: true },
    });
    expect(mqttStateOf(lock, topics({ 'door/set': 'UNLOCK' }), undefined)?.state).toEqual({
      lock: { lockState: 'unlocked' },
    });
  });

  it('keeps what a JSON light’s document leaves out', () => {
    const light = entity('light', {
      schema: 'json',
      state_topic: 'l/state',
      command_topic: 'l/set',
      brightness: true,
    });
    const previous: CapabilityState = { on_off: { isOn: true }, level: { level: 50 } };

    expect(
      mqttStateOf(light, topics({ 'l/state': '{"brightness":255}' }), previous)?.state,
    ).toEqual({ on_off: { isOn: true }, level: { level: 100 } });
    expect(
      mqttStateOf(light, topics({ 'l/state': '{"brightness":255}' }), undefined),
    ).toBeUndefined();
  });

  it('reads a plain light’s brightness beside whether it is on', () => {
    const light = entity('light', {
      state_topic: 'l/state',
      command_topic: 'l/set',
      brightness_state_topic: 'l/bri',
      brightness_command_topic: 'l/bri/set',
      brightness_scale: 100,
    });

    expect(
      mqttStateOf(light, topics({ 'l/state': 'ON', 'l/bri': '40' }), undefined)?.state,
    ).toEqual({ on_off: { isOn: true }, level: { level: 40 } });
  });

  it('reads a cover’s position from its topic, and its motion from its state', () => {
    const cover = entity('cover', {
      state_topic: 'c/state',
      command_topic: 'c/set',
      position_topic: 'c/pos',
      set_position_topic: 'c/pos/set',
    });

    expect(
      mqttStateOf(cover, topics({ 'c/state': 'closing', 'c/pos': '30' }), undefined)?.state,
    ).toEqual({ cover: { position: 30, motion: 'closing' } });
  });
});

describe('what a command publishes', () => {
  it('a switch’s payloads, a toggle by what it is now', () => {
    const plug = entity('switch', { state_topic: 's', command_topic: 'cmnd/plug/POWER' });

    expect(mqttCommandOf(plug, 'on_off', { command: 'turn_on' }, undefined)).toEqual([
      { topic: 'cmnd/plug/POWER', payload: 'ON' },
    ]);
    expect(
      mqttCommandOf(plug, 'on_off', { command: 'toggle' }, { on_off: { isOn: true } }),
    ).toEqual([{ topic: 'cmnd/plug/POWER', payload: 'OFF' }]);
  });

  it('a JSON light’s document, a cover’s position on its scale', () => {
    const light = entity('light', { schema: 'json', command_topic: 'l/set', brightness: true });
    const cover = entity('cover', {
      command_topic: 'c/set',
      set_position_topic: 'c/pos/set',
      position_open: 255,
      position_closed: 0,
    });

    expect(mqttCommandOf(light, 'level', { command: 'set_level', level: 50 }, undefined)).toEqual([
      { topic: 'l/set', payload: '{"state":"ON","brightness":128}' },
    ]);
    expect(
      mqttCommandOf(cover, 'cover', { command: 'set_position', position: 50 }, undefined),
    ).toEqual([{ topic: 'c/pos/set', payload: '128' }]);
  });

  it('refuses a command template it cannot fill, and a command with no topic', () => {
    expect(() =>
      mqttCommandOf(
        entity('switch', { command_topic: 'x', command_template: '{{ value }}' }),
        'on_off',
        { command: 'turn_on' },
        undefined,
      ),
    ).toThrow(/command template/u);
    expect(() =>
      mqttCommandOf(
        entity('switch', { state_topic: 'x' }),
        'on_off',
        { command: 'turn_on' },
        undefined,
      ),
    ).toThrow(/no command topic/u);
  });
});

describe('the driver', () => {
  const device = {
    deviceKey: 'C82B96',
    identity: {
      deviceKey: 'C82B96',
      source: 'announced' as const,
      name: 'Plug',
      manufacturer: 'Itead',
      model: 'Sonoff S26',
      modelId: null,
      swVersion: '14.2.0',
      hwVersion: null,
      serialNumber: null,
      identifiers: ['C82B96'],
      macAddresses: ['aa:bb:cc:dd:ee:ff'],
      viaDevice: null,
      originName: 'Tasmota',
      originSwVersion: '14.2.0',
      components: ['switch' as const],
    },
    entities: [
      {
        key: 'C82B96_RL_1',
        objectId: 'rl_1',
        name: 'Plug',
        component: 'switch' as const,
        config: { state_topic: 'stat/plug/POWER', command_topic: 'cmnd/plug/POWER' },
      },
    ],
  };
  const integration = createMqttIntegration({ id: 'mqtt/generic' });
  const entityId: EntityId = formatEntityId('switch', 'plug_rl_1');
  const claim = integration.claim({ deviceKey: 'C82B96', payload: device }, {});
  const context = (lastState?: CapabilityState): MappingContext => ({
    options: {},
    claim: claim ?? { deviceKey: '', externalId: '', descriptor: null },
    entities: new Map([['rl_1', entityId]]),
    lastState: () => lastState,
  });

  it('claims what the broker hears and describes it', () => {
    expect(claim).toEqual({ deviceKey: 'C82B96', externalId: 'C82B96', descriptor: device });
    expect(integration.claim({ deviceKey: 'x', payload: { nodeId: '1' } }, {})).toBeNull();
    expect(integration.describe(claim!, {})).toMatchObject({
      externalId: 'C82B96',
      name: 'Plug',
      manufacturer: 'Itead',
      model: 'Sonoff S26',
      mac: 'aa:bb:cc:dd:ee:ff',
      entities: [{ domain: 'switch', objectId: 'rl_1', capabilities: { on_off: {} } }],
    });
  });

  it('reports only what a changed topic is read for, and publishes a command', () => {
    const inbound = (changed: string[] | null) => ({
      connectionKey: 'mqtt-house',
      deviceKey: 'C82B96',
      payload: { device, texts: { 'stat/plug/POWER': 'ON' }, changed },
    });

    expect(integration.toState(inbound(['tele/other']), context())).toEqual([]);
    expect(integration.toState(inbound(['stat/plug/POWER']), context())).toEqual([
      { entityId, state: { on_off: { isOn: true } }, attributes: {}, isAvailable: true },
    ]);
    expect(
      integration.toCommand(
        { entityId, capability: 'on_off', command: { command: 'toggle' } },
        context({ on_off: { isOn: true } }),
      ),
    ).toEqual({
      deviceKey: 'C82B96',
      op: 'publish',
      args: { messages: [{ topic: 'cmnd/plug/POWER', payload: 'OFF' }] },
    });
  });
});
