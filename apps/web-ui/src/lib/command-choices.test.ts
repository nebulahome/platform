import { describe, expect, it } from 'vitest';

import { choiceOf, commandChoicesFor, commandChoicesOf, defaultParams } from './command-choices';

describe('commandChoicesOf', () => {
  it('reads every command a capability takes, with its fields', () => {
    expect(commandChoicesOf('on_off').map((choice) => choice.command)).toEqual([
      'turn_on',
      'turn_off',
      'toggle',
    ]);

    const [setLevel] = commandChoicesOf('level');

    expect(setLevel).toMatchObject({
      label: 'Set level',
      fields: [
        { key: 'level', kind: 'percent', label: 'Level', isOptional: false },
        { key: 'transitionMs', kind: 'duration', label: 'Transition', isOptional: true },
      ],
    });
  });

  it('reads an enum as its choices', () => {
    const setMode = commandChoicesOf('thermostat').find((choice) => choice.command === 'set_mode');

    expect(setMode?.fields[0]).toMatchObject({
      kind: 'enum',
      options: ['off', 'heat', 'cool', 'auto', 'fan_only', 'dry'],
    });
  });

  it('has nothing for a capability that only reports', () => {
    expect(commandChoicesOf('sensor_numeric')).toEqual([]);
  });
});

describe('defaultParams', () => {
  it('fills what the command needs and leaves what it may go without', () => {
    const choices = commandChoicesFor(['on_off', 'level']);
    const setLevel = choiceOf(choices, 'level', { command: 'set_level' });

    expect(setLevel === undefined ? undefined : defaultParams(setLevel)).toEqual({
      command: 'set_level',
      level: 100,
    });
    expect(choiceOf(choices, 'on_off', { command: 'set_level' })).toBeUndefined();
  });
});
