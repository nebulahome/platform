/**
 * What the alias pages work out: a part's value in a state and in words, the list's filter and
 * groups, and the type search.
 */
import { describe, expect, it } from 'vitest';

import { aliasType } from '@nebulahome/contracts';

import {
  GUEST_MODE,
  HOUSE_TEMPERATURE,
  listItemOf,
  SAMPLE_ALIASES,
  THERMOSTAT,
  WASHER,
} from '@/testing/alias-samples';

import {
  ALIAS_LIST_CODEC,
  aliasDefs,
  formatPartValue,
  groupAliases,
  matchesAliasList,
  OPEN_ALIAS_LIST_FILTER,
  partValueOf,
  searchTypes,
  sourceChip,
} from './alias-model';

const items = SAMPLE_ALIASES.map(listItemOf);

/**
 * A part of a type, by key.
 *
 * @param type - The type.
 * @param key - The part.
 * @returns The part.
 * @throws {Error} When the type has no such part.
 */
function defOf(type: Parameters<typeof aliasDefs>[0], key: string) {
  const def = aliasDefs(type).find((each) => each.key === key);

  if (def === undefined) {
    throw new Error(`No part ${key}`);
  }

  return def;
}

describe('a part in a state', () => {
  it('reads its field under its capability', () => {
    const state = { thermostat: { targetTemperature: 21, mode: 'heat' } };

    expect(partValueOf(defOf('thermostat', 'target_temperature'), state)).toBe(21);
    expect(partValueOf(defOf('thermostat', 'mode'), state)).toBe('heat');
    expect(partValueOf(defOf('thermostat', 'action'), state)).toBeUndefined();
  });

  it('reads a colour as hue and saturation together', () => {
    const color = defOf('light', 'color');

    expect(partValueOf(color, { color_hs: { hue: 30, saturation: 80 } })).toEqual({
      hue: 30,
      saturation: 80,
    });
    expect(partValueOf(color, { color_hs: { hue: 30 } })).toBeUndefined();
  });

  it('says it in words', () => {
    expect(formatPartValue(defOf('light', 'color_temp'), 370)).toBe('2,703 K');
    expect(formatPartValue(defOf('light', 'on'), true)).toBe('On');
    expect(formatPartValue(defOf('thermostat', 'mode'), 'fan_only')).toBe('Fan only');
    expect(formatPartValue(defOf('sensor', 'value'), 21.456, '°C')).toBe('21.46 °C');
    expect(formatPartValue(defOf('sensor', 'value'), null)).toBe('—');
  });
});

describe('where a part comes from', () => {
  it('names each source as its chip shows it', () => {
    const name = (entityId: string): string => `Name of ${entityId}`;

    expect(sourceChip({ from: 'stored', value: 1 }, name).text).toBe('Stored');
    expect(sourceChip({ from: 'code', function: 'action' }, name)).toMatchObject({
      text: 'action()',
      isMono: true,
    });
    expect(sourceChip(HOUSE_TEMPERATURE.parts['value'] ?? { from: 'stored' }, name).text).toBe(
      'Entities · average of 3',
    );
  });
});

describe('the list', () => {
  it('keeps the problems alone when asked', () => {
    const shown = items.filter((item) =>
      matchesAliasList(item, { ...OPEN_ALIAS_LIST_FILTER, show: 'problems' }),
    );

    expect(shown.map((item) => item.name).sort()).toEqual(['Garage power', 'Washing done']);
  });

  it('narrows by type, device and search', () => {
    const byType = items.filter((item) =>
      matchesAliasList(item, { ...OPEN_ALIAS_LIST_FILTER, type: 'sensor' }),
    );
    const real = items.filter((item) =>
      matchesAliasList(item, { ...OPEN_ALIAS_LIST_FILTER, device: 'existing' }),
    );
    const searched = items.filter((item) =>
      matchesAliasList(item, { ...OPEN_ALIAS_LIST_FILTER, search: 'washing_machine' }),
    );

    expect(byType.map((item) => item.name).sort()).toEqual(['Garage power', 'House temperature']);
    expect(real.map((item) => item.name).sort()).toEqual([
      'Garage power',
      'Living room thermostat',
      'Washing done',
    ]);
    expect(searched.map((item) => item.name)).toEqual([WASHER.name]);
  });

  it('groups by type in the types’ order, each by name', () => {
    const groups = groupAliases(items);

    expect(groups.map((group) => group.type.id)).toEqual([
      'sensor',
      'binary_sensor',
      'switch',
      'light',
      'thermostat',
    ]);
    expect(groups[0]?.items.map((item) => item.name)).toEqual([
      'Garage power',
      'House temperature',
    ]);
    expect(groups.find((group) => group.type.id === 'switch')?.items).toEqual([
      listItemOf(GUEST_MODE),
    ]);
  });

  it('keeps its filter in the address, leaving out what is open', () => {
    const filter = { ...OPEN_ALIAS_LIST_FILTER, show: 'problems' as const, type: 'light' };
    const written = new URLSearchParams(ALIAS_LIST_CODEC.write(filter));

    expect(written.toString()).toBe('show=problems&type=light');
    expect(ALIAS_LIST_CODEC.read(written)).toEqual(filter);
  });
});

describe('the type search', () => {
  it('finds a type by its name, or by one of its words', () => {
    expect(searchTypes('therm').map((match) => match.type.id)).toContain('thermostat');

    const byWord = searchTypes('heating').find((match) => match.type.id === 'thermostat');

    expect(byWord?.word).toBe('heating');
    expect(searchTypes('').length).toBe(21);
  });

  it('lists the thermostat’s required parts first', () => {
    const keys = aliasDefs(THERMOSTAT.behavesAs).map((def) => def.key);

    expect(keys.slice(0, 3)).toEqual(['target_temperature', 'mode', 'action']);
    expect(aliasType('thermostat').display).toBeUndefined();
  });
});
