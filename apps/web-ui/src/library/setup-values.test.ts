import { describe, expect, it } from 'vitest';

import { integrationSetupSchema } from '@nebula-home/contracts';

import { ApiError } from '@/lib/api-error';

import { errorsByField, initialDraft, keptSecrets, serverIssuesOf, toValues } from './setup-values';

/** A declaration with one field of every kind. */
const SETUP = integrationSetupSchema.parse({
  transport: {
    constants: { username: 'bblp' },
    fields: [
      { key: 'url', type: 'text', label: 'Address', isRequired: true, pattern: '^mqtts?://.+' },
      { key: 'password', type: 'secret', label: 'Access code', isRequired: true, minLength: 8 },
      { key: 'hosts', type: 'list', label: 'Addresses', minItems: 0 },
      {
        key: 'pollMs',
        type: 'number',
        label: 'Poll every',
        min: 100,
        isInteger: true,
        default: 5000,
      },
      { key: 'isSecure', type: 'boolean', label: 'HTTPS', default: false },
      {
        key: 'speed',
        type: 'choice',
        label: 'Speed',
        choices: [
          { value: 'slow', label: 'Slow' },
          { value: 'fast', label: 'Fast' },
        ],
        default: 'fast',
      },
    ],
  },
});

describe('initialDraft', () => {
  it('starts a new instance from the declared defaults, with everything else blank', () => {
    expect(initialDraft(SETUP.transport)).toEqual({
      url: '',
      password: '',
      hosts: '',
      pollMs: '5000',
      isSecure: false,
      speed: 'fast',
    });
  });

  it('starts an edit from what the row holds, as text a control can show', () => {
    expect(
      initialDraft(SETUP.transport, {
        url: 'mqtts://a',
        username: 'bblp',
        password: { $sealed: true },
        hosts: ['192.168.1.40', '192.168.1.41'],
        pollMs: 2500,
        isSecure: true,
        speed: 'slow',
      }),
    ).toEqual({
      url: 'mqtts://a',
      password: '',
      hosts: '192.168.1.40, 192.168.1.41',
      pollMs: '2500',
      isSecure: true,
      speed: 'slow',
    });
  });
});

describe('keptSecrets', () => {
  it('names the secret fields the row already holds a value for', () => {
    expect(keptSecrets(SETUP.transport, { password: { $sealed: true }, url: 'x' })).toEqual([
      'password',
    ]);
    expect(keptSecrets(SETUP.transport, { url: 'x' })).toEqual([]);
    expect(keptSecrets(SETUP.transport, undefined)).toEqual([]);
  });
});

describe('toValues', () => {
  it('turns what was typed into what the API takes, leaving blanks out', () => {
    const result = toValues(
      SETUP.transport,
      {
        url: ' mqtts://192.168.1.60:8883 ',
        password: '12345678',
        hosts: '192.168.1.40, 192.168.1.41\n 192.168.1.42 ',
        pollMs: '3000',
        isSecure: true,
        speed: 'slow',
      },
      'complete',
    );

    expect(result).toEqual({
      values: {
        url: 'mqtts://192.168.1.60:8883',
        password: '12345678',
        hosts: ['192.168.1.40', '192.168.1.41', '192.168.1.42'],
        pollMs: 3000,
        isSecure: true,
        speed: 'slow',
      },
      errors: {},
    });
  });

  it('says, per field, what is wrong', () => {
    const result = toValues(
      SETUP.transport,
      { url: 'nope', password: '123', hosts: '', pollMs: 'soon', isSecure: false, speed: 'fast' },
      'complete',
    );

    expect(Object.keys(result.errors).sort()).toEqual(['password', 'pollMs', 'url']);
    expect(result.errors['pollMs']).toMatch(/number/iu);
  });

  it('leaves a blank secret out of a change, so the kept one stays', () => {
    const result = toValues(
      SETUP.transport,
      { url: 'mqtts://b', password: '', hosts: '', pollMs: '5000', isSecure: false, speed: 'fast' },
      'partial',
    );

    expect(result.errors).toEqual({});
    expect('password' in result.values).toBe(false);
    expect(result.values['url']).toBe('mqtts://b');
  });

  it('insists on a required field for a new instance', () => {
    const result = toValues(
      SETUP.transport,
      { url: '', password: '', hosts: '', pollMs: '5000', isSecure: false, speed: 'fast' },
      'complete',
    );

    expect(Object.keys(result.errors).sort()).toEqual(['password', 'url']);
  });
});

describe('errorsByField', () => {
  it('puts a server issue under the control it names, and the rest under nothing', () => {
    expect(
      errorsByField(
        [
          { path: 'transportConfig.url', message: 'Must start with mqtt' },
          { path: 'options.pollMs', message: 'Too small' },
          { path: 'transportConfig', message: 'Unrecognized key' },
        ],
        'transportConfig',
      ),
    ).toEqual({ url: 'Must start with mqtt' });
  });
});

describe('serverIssuesOf', () => {
  it('reads the issues a 400 carried, and nothing from any other failure', () => {
    const refused = new ApiError({
      status: 400,
      code: 'VALIDATION',
      message: 'Invalid',
      details: {
        issues: [{ path: 'transportConfig.password', message: 'Must be 8 characters' }, 'noise'],
      },
    });

    expect(serverIssuesOf(refused)).toEqual([
      { path: 'transportConfig.password', message: 'Must be 8 characters' },
    ]);
    expect(serverIssuesOf(new Error('offline'))).toEqual([]);
    expect(
      serverIssuesOf(new ApiError({ status: 409, code: 'CONFLICT', message: 'Taken' })),
    ).toEqual([]);
  });
});
