/**
 * The build's assets compressed ahead of time: a `.br` and a `.gz` beside each script, stylesheet
 * and the like, which the proxy sends as they are (`apps/proxy/src/server.ts`, `preCompressed`).
 *
 * Done once at build time at the strongest settings rather than by the proxy on every load: a hub
 * behind a certificate the browser does not trust is a browser that keeps nothing, so every page
 * load would compress the whole app again.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

/** The files worth compressing: text, and WebAssembly. Images and fonts are compressed already. */
const COMPRESSIBLE = /\.(?:js|mjs|css|svg|json|wasm)$/u;

/** Brotli, as a promise. */
const toBrotli = promisify(brotliCompress);

/** Gzip, as a promise. */
const toGzip = promisify(gzip);

/**
 * Writes one compressed twin beside a file, when it is smaller than the file.
 *
 * @param file - The file's path.
 * @param size - The file's size, in bytes.
 * @param twin - The twin's bytes.
 * @param extension - The twin's extension: `.br` or `.gz`.
 * @returns Whether it was written.
 */
async function writeTwin(
  file: string,
  size: number,
  twin: Buffer,
  extension: string,
): Promise<boolean> {
  if (twin.length >= size) {
    return false;
  }

  await writeFile(`${file}${extension}`, twin);

  return true;
}

/**
 * Compresses every compressible file of a folder, its subfolders included, into a `.br`
 * (quality 11) and a `.gz` (level 9) beside it. A twin that would not be smaller is not written:
 * the proxy then sends the file and compresses it itself, as for any other.
 *
 * @param folder - The folder, the build's `dist/assets`.
 * @returns How many twins were written.
 */
export async function precompressFolder(folder: string): Promise<number> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && COMPRESSIBLE.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));

  const written = await Promise.all(
    files.map(async (file) => {
      const content = await readFile(file);
      const [brotli, gzipped] = await Promise.all([
        toBrotli(content, {
          params: {
            [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
            [constants.BROTLI_PARAM_SIZE_HINT]: content.length,
          },
        }),
        toGzip(content, { level: constants.Z_BEST_COMPRESSION }),
      ]);
      const twins = await Promise.all([
        writeTwin(file, content.length, brotli, '.br'),
        writeTwin(file, content.length, gzipped, '.gz'),
      ]);

      return twins.filter(Boolean).length;
    }),
  );

  return written.reduce((sum, count) => sum + count, 0);
}
