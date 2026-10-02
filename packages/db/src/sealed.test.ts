import { describe, expect, it } from 'vitest';

import { ConfigurationError } from '@nebulahome/contracts';

import {
  isSealed,
  maskSealed,
  openSecret,
  openSecrets,
  sealSecret,
  sealSecrets,
  secretsKeyFrom,
} from './sealed.js';

/** A key, as `NEBULA_SECRETS_KEY` would supply it. */
const KEY = secretsKeyFrom('0f'.repeat(32));

/** A different key, for the case where the one in `.env` has changed. */
const OTHER_KEY = secretsKeyFrom('1e'.repeat(32));

describe('sealSecret and openSecret', () => {
  it('round-trips a value through a marker that does not contain it', () => {
    const sealed = sealSecret('12345678', KEY);

    expect(sealed.$sealed).toMatch(/^v1:[A-Za-z0-9+/]+=*$/u);
    expect(sealed.$sealed).not.toContain('12345678');
    expect(openSecret(sealed, KEY)).toBe('12345678');
  });

  it('seals the same value differently every time, so equal passwords do not look equal', () => {
    expect(sealSecret('12345678', KEY).$sealed).not.toBe(sealSecret('12345678', KEY).$sealed);
  });

  it('refuses to open with another key, and says what to do about it', () => {
    const sealed = sealSecret('12345678', KEY);

    expect(() => openSecret(sealed, OTHER_KEY)).toThrow(ConfigurationError);
    expect(() => openSecret(sealed, OTHER_KEY)).toThrow(/NEBULA_SECRETS_KEY/u);
  });

  it('refuses a marker that was tampered with', () => {
    const sealed = sealSecret('12345678', KEY);
    const tampered = { $sealed: `${sealed.$sealed.slice(0, -4)}AAAA` };

    expect(() => openSecret(tampered, KEY)).toThrow(ConfigurationError);
  });
});

describe('isSealed', () => {
  it('recognises a marker and nothing else', () => {
    expect(isSealed({ $sealed: 'v1:abc' })).toBe(true);
    expect(isSealed({ $sealed: true })).toBe(false);
    expect(isSealed('v1:abc')).toBe(false);
    expect(isSealed(null)).toBe(false);
    expect(isSealed({ url: 'mqtt://x' })).toBe(false);
  });
});

describe('sealSecrets and openSecrets', () => {
  it('seals only the declared keys and opens exactly those back', () => {
    const stored = sealSecrets(
      { url: 'mqtts://192.168.1.60:8883', password: '12345678', username: 'bblp' },
      ['password'],
      KEY,
    );

    expect(stored['url']).toBe('mqtts://192.168.1.60:8883');
    expect(stored['username']).toBe('bblp');
    expect(isSealed(stored['password'])).toBe(true);
    expect(openSecrets(stored, KEY)).toEqual({
      url: 'mqtts://192.168.1.60:8883',
      password: '12345678',
      username: 'bblp',
    });
  });

  it('leaves a value that is already sealed alone, so a merge cannot seal twice', () => {
    const once = sealSecrets({ password: '12345678' }, ['password'], KEY);
    const twice = sealSecrets(once, ['password'], KEY);

    expect(twice['password']).toEqual(once['password']);
  });

  it('seals nothing that is not a string, since a secret is typed, not computed', () => {
    expect(sealSecrets({ password: 42 }, ['password'], KEY)).toEqual({ password: 42 });
  });
});

describe('maskSealed', () => {
  it('replaces every marker with a flag, so the ciphertext never leaves the server', () => {
    const stored = sealSecrets({ url: 'mqtt://x', password: 'p' }, ['password'], KEY);

    expect(maskSealed(stored)).toEqual({ url: 'mqtt://x', password: { $sealed: true } });
  });
});

describe('secretsKeyFrom', () => {
  it('turns the 64 hex characters of the environment into 32 bytes', () => {
    expect(KEY.length).toBe(32);
  });
});
