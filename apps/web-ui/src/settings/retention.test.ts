/**
 * The retention ladder, as the page checks it before offering to save.
 *
 * This is the same rule the API enforces, asked in the browser so the person finds out while
 * looking at the four dropdowns that caused it. The cases below are the ones a reader of the
 * four values would not spot: every rung individually valid, and the set of them wrong.
 */
import { describe, expect, it } from 'vitest';

import { SETTINGS, type JsonValue } from '@nebula-home/contracts';

import { RETENTION_RUNGS, ladderProblem } from '@/settings/retention';

/** Every setting at its seeded default, which is the ladder most edits start from. */
const DEFAULTS: ReadonlyMap<string, JsonValue> = new Map(
  SETTINGS.map((definition) => [definition.key, definition.defaultValue]),
);

/**
 * Builds a ladder from the defaults with some rungs replaced.
 *
 * @param changes - The rungs to change, by key.
 * @returns The whole set of values.
 */
function ladderWith(changes: Readonly<Record<string, number | null>>): Map<string, JsonValue> {
  return new Map([...DEFAULTS, ...Object.entries(changes)]);
}

describe('ladderProblem', () => {
  it('accepts the ladder the migration seeds', () => {
    expect(ladderProblem(DEFAULTS)).toBeNull();
  });

  it('refuses a level kept for less time than the one below it', () => {
    // 400 days of raw readings rolled up into 365 days of minute buckets: the raw rows outlive
    // the thing built from them, and every level above ends up with a hole.
    expect(
      ladderProblem(ladderWith({ 'history.telemetry.raw_retention_days': 400 })),
    ).not.toBeNull();
  });

  it('accepts the same change once the level above is raised with it', () => {
    expect(
      ladderProblem(
        ladderWith({
          'history.telemetry.raw_retention_days': 400,
          'history.telemetry.tier_1m_retention_days': 500,
        }),
      ),
    ).toBeNull();
  });

  it('refuses a level below the floor its own aggregate needs', () => {
    // `telemetry_1h` refreshes by looking a day back into the minute buckets, so a minute level
    // kept for a single day is already too short.
    expect(
      ladderProblem(ladderWith({ 'history.telemetry.tier_1m_retention_days': 1 })),
    ).not.toBeNull();
  });

  it('treats forever as the longest retention rather than the shortest', () => {
    // The default keeps daily buckets indefinitely. Comparing `null` as a number would sort it
    // first and reject the configuration every installation ships with.
    expect(
      ladderProblem(ladderWith({ 'history.telemetry.tier_1d_retention_days': null })),
    ).toBeNull();
  });

  it('refuses a finer level kept forever under a coarser one that is not', () => {
    expect(
      ladderProblem(ladderWith({ 'history.telemetry.raw_retention_days': null })),
    ).not.toBeNull();
  });
});

describe('RETENTION_RUNGS', () => {
  it('names four levels the catalogue actually has', () => {
    const known = new Set<string>(SETTINGS.map((definition) => definition.key));

    expect(RETENTION_RUNGS).toHaveLength(4);

    for (const rung of RETENTION_RUNGS) {
      expect(known.has(rung.key), rung.key).toBe(true);
    }
  });

  it('reads finest first, which is the order they constrain each other in', () => {
    expect(RETENTION_RUNGS.map((rung) => rung.label)).toEqual([
      'raw',
      '1 minute',
      '1 hour',
      '1 day',
    ]);
  });
});
