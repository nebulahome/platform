import { describe, expect, it } from 'vitest';

import {
  PINO_LEVEL_BY_NAME,
  RETENTION_MINIMUM_DAYS,
  SETTING_KEY_PATTERN,
  SETTINGS,
  retentionLadderSchema,
} from './settings.js';

const defaultLadder = {
  rawRetentionDays: 30,
  tier1mRetentionDays: 365,
  tier1hRetentionDays: 1825,
  tier1dRetentionDays: null,
};

describe('the settings catalogue', () => {
  it('gives every setting a key the database will accept', () => {
    for (const setting of SETTINGS) {
      expect(setting.key).toMatch(SETTING_KEY_PATTERN);
    }
  });

  it('has no duplicate keys', () => {
    const keys = SETTINGS.map((setting) => setting.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('seeds a default that its own schema accepts', () => {
    for (const setting of SETTINGS) {
      expect(setting.schema.safeParse(setting.defaultValue).success).toBe(true);
    }
  });
});

describe('the retention ladder', () => {
  it('accepts the shipped defaults', () => {
    expect(retentionLadderSchema.safeParse(defaultLadder).success).toBe(true);
  });

  it('treats null as forever and therefore as the largest value', () => {
    const keptForever = { ...defaultLadder, tier1hRetentionDays: null };

    expect(retentionLadderSchema.safeParse(keptForever).success).toBe(true);
  });

  it('rejects a ladder that keeps coarse data for less time than fine data', () => {
    const inverted = { ...defaultLadder, tier1mRetentionDays: 7, rawRetentionDays: 30 };

    expect(retentionLadderSchema.safeParse(inverted).success).toBe(false);
  });

  it('rejects a raw retention below the window the one-minute aggregate reads back', () => {
    const tooShort = { ...defaultLadder, rawRetentionDays: RETENTION_MINIMUM_DAYS.raw - 1 };

    expect(retentionLadderSchema.safeParse(tooShort).success).toBe(false);
  });

  it('rejects a one-minute retention below the window the hourly aggregate reads back', () => {
    const tooShort = { ...defaultLadder, tier1mRetentionDays: RETENTION_MINIMUM_DAYS.tier1m - 1 };

    expect(retentionLadderSchema.safeParse(tooShort).success).toBe(false);
  });

  it('rejects an hourly retention below the window the daily aggregate reads back', () => {
    const tooShort = { ...defaultLadder, tier1hRetentionDays: RETENTION_MINIMUM_DAYS.tier1h - 1 };

    expect(retentionLadderSchema.safeParse(tooShort).success).toBe(false);
  });

  it('rejects a fractional number of days', () => {
    expect(
      retentionLadderSchema.safeParse({ ...defaultLadder, rawRetentionDays: 1.5 }).success,
    ).toBe(false);
  });
});

describe('pino levels', () => {
  it('maps every severity to the numeric level history.logs stores', () => {
    expect(PINO_LEVEL_BY_NAME.trace).toBe(10);
    expect(PINO_LEVEL_BY_NAME.fatal).toBe(60);
  });

  it('stays inside the range the logs_level_range constraint allows', () => {
    for (const level of Object.values(PINO_LEVEL_BY_NAME)) {
      expect(level).toBeGreaterThanOrEqual(10);
      expect(level).toBeLessThanOrEqual(60);
    }
  });
});
