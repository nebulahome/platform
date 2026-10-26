/**
 * What the template editor says of each domain, capability and function code: its icon, its tint,
 * and the line that explains it.
 */
import type { ModbusCapability, ModbusDomain } from '@nebulahome/contracts';
import type { UiIconId } from '@nebulahome/ui';

import { defineMessage, translate } from '@/i18n/messages';

/** How a domain is drawn: its icon, the tint of its tile and chip, and its name. */
export type DomainLook = {
  readonly icon: UiIconId;

  /** The tile's and the chip's classes: the domain's colour on its own faint ground. */
  readonly tint: string;
  readonly label: string;

  /** What it is, on the Add entity tile. */
  readonly line: string;
};

/**
 * How each domain is drawn.
 *
 * @returns The looks, by domain.
 */
export function domainLooks(): Readonly<Record<ModbusDomain, DomainLook>> {
  return {
    sensor: {
      icon: 'gauge',
      tint: 'bg-cyan/14 text-cyan',
      label: translate('brokers.modbus.domain.sensor', 'Sensor'),
      line: translate(
        'brokers.modbus.domain.sensorLine',
        'Reports a number or a text the device measures.',
      ),
    },
    binary_sensor: {
      icon: 'circle-dot',
      tint: 'bg-violet/14 text-violet',
      label: translate('brokers.modbus.domain.binary_sensor', 'Binary sensor'),
      line: translate(
        'brokers.modbus.domain.binarySensorLine',
        'On or off, from a bit: an input, an alarm.',
      ),
    },
    switch: {
      icon: 'toggle-left',
      tint: 'bg-success/14 text-success',
      label: translate('brokers.modbus.domain.switch', 'Switch'),
      line: translate(
        'brokers.modbus.domain.switchLine',
        'Turns something on and off: a relay, a coil.',
      ),
    },
    light: {
      icon: 'lightbulb',
      tint: 'bg-lamp/14 text-lamp',
      label: translate('brokers.modbus.domain.light', 'Light'),
      line: translate('brokers.modbus.domain.lightLine', 'Switches, and may dim with a level.'),
    },
    number: {
      icon: 'hash',
      tint: 'bg-tag-blue/14 text-tag-blue',
      label: translate('brokers.modbus.domain.number', 'Number'),
      line: translate(
        'brokers.modbus.domain.numberLine',
        'A setting within limits: a setpoint, a delay.',
      ),
    },
    select: {
      icon: 'list',
      tint: 'bg-tag-pink/14 text-tag-pink',
      label: translate('brokers.modbus.domain.select', 'Select'),
      line: translate(
        'brokers.modbus.domain.selectLine',
        'One of a few modes, each a number on the device.',
      ),
    },
    button: {
      icon: 'mouse-pointer-click',
      tint: 'bg-tag-orange/14 text-tag-orange',
      label: translate('brokers.modbus.domain.button', 'Button'),
      line: translate(
        'brokers.modbus.domain.buttonLine',
        'Writes one value when pressed: a reset.',
      ),
    },
  };
}

/** The capabilities each domain lists on its tile. */
export const DOMAIN_CAPABILITY_LINES: Readonly<Record<ModbusDomain, string>> = {
  sensor: 'sensor_numeric · sensor_text',
  binary_sensor: 'sensor_binary',
  switch: 'on_off',
  light: 'on_off + level',
  number: 'number',
  select: 'select',
  button: 'button',
};

/**
 * What a capability does, in a few words.
 *
 * @param capability - The capability.
 * @returns The line.
 */
export function capabilityLine(capability: ModbusCapability): string {
  switch (capability) {
    case 'sensor_numeric':
      return translate('brokers.modbus.cap.sensorNumeric', 'A number, scaled');
    case 'sensor_text':
      return translate('brokers.modbus.cap.sensorText', 'A text, or a number’s meaning');
    case 'sensor_binary':
      return translate('brokers.modbus.cap.sensorBinary', 'On or off');
    case 'on_off':
      return translate('brokers.modbus.cap.onOff', 'Switched on and off');
    case 'level':
      return translate('brokers.modbus.cap.level', 'From 0 to 100 %, spread between min and max');
    case 'number':
      return translate('brokers.modbus.cap.number', 'Set within min and max');
    case 'select':
      return translate('brokers.modbus.cap.select', 'One of the options');
    case 'button':
      return translate('brokers.modbus.cap.button', 'Pressed');
  }
}

/** Each function code, and the line that says what it reads or writes. */
export const FUNCTION_LINES = {
  1: defineMessage('brokers.modbus.fc.1', 'Coils: bits you read and write · 0xxxx in manuals'),
  2: defineMessage('brokers.modbus.fc.2', 'Discrete inputs: bits you only read · 1xxxx'),
  3: defineMessage('brokers.modbus.fc.3', 'Holding registers: words you read and write · 4xxxx'),
  4: defineMessage('brokers.modbus.fc.4', 'Input registers: words you only read · 3xxxx'),
  5: defineMessage('brokers.modbus.fc.5', 'One coil: 0xFF00 on, 0x0000 off'),
  6: defineMessage('brokers.modbus.fc.6', 'One register'),
  15: defineMessage('brokers.modbus.fc.15', 'Several coils'),
  16: defineMessage('brokers.modbus.fc.16', 'Several registers: needed for 32-bit values'),
} as const;

/** What each function code is called, in the reference card. */
export const FUNCTION_NAMES = {
  1: defineMessage('brokers.modbus.fcName.1', 'Read coils'),
  2: defineMessage('brokers.modbus.fcName.2', 'Read discrete inputs'),
  3: defineMessage('brokers.modbus.fcName.3', 'Read holding registers'),
  4: defineMessage('brokers.modbus.fcName.4', 'Read input registers'),
  5: defineMessage('brokers.modbus.fcName.5', 'Write one coil'),
  6: defineMessage('brokers.modbus.fcName.6', 'Write one register'),
  15: defineMessage('brokers.modbus.fcName.15', 'Write coils'),
  16: defineMessage('brokers.modbus.fcName.16', 'Write registers'),
} as const;

/**
 * A function code as the editor writes it: two digits.
 *
 * @param fn - The code.
 * @returns `03`.
 */
export function fcText(fn: number): string {
  return String(fn).padStart(2, '0');
}
