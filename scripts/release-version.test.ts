import { describe, expect, it } from 'vitest';

import { nextVersion } from './release-version.js';

const NOVEMBER = new Date('2026-11-14T10:00:00Z');

describe('nextVersion', () => {
  it('starts the month at 0, with the channel suffix', () => {
    expect(nextVersion([], 'stable', NOVEMBER)).toBe('2026.11.0');
    expect(nextVersion(['package-sdk@1.2.0'], 'beta', NOVEMBER)).toBe('2026.11.0-beta.1');
    expect(nextVersion([], 'dev', NOVEMBER)).toBe('2026.11.0-alpha.1');
  });

  it('counts on within the month', () => {
    expect(nextVersion(['v2026.11.0'], 'stable', NOVEMBER)).toBe('2026.11.1');
    expect(nextVersion(['v2026.11.0'], 'beta', NOVEMBER)).toBe('2026.11.1-beta.1');
    expect(nextVersion(['v2026.11.0'], 'dev', NOVEMBER)).toBe('2026.11.1-alpha.1');
  });

  it('goes on counting an open beta, and promotes it', () => {
    const tags = ['v2026.10.3', 'v2026.11.0-beta.1', 'v2026.11.0-beta.2'];

    expect(nextVersion(tags, 'beta', NOVEMBER)).toBe('2026.11.0-beta.3');
    expect(nextVersion(tags, 'stable', NOVEMBER)).toBe('2026.11.0');
  });

  it('goes on counting an open alpha, and promotes it to beta or stable', () => {
    const tags = ['v2026.11.0-alpha.1', 'v2026.11.0-alpha.2'];

    expect(nextVersion(tags, 'dev', NOVEMBER)).toBe('2026.11.0-alpha.3');
    expect(nextVersion(tags, 'beta', NOVEMBER)).toBe('2026.11.0-beta.1');
    expect(nextVersion(tags, 'stable', NOVEMBER)).toBe('2026.11.0');
  });

  it('starts the next version for a dev build after a beta, which an alpha would sort below', () => {
    expect(nextVersion(['v2026.11.0-alpha.4', 'v2026.11.0-beta.1'], 'dev', NOVEMBER)).toBe(
      '2026.11.1-alpha.1',
    );
  });

  it('keeps an open version of an earlier month', () => {
    expect(nextVersion(['v2026.10.2-beta.4'], 'stable', NOVEMBER)).toBe('2026.10.2');
  });

  it('starts a new version once a prerelease was released', () => {
    expect(nextVersion(['v2026.11.0-beta.2', 'v2026.11.0'], 'beta', NOVEMBER)).toBe(
      '2026.11.1-beta.1',
    );
  });

  it('starts again in a new month', () => {
    expect(nextVersion(['v2026.10.5'], 'stable', NOVEMBER)).toBe('2026.11.0');
  });

  it('refuses to go backwards', () => {
    expect(() => nextVersion(['v2026.12.0'], 'stable', NOVEMBER)).toThrow(/not be newer/);
  });
});
