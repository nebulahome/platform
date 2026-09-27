import { describe, expect, it } from 'vitest';

import {
  isPinnedTag,
  newestOfShape,
  newestSatisfying,
  satisfiesMinimum,
  shortDigest,
  versionOf,
} from './versions.js';

const TAGS = [
  'latest',
  '2',
  '2.14',
  '2.14.1',
  '2.14.0',
  '2.9.2',
  '1.42.0',
  '3.0.0-rc1',
  'latest-dev',
];

describe('isPinnedTag', () => {
  it('tells a tag that pins a release from one that follows them', () => {
    expect(isPinnedTag('2.14.1')).toBe(true);
    expect(isPinnedTag('v1.27.3')).toBe(true);
    expect(isPinnedTag('16.4.0-alpine')).toBe(true);
    expect(isPinnedTag('latest')).toBe(false);
    expect(isPinnedTag('2.14')).toBe(false);
  });
});

describe('newestOfShape', () => {
  it('offers the highest release of the same shape, compared as numbers', () => {
    expect(newestOfShape('2.9.2', TAGS)).toBe('2.14.1');
  });

  it('never offers another suffix', () => {
    expect(newestOfShape('16.3.0-alpine', ['16.4.0', '16.3.1-alpine', '17.0.0-bookworm'])).toBe(
      '16.3.1-alpine',
    );
  });

  it('says nothing for a tag that follows releases', () => {
    expect(newestOfShape('latest', TAGS)).toBe(null);
  });
});

describe('newestSatisfying', () => {
  it('installs the newest plain release of the minimum major, never a candidate', () => {
    expect(newestSatisfying('2.1.0', TAGS)).toBe('2.14.1');
    expect(newestSatisfying('1.0.0', TAGS)).toBe('1.42.0');
  });

  it('finds none when the registry has nothing new enough', () => {
    expect(newestSatisfying('2.20.0', TAGS)).toBe(null);
  });
});

describe('satisfiesMinimum', () => {
  it('compares a version or a v-prefixed tag with the minimum', () => {
    expect(satisfiesMinimum('2.14.1', '2.1.0')).toBe(true);
    expect(satisfiesMinimum('v2.0.9', '2.1.0')).toBe(false);
    expect(satisfiesMinimum(null, '2.1.0')).toBe(false);
    expect(satisfiesMinimum('latest', '2.1.0')).toBe(false);
  });
});

describe('versionOf', () => {
  it("prefers the image's own label, then a pinning tag", () => {
    expect(versionOf({ 'org.opencontainers.image.version': '2.14.1' }, 'latest')).toBe('2.14.1');
    expect(versionOf({}, '1.27.3')).toBe('1.27.3');
    expect(versionOf({}, 'latest')).toBe(null);
  });
});

describe('shortDigest', () => {
  it('keeps twelve characters after the algorithm', () => {
    expect(shortDigest('sha256:0123456789abcdef0123')).toBe('0123456789ab');
  });
});
