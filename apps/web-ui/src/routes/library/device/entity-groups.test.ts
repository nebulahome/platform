/**
 * A device's entities, split into what can be operated and what only reports.
 */
import { describe, expect, it } from 'vitest';

import type { CapabilityName } from '@nebulahome/contracts';

import { entityGroupsOf, isReadingOnly } from './entity-groups';

/**
 * An entity line with the given capabilities.
 *
 * @param name - What to call it.
 * @param capabilities - What it can do.
 * @returns The line.
 */
function line(name: string, ...capabilities: CapabilityName[]) {
  return {
    name,
    entity: { capabilities: capabilities.map((capability) => ({ capability, params: {} })) },
  };
}

describe('isReadingOnly', () => {
  it('takes an entity that only reports as a sensor', () => {
    expect(isReadingOnly(line('Power', 'sensor_numeric').entity)).toBe(true);
    expect(isReadingOnly(line('Update', 'sensor_binary').entity)).toBe(true);
    expect(isReadingOnly(line('Mode', 'sensor_text').entity)).toBe(true);
  });

  it('takes anything that can be operated as a control', () => {
    expect(isReadingOnly(line('Light', 'on_off', 'level').entity)).toBe(false);
    expect(isReadingOnly(line('Install update', 'button').entity)).toBe(false);
    expect(isReadingOnly(line('Nothing').entity)).toBe(false);
  });
});

describe('entityGroupsOf', () => {
  it('lists the controls first, then the sensors, each in the order given', () => {
    const groups = entityGroupsOf([
      line('Energy', 'sensor_numeric'),
      line('Light', 'on_off', 'level'),
      line('Power', 'sensor_numeric'),
      line('Restart', 'button'),
    ]);

    expect(groups.map((group) => [group.title, group.lines.map((each) => each.name)])).toEqual([
      ['Controls', ['Light', 'Restart']],
      ['Sensors', ['Energy', 'Power']],
    ]);
  });

  it('leaves out a group with nothing in it', () => {
    expect(entityGroupsOf([line('Temperature', 'sensor_numeric')]).map((g) => g.title)).toEqual([
      'Sensors',
    ]);
    expect(entityGroupsOf([])).toEqual([]);
  });
});
