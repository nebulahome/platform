/**
 * The platform's interpreter of Modbus templates: how reads are planned into blocks, what the
 * registers say, what a command writes, and the driver around them.
 */
import { describe, expect, it } from 'vitest';

import {
  formatEntityId,
  modbusTemplateSchema,
  type CapabilityState,
  type EntityId,
  type ModbusEntity,
} from '@nebulahome/contracts';

import type { MappingContext } from './integration.js';
import {
  createModbusIntegration,
  encodeModbusWrite,
  modbusEntityDescriptorOf,
  modbusEntityStateOf,
  modbusKeyOf,
  modbusRawOf,
  modbusReadValueOf,
  planModbusBlocks,
  type ModbusDeviceSnapshot,
} from './modbus-mapping.js';

/**
 * A template of some entities.
 *
 * @param entities - The entities, as written.
 * @returns The template.
 */
function templateOf(entities: Record<string, unknown>[]) {
  return modbusTemplateSchema.parse({ name: 'Board', entities });
}

/**
 * A sensor read from one holding register.
 *
 * @param name - Its name.
 * @param read - Its read, beyond the function.
 * @returns The entity, as written.
 */
function sensor(name: string, read: Record<string, unknown>): Record<string, unknown> {
  return {
    name,
    domain: 'sensor',
    capabilities: { sensor_numeric: { read: { function: 3, ...read } } },
  };
}

describe('planning the reads', () => {
  it('joins reads a short gap apart, and starts again past it', () => {
    const template = templateOf([
      sensor('A', { address: 0 }),
      sensor('B', { address: 17 }),
      sensor('C', { address: 35 }),
      sensor('D', { address: 36, type: 'u32' }),
    ]);

    // 0 and 17 have 16 unread between them; 17 and 35 have 17.
    expect(planModbusBlocks(template)).toEqual([
      { function: 3, start: 0, count: 18 },
      { function: 3, start: 35, count: 3 },
    ]);
  });

  it('keeps tables apart and no block over a hundred', () => {
    const template = templateOf([
      ...[0, 15, 30, 45, 60, 75, 90, 99, 100].map((address) =>
        sensor(`Value ${String(address)}`, { address }),
      ),
      {
        name: 'Relay',
        domain: 'switch',
        capabilities: { on_off: { read: { function: 1, address: 0 } } },
      },
    ]);

    expect(planModbusBlocks(template)).toEqual([
      { function: 1, start: 0, count: 1 },
      { function: 3, start: 0, count: 100 },
      { function: 3, start: 100, count: 1 },
    ]);
  });
});

