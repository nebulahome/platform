import { describe, expect, it } from 'vitest';

import {
  aliasCapabilityParams,
  aliasEnumValues,
  aliasPartIssues,
  aliasPartsSchema,
  defaultAliasParts,
} from './alias-parts.js';
import { ALIAS_TYPES, aliasCapabilities, aliasPartDef, aliasType } from './alias-types.js';
import { CAPABILITY_DEFINITIONS } from './capabilities.js';

describe('alias parts', () => {
  it('starts every type with its required parts, Stored, and nothing wrong', () => {
    for (const type of ALIAS_TYPES) {
      if (type.id === 'custom') {
        continue;
      }

      const parts = defaultAliasParts(type);

      expect(Object.keys(parts), type.id).toEqual(
        type.parts.filter((part) => part.isRequired).map((part) => part.key),
      );
      expect(
        Object.values(parts).every((config) => config.from === 'stored'),
        type.id,
      ).toBe(true);

      // An image's picture has nothing to store: it must name an entity before it is created.
      const issues = aliasPartIssues(type, aliasPartsSchema.parse(parts));
      expect(issues, type.id).toEqual(
        type.id === 'image'
          ? [{ part: 'picture', message: 'Picture cannot come from stored' }]
          : [],
      );
    }
  });

  it('works out params every capability schema accepts, for every type', () => {
    for (const type of ALIAS_TYPES) {
      if (type.id === 'custom') {
        continue;
      }

      const parts = Object.fromEntries(
        type.parts.map((part) => [
          part.key,
          defaultAliasParts({ ...type, parts: [{ ...part, isRequired: true }] })[part.key],
        ]),
      );
      const capabilities = aliasCapabilities(type, Object.keys(parts));
      const params = aliasCapabilityParams(capabilities, aliasPartsSchema.parse(parts), type.parts);

      for (const capability of capabilities) {
        expect(
          CAPABILITY_DEFINITIONS[capability].params.safeParse(params[capability]).success,
          `${type.id}.${capability}`,
        ).toBe(true);
      }
    }
  });

  it('takes the thermostat params from the parts', () => {
    const thermostat = aliasType('thermostat');
    const parts = aliasPartsSchema.parse({
      target_temperature: { from: 'stored', value: 21, min: 10, max: 28, step: 0.5 },
      mode: { from: 'stored', value: 'heat', offered: ['off', 'heat'] },
      action: { from: 'code', function: 'action' },
      preset: { from: 'stored', value: 'eco', offered: ['comfort', 'eco'] },
    });
    const params = aliasCapabilityParams(['thermostat'], parts, thermostat.parts);

    expect(params['thermostat']).toMatchObject({
      supportedModes: ['off', 'heat'],
      minTemperature: 10,
      maxTemperature: 28,
      presets: ['comfort', 'eco'],
      hasTargetRange: false,
    });
  });

  it('borrows the params of the one entity a capability comes from', () => {
    const thermostat = aliasType('thermostat');
    const parts = aliasPartsSchema.parse({
      target_temperature: { from: 'entity', entity: 'climate.hall' },
      mode: { from: 'entity', entity: 'climate.hall' },
      action: { from: 'entity', entity: 'climate.hall' },
    });
    const params = aliasCapabilityParams(['thermostat'], parts, thermostat.parts, () => ({
      supportedModes: ['off', 'cool'],
      minTemperature: 16,
      maxTemperature: 30,
    }));

    expect(params['thermostat']).toMatchObject({
      supportedModes: ['off', 'cool'],
      minTemperature: 16,
    });
  });

  it('says what is wrong with parts for their type', () => {
    const thermostat = aliasType('thermostat');
    const issues = aliasPartIssues(
      thermostat,
      aliasPartsSchema.parse({
        target_temperature: { from: 'stored', value: 50, min: 5, max: 35 },
        mode: { from: 'stored', value: 'boost' },
        target_temperature_low: { from: 'stored', value: 18 },
        humidity: { from: 'entities', entities: ['sensor.a', 'sensor.b'], rule: 'any' },
        wings: { from: 'stored', value: 1 },
      }),
    );

    expect(issues.map((issue) => issue.part)).toEqual([
      'wings',
      'target_temperature',
      'mode',
      'action',
      'target_temperature_high',
      'humidity',
    ]);
  });

  it('narrows a fixed list by what is offered', () => {
    const mode = aliasPartDef(aliasType('thermostat'), 'mode');

    expect(mode).toBeDefined();
    expect(
      aliasEnumValues(mode!, { from: 'stored', value: 'heat', offered: ['heat', 'off'] }),
    ).toEqual(['off', 'heat']);
  });
});
