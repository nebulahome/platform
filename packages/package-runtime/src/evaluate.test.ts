import { describe, expect, it } from 'vitest';

import { resolvePath } from './evaluate.js';

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
