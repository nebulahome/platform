/**
 * A location on an FTP server, plain or over TLS.
 *
 * One control connection for the session. A header is read on a connection of its own and cut
 * off after the bytes it needs: FTP has no way to ask for the start of a file only, and closing
 * the transfer early leaves a control connection in no state to be used again.
 */
import { randomUUID } from 'node:crypto';
import { PassThrough, Readable, Writable } from 'node:stream';

import { Client } from 'basic-ftp';

import { parseArchiveName, partialNameOf } from '../domain/archive-name.js';

import { joinRemote, type ArchiveFile, type LocationSession } from './session.js';

/** An FTP location's settings, with its password in clear. */
export type FtpTarget = {
  readonly host: string;
  readonly port: number | null;
  readonly security: 'none' | 'explicit' | 'implicit';
  readonly allowSelfSigned: boolean;
  readonly path: string;
  readonly username: string;
  readonly password: string;
};

/**
 * Connects and logs in.
 *
 * @param target - Where and who.
 * @param timeoutMs - How long any step may take.
 * @returns The client.
 */
async function connect(target: FtpTarget, timeoutMs: number): Promise<Client> {
  const client = new Client(timeoutMs);

  await client.access({
    host: target.host,
    port: target.port ?? (target.security === 'implicit' ? 990 : 21),
    user: target.username === '' ? 'anonymous' : target.username,
    password: target.password === '' ? 'anonymous@' : target.password,
    secure: target.security === 'none' ? false : target.security === 'implicit' ? 'implicit' : true,
    secureOptions: { rejectUnauthorized: !target.allowSelfSigned, servername: target.host },
  });

  return client;
}

/**
 * Opens an FTP location, making its folder when it is not there.
 *
 * @param target - Where and who.
 * @param timeoutMs - How long any step may take.
 * @returns The session.
 */
export async function openFtp(target: FtpTarget, timeoutMs: number): Promise<LocationSession> {
  const client = await connect(target, timeoutMs);
  const folder = `/${joinRemote(target.path)}`;

  try {
    await client.ensureDir(folder);
  } catch (error: unknown) {
    client.close();

    throw error;
  }

  /**
   * A file's path on the server.
   *
   * @param name - The file.
   * @returns Its path in the location's folder.
   */
  const remote = (name: string): string => `${folder === '/' ? '' : folder}/${name}`;

  /**
   * The archives on the server.
   *
   * @returns Each archive's name and size.
   */
  const list = async (): Promise<ArchiveFile[]> =>
    (await client.list(folder))
      .filter((entry) => entry.isFile && parseArchiveName(entry.name) !== null)
      .map((entry) => ({ name: entry.name, bytes: entry.size }));

  /**
   * Uploads an archive under a hidden name, and renames it when whole.
   *
   * @param name - Its name.
   * @param source - Its bytes.
   * @param signal - Stops the upload, by closing the connection.
   * @returns Its size, as the server lists it.
   */
  const write = async (name: string, source: Readable, signal?: AbortSignal): Promise<number> => {
    const partial = remote(partialNameOf(name));

    /** Closes the connection, which is how an upload is stopped. */
    const onAbort = (): void => {
      client.close();
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      await client.uploadFrom(source, partial);
      await client.rename(partial, remote(name));
    } catch (error: unknown) {
      await client.remove(partial, true).catch(() => undefined);

      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }

    const found = (await client.list(folder)).find((entry) => entry.name === name);

    return found?.size ?? 0;
  };

  /**
   * Downloads an archive, or its first bytes on a connection of its own.
   *
   * @param name - Its name.
   * @param limit - How many bytes; all of them when absent.
   * @returns The bytes.
   */
  const read = async (name: string, limit?: number): Promise<Readable> => {
    const output = new PassThrough();

    if (limit === undefined) {
      // The session's own connection: the whole file, for a restore.
      void client.downloadTo(output, remote(name)).catch((error: unknown) => {
        output.destroy(error instanceof Error ? error : new Error(String(error)));
      });

      return output;
    }

    // A connection of its own, cut off once the header is in.
    const reader = await connect(target, timeoutMs);
    let received = 0;
    const sink = new Writable({
      /**
       * Keeps what is needed, and stops the transfer after.
       *
       * @param chunk - A piece of the file.
       * @param encoding - Unused: bytes.
       * @param callback - Called when done.
       */
      write(chunk: Buffer, encoding, callback): void {
        const wanted = Math.max(0, limit - received);

        if (wanted > 0) {
          output.write(chunk.subarray(0, wanted));
        }

        received += chunk.length;

        if (received >= limit) {
          output.end();
          reader.close();
        }

        callback();
      },
    });

    void reader
      .downloadTo(sink, remote(name))
      .catch(() => {
        // Closing the connection mid-transfer is how the read stops: not an error.
      })
      .finally(() => {
        output.end();
        reader.close();
      });

    return output;
  };

  /**
   * Removes an archive; nothing else.
   *
   * @param name - Its name.
   */
  const remove = async (name: string): Promise<void> => {
    if (parseArchiveName(name) === null) {
      throw new Error(`Not an archive: ${name}`);
    }

    await client.remove(remote(name));
  };

  /** Uploads a small file and removes it. */
  const probe = async (): Promise<void> => {
    const file = remote(`.nebulahome-probe-${randomUUID()}`);

    await client.uploadFrom(Readable.from(['NebulaHome checks it can write here.\n']), file);
    await client.remove(file);
  };

  /**
   * FTP has no way to ask for the room left.
   *
   * @returns Null.
   */
  const freeBytes = async (): Promise<number | null> => Promise.resolve(null);

  /**
   * Disconnects.
   *
   * @returns Once disconnected.
   */
  const close = async (): Promise<void> => {
    client.close();

    return Promise.resolve();
  };

  return { list, write, read, remove, probe, freeBytes, close };
}
