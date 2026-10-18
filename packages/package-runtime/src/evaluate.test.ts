import { describe, expect, it } from 'vitest';

import { conditionHolds, resolvePath, resolvePresence } from './evaluate.js';

describe('resolvePath', () => {
  it('walks a path of names', () => {
    expect(resolvePath({ relay: { on: true } }, 'relay.on')).toBe(true);
  });

  it('reads a key that is not an identifier', () => {
    // Shelly reports channels under `switch:0`. A path language that could not name that key
    // would exclude the most common device the declarative tier exists for.
    expect(resolvePath({ 'switch:0': { output: true } }, "'switch:0'.output")).toBe(true);
  });

  it('indexes into an array', () => {
    expect(resolvePath({ channels: [{ on: false }, { on: true }] }, 'channels[1].on')).toBe(true);
  });

  it('returns nothing rather than throwing when the path is not there', () => {
    // A device that stopped reporting a field must leave the entity as it was, not take the
    // integration down. Absence is a normal answer here, not an error.
    expect(resolvePath({ relay: {} }, 'relay.on')).toBeUndefined();
  });

  it('returns nothing when the path runs through something that is not an object', () => {
    expect(resolvePath({ relay: 5 }, 'relay.on')).toBeUndefined();
  });

  it('returns nothing for an index past the end', () => {
    expect(resolvePath({ channels: [] }, 'channels[0]')).toBeUndefined();
  });

  it('returns nothing when the payload is not an object at all', () => {
    expect(resolvePath('a string', 'relay.on')).toBeUndefined();
  });

  it('reads a whole branch, not only a leaf', () => {
    expect(resolvePath({ relay: { on: true } }, 'relay')).toEqual({ on: true });
  });

  it('refuses a path the grammar does not admit', () => {
    // The grammar is the ceiling. Anything reaching the resolver has already been validated by
    // the schema, so this is the second line rather than the first - but a resolver that
    // quietly returned undefined for a malformed path would hide a profile bug as a silent
    // no-op, which is the failure mode the whole tier is trying to avoid.
    expect(() => resolvePath({}, '$exists(relay)')).toThrow(/path/i);
  });
});

describe('resolvePresence', () => {
  it('says a value is there', () => {
    const payload = { sys: { available_updates: { stable: { version: '1.4.4' } } } };

    expect(resolvePresence(payload, 'sys.available_updates.stable')).toBe(true);
  });

  it('says a value is gone when the object that would hold it is there without it', () => {
    // Shelly empties available_updates once the update is installed: the absence is the news.
    expect(
      resolvePresence({ sys: { available_updates: {} } }, 'sys.available_updates.stable'),
    ).toBe(false);
  });

  it('counts null as not there', () => {
    expect(resolvePresence({ sys: { update: null } }, 'sys.update')).toBe(false);
  });

  it('says nothing when the report does not carry the holder at all', () => {
    // A partial report about a relay says nothing about firmware, and must not switch it off.
    expect(resolvePresence({ 'switch:0': { output: true } }, 'sys.available_updates.stable')).toBe(
      undefined,
    );
  });
});

describe('conditionHolds', () => {
  it('takes a text that starts with the prefix, whatever its case', () => {
    const condition = { path: 'instance', startsWith: 'shelly' };

    expect(conditionHolds(condition, { instance: 'shellyplus1-a8032ab1' })).toBe(true);
    expect(conditionHolds(condition, { instance: 'ShellyDimmerG3-7C2C67' })).toBe(true);
  });

  it('refuses another prefix, and anything that is not text', () => {
    const condition = { path: 'instance', startsWith: 'shelly' };

    expect(conditionHolds(condition, { instance: 'Brother HL-L2350DW' })).toBe(false);
    expect(conditionHolds(condition, { instance: 42 })).toBe(false);
    expect(conditionHolds(condition, {})).toBe(false);
  });

  it('takes a text that ends with the suffix, whatever its case', () => {
    const condition = { path: 'model', endsWith: '-eu' };

    expect(conditionHolds(condition, { model: 'S3SW-001P16EU' })).toBe(false);
    expect(conditionHolds(condition, { model: 'Plug-S-EU' })).toBe(true);
    expect(conditionHolds(condition, { model: 3 })).toBe(false);
  });

  it('takes a text holding a part, or a list holding an item', () => {
    expect(
      conditionHolds({ path: 'productName', contains: 'plug' }, { productName: 'Shelly Plug S' }),
    ).toBe(true);
    expect(conditionHolds({ path: 'deviceTypes', contains: 266 }, { deviceTypes: [22, 266] })).toBe(
      true,
    );
    expect(conditionHolds({ path: 'deviceTypes', contains: 256 }, { deviceTypes: [22, 266] })).toBe(
      false,
    );
    expect(conditionHolds({ path: 'clusters', contains: 'x' }, { clusters: 'nothing' })).toBe(
      false,
    );
  });

  it('takes a number within its range, both ends included', () => {
    const condition = { path: 'softwareVersion', min: 10, max: 20 };

    expect(conditionHolds(condition, { softwareVersion: 10 })).toBe(true);
    expect(conditionHolds(condition, { softwareVersion: 20 })).toBe(true);
    expect(conditionHolds(condition, { softwareVersion: 21 })).toBe(false);
    expect(conditionHolds({ path: 'softwareVersion', min: 10 }, { softwareVersion: 99 })).toBe(
      true,
    );
    expect(conditionHolds(condition, { softwareVersion: '15' })).toBe(false);
  });
});
