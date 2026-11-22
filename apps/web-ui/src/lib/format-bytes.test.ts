import { describe, expect, it } from 'vitest';

import { formatBytes, formatPercent, formatRate, formatShare } from './format-bytes';

describe('formatBytes', () => {
  it('scales by thousands, as a disk is sold', () => {
    expect([formatBytes(512), formatBytes(1_900_000_000), formatBytes(240_300_000_000)]).toEqual([
      '512 B',
      '1.9 GB',
      '240 GB',
    ]);
  });

  it('reads nothing as nothing rather than as a negative number', () => {
    expect(formatBytes(-5)).toBe('0 B');
  });
});

describe('formatRate', () => {
  it('writes a rate in the unit the entities carry', () => {
    expect(formatRate(1_234_000)).toBe('1.2 MB/s');
  });

  it('writes a dash where there is no rate, rather than a zero', () => {
    // "No traffic" and "cannot tell" are different things to read off a page.
    expect(formatRate(null)).toBe('—');
  });
});

describe('formatPercent', () => {
  it('rounds to a whole percentage, and dashes a missing one', () => {
    expect([formatPercent(23.6), formatPercent(null)]).toEqual(['24%', '—']);
  });
});

describe('formatShare', () => {
  it('calls a slice too thin to round to one percent less than one, not nothing', () => {
    expect([formatShare(0.64), formatShare(0.004), formatShare(0)]).toEqual(['64%', '<1%', '0%']);
  });
});
