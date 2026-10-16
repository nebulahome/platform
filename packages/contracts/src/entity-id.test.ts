import { describe, expect, it } from 'vitest';

import { formatEntityId, isEntityId, parseEntityId, splitEntityId } from './entity-id.js';

describe('entity identifiers', () => {
  it('accepts a well-formed identifier', () => {
    expect(isEntityId('light.kitchen_ceiling')).toBe(true);
    expect(isEntityId('binary_sensor.front_door')).toBe(true);
  });

  it('accepts an object id that starts with a digit, as a package prefix may', () => {
    // A package id may start with a digit (`3d-home`), and its entities' object ids start
    // with that prefix; the domain still starts with a letter.
    expect(isEntityId('sensor.3d_home_kitchen_temperature')).toBe(true);
  });

  it.each([
    ['no dot', 'light'],
    ['empty object id', 'light.'],
    ['empty domain', '.kitchen'],
    ['upper case', 'Light.kitchen'],
    ['a hyphen', 'light.kitchen-ceiling'],
    ['a domain with a leading digit', '1light.kitchen'],
    ['an object id with a leading underscore', 'light._kitchen'],
    ['two dots', 'light.kitchen.ceiling'],
    ['a space', 'light.kitchen ceiling'],
  ])('rejects %s', (description, candidate) => {
    expect(isEntityId(candidate)).toBe(false);
  });

  it('rejects an object id longer than the column allows', () => {
    expect(isEntityId(`light.${'a'.repeat(64)}`)).toBe(true);
    expect(isEntityId(`light.${'a'.repeat(65)}`)).toBe(false);
  });

  it('throws rather than returning an invalid identifier', () => {
    expect(() => parseEntityId('Light.Kitchen')).toThrow();
  });

  it('builds an identifier from its parts', () => {
    expect(formatEntityId('sensor', 'hallway_illuminance')).toBe('sensor.hallway_illuminance');
  });

  it('refuses to build one from an unusable object id', () => {
    expect(() => formatEntityId('sensor', 'Hallway Illuminance')).toThrow();
  });

  it('splits an identifier back into its parts', () => {
    expect(splitEntityId(parseEntityId('media_player.living_room'))).toEqual({
      domain: 'media_player',
      objectId: 'living_room',
    });
  });
});
