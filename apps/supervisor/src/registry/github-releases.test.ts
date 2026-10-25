import { describe, expect, it } from 'vitest';

import { newestReleases } from './github-releases.js';

/**
 * A release as GitHub answers.
 *
 * @param tag - Its tag.
 * @param extra - What else differs.
 * @returns It.
 */
function release(tag: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag_name: tag,
    html_url: `https://github.com/nebulahome/platform/releases/tag/${tag}`,
    body: `Notes of ${tag}`,
    draft: false,
    prerelease: tag.includes('-'),
    published_at: '2026-11-01T10:00:00Z',
    ...extra,
  };
}

describe('newestReleases', () => {
  it('picks the newest stable and the newest of all', () => {
    const found = newestReleases([
      release('v2026.11.1-beta.1'),
      release('v2026.11.0'),
      release('v2026.10.4'),
      release('package-sdk@1.3.0'),
    ]);

    expect(found.stable?.version).toBe('2026.11.0');
    expect(found.beta?.version).toBe('2026.11.1-beta.1');
    expect(found.beta?.notes).toBe('Notes of v2026.11.1-beta.1');
  });

  it('never offers a draft, and gives the stable to the beta channel when it is newest', () => {
    const found = newestReleases([
      release('v2026.12.0', { draft: true }),
      release('v2026.11.0'),
      release('v2026.11.0-beta.3'),
    ]);

    expect(found.stable?.version).toBe('2026.11.0');
    expect(found.beta?.version).toBe('2026.11.0');
  });

  it('gives dev builds to the dev channel only', () => {
    const found = newestReleases([
      release('v2026.11.1-alpha.2'),
      release('v2026.11.0-beta.1'),
      release('v2026.10.4'),
    ]);

    expect(found.stable?.version).toBe('2026.10.4');
    expect(found.beta?.version).toBe('2026.11.0-beta.1');
    expect(found.dev?.version).toBe('2026.11.1-alpha.2');
  });

  it('has nothing when there is no release', () => {
    expect(newestReleases([])).toEqual({ stable: null, beta: null, dev: null });
  });
});
