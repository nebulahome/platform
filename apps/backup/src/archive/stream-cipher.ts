/**
 * The encryption every archive is written in: AES-256-GCM over 1 MiB chunks, as a stream.
 *
 * GCM authenticates a whole message at once, and an archive is gigabytes, so it is cut into
 * chunks, each sealed on its own with a nonce made of a random prefix, the chunk's number and a
 * flag on the last one - the STREAM construction (Hoang, Reyhanitabar, Rogaway, Vizár), as `age`
 * and Tink use it. A chunk altered, moved, dropped or added fails to open, and so does an archive
 * cut short: its last chunk was not sealed as the last.
 *
 * Every archive has its own key, derived from the backup key with HKDF and a random salt, so
 * nonces never repeat across archives. The header before the chunks is written in the clear -
 * magic, version, the backup key's id, the salt, the nonce prefix, the chunk size and a little
 * JSON anyone may read (when, what, how large) - and is bound into every chunk's tag, so it
 * cannot be changed either.
 *
 * ```
 * "NHBACKUP" | version 1 | suite 1 | key id (16) | salt (32) | nonce prefix (7) | chunk size (u32)
 *   | public JSON length (u32) | public JSON | chunk 0 ‖ tag | chunk 1 ‖ tag | … | last ‖ tag
 * ```
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';

/** What every archive starts with. */
const MAGIC = Buffer.from('NHBACKUP', 'ascii');

/** The header's layout version, and the cipher suite: AES-256-GCM, HKDF-SHA256. */
const VERSION = 1;
const SUITE = 1;

/** How much plain text each chunk seals. */
export const CHUNK_SIZE = 1024 * 1024;

/** The length of a GCM tag. */
const TAG_LENGTH = 16;

/** The fixed part of the header, before the public JSON. */
const FIXED_HEADER_LENGTH = MAGIC.length + 1 + 1 + 16 + 32 + 7 + 4 + 4;

/** The most public JSON a header may carry. */
export const MAX_PUBLIC_LENGTH = 64 * 1024;

/** The context the file key is derived for. */
const KEY_INFO = Buffer.from('nebulahome-backup v1 file key', 'utf8');

/** What an archive's header says. */
export type ArchiveHeader = {
  /** The backup key's id, as 32 hex characters. */
  readonly keyId: string;

  /** What anyone may read about the archive. */
  readonly public: Readonly<Record<string, unknown>>;
};

/** A header as parsed, with what opening the chunks needs. */
type ParsedHeader = ArchiveHeader & {
  readonly salt: Buffer;
  readonly noncePrefix: Buffer;
  readonly chunkSize: number;

  /** The header's own bytes, bound into every chunk. */
  readonly bytes: Buffer;
};

/**
 * Derives the key one archive's chunks are sealed with.
 *
 * @param backupKey - The installation's backup key.
 * @param salt - The archive's salt.
 * @returns The 32-byte key.
 */
function fileKeyOf(backupKey: Buffer, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', backupKey, salt, KEY_INFO, 32));
}

/**
 * The nonce of one chunk.
 *
 * @param prefix - The archive's random prefix.
 * @param index - The chunk's number.
 * @param isLast - Whether it is the last.
 * @returns The 12-byte nonce.
 */
function nonceOf(prefix: Buffer, index: number, isLast: boolean): Buffer {
  const nonce = Buffer.alloc(12);

  prefix.copy(nonce, 0);
  nonce.writeUInt32BE(index, 7);
  nonce.writeUInt8(isLast ? 1 : 0, 11);

  return nonce;
}

/**
 * Writes an archive's header.
 *
 * @param keyId - The backup key's id.
 * @param publicData - What anyone may read.
 * @returns The header, with the salt and prefix it chose.
 * @throws {Error} When what anyone may read is larger than a header takes.
 */
