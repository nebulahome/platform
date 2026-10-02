import { describe, expect, it } from 'vitest';

import { loadConfig } from '@nebulahome/config';
import { ConfigurationError } from '@nebulahome/contracts';

import { coreEnvSchema } from './config.js';

const minimal = {
  DATABASE_URL: 'postgres://nebula:nebula@localhost:5432/nebula',
  NATS_URL: 'nats://localhost:4222',
};

describe('coreEnvSchema', () => {
  it('starts from a database and a broker and nothing else', () => {
    const config = loadConfig(coreEnvSchema, minimal);

    expect(config.NODE_ENV).toBe('development');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.CORE_COMMAND_TIMEOUT_MS).toBe(5000);
    expect(config.CORE_HISTORY_BATCH_SIZE).toBe(500);
  });

  it('coerces the numbers, which arrive as strings', () => {
    const config = loadConfig(coreEnvSchema, { ...minimal, CORE_COMMAND_TIMEOUT_MS: '250' });

    expect(config.CORE_COMMAND_TIMEOUT_MS).toBe(250);
  });

  it('refuses a command timeout long enough to queue up stuck requests', () => {
    // An unbounded wait turns one unreachable lamp into a queue of stuck HTTP requests.
    expect(() =>
      loadConfig(coreEnvSchema, { ...minimal, CORE_COMMAND_TIMEOUT_MS: '600000' }),
    ).toThrow(ConfigurationError);
  });

  it('refuses a database URL that is not one', () => {
    // Failing here names the variable, instead of surfacing later as an opaque driver error.
    expect(() =>
      loadConfig(coreEnvSchema, { ...minimal, DATABASE_URL: 'http://localhost' }),
    ).toThrow(ConfigurationError);
  });

  it('refuses a broker URL that is not one', () => {
    expect(() => loadConfig(coreEnvSchema, { ...minimal, NATS_URL: 'redis://localhost' })).toThrow(
      ConfigurationError,
    );
  });

  it('reports every problem at once, not one restart at a time', () => {
    try {
      loadConfig(coreEnvSchema, { LOG_LEVEL: 'chatty' });
      expect.unreachable('should have rejected the environment');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ConfigurationError);

      const issues = (error as ConfigurationError).details['issues'] as { variable: string }[];

      expect(issues.map((issue) => issue.variable).toSorted()).toStrictEqual([
        'DATABASE_URL',
        'LOG_LEVEL',
        'NATS_URL',
      ]);
    }
  });
});
