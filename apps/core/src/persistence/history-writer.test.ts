import { describe, expect, it } from 'vitest';

import { latestRowPerEntity, type EntityStateRow } from './history-writer.js';

/**
 * A cache row for an entity, reporting a number.
 *
 * @param entityId - Which entity.
 * @param value - What it reported.
 * @param at - When.
 * @returns The row.
 */
function row(entityId: string, value: number, at: number): EntityStateRow {
  return {
    entityId,
    state: { sensor_numeric: { value } },
    attributes: {},
    isAvailable: true,
    lastChanged: new Date(at),
    lastUpdated: new Date(at),
    source: 'test',
    contextId: null,
    contextType: null,
  };
}

describe('latestRowPerEntity', () => {
  it('keeps the newest row of an entity that reported more than once in a batch', () => {
    // The nozzle reported three times in one flush window. Only the last report is the state
    // the cache should hold, and a statement naming the nozzle three times would be refused.
    const collapsed = latestRowPerEntity([
      row('nozzle', 24.6, 1000),
      row('bed', 23.9, 1001),
      row('nozzle', 24.5, 4000),
      row('nozzle', 24.4, 7000),
    ]);

    expect(collapsed.map((each) => each.entityId)).toEqual(['nozzle', 'bed']);
    expect(collapsed[0]?.state).toEqual({ sensor_numeric: { value: 24.4 } });
    expect(collapsed[1]?.state).toEqual({ sensor_numeric: { value: 23.9 } });
  });

  it('leaves a batch without repeats as it was', () => {
    const rows = [row('a', 1, 1000), row('b', 2, 1001), row('c', 3, 1002)];

    expect(latestRowPerEntity(rows)).toEqual(rows);
  });

  it('has nothing to say about an empty batch', () => {
    expect(latestRowPerEntity([])).toEqual([]);
  });
});
