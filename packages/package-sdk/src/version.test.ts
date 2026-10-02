import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SDK_VERSION } from './version.js';

describe('the SDK version', () => {
  it('is the version its package.json publishes', () => {
    const manifest: unknown = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );

    expect(manifest).toMatchObject({ version: SDK_VERSION });
  });
});
