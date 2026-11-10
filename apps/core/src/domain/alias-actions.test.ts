import { describe, expect, it } from 'vitest';

import { changeFires, changeHolds, partToken, resolveFormulas } from './alias-actions.js';

describe('when an alias action starts on a change', () => {
  it('names a value the way From and To do', () => {
    expect(partToken(true)).toBe('on');
    expect(partToken(false)).toBe('off');
    expect(partToken('heat')).toBe('heat');
    expect(partToken(21.5)).toBe('21.5');
    expect(partToken(null)).toBeUndefined();
  });

  it('fires on a state left and entered, not while it stays', () => {
    const turnsOn = { kind: 'state', to: 'on' } as const;

    expect(changeFires(turnsOn, false, true)).toBe(true);
    expect(changeFires(turnsOn, true, true)).toBe(false);
    expect(changeFires({ kind: 'state', from: 'heat', to: 'off' }, 'cool', 'off')).toBe(false);
    expect(changeFires({ kind: 'state' }, 'heat', 'off')).toBe(true);
  });

  it('fires when a number crosses, not while it stays past', () => {
    const above = { kind: 'numeric', operator: 'gt', value: 60 } as const;

    expect(changeFires(above, 40, 72)).toBe(true);
    expect(changeFires(above, 72, 80)).toBe(false);
    expect(changeFires(above, 72, 40)).toBe(false);
    expect(changeHolds(above, 61)).toBe(true);
    expect(changeHolds(above, 60)).toBe(false);
  });
});

describe('the formulas of an action', () => {
  it('reads the command values and entities, fitted to what the param allows', () => {
    const readings: Record<string, number> = { 'sensor.lux': 300 };

    expect(
      resolveFormulas(
        'level',
        { command: 'set_level', level: { formula: 'command.level * 0.6' }, transitionMs: 1000 },
        { command: 'set_level', level: 72 },
        (name) => readings[name] ?? null,
      ),
    ).toEqual({ command: 'set_level', level: 43.2, transitionMs: 1000 });

    // A brightness is at most 100, whatever the formula says.
    expect(
      resolveFormulas(
        'level',
        { command: 'set_level', level: { formula: 'sensor.lux / 2' } },
        undefined,
        (name) => readings[name] ?? null,
      ),
    ).toEqual({ command: 'set_level', level: 100 });
  });

  it('fails the step, saying which param, when a formula cannot be worked out', () => {
    expect(() =>
      resolveFormulas(
        'level',
        { command: 'set_level', level: { formula: 'command.level * ' } },
        { command: 'set_level', level: 72 },
        () => null,
      ),
    ).toThrow(/^level: /u);
  });
});
