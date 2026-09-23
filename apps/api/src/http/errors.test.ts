/**
 * Turning failures into the one error body.
 *
 * The case worth guarding hardest is the last one: an unexpected error must not put its message
 * in the response. Those messages are written for developers and routinely name a table, a
 * column or a path, none of which an unauthenticated caller should learn from a 500.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ConflictError,
  DeviceUnavailableError,
  ERROR_CODES,
  NotFoundError,
  PermissionError,
  UpstreamError,
  ValidationError,
} from '@nebula-home/contracts';

import { toErrorBody, toErrorShape, toValidationIssues } from './errors.js';

describe('toErrorShape', () => {
  it('keeps a platform error whole', () => {
    const shape = toErrorShape(
      new NotFoundError('No entity light.spare', { details: { entityId: 'light.spare' } }),
    );

    expect(shape).toEqual({
      status: 404,
      code: ERROR_CODES.NOT_FOUND,
      message: 'No entity light.spare',
      details: { entityId: 'light.spare' },
    });
  });

  it.each([
    [new ValidationError('bad'), 400, ERROR_CODES.VALIDATION],
    [new ConflictError('taken'), 409, ERROR_CODES.CONFLICT],
    [new PermissionError('nope'), 403, ERROR_CODES.PERMISSION],
    [new DeviceUnavailableError('silent'), 503, ERROR_CODES.DEVICE_UNAVAILABLE],
    [new UpstreamError('no map server'), 503, ERROR_CODES.UPSTREAM],
  ])('maps %s to its own status', (error, status, code) => {
    const shape = toErrorShape(error);

    expect(shape.status).toBe(status);
    expect(shape.code).toBe(code);
  });

  it('turns a schema failure into a 400 that names the fields', () => {
    const parsed = z.object({ level: z.number().min(0) }).safeParse({ level: -1 });
    const shape = toErrorShape(parsed.success ? new Error('unreachable') : parsed.error);

    expect(shape.status).toBe(400);
    expect(shape.code).toBe(ERROR_CODES.VALIDATION);
    expect(shape.details['issues']).toEqual([
      expect.objectContaining({ path: 'level' }) as unknown,
    ]);
  });

  it('keeps the status a framework failure already carries', () => {
    const shape = toErrorShape({ statusCode: 429, message: 'Rate limit exceeded' });

    expect(shape.status).toBe(429);
    expect(shape.message).toBe('Rate limit exceeded');
  });

  it('reads a framework 404 as a not-found', () => {
    expect(toErrorShape({ statusCode: 404, message: 'Not Found' }).code).toBe(
      ERROR_CODES.NOT_FOUND,
    );
  });

  it('never repeats the message of an error it did not expect', () => {
    const shape = toErrorShape(
      new Error('relation "auth.users" does not exist at /srv/app/dist/db.js:41'),
    );

    expect(shape.status).toBe(500);
    expect(shape.code).toBe(ERROR_CODES.INTERNAL);
    expect(shape.message).toBe('The request could not be completed');
    expect(shape.details).toEqual({});
  });

  it('survives something that is not an error at all', () => {
    expect(toErrorShape('a string').status).toBe(500);
    expect(toErrorShape(null).code).toBe(ERROR_CODES.INTERNAL);
  });
});

describe('toErrorBody', () => {
  it('produces exactly the envelope RULES.md 8.3 fixes', () => {
    const body = toErrorBody(
      toErrorShape(new ValidationError('bad')),
      '01JD8Z4K2P9QF3M7X1V6R8T2NB',
    );

    expect(Object.keys(body)).toEqual(['error']);
    expect(Object.keys(body.error).sort()).toEqual(['code', 'details', 'message', 'traceId']);
    expect(body.error.traceId).toBe('01JD8Z4K2P9QF3M7X1V6R8T2NB');
  });
});

describe('toValidationIssues', () => {
  it('names a nested field by its path', () => {
    const parsed = z
      .object({ command: z.object({ level: z.number() }) })
      .safeParse({ command: { level: 'bright' } });

    expect(parsed.success).toBe(false);

    if (!parsed.success) {
      expect(toValidationIssues(parsed.error)[0]?.path).toBe('command.level');
    }
  });
});
