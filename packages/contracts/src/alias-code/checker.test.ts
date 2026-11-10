/**
 * The static check of alias code: what it reads and uses, and the problems that stop it.
 */
import { describe, expect, it } from 'vitest';

import { checkCode, type CheckContext } from './checker.js';

const CODE = `def action():
    if binary_sensor.lr_window:
        return "idle"
    if minutes_since(last_changed("sensor.room")) > 10:
        return "off"
    return "heating"

def helper(x):
    return x
`;

const CONTEXT: CheckContext = {
  parts: [{ key: 'action', expectation: { kind: 'enum', values: ['off', 'idle', 'heating'] } }],
  knownEntity: (entityId) => ['binary_sensor.lr_window', 'sensor.room'].includes(entityId),
  partKeys: ['action', 'mode'],
};

describe('checkCode', () => {
  it('says what the code reads and uses, with no problem', () => {
    const result = checkCode(CODE, CONTEXT);

    expect(result.problems.filter((problem) => problem.severity === 'error')).toEqual([]);
    expect(result.reads.entityIds).toEqual(['binary_sensor.lr_window', 'sensor.room']);
    expect(result.uses.time).toBe(true);
    expect(result.functions.find((fn) => fn.name === 'action')?.literalReturns).toEqual([
      'idle',
      'off',
      'heating',
    ]);
    expect(result.functions.find((fn) => fn.name === 'helper')?.params).toEqual(['x']);
  });

  it('finds an entity the house has not got, a missing function, and a return that does not fit', () => {
    const result = checkCode(
      'def action():\n    if sensor.gone:\n        return "boiling"\n    return "off"\n',
      {
        ...CONTEXT,
        parts: [...CONTEXT.parts, { key: 'mode', expectation: { kind: 'text' } }],
      },
    );
    const messages = result.problems.map((problem) => problem.message).join('\n');

    expect(messages).toMatch(/sensor\.gone/u);
    expect(messages).toMatch(/mode/u);
    expect(messages).toMatch(/boiling/u);
  });

  it('refuses what the language does not have, at its line', () => {
    const result = checkCode('import os\n\ndef action():\n    return "off"\n', CONTEXT);

    expect(result.problems[0]).toMatchObject({ line: 1, severity: 'error' });
  });
});
