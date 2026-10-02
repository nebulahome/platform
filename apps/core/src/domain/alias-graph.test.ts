import { describe, expect, it } from 'vitest';

import { parseEntityId } from '@nebulahome/contracts';

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

describe('aliasDescendants', () => {
  it('returns only descendants of the changed source, sources before dependents', () => {
    const edges = [
      { aliasEntityId: a, sourceEntityId: sensor },
      { aliasEntityId: b, sourceEntityId: a },
      { aliasEntityId: c, sourceEntityId: parseEntityId('sensor.other') },
    ];

    expect(aliasDescendants(edges, sensor)).toEqual([a, b]);
  });
});
