import { describe, expect, it } from 'vitest';

import { semverRangeSchema, semverSchema } from './semver.js';

describe('a version range', () => {
  it.each([
    '^1.2.0',
    '~1.4',
    '>=1.0.0 <2.0.0',
    '1.x || 2.x',
    '*',
    '1.2.3 - 2.0.0',
    '^1.0.0-beta.1',
    '>= 1.5.0',
  ])('takes %s', (range) => {
    expect(semverRangeSchema.safeParse(range).success).toBe(true);
  });

  it.each(['latest', 'latest please', '^^1.0.0', '1.2.3.4', '>=1.0.0 ||', ''])(
    'refuses %j',
    (range) => {
      expect(semverRangeSchema.safeParse(range).success).toBe(false);
    },
  );
});

describe('a version', () => {
  it('takes a release and a prerelease, not a range', () => {
    expect(semverSchema.safeParse('1.10.0-rc.1+build.5').success).toBe(true);
    expect(semverSchema.safeParse('^1.0.0').success).toBe(false);
  });
});
