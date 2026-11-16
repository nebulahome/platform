import { describe, expect, it } from 'vitest';

import { oldestKeptAt } from './history-import.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-11-16T12:00:00.000Z');

describe('how far back a past reading is kept', () => {
  it('is 28 days while the raw readings are kept longer', () => {
    expect(oldestKeptAt(now, 30 * DAY_MS)).toBe(now - 28 * DAY_MS);
    expect(oldestKeptAt(now, undefined)).toBe(now - 28 * DAY_MS);
  });

  it('is a day less than the raw readings are kept when that is shorter', () => {
    expect(oldestKeptAt(now, 14 * DAY_MS)).toBe(now - 13 * DAY_MS);
  });

  it('is nothing when the raw readings are kept a day or less', () => {
    expect(oldestKeptAt(now, DAY_MS)).toBe(now);
    expect(oldestKeptAt(now, 6 * 60 * 60 * 1000)).toBe(now);
  });
});