function writeHeader(keyId: string, publicData: Readonly<Record<string, unknown>>): ParsedHeader {
  const json = Buffer.from(JSON.stringify(publicData), 'utf8');

  if (json.length > MAX_PUBLIC_LENGTH) {
    throw new Error('The archive header is too large');
  }

  const salt = randomBytes(32);
  const noncePrefix = randomBytes(7);
  const bytes = Buffer.alloc(FIXED_HEADER_LENGTH + json.length);
  let at = 0;

  at += MAGIC.copy(bytes, at);
  at = bytes.writeUInt8(VERSION, at);
  at = bytes.writeUInt8(SUITE, at);
  at += Buffer.from(keyId, 'hex').copy(bytes, at);
  at += salt.copy(bytes, at);
  at += noncePrefix.copy(bytes, at);
  at = bytes.writeUInt32BE(CHUNK_SIZE, at);
  at = bytes.writeUInt32BE(json.length, at);
  json.copy(bytes, at);

  return { keyId, public: publicData, salt, noncePrefix, chunkSize: CHUNK_SIZE, bytes };
}

/**
 * Reads an archive's header from its first bytes.
 *
 * @param bytes - At least the whole header.
 * @returns The header, or null when more bytes are needed.
 * @throws {Error} When the bytes are not an archive this build can read.
 */
function parseHeader(bytes: Buffer): ParsedHeader | null {
  const start = bytes.subarray(0, MAGIC.length);

  if (!start.equals(MAGIC.subarray(0, start.length))) {
    throw new Error('Not a NebulaHome backup');
  }

  if (bytes.length < FIXED_HEADER_LENGTH) {
    return null;
  }

  let at = MAGIC.length;
  const version = bytes.readUInt8(at);
  const suite = bytes.readUInt8(at + 1);

  at += 2;

  if (version !== VERSION || suite !== SUITE) {
    throw new Error(`A backup format this build does not read (version ${String(version)})`);
  }

  const keyId = bytes.subarray(at, at + 16).toString('hex');

  at += 16;

  const salt = Buffer.from(bytes.subarray(at, at + 32));

  at += 32;

  const noncePrefix = Buffer.from(bytes.subarray(at, at + 7));

  at += 7;

  const chunkSize = bytes.readUInt32BE(at);
  const jsonLength = bytes.readUInt32BE(at + 4);

  at += 8;

  if (chunkSize === 0 || chunkSize > 64 * 1024 * 1024 || jsonLength > MAX_PUBLIC_LENGTH) {
    throw new Error('A damaged backup header');
  }

  if (bytes.length < at + jsonLength) {
    return null;
  }

  const publicData = JSON.parse(bytes.subarray(at, at + jsonLength).toString('utf8')) as Record<
    string,
    unknown
  >;

  return {
    keyId,
    public: publicData,
    salt,
    noncePrefix,
    chunkSize,
    bytes: Buffer.from(bytes.subarray(0, at + jsonLength)),
  };
}

/**
 * Reads an archive's header, without the key: what the archives list shows.
 *
 * @param bytes - The archive's first bytes; 64 KiB and a little more is always enough.
 * @returns The header.
 * @throws {Error} When the bytes are not a whole header of an archive.
 */
export function readArchiveHeader(bytes: Buffer): ArchiveHeader {
  const header = parseHeader(bytes);

  if (header === null) {
    throw new Error('The backup is cut short before its header ends');
  }

  return { keyId: header.keyId, public: header.public };
}

/** The bytes a header can take at most. */
export const MAX_HEADER_LENGTH = FIXED_HEADER_LENGTH + MAX_PUBLIC_LENGTH;

/**
 * A stream that encrypts what goes through it into an archive.
 *
 * @param backupKey - The backup key.
 * @param keyId - Its id.
 * @param publicData - What the header says to anyone.
 * @returns The transform: plain text in, the archive out.
 */
