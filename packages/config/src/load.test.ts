import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ConfigurationError } from '@nebula-home/contracts';

import { busEnvSchema, databaseEnvSchema, runtimeEnvSchema } from './env-schemas.js';
import { loadConfig, type ConfigurationIssue } from './load.js';

const serviceSchema = runtimeEnvSchema.extend(databaseEnvSchema.shape).extend(busEnvSchema.shape);

const validEnvironment = {
  DATABASE_URL: 'postgres://nebula:nebula@localhost:5432/nebula',
  NATS_URL: 'nats://localhost:4222',
};

describe('loadConfig', () => {
  it('applies declared defaults when optional variables are absent', () => {
    const config = loadConfig(serviceSchema, validEnvironment);

    expect(config.NODE_ENV).toBe('development');
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('reads variables from the supplied source rather than the process environment', () => {
    const config = loadConfig(serviceSchema, { ...validEnvironment, LOG_LEVEL: 'debug' });

    expect(config.LOG_LEVEL).toBe('debug');
  });

  it('coerces string variables to the type the schema declares', () => {
    const config = loadConfig(z.object({ API_PORT: z.coerce.number() }), { API_PORT: '3001' });

    expect(config.API_PORT).toBe(3001);
  });

  it('rejects a URL whose scheme is not the one the variable expects', () => {
    expect(() =>
      loadConfig(serviceSchema, { ...validEnvironment, DATABASE_URL: 'http://localhost:5432' }),
    ).toThrow(ConfigurationError);
  });

  it('reports every invalid variable at once, not just the first', () => {
    let caught: unknown;

    try {
      loadConfig(serviceSchema, { LOG_LEVEL: 'verbose' });
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigurationError);

    const issues = (caught as ConfigurationError).details['issues'] as ConfigurationIssue[];
    const variables = issues.map((issue) => issue.variable);

    expect(variables).toContain('LOG_LEVEL');
    expect(variables).toContain('DATABASE_URL');
    expect(variables).toContain('NATS_URL');
  });

  it('names the offending variables in the error message', () => {
    expect(() => loadConfig(serviceSchema, {})).toThrow(/DATABASE_URL/);
  });
});
