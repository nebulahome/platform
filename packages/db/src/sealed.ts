/**
 * Secrets inside `jsonb` columns: sealed at rest, opened only by the process that needs them.
 *
 * A configuration is mostly things an owner has to be able to read back - addresses, names,
 * flags - and one or two things nobody should: a broker password, a printer's access code. The
 * readable parts stay plain JSON. A secret is replaced, in the same document, by a **marker**:
 *
 * ```json
 * { "url": "mqtts://192.168.1.60:8883", "password": { "$sealed": "v1:…" } }
 * ```
 *
 * The marker holds the value encrypted with AES-256-GCM under `NEBULA_SECRETS_KEY`, which lives
 * in `.env` and nowhere in the database. A dump, a backup or a read-only role gets the marker
 * and nothing it can do with it; `api` seals when it writes, `hub` opens when it starts an
 * instance, and the value in the clear exists only in that process's memory.
 *
 * `v1:` names the layout - nonce, tag, ciphertext, base64 - so that a later layout can be told
 * apart from this one without guessing at byte lengths.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { ConfigurationError, type JsonObject, type JsonValue } from '@nebula-home/contracts';

/** GCM's standard nonce length. */
const NONCE_BYTES = 12;

/** GCM's standard authentication tag length. */
const TAG_BYTES = 16;

/** The layout this module writes. */
const LAYOUT = 'v1';

/** The key length AES-256 needs. */
const KEY_BYTES = 32;

/** What a sealed value looks like inside a document. */
export type SealedValue = { readonly $sealed: string };

/**
 * Turns the environment's key into the bytes the cipher takes.
 *
 * @param hex - The 64 hexadecimal characters of `NEBULA_SECRETS_KEY`.
 * @returns The 32-byte key.
 * @throws {ConfigurationError} When the key is not 32 bytes of hexadecimal.
 */
export function secretsKeyFrom(hex: string): Buffer {
  const key = Buffer.from(hex, 'hex');

  if (key.length !== KEY_BYTES || key.toString('hex') !== hex.toLowerCase()) {
    throw new ConfigurationError('NEBULA_SECRETS_KEY must be 64 hexadecimal characters');
  }

  return key;
}

/**
 * Whether a value is a sealed marker.
 *
 * @param value - Anything found in a document.
 * @returns True for `{ "$sealed": "<string>" }` and nothing else - the masked form
 * `{ "$sealed": true }` the API serves is deliberately not one.
 */
export function isSealed(value: unknown): value is SealedValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$sealed' in value &&
    typeof value.$sealed === 'string'
  );
}

/**
 * Seals one value.
 *
 * @param plain - The secret as typed.
 * @param key - From {@link secretsKeyFrom}.
 * @returns The marker to store in its place. A fresh nonce each time, so two equal secrets do
 * not produce two equal markers.
 */
export function sealSecret(plain: string, key: Buffer): SealedValue {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const packed = Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);

  return { $sealed: `${LAYOUT}:${packed.toString('base64')}` };
}

/**
 * Opens one marker.
 *
 * @param sealed - What {@link sealSecret} produced.
 * @param key - The key it was sealed with.
 * @returns The secret as typed.
 * @throws {ConfigurationError} When the marker is not this module's layout, was altered, or was
 * sealed with another key. All three read the same to the cipher; the message names the likely
 * cause, which is a key that changed since the value was saved.
 */
export function openSecret(sealed: SealedValue, key: Buffer): string {
  const [layout, encoded] = sealed.$sealed.split(':');

  if (layout !== LAYOUT || encoded === undefined) {
    throw new ConfigurationError('A sealed secret has a layout this build does not read');
  }

  const packed = Buffer.from(encoded, 'base64');
  const nonce = packed.subarray(0, NONCE_BYTES);
  const tag = packed.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
  const ciphertext = packed.subarray(NONCE_BYTES + TAG_BYTES);

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);

    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (error: unknown) {
    throw new ConfigurationError(
      'A sealed secret could not be opened: NEBULA_SECRETS_KEY is not the key it was saved with. Enter the secret again.',
      { cause: error },
    );
  }
}

/**
 * Seals the values at the given keys of a document.
 *
 * @param values - The document, as validated.
 * @param secretKeys - Which of its keys hold secrets, from the bundle's declaration.
 * @param key - The sealing key.
 * @returns A copy with those values sealed. A value that is already a marker is kept as it is -
 * a change merged over a stored row carries the row's markers through - and a value that is not
 * a string is left alone, because a secret is something typed.
 */
export function sealSecrets(
  values: JsonObject,
  secretKeys: readonly string[],
  key: Buffer,
): JsonObject {
  const sealed: JsonObject = { ...values };

  for (const name of secretKeys) {
    const value = sealed[name];

    if (typeof value === 'string') {
      sealed[name] = sealSecret(value, key);
    }
  }

  return sealed;
}

/**
 * Opens every marker in a document.
 *
 * @param values - The document as stored.
 * @param key - The sealing key.
 * @returns A copy with every marker replaced by the secret it held.
 * @throws {ConfigurationError} When a marker cannot be opened - see {@link openSecret}.
 */
export function openSecrets(values: JsonObject, key: Buffer): JsonObject {
  const opened: JsonObject = {};

  for (const [name, value] of Object.entries(values)) {
    opened[name] = isSealed(value) ? openSecret(value, key) : value;
  }

  return opened;
}

/**
 * Replaces every marker with a flag, for a document that leaves the server.
 *
 * @param values - The document as stored.
 * @returns A copy in which each sealed value reads `{ "$sealed": true }`: enough for a form to
 * say a secret is kept, and nothing an attacker could do anything with.
 */
export function maskSealed(values: JsonObject): JsonObject {
  const masked: JsonObject = {};

  for (const [name, value] of Object.entries(values)) {
    const flag: JsonValue = { $sealed: true };

    masked[name] = isSealed(value) ? flag : value;
  }

  return masked;
}
