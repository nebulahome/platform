import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  ALIAS_SOURCES_BY_KIND,
  ALIAS_TYPES,
  aliasCapabilities,
  aliasType,
  customAliasParts,
  snakeCase,
} from './alias-types.js';
import { CAPABILITIES, CAPABILITY_DEFINITIONS } from './capabilities.js';
import { DOMAIN_CAPABILITIES, ENTITY_DOMAINS } from './entity-id.js';

/** State fields an alias works out itself rather than taking from a part. */
const WORKED_OUT = new Set(['color_hs.isActive', 'color_temp.isActive']);

/** Capabilities whose whole state is one part (a picture) or none (a press). */
const WHOLE_STATE = new Set(['image', 'button', 'custom']);

describe('alias types', () => {
  it('has a type for every domain but the alias domain itself', () => {
    const domains = new Set(ALIAS_TYPES.map((type) => type.domain));

    for (const domain of ENTITY_DOMAINS) {
      if (domain !== 'alias') {
        expect(domains, domain).toContain(domain);
      }
    }
  });

  it('carries every capability somewhere', () => {
    const carried = new Set(
      ALIAS_TYPES.flatMap((type) => [...type.capabilities, ...type.optionalCapabilities]),
    );

    for (const capability of CAPABILITIES) {
      expect(carried, capability).toContain(capability);
    }
  });

  it('carries what each domain carries: its required capability and every optional one', () => {
    for (const type of ALIAS_TYPES) {
      const domain = DOMAIN_CAPABILITIES[type.domain];
      const all = [...type.capabilities, ...type.optionalCapabilities];

      expect(domain.oneOf.some((capability) => type.capabilities.includes(capability))).toBe(true);

      for (const capability of domain.may) {
        expect(all, `${type.id} may ${capability}`).toContain(capability);
      }
    }
  });

  it('has a part for every state field of every capability it carries', () => {
    for (const type of ALIAS_TYPES) {
      for (const capability of [...type.capabilities, ...type.optionalCapabilities]) {
        if (WHOLE_STATE.has(capability)) {
          continue;
        }

        const schema = CAPABILITY_DEFINITIONS[capability].state as z.ZodObject;
        const covered = new Set(
          type.parts
            .filter((part) => part.capability === capability)
            .flatMap((part) => part.fields),
        );

        for (const field of Object.keys(schema.shape)) {
          if (!WORKED_OUT.has(`${capability}.${field}`)) {
            expect(covered, `${type.id}: ${capability}.${field}`).toContain(field);
          }
        }
      }
    }
  });

  it('keys each part by its field in snake case, once per type', () => {
    for (const type of ALIAS_TYPES) {
      const keys = type.parts.map((part) => part.key);

      expect(new Set(keys).size, type.id).toBe(keys.length);
    }

    expect(snakeCase('targetTemperatureHigh')).toBe('target_temperature_high');
  });

  it('lists the required parts first and lets a picture come only from an entity', () => {
    for (const type of ALIAS_TYPES) {
      const firstOptional = type.parts.findIndex((part) => !part.isRequired);

      if (firstOptional >= 0) {
        expect(
          type.parts.slice(firstOptional).every((part) => !part.isRequired),
          type.id,
        ).toBe(true);
      }
    }

    expect(ALIAS_SOURCES_BY_KIND.picture).toEqual(['entity']);
  });

  it('declares an optional capability only when one of its parts is there', () => {
    const light = aliasType('light');

    expect(aliasCapabilities(light, ['on'])).toEqual(['on_off']);
    expect(aliasCapabilities(light, ['on', 'brightness', 'color'])).toEqual([
      'on_off',
      'level',
      'color_hs',
    ]);
    expect(aliasCapabilities(aliasType('media_player'), ['playback', 'on'])).toEqual([
      'media_player',
      'on_off',
    ]);
  });

  it('makes a custom type from a package entity type', () => {
    const parts = customAliasParts([
      {
        key: 'phase',
        type: 'choice',
        label: 'Phase',
        isOptional: false,
        choices: [{ value: 'wash', label: 'Wash' }],
      },
      { key: 'minutesLeft', type: 'number', label: 'Minutes left', isOptional: true },
    ]);

    expect(parts.map((part) => [part.key, part.kind, part.isRequired])).toEqual([
      ['phase', 'enum', true],
      ['minutes_left', 'number', false],
    ]);
  });
});
