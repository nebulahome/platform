import { describe, expect, it } from 'vitest';

import {
  AdapterError,
  DeviceUnavailableError,
  ERROR_CODES,
  NotFoundError,
  PermissionError,
} from '@nebula-home/contracts';

import { fromBusError, toBusError } from './error-mapping.js';

describe('toBusError', () => {
  it('carries the code, the message and the details', () => {
    const wire = toBusError(
      new NotFoundError('No such entity', { details: { entityId: 'light.nowhere' } }),
    );

    expect(wire).toStrictEqual({
      code: ERROR_CODES.NOT_FOUND,
      message: 'No such entity',
      details: { entityId: 'light.nowhere' },
    });
  });

  it('reports anything that is not a platform error as an adapter failure', () => {
    expect(toBusError(new TypeError('cannot read property of undefined')).code).toBe(
      ERROR_CODES.ADAPTER,
    );
  });

  it('survives a thrown non-error', () => {
    expect(toBusError('something went wrong').message).toBe('something went wrong');
    expect(toBusError(undefined).message).toBe('Unknown error');
  });
});

describe('fromBusError', () => {
  it('rebuilds the class the responder threw', () => {
    // The point of routing failures through a shared hierarchy: `instanceof` works across
    // process boundaries, so a caller's catch reads the same whether the failure was local.
    const rebuilt = fromBusError(
      toBusError(new PermissionError('Not allowed')),
      'nebula.v1.cmd.lock.front_door.lock',
    );

    expect(rebuilt).toBeInstanceOf(PermissionError);
    expect(rebuilt.httpStatus).toBe(403);
  });

  it('keeps the details and adds the subject that failed', () => {
    const rebuilt = fromBusError(
      toBusError(new DeviceUnavailableError('No ack', { details: { entityId: 'light.kitchen' } })),
      'nebula.v1.cmd.light.kitchen.on_off',
    );

    expect(rebuilt.details).toStrictEqual({
      entityId: 'light.kitchen',
      subject: 'nebula.v1.cmd.light.kitchen.on_off',
    });
  });

  it('preserves a code it has never heard of instead of guessing', () => {
    // A code from a newer build. Reporting it as one of ours would send whoever reads the log
    // to the wrong place; reporting it as unintelligible with the original code attached does not.
    const rebuilt = fromBusError(
      { code: 'QUOTA_EXCEEDED', message: 'Too many', details: {} },
      'nebula.v1.svc.core.snapshot',
    );

    expect(rebuilt).toBeInstanceOf(AdapterError);
    expect(rebuilt.details['remoteCode']).toBe('QUOTA_EXCEEDED');
  });
});