describe('what the registers say', () => {
  const registers = {
    [modbusKeyOf(3, 0)]: 0xfffe,
    [modbusKeyOf(3, 1)]: 0x0001,
    [modbusKeyOf(3, 2)]: 0x4248,
    [modbusKeyOf(3, 3)]: 0x0000,
    [modbusKeyOf(3, 4)]: 0x5831,
    [modbusKeyOf(3, 5)]: 0x4700,
    [modbusKeyOf(1, 0)]: 1,
  };

  it('reads each type, in both word orders', () => {
    expect(modbusRawOf({ function: 3, address: 0, type: 's16' }, 'high', registers)).toBe(-2);
    expect(modbusRawOf({ function: 3, address: 0, type: 'u32' }, 'high', registers)).toBe(
      0xfffe_0001,
    );
    expect(modbusRawOf({ function: 3, address: 0, type: 'u32' }, 'low', registers)).toBe(
      0x0001_fffe,
    );
    expect(modbusRawOf({ function: 3, address: 2, type: 'f32' }, 'high', registers)).toBe(50);
    expect(
      modbusRawOf({ function: 3, address: 4, type: 'string', count: 2 }, 'high', registers),
    ).toBe('X1G');
    expect(modbusRawOf({ function: 3, address: 1, bit: 0 }, 'high', registers)).toBe(true);
    expect(modbusRawOf({ function: 1, address: 0 }, 'high', registers)).toBe(true);
    expect(modbusRawOf({ function: 3, address: 9 }, 'high', registers)).toBeUndefined();
  });

  it('scales a number without float noise, and names an option', () => {
    expect(modbusReadValueOf({ function: 3, address: 1, scale: 0.1 }, 'high', registers)).toBe(0.1);
    expect(
      modbusReadValueOf({ function: 3, address: 1, options: { '1': 'Eco' } }, 'high', registers),
    ).toBe('Eco');
  });

  it('keeps what a refused block did not read', () => {
    const [entity] = templateOf([
      {
        name: 'Light',
        domain: 'light',
        capabilities: {
          on_off: { read: { function: 1, address: 0 } },
          level: { read: { function: 3, address: 40 }, write: { function: 6, min: 0, max: 255 } },
        },
      },
    ]).entities;

    expect(modbusEntityStateOf(entity!, 'high', registers, { level: { level: 30 } })).toEqual({
      on_off: { isOn: true },
      level: { level: 30 },
    });
    expect(
      modbusEntityStateOf(entity!, 'high', { ...registers, [modbusKeyOf(3, 40)]: 51 }, undefined),
    ).toEqual({ on_off: { isOn: true }, level: { level: 20 } });
  });
});

describe('what a command writes', () => {
  const [relay, setpoint, mode, reset] = templateOf([
    {
      name: 'Relay',
      domain: 'switch',
      capabilities: { on_off: { read: { function: 1, address: 3 }, write: { function: 5 } } },
    },
    {
      name: 'Setpoint',
      domain: 'number',
      capabilities: {
        number: {
          read: { function: 3, address: 10, type: 's32', scale: 0.1 },
          write: { function: 16, min: -20, max: 60 },
        },
      },
    },
    {
      name: 'Mode',
      domain: 'select',
      capabilities: {
        select: {
          read: { function: 3, address: 12, options: { '0': 'Off', '1': 'Eco' } },
          write: { function: 6 },
        },
      },
    },
    {
      name: 'Reset',
      domain: 'button',
      capabilities: { button: { write: { function: 6, address: '0x0100', value: '0x00AA' } } },
    },
  ]).entities as ModbusEntity[];

  it('switches a coil, and toggles from the last state', () => {
    expect(encodeModbusWrite(relay!, 'on_off', { command: 'turn_on' }, 'high')).toEqual({
      function: 5,
      address: 3,
      values: [0xff00],
    });
    expect(
      encodeModbusWrite(relay!, 'on_off', { command: 'toggle' }, 'high', {
        on_off: { isOn: true },
      }),
    ).toEqual({ function: 5, address: 3, values: [0] });
  });

  it('writes a number in its type and order, and refuses one outside min and max', () => {
    expect(
      encodeModbusWrite(setpoint!, 'number', { command: 'set_value', value: -1.5 }, 'high'),
    ).toEqual({
      function: 16,
      address: 10,
      values: [0xffff, 0xfff1],
    });
    expect(
      encodeModbusWrite(setpoint!, 'number', { command: 'set_value', value: 2 }, 'low'),
    ).toEqual({
      function: 16,
      address: 10,
      values: [20, 0],
    });
    expect(() =>
      encodeModbusWrite(setpoint!, 'number', { command: 'set_value', value: 61 }, 'high'),
    ).toThrow(/outside -20 to 60/u);
  });

  it('writes an option, a press, and refuses a sensor', () => {
    expect(
      encodeModbusWrite(mode!, 'select', { command: 'select_option', option: '1' }, 'high'),
    ).toEqual({
      function: 6,
      address: 12,
      values: [1],
    });
    expect(() =>
      encodeModbusWrite(mode!, 'select', { command: 'select_option', option: '7' }, 'high'),
    ).toThrow(/no option 7/u);
    expect(encodeModbusWrite(reset!, 'button', { command: 'press' }, 'high')).toEqual({
      function: 6,
      address: 256,
      values: [0xaa],
    });
  });

  it('declares a number’s limits and a choice’s options', () => {
    expect(modbusEntityDescriptorOf(setpoint!).capabilities).toEqual({
      number: { min: -20, max: 60, step: 1 },
    });
    expect(modbusEntityDescriptorOf(mode!)).toMatchObject({
      domain: 'select',
      objectId: 'mode',
      capabilities: {
        select: {
          options: [
            { value: '0', label: 'Off' },
            { value: '1', label: 'Eco' },
          ],
        },
      },
    });
  });
});

