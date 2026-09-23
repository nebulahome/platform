/**
 * An alias's sources: their colours, their names, and what their formula reads now.
 */
import { describe, expect, it } from 'vitest';

import { anEntity } from '@/testing/fixtures';

import {
  nextVariableName,
  readFormula,
  sourceColors,
  toSources,
  variableProblem,
  type SourceDraft,
} from './alias-sources';

/**
 * A source row.
 *
 * @param rowKey - Its key.
 * @param variableName - Its variable.
 * @param entityId - Its entity.
 * @returns The row.
 */
function row(rowKey: string, variableName: string, entityId = ''): SourceDraft {
  return { rowKey, variableName, entityId };
}

describe('sourceColors', () => {
  it('gives a name the same colour whatever rows sit around it', () => {
    const alone = sourceColors([row('a', 'hall')]);
    const withOthers = sourceColors([row('x', 'kitchen'), row('y', 'hall')]);

    // Unless the other name happened to take its colour first, removing a row does not repaint
    // the one after it.
    if (withOthers.get('x') !== alone.get('a')) {
      expect(withOthers.get('y')).toBe(alone.get('a'));
    }
  });

  it('never gives two rows one colour', () => {
    const rows = Array.from({ length: 12 }, (unused, index) =>
      row(`r${String(index)}`, `t${String(index)}`),
    );
    const colors = [...sourceColors(rows).values()];

    expect(new Set(colors).size).toBe(12);
  });
});

describe('variable names', () => {
  it('asks for a name the formula can use, and one no other source has', () => {
    const rows = [row('a', 't1'), row('b', 'T2'), row('c', 't1'), row('d', ' ')];

    expect(variableProblem(rows, 0)).toMatch(/already called t1/u);
    expect(variableProblem(rows, 1)).toMatch(/Lower-case/u);
    expect(variableProblem(rows, 3)).toMatch(/name/u);
    expect(toSources(rows)).toBeNull();
  });

  it('offers the first free tN for a new source', () => {
    expect(nextVariableName([row('a', 't1'), row('b', 't3')])).toBe('t2');
  });
});

describe('readFormula', () => {
  const kitchen = anEntity({
    entityId: 'sensor.kitchen_temperature',
    capabilities: [{ capability: 'sensor_numeric', params: {} }],
    state: { sensor_numeric: { value: 21 } },
  });
  const hall = anEntity({
    entityId: 'sensor.hall_temperature',
    capabilities: [{ capability: 'sensor_numeric', params: {} }],
    state: { sensor_numeric: { value: 23 } },
  });
  const entities = new Map([
    [kitchen.entityId, kitchen],
    [hall.entityId, hall],
  ]);
  const sources = [row('a', 't1', kitchen.entityId), row('b', 't2', hall.entityId)];
  const result = { capability: 'sensor_numeric', unit: '°C' };

  it('works the formula out from the sources’ readings', () => {
    const reading = readFormula('(t1 + t2) / 2', sources, entities, {}, result);

    expect(reading.tone).toBe('value');
    expect(reading.text).toMatch(/^Reads 22 °C now\.$/u);
  });

  it('prefers what the channel said since', () => {
    const reading = readFormula(
      't1',
      sources,
      entities,
      {
        [kitchen.entityId]: {
          state: { sensor_numeric: { value: 30 } },
          attributes: {},
          isAvailable: true,
          changedAt: new Date(),
          receivedAt: 1,
        },
      },
      result,
    );

    expect(reading.text).toContain('30');
  });

  it('names a variable that is not a source, before anything else', () => {
    expect(readFormula('t1 + t9', sources, entities, {}, result)).toEqual({
      tone: 'problem',
      text: 't9 is not one of the sources.',
    });
  });

  it('says what the evaluator says of a formula it cannot read', () => {
    expect(readFormula('t1 +', sources, entities, {}, result).tone).toBe('problem');
  });

  it('waits, rather than fails, while a source has not been chosen', () => {
    expect(readFormula('t1', [row('a', 't1')], entities, {}, result).tone).toBe('hint');
  });
});
