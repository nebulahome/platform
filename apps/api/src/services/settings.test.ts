/**
 * Validating a settings change.
 *
 * The retention cases are the reason this file exists. Every rung of the ladder is individually
 * valid at seven days, and a ladder that keeps raw readings for longer than the minute buckets
 * rolled up from them silently loses data at every level - TimescaleDB drops the source rows
 * before the aggregate above has read them and raises nothing. There is no error to catch later
 * and no way to reconstruct what was lost, so the check has to happen before the write.
 */
import { describe, expect, it } from 'vitest';

import { SETTINGS, ValidationError, type JsonValue } from '@nebula-home/contracts';

import { auditableChanges, validateSettingChanges } from './settings.js';

/** Every setting at its seeded default, which is the state most changes start from. */
const DEFAULTS: ReadonlyMap<string, unknown> = new Map(
  SETTINGS.map((definition) => [definition.key, definition.defaultValue]),
);

/**
 * Reads the keys a refusal names.
 *
 * @param call - What to run.
 * @returns The keys, in the order they were reported.
 * @throws {Error} When the call was accepted, which is a failing case rather than a passing one.
 */
function rejectedKeys(call: () => unknown): string[] {
  try {
    call();
  } catch (error: unknown) {
    if (!(error instanceof ValidationError)) {
      throw error;
    }

    const issues: unknown = error.details['issues'];

    if (!Array.isArray(issues)) {
      return ['<the refusal carried no issues>'];
    }

    return issues.map((issue: unknown) =>
      typeof issue === 'object' && issue !== null && 'key' in issue && typeof issue.key === 'string'
        ? issue.key
        : '<an issue carried no key>',
    );
  }

  throw new Error('The change was accepted');
}

describe('validateSettingChanges', () => {
  it('accepts a value its own schema allows', () => {
    const accepted = validateSettingChanges(DEFAULTS, { 'units.temperature': 'fahrenheit' });

    expect([...accepted]).toEqual([['units.temperature', 'fahrenheit']]);
  });

  it('refuses a key the platform does not have', () => {
    expect(
      rejectedKeys(() => validateSettingChanges(DEFAULTS, { 'units.pressure': 'bar' })),
    ).toEqual(['units.pressure']);
  });

  it('refuses a value of the wrong shape', () => {
    expect(
      rejectedKeys(() => validateSettingChanges(DEFAULTS, { 'units.temperature': 'kelvin' })),
    ).toEqual(['units.temperature']);
  });

  it('reports every problem at once', () => {
    // A form with four fields should not have to be submitted four times to learn about all of
    // them.
    expect(
      rejectedKeys(() =>
        validateSettingChanges(DEFAULTS, {
          'units.temperature': 'kelvin',
          'ui.default_theme': 'sepia',
        }),
      ),
    ).toEqual(['units.temperature', 'ui.default_theme']);
  });

  it('refuses a retention shorter than the aggregate built from it needs', () => {
    // `telemetry_1m` refreshes by looking three hours back into the raw table; a raw retention
    // measured in hours would drop the rows before it got there.
    expect(
      rejectedKeys(() =>
        validateSettingChanges(DEFAULTS, { 'history.telemetry.raw_retention_days': 0 }),
      ),
    ).toEqual(['history.telemetry.raw_retention_days']);
  });

  it('refuses a ladder that keeps the coarser tier for less time than the finer one', () => {
    // Every value here is fine on its own. The pair is not.
    expect(
      rejectedKeys(() =>
        validateSettingChanges(DEFAULTS, {
          'history.telemetry.raw_retention_days': 400,
        }),
      ),
    ).toEqual(['history.telemetry.raw_retention_days']);
  });

  it('names the key the caller sent rather than the field the ladder calls it', () => {
    const [key] = rejectedKeys(() =>
      validateSettingChanges(DEFAULTS, { 'history.telemetry.tier_1h_retention_days': 30 }),
    );

    expect(key).toBe('history.telemetry.tier_1h_retention_days');
  });

  it('accepts a ladder raised from the bottom up', () => {
    const accepted = validateSettingChanges(DEFAULTS, {
      'history.telemetry.raw_retention_days': 400,
      'history.telemetry.tier_1m_retention_days': 500,
    });

    expect([...accepted.keys()]).toEqual([
      'history.telemetry.raw_retention_days',
      'history.telemetry.tier_1m_retention_days',
    ]);
  });

  it('treats forever as the longest retention rather than the shortest', () => {
    // `null` means keep forever. Compared as a number it would sort first and reject the default
    // configuration, which keeps daily buckets indefinitely.
    expect(() =>
      validateSettingChanges(DEFAULTS, { 'history.telemetry.tier_1h_retention_days': 3650 }),
    ).not.toThrow();
  });

  it('does not check the ladder when nothing in it was touched', () => {
    const accepted = validateSettingChanges(new Map(), { 'ui.default_theme': 'dark' });

    expect([...accepted]).toEqual([['ui.default_theme', 'dark']]);
  });
});

describe('auditableChanges', () => {
  it('records what a setting was changed to', () => {
    const values = new Map<string, JsonValue>([['history.logs.retention_days', 7]]);

    expect(auditableChanges(values)).toEqual([{ key: 'history.logs.retention_days', value: 7 }]);
  });

  it('records that the location changed without recording where it is', () => {
    // An audit detail reaches the log stream as well as the table, and where somebody lives is
    // personal data (RULES.md 10.1).
    const values = new Map<string, JsonValue>([['location.latitude', 45.4642]]);

    expect(auditableChanges(values)).toEqual([{ key: 'location.latitude' }]);
  });
});
