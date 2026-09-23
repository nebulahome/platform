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

describe('discovery settings', () => {
  it('listens by default, asking every ten minutes and forgetting after half an hour', () => {
    const config = hubEnvSchema.parse(REQUIRED);

    expect([
      config.HUB_DISCOVERY_ENABLED,
      config.HUB_DISCOVERY_QUERY_INTERVAL_MS,
      config.HUB_DISCOVERY_TTL_MS,
    ]).toEqual([true, 600_000, 1_800_000]);
  });

  it('can be switched off, for a hub whose network carries no multicast', () => {
    expect(
      hubEnvSchema.parse({ ...REQUIRED, HUB_DISCOVERY_ENABLED: 'false' }).HUB_DISCOVERY_ENABLED,
    ).toBe(false);
  });

  it('refuses to ask more often than once a minute', () => {
    expect(
      hubEnvSchema.safeParse({ ...REQUIRED, HUB_DISCOVERY_QUERY_INTERVAL_MS: '1000' }).success,
    ).toBe(false);
  });
});
