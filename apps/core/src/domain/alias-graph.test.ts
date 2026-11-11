import { describe, expect, it } from 'vitest';

import { parseEntityId, type EntityId } from '@nebulahome/contracts';

import { AliasCatalog, type AliasDefinition } from './alias-catalog.js';
import { aliasDescendants, findAliasCycle } from './alias-graph.js';

const a = parseEntityId('alias.a');
const b = parseEntityId('alias.b');
const c = parseEntityId('alias.c');
const sensor = parseEntityId('sensor.kitchen');

describe('findAliasCycle', () => {
  it('accepts a DAG', () => {
    expect(
      findAliasCycle([
        { aliasEntityId: a, sourceEntityId: sensor },
        { aliasEntityId: b, sourceEntityId: a },
      ]),
    ).toBeNull();
  });

  it('returns the path that closes a cycle', () => {
    const cycle = findAliasCycle([
      { aliasEntityId: a, sourceEntityId: b },
      { aliasEntityId: b, sourceEntityId: c },
      { aliasEntityId: c, sourceEntityId: a },
    ]);

    expect(cycle).not.toBeNull();
    expect(cycle?.path[0]).toBe(cycle?.path[cycle.path.length - 1]);
    expect(new Set(cycle?.path.slice(0, -1))).toEqual(new Set([a, b, c]));
  });
});

/**
 * An alias that only says what it reads: all the walk looks at.
 *
 * @param entityId - The alias entity.
 * @param reads - What it reads.
 * @returns The definition.
 */
function reading(entityId: EntityId, reads: readonly EntityId[]): AliasDefinition {
  return { id: `id-${entityId}`, entityId, reads } as unknown as AliasDefinition;
}

describe('aliasDescendants', () => {
  it('returns only descendants of the changed source, sources before dependents', () => {
    const catalog = new AliasCatalog();

    catalog.replaceAll([
      reading(a, [sensor]),
      reading(b, [a]),
      reading(c, [parseEntityId('sensor.other')]),
    ]);

    expect(aliasDescendants((entityId) => catalog.readersOf(entityId), sensor)).toEqual([a, b]);
  });

  it('follows the catalogue as aliases are saved and removed', () => {
    const catalog = new AliasCatalog();
    const other = parseEntityId('sensor.other');
    const descendants = (): EntityId[] =>
      aliasDescendants((entityId) => catalog.readersOf(entityId), sensor);

    catalog.upsert(reading(a, [sensor]));
    catalog.upsert(reading(b, [a]));
    catalog.upsert(reading(c, [sensor]));
    expect(descendants()).toEqual([a, c, b]);

    // A save that keeps what it reads leaves it where it was.
    catalog.upsert(reading(a, [sensor]));
    expect(descendants()).toEqual([a, c, b]);

    catalog.upsert(reading(a, [other]));
    expect(descendants()).toEqual([c]);
    expect([...catalog.readersOf(other)]).toEqual([a]);

    catalog.remove(c);
    catalog.remove(a);
    expect(descendants()).toEqual([]);
    expect(catalog.readersOf(other).size).toBe(0);
    expect([...catalog.readersOf(a)]).toEqual([b]);
  });
});
