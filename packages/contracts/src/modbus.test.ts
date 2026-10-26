import { describe, expect, it } from 'vitest';

import {
  ipv4RangeOf,
  ipv4Text,
  modbusEntityIdOf,
  modbusSettingsSchema,
  modbusTemplateSchema,
  modbusWordOf,
  withModbusEntityIds,
} from './modbus.js';

/**
 * A relay board's template, with one entity in place of its first.
 *
 * @param entity - The entity to test, as written.
 * @returns The template, as written.
 */
function templateWith(entity: Record<string, unknown>): Record<string, unknown> {
  return { name: 'Relay board', entities: [entity] };
}

/**
 * What the template schema says about one entity.
 *
 * @param entity - The entity, as written.
 * @returns The messages of every problem, empty when there is none.
 */
function problemsOf(entity: Record<string, unknown>): string[] {
  const parsed = modbusTemplateSchema.safeParse(templateWith(entity));

  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

describe('modbusTemplateSchema', () => {
  it('takes the relay board of the editor', () => {
    const parsed = modbusTemplateSchema.parse({
      name: 'Waveshare relay 8ch',
      device: 'Waveshare Modbus POE ETH Relay',
      pollSeconds: 5,
      entities: [
        {
          name: 'Relay 1',
          domain: 'switch',
          capabilities: {
            on_off: {
              read: { function: 1, address: '0x0000' },
              write: { function: 5, on: '0xFF00', off: '0x0000' },
            },
          },
        },
        {
          name: 'Input 1',
          domain: 'binary_sensor',
          capabilities: { sensor_binary: { read: { function: 2, address: 0 } } },
        },
        {
          name: 'Firmware',
          domain: 'sensor',
          capabilities: {
            sensor_numeric: { read: { function: 3, address: '0x8000', type: 'u16', scale: 0.01 } },
          },
        },
      ],
    });

    expect(parsed.port).toBe(502);
    expect(parsed.unitId).toBe(1);
    expect(parsed.wordOrder).toBe('high');
  });

  it.each([
    [
      'a number read from coils',
      {
        name: 'Power',
        domain: 'sensor',
        capabilities: { sensor_numeric: { read: { function: 1, address: 0 } } },
      },
      'A number is read from registers: use 03 or 04',
    ],
    [
      'a number written to a coil',
      {
        name: 'Setpoint',
        domain: 'number',
        capabilities: {
          number: { read: { function: 3, address: 0 }, write: { function: 5, min: 0, max: 10 } },
        },
      },
      'A number is written to registers: use 06 or 16',
    ],
    [
      'a coil written as a register',
      {
        name: 'Relay',
        domain: 'switch',
        capabilities: { on_off: { read: { function: 1, address: 0 }, write: { function: 6 } } },
      },
      'The read is a coil: write it with 05 or 15',
    ],
    [
      'a 32-bit value written with 06',
      {
        name: 'Limit',
        domain: 'number',
        capabilities: {
          number: {
            read: { function: 3, address: 0, type: 'u32' },
            write: { function: 6, min: 0, max: 10 },
          },
        },
      },
      'A 32-bit value takes two registers: use 16',
    ],
    [
      'an input register written back',
      {
        name: 'Mode',
        domain: 'switch',
        capabilities: {
          on_off: { read: { function: 4, address: 0, bit: 0 }, write: { function: 6 } },
        },
      },
      'Needed: function 04 reads a table that cannot be written',
    ],
    [
      'a number with no limits',
      {
        name: 'Setpoint',
        domain: 'number',
        capabilities: {
          number: { read: { function: 3, address: 0 }, write: { function: 6, min: 5, max: 5 } },
        },
      },
      'Must be above min',
    ],
    [
      'a sensor that writes',
      {
        name: 'Power',
        domain: 'sensor',
        capabilities: {
          sensor_numeric: { read: { function: 3, address: 0 }, write: { function: 6 } },
        },
      },
      'A sensor is only read: leave the write out',
    ],
    [
      'a text with no count',
      {
        name: 'Serial',
        domain: 'sensor',
        capabilities: { sensor_text: { read: { function: 3, address: 0, type: 'string' } } },
      },
      'Needed: how many registers the text takes',
    ],
    [
      'a switch that is a number',
      {
        name: 'Relay',
        domain: 'switch',
        capabilities: { number: { read: { function: 3, address: 0 } } },
      },
      'A switch has on_off',
    ],
    [
      'a button with nowhere to write',
      { name: 'Reset', domain: 'button', capabilities: { button: { write: { function: 5 } } } },
      'Needed: there is no read to take it from',
    ],
  ])('refuses %s', (...[, entity, message]) => {
    expect(problemsOf(entity)).toContain(message);
  });

  it('refuses two entities of one id', () => {
    const entity = {
      name: 'Relay',
      domain: 'switch',
      capabilities: { on_off: { read: { function: 1, address: 0 } } },
    };
    const parsed = modbusTemplateSchema.safeParse({ name: 'Board', entities: [entity, entity] });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['entities', 1, 'name']);
  });

  it('gives each entity the id of its name, once', () => {
    const template = modbusTemplateSchema.parse(
      templateWith({
        name: 'Relay 1',
        domain: 'switch',
        capabilities: { on_off: { read: { function: 1, address: 0 } } },
      }),
    );
    const saved = withModbusEntityIds(template);

    expect(saved.entities[0]?.id).toBe('relay_1');
    expect(
      withModbusEntityIds({ ...saved, entities: [{ ...saved.entities[0]!, name: 'Pump' }] })
        .entities[0]?.id,
    ).toBe('relay_1');
  });
});

