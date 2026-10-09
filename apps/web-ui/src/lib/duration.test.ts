import { describe, expect, it } from 'vitest';

import { formatDuration, parseDuration } from './duration';

describe('formatDuration', () => {
  it('writes the largest units, two at most', () => {
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(500)).toBe('500 ms');
    expect(formatDuration(45_000)).toBe('45 s');
    expect(formatDuration(120_000)).toBe('2 min');
    expect(formatDuration(5_400_000)).toBe('1 h 30 min');
    expect(formatDuration(3_600_000 + 5_000)).toBe('1 h');
    expect(formatDuration(2 * 86_400_000)).toBe('2 d');
  });
});

describe('parseDuration', () => {
  it('reads a bare number as seconds', () => {
    expect(parseDuration('90')).toBe(90_000);
    expect(parseDuration('1.5')).toBe(1_500);
  });

  it('reads units, together and apart', () => {
    expect(parseDuration('2 min')).toBe(120_000);
    expect(parseDuration('1h 30m')).toBe(5_400_000);
    expect(parseDuration('10 minutes')).toBe(600_000);
    expect(parseDuration('250 ms')).toBe(250);
  });

  it('reads a clock-like duration as minutes and seconds', () => {
    expect(parseDuration('1:30')).toBe(90_000);
    expect(parseDuration('1:00:00')).toBe(3_600_000);
  });

  it('reads back what it writes', () => {
    for (const ms of [0, 45_000, 120_000, 5_400_000]) {
      expect(parseDuration(formatDuration(ms))).toBe(ms);
    }
  });

  it('refuses what is not a duration', () => {
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('soon')).toBeNull();
    expect(parseDuration('2 fortnights')).toBeNull();
    expect(parseDuration('2 min and a bit')).toBeNull();
  });
});
