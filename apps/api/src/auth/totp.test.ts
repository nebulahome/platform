/**
 * The one-time code implementation.
 *
 * The RFC 6238 test vectors are the reason this file can exist at all: an implementation nobody
 * checks against them is one that works with the phone it was developed against and with nothing
 * else. Every vector below is from the appendix of the RFC, for the SHA-1 variant every
 * authenticator app implements.
 */
import { describe, expect, it } from 'vitest';

import { TOTP_PARAMS } from '@nebulahome/contracts';

import {
  decryptSecret,
  encryptSecret,
  fromBase32,
  generateRecoveryCodes,
  generateTotpSecret,
  toBase32,
  totpCodeFor,
  totpUri,
  verifyTotp,
} from './totp.js';

/** The RFC 6238 SHA-1 test key: the ASCII digits 1234567890 repeated. */
const RFC_SECRET = Buffer.from('12345678901234567890', 'utf8');

/** A 32-byte key, as `API_TOTP_ENCRYPTION_KEY` supplies. */
const KEY = Buffer.alloc(32, 7);

describe('totpCodeFor', () => {
  it.each([
    [59, '287082'],
    [1_111_111_109, '081804'],
    [1_111_111_111, '050471'],
    [1_234_567_890, '005924'],
    [2_000_000_000, '279037'],
  ])('matches the RFC 6238 vector at %i seconds', (seconds, expected) => {
    const step = Math.floor(seconds / TOTP_PARAMS.periodSeconds);

    expect(totpCodeFor(RFC_SECRET, step)).toBe(expected);
  });

  it('always produces the configured number of digits', () => {
    for (let step = 0; step < 200; step += 1) {
      expect(totpCodeFor(RFC_SECRET, step)).toHaveLength(TOTP_PARAMS.digits);
    }
  });
});

describe('verifyTotp', () => {
  /**
   * A moment at which the RFC's first vector is the current code.
   *
   * @returns That moment.
   */
  const at59Seconds = (): Date => new Date(59_000);

  it('accepts the current code', () => {
    expect(verifyTotp(RFC_SECRET, '287082', at59Seconds)).toBe(true);
  });

  it('accepts a code from the step before, for a slow clock', () => {
    const previous = totpCodeFor(RFC_SECRET, Math.floor(59 / TOTP_PARAMS.periodSeconds) - 1);

    expect(verifyTotp(RFC_SECRET, previous, at59Seconds)).toBe(true);
  });

  it('refuses a code from two steps ago', () => {
    // A later moment than the other cases, so that two steps back is still a real time step.
    const at1111111109 = (): Date => new Date(1_111_111_109_000);
    const step = Math.floor(1_111_111_109 / TOTP_PARAMS.periodSeconds);

    expect(verifyTotp(RFC_SECRET, totpCodeFor(RFC_SECRET, step - 2), at1111111109)).toBe(false);
  });

  it('survives a clock set to the first seconds of the epoch', () => {
    expect(verifyTotp(RFC_SECRET, '000000', () => new Date(0))).toBe(false);
  });

  it('refuses a wrong code', () => {
    expect(verifyTotp(RFC_SECRET, '000000', at59Seconds)).toBe(false);
  });

  it('refuses something that is not a code', () => {
    expect(verifyTotp(RFC_SECRET, 'abcdef', at59Seconds)).toBe(false);
    expect(verifyTotp(RFC_SECRET, '12345', at59Seconds)).toBe(false);
  });

  it('ignores the spaces an authenticator app displays', () => {
    expect(verifyTotp(RFC_SECRET, '287 082', at59Seconds)).toBe(true);
  });
});

describe('base32', () => {
  it('encodes the RFC key the way authenticator apps read it', () => {
    expect(toBase32(RFC_SECRET)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('round-trips arbitrary bytes', () => {
    for (let length = 1; length <= 32; length += 1) {
      const bytes = Buffer.alloc(length, length);

      expect(fromBase32(toBase32(bytes))).toEqual(bytes);
    }
  });

  it('refuses a string outside the alphabet', () => {
    expect(() => fromBase32('ABC!')).toThrow('Not a base32 string');
  });
});

describe('totpUri', () => {
  it('carries every parameter an app needs to agree with the server', () => {
    const uri = totpUri(RFC_SECRET, 'mattia', 'Nebula Home');

    expect(uri.startsWith('otpauth://totp/Nebula%20Home%3Amattia?')).toBe(true);
    expect(uri).toContain('secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});

describe('secret encryption', () => {
  it('round-trips a secret', () => {
    const secret = generateTotpSecret();

    expect(decryptSecret(encryptSecret(secret, KEY), KEY)).toEqual(secret);
  });

  it('produces a different ciphertext each time, so two users do not look alike', () => {
    const secret = generateTotpSecret();

    expect(encryptSecret(secret, KEY)).not.toEqual(encryptSecret(secret, KEY));
  });

  it('refuses a ciphertext that was altered', () => {
    const stored = encryptSecret(generateTotpSecret(), KEY);

    stored.writeUInt8(stored.readUInt8(stored.length - 1) ^ 1, stored.length - 1);

    expect(() => decryptSecret(stored, KEY)).toThrow();
  });

  it('refuses the wrong key', () => {
    const stored = encryptSecret(generateTotpSecret(), KEY);

    expect(() => decryptSecret(stored, Buffer.alloc(32, 9))).toThrow();
  });
});

describe('generateRecoveryCodes', () => {
  it('makes as many as asked for, all different', () => {
    const codes = generateRecoveryCodes(10);

    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
  });

  it('formats them so a person can write one down', () => {
    for (const code of generateRecoveryCodes(20)) {
      expect(code).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/);
    }
  });
});
