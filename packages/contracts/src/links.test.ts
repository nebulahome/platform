import { describe, expect, it } from 'vitest';

import { normalizeMac } from './links.js';

describe('normalizeMac', () => {
  it('writes every way a device says its MAC the same way', () => {
    expect(normalizeMac('08F9E0124C7A')).toBe('08:f9:e0:12:4c:7a');
    expect(normalizeMac('08:f9:e0:12:4c:7a')).toBe('08:f9:e0:12:4c:7a');
    expect(normalizeMac('08-F9-E0-12-4C-7A')).toBe('08:f9:e0:12:4c:7a');
  });

  it('refuses what is not a six-byte address', () => {
    expect(normalizeMac('0a:1b:2c:3d:4e:5f:60:71')).toBeNull();
    expect(normalizeMac('shellyplug-08f9e0124c7a')).toBeNull();
    expect(normalizeMac('')).toBeNull();
    expect(normalizeMac(null)).toBeNull();
  });
});
