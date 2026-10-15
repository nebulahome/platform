/**
 * Crossing between a setting's value and the string a `<select>` deals in.
 *
 * The case that matters is `null`. It means "keep forever", it is a perfectly good value, and
 * every naive encoding loses it: `String(null)` and an empty option value are both
 * indistinguishable from "nothing chosen", which is how a dropdown ends up quietly deleting the
 * one setting nobody wanted changed.
 */
import { describe, expect, it } from 'vitest';

import { RETENTION_MINIMUM_DAYS } from '@nebulahome/contracts';

import {
  logLevelChoices,
  asWord,
  decodeNumberChoice,
  durationLabel,
  encodeChoice,
  retentionChoices,
} from '@/settings/setting-choices';

describe('encodeChoice and decodeNumberChoice', () => {
  it.each([30, 1825, 0])('round-trips the number %d', (days) => {
    expect(decodeNumberChoice(encodeChoice(days))).toBe(days);
  });

  it('round-trips forever', () => {
    expect(decodeNumberChoice(encodeChoice(null))).toBeNull();
  });

  it('encodes a word as itself', () => {
    expect(encodeChoice('celsius')).toBe('celsius');
  });

  it('gives a value it cannot represent no option value at all', () => {
    // Nothing in the catalogue holds an object. If one ever does, an option with an empty value
    // is visibly wrong, where `[object Object]` looks like a label somebody chose.
    expect(encodeChoice({ nested: true })).toBe('');
  });
});

describe('asWord', () => {
  it('reads a word', () => {
    expect(asWord('fahrenheit', 'celsius')).toBe('fahrenheit');
  });

  it.each([[null], [42], [undefined]])('falls back for %j', (value) => {
    expect(asWord(value ?? null, 'celsius')).toBe('celsius');
  });
});

describe('retentionChoices', () => {
  it('offers nothing below the floor the level needs', () => {
    const offered = retentionChoices(RETENTION_MINIMUM_DAYS.tier1h).map((choice) => choice.value);

    // `telemetry_1d` refreshes by looking seven days back into the hour buckets, so anything
    // under thirty days is refused by the schema and must not be offered.
    expect(offered).not.toContain('1');
    expect(offered).not.toContain('7');
    expect(offered).toContain('30');
  });

  it('puts forever last, because it is the longest and not the shortest', () => {
    const offered = retentionChoices(1);

    expect(offered.at(-1)?.value).toBe('null');
    expect(offered.at(-1)?.label).toBe('Forever');
  });

  it('can be told not to offer forever at all', () => {
    expect(retentionChoices(1, false).map((choice) => choice.value)).not.toContain('null');
  });
});

describe('durationLabel', () => {
  it.each([
    [1, '1 day'],
    [30, '30 days'],
    [365, '1 year'],
    [1825, '5 years'],
  ])('calls %d days %j', (days, expected) => {
    expect(durationLabel(days)).toBe(expected);
  });
});

describe('logLevelChoices', () => {
  it('offers pino numbers as values and names as labels', () => {
    // The column holds the number; nobody should have to know that to change the setting.
    expect(logLevelChoices()).toContainEqual({ value: '30', label: 'info and above' });
  });

  it('offers all six levels', () => {
    expect(logLevelChoices()).toHaveLength(6);
  });
});
