import { describe, expect, it } from 'vitest';

import { nextVersion } from './release-version.js';

const NOVEMBER = new Date('2026-11-14T10:00:00Z');

describe('nextVersion', () => {
  it('starts the month at 0', () => {
    expect(nextVersion([], 'stable', NOVEMBER)).toBe('2026.11.0');
    expect(nextVersion(['package-sdk@1.2.0'], 'beta', NOVEMBER)).toBe('2026.11.0-beta.1');
  });

  it('counts on within the month', () => {
    expect(nextVersion(['v2026.11.0'], 'stable', NOVEMBER)).toBe('2026.11.1');
    expect(nextVersion(['v2026.11.0'], 'beta', NOVEMBER)).toBe('2026.11.1-beta.1');
  });

  it('goes on counting an open beta, and promotes it', () => {
    const tags = ['v2026.10.3', 'v2026.11.0-beta.1', 'v2026.11.0-beta.2'];

    expect(nextVersion(tags, 'beta', NOVEMBER)).toBe('2026.11.0-beta.3');
    expect(nextVersion(tags, 'stable', NOVEMBER)).toBe('2026.11.0');
  });

  it('keeps an open beta of an earlier month', () => {
    expect(nextVersion(['v2026.10.2-beta.4'], 'stable', NOVEMBER)).toBe('2026.10.2');
  });

  it('starts a new version once a beta was released', () => {
    const tags = ['v2026.11.0-beta.2', 'v2026.11.0'];

    expect(nextVersion(tags, 'beta', NOVEMBER)).toBe('2026.11.1-beta.1');
  });

  it('starts again in a new month', () => {
    expect(nextVersion(['v2026.10.5'], 'stable', NOVEMBER)).toBe('2026.11.0');
  });

  it('refuses to go backwards', () => {
    expect(() => nextVersion(['v2026.12.0'], 'stable', NOVEMBER)).toThrow(/not be newer/);
  });
});
