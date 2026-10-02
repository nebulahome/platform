/**
 * Whether an alias belongs under a filter.
 */
import { describe, expect, it } from 'vitest';

import { entityIdSchema, type AliasView } from '@nebulahome/contracts';

import {
  ALIAS_FILTER_CODEC,
  byAliasName,
  matchesAliasFilter,
  OPEN_ALIAS_FILTER,
} from './alias-filters';

const ALIAS: AliasView = {
  id: '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f',
  entityId: entityIdSchema.parse('alias.kitchen_average'),
  name: 'Kitchen average',
  kind: 'calculated',
  domain: 'sensor',
  capability: 'sensor_numeric',
  capabilities: ['sensor_numeric'],
  expression: '(t1 + t2) / 2',
  debounceMs: 0,
  fallbackPolicy: 'unavailable',
  isEnabled: true,
  lastError: null,
  lastEvaluatedAt: null,
  unitOfMeasurement: '°C',
  deviceClass: 'temperature',
  min: null,
  max: null,
  step: null,
  sources: [
    {
      variableName: 't1',
      entityId: entityIdSchema.parse('sensor.kitchen_temperature'),
      entityName: 'Kitchen temperature',
      areaName: 'Kitchen',
    },
  ],
};

describe('matchesAliasFilter', () => {
  it('admits everything under the open filter', () => {
    expect(matchesAliasFilter(ALIAS, OPEN_ALIAS_FILTER, true)).toBe(true);
  });

  it('matches the name, the entity id and a source name', () => {
    expect(matchesAliasFilter(ALIAS, { ...OPEN_ALIAS_FILTER, search: 'average' }, true)).toBe(true);
    expect(matchesAliasFilter(ALIAS, { ...OPEN_ALIAS_FILTER, search: 'alias.kitchen' }, true)).toBe(
      true,
    );
    expect(
      matchesAliasFilter(ALIAS, { ...OPEN_ALIAS_FILTER, search: 'kitchen temperature' }, true),
    ).toBe(true);
    expect(matchesAliasFilter(ALIAS, { ...OPEN_ALIAS_FILTER, search: 'porch' }, true)).toBe(false);
  });

  it('also finds an alias by the address and the room of a source', () => {
    expect(
      matchesAliasFilter(
        ALIAS,
        { ...OPEN_ALIAS_FILTER, search: 'sensor.kitchen_temperature' },
        true,
      ),
    ).toBe(true);
    expect(
      matchesAliasFilter(ALIAS, { ...OPEN_ALIAS_FILTER, search: 'kitchen average' }, true),
    ).toBe(true);
  });

  it('narrows by domain', () => {
    expect(matchesAliasFilter(ALIAS, { ...OPEN_ALIAS_FILTER, domain: 'light' }, true)).toBe(false);
    expect(matchesAliasFilter(ALIAS, { ...OPEN_ALIAS_FILTER, domain: 'sensor' }, true)).toBe(true);
  });

  it('asks whether it is on apart from what is wrong with it', () => {
    const failing = { ...ALIAS, lastError: 'boom' };

    expect(matchesAliasFilter(ALIAS, { ...OPEN_ALIAS_FILTER, state: 'off' }, true)).toBe(false);
    expect(matchesAliasFilter(ALIAS, { ...OPEN_ALIAS_FILTER, state: 'on' }, true)).toBe(true);
    expect(matchesAliasFilter(ALIAS, { ...OPEN_ALIAS_FILTER, health: 'failing' }, true)).toBe(
      false,
    );
    // On and failing: the one a single status dropdown could not find.
    expect(
      matchesAliasFilter(failing, { ...OPEN_ALIAS_FILTER, state: 'on', health: 'failing' }, true),
    ).toBe(true);
    expect(matchesAliasFilter(ALIAS, { ...OPEN_ALIAS_FILTER, health: 'unavailable' }, true)).toBe(
      false,
    );
    expect(matchesAliasFilter(ALIAS, { ...OPEN_ALIAS_FILTER, health: 'unavailable' }, false)).toBe(
      true,
    );
  });
});

describe('the address', () => {
  it('keeps the filter in the query and leaves the open one out', () => {
    const filter = { ...OPEN_ALIAS_FILTER, search: 'kitchen', health: 'failing' as const };

    expect(ALIAS_FILTER_CODEC.write(filter)).toEqual({ q: 'kitchen', health: 'failing' });
    expect(
      ALIAS_FILTER_CODEC.read(new URLSearchParams({ q: 'kitchen', health: 'failing' })),
    ).toEqual(filter);
    expect(ALIAS_FILTER_CODEC.read(new URLSearchParams({ state: 'nonsense' })).state).toBe('any');
  });
});

describe('byAliasName', () => {
  it('orders by the name a person gave, not by the address', () => {
    const attic = {
      ...ALIAS,
      name: 'Attic humidity',
      entityId: entityIdSchema.parse('alias.z_attic'),
    };

    expect(byAliasName([ALIAS, attic]).map((alias) => alias.name)).toEqual([
      'Attic humidity',
      'Kitchen average',
    ]);
  });
});