describe('the driver', () => {
  const device: ModbusDeviceSnapshot = {
    deviceKey: 'modbus-1',
    kind: 'modbus/generic',
    name: 'Garage relays',
    host: '192.168.1.60',
    port: 502,
    unitId: 1,
    framing: 'tcp',
    pollSeconds: 5,
    template: templateOf([
      {
        id: 'relay_1',
        name: 'Relay 1',
        domain: 'switch',
        capabilities: { on_off: { read: { function: 1, address: 0 }, write: { function: 5 } } },
      },
    ]),
  };
  const integration = createModbusIntegration({ id: 'modbus/generic' });
  const entityId: EntityId = formatEntityId('switch', 'garage_relays_relay_1');
  const claim = integration.claim({ deviceKey: 'modbus-1', payload: device }, {});
  const context = (lastState?: CapabilityState): MappingContext => ({
    options: {},
    claim: claim ?? { deviceKey: '', externalId: '', descriptor: null },
    entities: new Map([['relay_1', entityId]]),
    lastState: () => lastState,
  });

  it('claims its own devices only, and describes them from the template', () => {
    expect(claim?.externalId).toBe('modbus-1');
    expect(
      integration.claim(
        { deviceKey: 'modbus-1', payload: { ...device, kind: 'solax-power/x3' } },
        {},
      ),
    ).toBeNull();
    expect(integration.describe(claim!, {})).toMatchObject({
      externalId: 'modbus-1',
      name: 'Garage relays',
      model: 'Board',
      entities: [{ domain: 'switch', objectId: 'relay_1', name: 'Relay 1' }],
    });
  });

  it('polls each device at its pace for its blocks', () => {
    expect(integration.subscriptions([claim!], {})).toEqual([
      {
        op: 'poll',
        args: {
          deviceKey: 'modbus-1',
          host: '192.168.1.60',
          port: 502,
          unitId: 1,
          framing: 'tcp',
          everyMs: 5000,
          blocks: [{ function: 1, start: 0, count: 1 }],
        },
      },
    ]);
  });

  it('reports what was read, and every entity unavailable when the device is silent', () => {
    const message = { connectionKey: 'modbus', deviceKey: 'modbus-1' };

    expect(
      integration.toState({ ...message, payload: { registers: { '1:0': 1 } } }, context()),
    ).toEqual([{ entityId, state: { on_off: { isOn: true } }, attributes: {}, isAvailable: true }]);
    expect(
      integration.toState(
        { ...message, payload: { error: 'No answer' } },
        context({ on_off: { isOn: true } }),
      ),
    ).toEqual([
      { entityId, state: { on_off: { isOn: true } }, attributes: {}, isAvailable: false },
    ]);
  });

  it('turns a command into a write to the device', () => {
    expect(
      integration.toCommand(
        { entityId, capability: 'on_off', command: { command: 'turn_off' } },
        context(),
      ),
    ).toEqual({
      deviceKey: 'modbus-1',
      op: 'write',
      args: {
        host: '192.168.1.60',
        port: 502,
        unitId: 1,
        framing: 'tcp',
        function: 5,
        address: 0,
        values: [0],
      },
    });
  });
});
