import { describe, expect, it } from 'vitest';

import {
  AdapterError,
  ConfigurationError,
  ERROR_CODES,
  isNebulaError,
  NotFoundError,
  PermissionError,
  ValidationError,
} from './errors.js';

describe('ERROR_CODES', () => {
  it('gives every code the same value as its key, so the two cannot drift', () => {
    for (const [key, value] of Object.entries(ERROR_CODES)) {
      expect(value).toBe(key);
    }
  });
});

describe('NebulaError', () => {
  it('reports the name of the most-derived class rather than the base', () => {
    expect(new NotFoundError('Entity does not exist').name).toBe('NotFoundError');
  });

  it('carries the code and HTTP status of its subclass', () => {
    const error = new PermissionError('Missing entity:control');

    expect(error.code).toBe(ERROR_CODES.PERMISSION);
    expect(error.httpStatus).toBe(403);
  });

  it('attaches structured details when given them', () => {
    const error = new ValidationError('Unknown capability', {
      details: { entityId: 'light.kitchen_ceiling' },
    });

    expect(error.details).toEqual({ entityId: 'light.kitchen_ceiling' });
  });

  it('defaults details to an empty object so callers never guard against undefined', () => {
    expect(new ValidationError('Bad input').details).toEqual({});
  });

  it('preserves the cause so the whole chain survives to the logs', () => {
    const cause = new Error('ECONNREFUSED');
    const error = new AdapterError('Pairing failed', { cause });

    expect(error.cause).toBe(cause);
  });

  it('is a real Error, so stack traces and instanceof both behave', () => {
    const error = new ConfigurationError('DATABASE_URL is not set');

    expect(error).toBeInstanceOf(Error);
    expect(error.stack).toContain('ConfigurationError');
  });
});

describe('isNebulaError', () => {
  it('accepts any platform error', () => {
    expect(isNebulaError(new NotFoundError('Gone'))).toBe(true);
  });

  it('rejects errors raised below the platform', () => {
    expect(isNebulaError(new Error('ECONNRESET'))).toBe(false);
  });

  it('rejects non-error values, which a catch clause can also receive', () => {
    expect(isNebulaError('boom')).toBe(false);
    expect(isNebulaError(undefined)).toBe(false);
  });
});
