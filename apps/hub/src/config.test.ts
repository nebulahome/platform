import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { developmentBundleDirectory, hubEnvSchema } from './config.js';

/** What every hub needs, whatever else a test varies. */
const REQUIRED = {
  DATABASE_URL: 'postgres://nebula:nebula@localhost:5432/nebula',
  NATS_URL: 'nats://localhost:4222',
  NEBULA_SECRETS_KEY: 'ab'.repeat(32),
};

describe('developmentBundleDirectory', () => {
  it("reads the repository's bundles outside production, found from the package", () => {
    const directory = developmentBundleDirectory(hubEnvSchema.parse(REQUIRED));

    expect(directory?.endsWith(path.join('apps', 'hub', 'bundles'))).toBe(true);
  });

  it('reads none in production, where the product ships with no integration', () => {
    const config = hubEnvSchema.parse({
      ...REQUIRED,
      NODE_ENV: 'production',
      NEBULA_DATA_DIR: path.resolve('/srv/nebula'),
    });

    expect(developmentBundleDirectory(config)).toBeUndefined();
  });

  it('reads the one it was given, in production too', () => {
    const given = path.resolve('/opt/bundles');
    const config = hubEnvSchema.parse({
      ...REQUIRED,
      NODE_ENV: 'production',
      NEBULA_DATA_DIR: path.resolve('/srv/nebula'),
      HUB_DEV_BUNDLE_DIR: given,
    });

    expect(developmentBundleDirectory(config)).toBe(given);
  });

  it('refuses a relative one, which would depend on where the process was started', () => {
    expect(hubEnvSchema.safeParse({ ...REQUIRED, HUB_DEV_BUNDLE_DIR: './bundles' }).success).toBe(
      false,
    );
  });
});