export function createEncryptStream(
  backupKey: Buffer,
  keyId: string,
  publicData: Readonly<Record<string, unknown>>,
): Transform {
  const header = writeHeader(keyId, publicData);
  const key = fileKeyOf(backupKey, header.salt);
  let pending = Buffer.alloc(0);
  let index = 0;
  let isHeaderWritten = false;

  /**
   * Seals one chunk.
   *
   * @param plain - Its plain text.
   * @param isLast - Whether it is the last.
   * @returns The sealed chunk with its tag.
   */
  const seal = (plain: Buffer, isLast: boolean): Buffer => {
    const cipher = createCipheriv('aes-256-gcm', key, nonceOf(header.noncePrefix, index, isLast));

    cipher.setAAD(header.bytes);
    index += 1;

    return Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  };

  return new Transform({
    /**
     * Seals every whole chunk but the last seen, which may yet be the last.
     *
     * @param data - Plain text.
     * @param encoding - Unused: bytes.
     * @param callback - Called when done.
     */
    transform(data: Buffer, encoding: BufferEncoding, callback: TransformCallback): void {
      if (!isHeaderWritten) {
        this.push(header.bytes);
        isHeaderWritten = true;
      }

      pending = Buffer.concat([pending, data]);

      // Strictly more than a chunk: the one held back may be the last, and is sealed as such.
      while (pending.length > CHUNK_SIZE) {
        this.push(seal(pending.subarray(0, CHUNK_SIZE), false));
        pending = pending.subarray(CHUNK_SIZE);
      }

      callback();
    },

    /**
     * Seals the last chunk - empty for an empty input.
     *
     * @param callback - Called when done.
     */
    flush(callback: TransformCallback): void {
      if (!isHeaderWritten) {
        this.push(header.bytes);
        isHeaderWritten = true;
      }

      this.push(seal(pending, true));
      callback();
    },
  });
}

/**
 * A stream that opens an archive and yields its plain text.
 *
 * @param keyFor - The backup key for a key id, or null when this installation does not have it.
 * @returns The transform: the archive in, plain text out. It fails on any chunk that does not
 * open, and at the end when the archive was cut short.
 */
export function createDecryptStream(keyFor: (keyId: string) => Buffer | null): Transform {
  let pending = Buffer.alloc(0);
  let header: ParsedHeader | null = null;
  let key: Buffer | null = null;
  let index = 0;

  /**
   * Opens one chunk.
   *
   * @param sealed - The chunk with its tag.
   * @param isLast - Whether it is taken as the last.
   * @returns Its plain text.
   * @throws {Error} When it does not open: damaged, cut short, or another key.
   */
  const open = (sealed: Buffer, isLast: boolean): Buffer => {
    if (header === null || key === null || sealed.length < TAG_LENGTH) {
      throw new Error('The backup is damaged');
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      nonceOf(header.noncePrefix, index, isLast),
    );

    decipher.setAAD(header.bytes);
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG_LENGTH));
    index += 1;

    try {
      return Buffer.concat([
        decipher.update(sealed.subarray(0, sealed.length - TAG_LENGTH)),
        decipher.final(),
      ]);
    } catch {
      throw new Error(
        isLast
          ? 'The backup is damaged or cut short'
          : 'The backup is damaged, or was not made with this key',
      );
    }
  };

  return new Transform({
    /**
     * Opens every whole chunk but the last seen.
     *
     * @param data - Archive bytes.
     * @param encoding - Unused: bytes.
     * @param callback - Called when done, or with the failure.
     */
    transform(data: Buffer, encoding: BufferEncoding, callback: TransformCallback): void {
      try {
        pending = Buffer.concat([pending, data]);

        if (header === null) {
          header = parseHeader(pending);

          if (header === null) {
            callback();

            return;
          }

          const found = keyFor(header.keyId);

          if (found === null) {
            throw new Error('The backup was made with another key');
          }

          key = fileKeyOf(found, header.salt);
          pending = pending.subarray(header.bytes.length);
        }

        const sealedSize = header.chunkSize + TAG_LENGTH;

        while (pending.length > sealedSize) {
          this.push(open(pending.subarray(0, sealedSize), false));
          pending = pending.subarray(sealedSize);
        }

        callback();
      } catch (error: unknown) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },

    /**
     * Opens the last chunk.
     *
     * @param callback - Called when done, or with the failure.
     */
    flush(callback: TransformCallback): void {
      try {
        if (header === null) {
          throw new Error('The backup is cut short before its header ends');
        }

        this.push(open(pending, true));
        callback();
      } catch (error: unknown) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
  });
}