describe('modbusEntityIdOf', () => {
  it('joins words with _ and drops accents', () => {
    expect(modbusEntityIdOf('Temperatura mandata °C')).toBe('temperatura_mandata_c');
    expect(modbusEntityIdOf('  ')).toBe('entity');
  });
});

describe('modbusWordOf', () => {
  it('reads hex and decimal alike', () => {
    expect(modbusWordOf('0xFF00')).toBe(65_280);
    expect(modbusWordOf(40)).toBe(40);
  });
});

describe('ipv4RangeOf', () => {
  it('takes a network, a span and one address', () => {
    expect(ipv4RangeOf('192.168.1.0/24')).toEqual({ first: 3_232_235_776, last: 3_232_236_031 });
    expect(ipv4RangeOf('192.168.1.77/24')?.first).toBe(3_232_235_776);
    expect(ipv4RangeOf('10.0.0.20-10.0.0.40')).toEqual({ first: 167_772_180, last: 167_772_200 });
    expect(ipv4RangeOf('10.0.0.7')).toEqual({ first: 167_772_167, last: 167_772_167 });
  });

  it.each(['10.0.0.0/15', '10.0.0.40-10.0.0.20', '10.0.0.0-10.2.0.0', '10.0.0.256', 'garage'])(
    'refuses %s',
    (text) => {
      expect(ipv4RangeOf(text)).toBeNull();
    },
  );

  it('writes a number back as an address', () => {
    expect(ipv4Text(3_232_235_777)).toBe('192.168.1.1');
  });
});

describe('modbusSettingsSchema', () => {
  it('searches nothing until it is turned on, every two hours', () => {
    expect(modbusSettingsSchema.parse({})).toEqual({
      isSearchEnabled: false,
      ranges: [],
      intervalMinutes: 120,
    });
  });

  it('refuses ranges of more than 65536 addresses in all', () => {
    expect(modbusSettingsSchema.safeParse({ ranges: ['10.0.0.0/16', '10.1.0.0/24'] }).success).toBe(
      false,
    );
    expect(modbusSettingsSchema.safeParse({ ranges: ['garage'] }).success).toBe(false);
  });
});
