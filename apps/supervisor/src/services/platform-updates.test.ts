/**
 * Which versions the Update button may ask for: every channel's, nothing else.
 */
import { describe, expect, it } from 'vitest';

import { RELEASE_VERSION } from './platform-updates.js';

describe('a release version', () => {
  it('is a stable release, a beta or a dev build', () => {
    for (const version of ['2026.10.0', '2026.10.1-beta.2', '2026.10.0-alpha.2']) {
      expect(RELEASE_VERSION.test(version), version).toBe(true);
    }
  });

  it('is nothing else', () => {
    for (const version of ['v2026.10.0', '2026.10.0-rc.1', '1.2', 'latest', '2026.10.0-alpha']) {
      expect(RELEASE_VERSION.test(version), version).toBe(false);
    }
  });
});
