import { describe, expect, it } from 'vitest';

import { isTrustedHubUrl, packetManagerEnvSchema } from './config.js';

/** What a production packet-manager is given, but the Hub. */
const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://nebula:nebula@localhost:5432/nebula',
  NATS_URL: 'nats://localhost:4222',
  NEBULA_SECRETS_KEY: 'a'.repeat(64),
  NEBULA_DATA_DIR: '/data',
};

describe('the Community Hub address', () => {
  it('may be plain HTTP only on this machine or its network', () => {
    for (const url of [
      'https://hub.example.com',
      'http://localhost:8088',
      'http://host.docker.internal:8088',
      'http://api:3000',
      'http://hub.local',
      'http://127.0.0.1:8088',
      'http://192.168.1.20',
      'http://[::1]:8088',
    ]) {
      expect(isTrustedHubUrl(url), url).toBe(true);
    }

    for (const url of ['http://hub.example.com', 'http://8.8.8.8', 'http://[2001:db8::1]']) {
      expect(isTrustedHubUrl(url), url).toBe(false);
    }
  });

  it('is refused over plain HTTP from afar in production, and taken outside it', () => {
    const afar = { COMMUNITY_HUB_URL: 'http://hub.example.com' };

    expect(packetManagerEnvSchema.safeParse({ ...production, ...afar }).success).toBe(false);
    expect(
      packetManagerEnvSchema.safeParse({
        ...production,
        COMMUNITY_HUB_URL: 'http://host.docker.internal:8088',
      }).success,
    ).toBe(true);
    expect(
      packetManagerEnvSchema.safeParse({ ...production, ...afar, NODE_ENV: 'development' }).success,
    ).toBe(true);
  });
});
