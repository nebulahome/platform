/**
 * The archive's encryption: what goes in comes out, and anything done to the archive in between
 * - a byte changed, the end cut off, another key - is refused rather than read.
 */
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { pipeline } from 'node:stream/promises';

import { describe, expect, it } from 'vitest';

import {
  CHUNK_SIZE,
  createDecryptStream,
  createEncryptStream,
  readArchiveHeader,
} from './stream-cipher.js';

const KEY = randomBytes(32);
const KEY_ID = 'ab'.repeat(16);

/**
 * Encrypts some bytes, fed in pieces.
 *
 * @param plain - What to encrypt.
 * @returns The archive.
 */
async function encrypt(plain: Buffer): Promise<Buffer> {
  const pieces = [];

  for (let at = 0; at < plain.length; at += 300_000) {
    pieces.push(plain.subarray(at, at + 300_000));
  }

  const encryptor = createEncryptStream(KEY, KEY_ID, { sections: ['configuration'] });
  const [out] = await Promise.all([buffer(encryptor), pipeline(Readable.from(pieces), encryptor)]);

  return out;
}

/**
 * Decrypts an archive.
 *
 * @param archive - The archive.
 * @param key - The key it is opened with.
 * @returns What was in it.
 */
async function decrypt(archive: Buffer, key: Buffer = KEY): Promise<Buffer> {
  const decryptor = createDecryptStream((keyId) => (keyId === KEY_ID ? key : null));
  const [out] = await Promise.all([
    buffer(decryptor),
    pipeline(Readable.from([archive.subarray(0, 1000), archive.subarray(1000)]), decryptor),
  ]);

  return out;
}

describe('the archive encryption', () => {
  it.each([
    ['nothing', 0],
    ['a little', 1234],
    ['exactly one chunk', CHUNK_SIZE],
    ['exactly two chunks', CHUNK_SIZE * 2],
    ['two chunks and a bit', CHUNK_SIZE * 2 + 17],
  ])('gives back what went in: %s', async (nothing, size) => {
    const plain = randomBytes(size);

    expect((await decrypt(await encrypt(plain))).equals(plain)).toBe(true);
  });

  it('says in the clear which key it needs and what it holds', async () => {
    const header = readArchiveHeader(await encrypt(randomBytes(10)));

    expect(header).toEqual({ keyId: KEY_ID, public: { sections: ['configuration'] } });
  });

  it('refuses an archive with one byte changed', async () => {
    const archive = await encrypt(randomBytes(CHUNK_SIZE + 10));

    archive[archive.length - 40] = (archive[archive.length - 40] ?? 0) ^ 1;

    await expect(decrypt(archive)).rejects.toThrow(/damaged/u);
  });

  it('refuses an archive cut short at a chunk’s end', async () => {
    const archive = await encrypt(randomBytes(CHUNK_SIZE * 2 + 10));
    // Without its last chunk (10 bytes and a 16-byte tag).
    const cut = archive.subarray(0, archive.length - 26);

    await expect(decrypt(cut)).rejects.toThrow(/cut short|damaged/u);
  });

  it('refuses an archive with its public header changed', async () => {
    const archive = await encrypt(randomBytes(100));
    const text = archive.toString('latin1').replace('configuration', 'configuratioN');

    await expect(decrypt(Buffer.from(text, 'latin1'))).rejects.toThrow(/damaged/u);
  });

  it('refuses the wrong key, and a key it does not have', async () => {
    const archive = await encrypt(randomBytes(100));

    await expect(decrypt(archive, randomBytes(32))).rejects.toThrow(/damaged|another key/u);

    const stranger = createDecryptStream(() => null);

    await expect(pipeline(Readable.from([archive]), stranger)).rejects.toThrow(/another key/u);
  });

  it('refuses what is not an archive', async () => {
    await expect(decrypt(Buffer.from('not a backup at all, just some text'))).rejects.toThrow(
      /Not a NebulaHome backup/u,
    );
  });
});
