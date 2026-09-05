/**
 * Time-based one-time passwords, and the encryption that protects the secrets at rest.
 *
 * RFC 6238 over RFC 4226, implemented here rather than pulled in: it is thirty lines of HMAC
 * and a truncation, the parameters are fixed by what authenticator apps implement, and a
 * dependency in the authentication path is a dependency in the authentication path.
 *
 * Secrets are stored encrypted with AES-256-GCM under `API_TOTP_ENCRYPTION_KEY`. A TOTP secret
 * is a bearer credential for the second factor: an attacker with the database and plaintext
 * secrets can generate codes for every account, which is precisely what the second factor was
 * supposed to prevent.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

import { TOTP_PARAMS } from '@nebula-home/contracts';

/** The base32 alphabet, RFC 4648, which is what authenticator apps read. */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Bytes in the AES-GCM nonce. */
const NONCE_BYTES = 12;

/** Bytes in the AES-GCM authentication tag. */
const TAG_BYTES = 16;

/**
 * Encodes bytes as base32, unpadded.
 *
 * @param bytes - The secret.
 * @returns The base32 string a person can type into an authenticator by hand.
 */
export function toBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET.charAt((value << (5 - bits)) & 31);
  }

  return output;
}

/**
 * Decodes an unpadded base32 string.
 *
 * @param encoded - The base32 secret.
 * @returns The bytes it stands for.
 * @throws {Error} When the string contains something outside the alphabet.
 */
export function fromBase32(encoded: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const character of encoded.replace(/=+$/, '').toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(character);

    if (index === -1) {
      throw new Error('Not a base32 string');
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Generates a new TOTP secret.
 *
 * @returns The raw bytes, to be encrypted before storage.
 */
export function generateTotpSecret(): Buffer {
  return randomBytes(TOTP_PARAMS.secretBytes);
}

/**
 * Computes the code for one time step.
 *
 * @param secret - The raw secret bytes.
 * @param counter - The time step, floor(unix seconds / period).
 * @returns The zero-padded code.
 */
export function totpCodeFor(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8);

  // The counter is 64-bit in the RFC. JavaScript integers are exact to 2^53, which covers every
  // time step until well past the year 285 million, so splitting it into two 32-bit halves is
  // exact rather than merely adequate.
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 15;
  const binary =
    (((digest[offset] ?? 0) & 127) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);

  return String(binary % 10 ** TOTP_PARAMS.digits).padStart(TOTP_PARAMS.digits, '0');
}

/**
 * Checks a code against the current time, allowing for clock drift.
 *
 * @param secret - The raw secret bytes.
 * @param code - What the user typed.
 * @param now - The clock, injectable for tests.
 * @returns True when the code matches any accepted step.
 */
export function verifyTotp(
  secret: Buffer,
  code: string,
  now: () => Date = () => new Date(),
): boolean {
  const trimmed = code.replace(/\s+/g, '');

  if (trimmed.length !== TOTP_PARAMS.digits) {
    return false;
  }

  const step = Math.floor(now().getTime() / 1000 / TOTP_PARAMS.periodSeconds);
  let matched = false;

  for (let offset = -TOTP_PARAMS.windowSteps; offset <= TOTP_PARAMS.windowSteps; offset += 1) {
    const candidate = step + offset;

    // A step before the epoch is not a code anyone could have generated. It only arises when
    // the clock is set to the first seconds of 1970, and computing it would mean encoding a
    // negative counter into an unsigned 64-bit field.
    if (candidate < 0) {
      continue;
    }

    // Every candidate is computed even after a match, so the time taken does not reveal which
    // step matched - and therefore not how far the caller's clock is from the server's.
    matched = totpCodeFor(secret, candidate) === trimmed || matched;
  }

  return matched;
}

/**
 * Builds the `otpauth://` URI an authenticator app scans.
 *
 * @param secret - The raw secret bytes.
 * @param username - Whose account it is, shown in the app's list.
 * @param issuer - The name shown above it.
 * @returns The URI to render as a QR code.
 */
export function totpUri(secret: Buffer, username: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${username}`);
  const parameters = new URLSearchParams({
    secret: toBase32(secret),
    issuer,
    algorithm: TOTP_PARAMS.algorithm,
    digits: String(TOTP_PARAMS.digits),
    period: String(TOTP_PARAMS.periodSeconds),
  });

  return `otpauth://totp/${label}?${parameters.toString()}`;
}

/**
 * Encrypts a secret for storage.
 *
 * @param secret - The raw secret bytes.
 * @param key - The 32-byte key from `API_TOTP_ENCRYPTION_KEY`.
 * @returns Nonce, tag and ciphertext concatenated, which is what goes in the `bytea` column.
 */
export function encryptSecret(secret: Buffer, key: Buffer): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);

  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
}

/**
 * Decrypts a stored secret.
 *
 * @param stored - What {@link encryptSecret} produced.
 * @param key - The 32-byte key.
 * @returns The raw secret bytes.
 * @throws {Error} When the tag does not verify, which means the row was altered or the key is
 * not the one it was encrypted with.
 */
export function decryptSecret(stored: Buffer, key: Buffer): Buffer {
  const nonce = stored.subarray(0, NONCE_BYTES);
  const tag = stored.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
  const ciphertext = stored.subarray(NONCE_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);

  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Generates the codes that get a person back in when their phone is gone.
 *
 * @param count - How many to make.
 * @returns Codes in `xxxx-xxxx` form, which is short enough to write down and long enough to
 * be unguessable at 40 bits each.
 */
export function generateRecoveryCodes(count: number): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString('hex');

    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}
