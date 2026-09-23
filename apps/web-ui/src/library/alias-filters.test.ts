/**
 * Whether an alias belongs under a filter.
 */
import { describe, expect, it } from 'vitest';

import { entityIdSchema, type AliasView } from '@nebula-home/contracts';

import { matchesAliasFilter, OPEN_ALIAS_FILTER } from './alias-filters';

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

  it('narrows by domain and by standing', () => {
    expect(matchesAliasFilter(ALIAS, { ...OPEN_ALIAS_FILTER, domain: 'light' }, true)).toBe(false);
    expect(matchesAliasFilter(ALIAS, { ...OPEN_ALIAS_FILTER, domain: 'sensor' }, true)).toBe(true);
    expect(matchesAliasFilter(ALIAS, { ...OPEN_ALIAS_FILTER, status: 'off' }, true)).toBe(false);
    expect(matchesAliasFilter(ALIAS, { ...OPEN_ALIAS_FILTER, status: 'enabled' }, true)).toBe(true);
    expect(matchesAliasFilter(ALIAS, { ...OPEN_ALIAS_FILTER, status: 'failing' }, true)).toBe(
      false,
    );
    expect(
      matchesAliasFilter(
        { ...ALIAS, lastError: 'boom' },
        { ...OPEN_ALIAS_FILTER, status: 'failing' },
        true,
      ),
    ).toBe(true);
    expect(matchesAliasFilter(ALIAS, { ...OPEN_ALIAS_FILTER, status: 'unavailable' }, true)).toBe(
      false,
    );
    expect(matchesAliasFilter(ALIAS, { ...OPEN_ALIAS_FILTER, status: 'unavailable' }, false)).toBe(
      true,
    );
  });
});
