// @ts-check
/**
 * A Bambu Lab printer's chamber camera, read over the LAN with the access code.
 *
 * Every Bambu printer has one; how it sends the picture depends on the family:
 *
 * - **RTSP over TLS**, port 322, H.264 - the X1 family, the H2 family, the P2S and the X2D. The
 *   printer only serves it with "LAN Mode Liveview" on (Settings → Network on the printer); off,
 *   it reports `ipcam.rtsp_url` as `"disable"` and the profile says the camera is not streaming.
 * - **JPEG stills over TLS**, port 6000, about one a second - the P1 and A1 families and the
 *   A2L, which have no RTSP server. The protocol is Bambu's own: an 80-byte greeting with the
 *   access code, then each picture behind a 16-byte header whose first bytes are its length.
 *
 * Both are reached at the host of the instance's `mqtts://` address, with the user `bblp` and
 * the access code the MQTT session already uses, and both behind a certificate the printer signed
 * itself - checked against nothing, as the MQTT session is (see the README). Nothing here decodes:
 * the frames go to the browser as they came.
 */
import { connect as connectTls } from 'node:tls';

/** @typedef {import('@nebula-home/package-runtime').BundleSdk} BundleSdk */
/** @typedef {import('@nebula-home/package-runtime').StreamSource} StreamSource */
/** @typedef {import('@nebula-home/package-runtime').StreamSink} StreamSink */

/** The one user a Bambu printer lets in. */
const USER = 'bblp';

/** Where the RTSP server listens, and the path of its only stream. */
const RTSP_PORT = 322;
const RTSP_PATH = '/streaming/live/1';

/** Where the still camera of a P1, an A1 or an A2L listens. */
const STILL_PORT = 6000;

/** The size of the greeting and of the header before each picture. */
const GREETING_BYTES = 80;
const HEADER_BYTES = 16;

/** How many bytes the user and the access code are each padded to in the greeting. */
const NAME_BYTES = 32;

/** The largest picture believed; a length past it is a stream out of step, not a picture. */
const STILL_MAXIMUM_BYTES = 4 * 1024 * 1024;

/** How long the still camera may go without a picture before the stream is called dead. */
const STILL_SILENCE_MS = 20_000;

/** How a JPEG starts and ends. */
const JPEG_START = [0xff, 0xd8];
const JPEG_END = [0xff, 0xd9];

/**
 * The printer's instance settings this reads: the broker's address and the access code.
 *
 * @typedef {object} Config
 * @property {string} url - `mqtts://<printer>:8883`.
 * @property {string} password - The access code.
 */

/**
 * The greeting the still camera waits for: two words, eight zero bytes, then the user and the
 * access code, each zero-padded to 32 bytes.
 *
 * @param {string} accessCode - The printer's access code.
 * @returns {Buffer} The 80 bytes.
 */
export function stillGreeting(accessCode) {
  const greeting = Buffer.alloc(GREETING_BYTES);

  greeting.writeUInt32LE(0x40, 0);
  greeting.writeUInt32LE(0x3000, 4);
  greeting.write(USER, HEADER_BYTES, NAME_BYTES, 'ascii');
  greeting.write(accessCode, HEADER_BYTES + NAME_BYTES, NAME_BYTES, 'ascii');

  return greeting;
}

/**
 * Cuts the pictures out of what the still camera sent so far.
 *
 * Each picture is a 16-byte header, whose first three bytes are its length, little-endian, and
 * then the JPEG. What is left over - a picture not complete yet - is handed back to be kept.
 *
 * @param {Buffer} buffer - What arrived and was not cut yet.
 * @returns {{ readonly pictures: readonly Buffer[]; readonly rest: Buffer }} The whole pictures,
 *   and what is left.
 * @throws {Error} When a header names a length no picture has: the stream is out of step.
 */
export function cutStills(buffer) {
  /** @type {Buffer[]} */
  const pictures = [];
  let at = 0;

  while (buffer.length - at >= HEADER_BYTES) {
    const size = buffer.readUIntLE(at, 3);

    if (size === 0 || size > STILL_MAXIMUM_BYTES) {
      throw new Error(`the camera announced a picture of ${String(size)} bytes`);
    }

    if (buffer.length - at < HEADER_BYTES + size) {
      break;
    }

    const picture = buffer.subarray(at + HEADER_BYTES, at + HEADER_BYTES + size);

    at += HEADER_BYTES + size;

    if (isJpeg(picture)) {
      pictures.push(Buffer.from(picture));
    }
  }

  return { pictures, rest: buffer.subarray(at) };
}

/**
 * Whether bytes are a whole JPEG: the start-of-image marker first, end-of-image last.
 *
 * @param {Buffer} bytes - The bytes.
 * @returns {boolean} True for a whole one.
 */
function isJpeg(bytes) {
  return (
    bytes.length > 4 &&
    bytes[0] === JPEG_START[0] &&
    bytes[1] === JPEG_START[1] &&
    bytes.at(-2) === JPEG_END[0] &&
    bytes.at(-1) === JPEG_END[1]
  );
}

/**
 * Reads the still camera until the signal ends it or the printer does.
 *
 * @param {string} host - The printer.
 * @param {number} port - Its still camera's port.
 * @param {string} accessCode - Its access code.
 * @param {StreamSink} sink - Where the pictures go.
 * @param {AbortSignal} signal - Ends the stream.
 * @returns {Promise<void>} Settles when the stream ended; rejects with why, when it failed.
 */
function readStills(host, port, accessCode, sink, signal) {
  return new Promise((resolve, reject) => {
    const socket = connectTls({
      host,
      port,
      rejectUnauthorized: false,
      // The printer's TLS stack stops at 1.2 and hangs on a 1.3 hello.
      maxVersion: 'TLSv1.2',
    });
    const startedMs = Date.now();
    /** @type {Buffer} */
    let buffer = Buffer.alloc(0);
    let hasPicture = false;
    let isDone = false;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let silence;

    /** Starts the silence clock again. */
    const heard = () => {
      clearTimeout(silence);
      silence = setTimeout(() => {
        finish(
          new Error(
            hasPicture
              ? `the camera sent nothing for ${String(STILL_SILENCE_MS / 1000)} s`
              : 'the camera sent no picture - check the access code',
          ),
        );
      }, STILL_SILENCE_MS);
    };

    /**
     * Ends once, closing the socket.
     *
     * @param {Error} [error] - Why, when it failed.
     */
    const finish = (error) => {
      if (isDone) {
        return;
      }

      isDone = true;
      clearTimeout(silence);
      signal.removeEventListener('abort', stop);
      socket.destroy();

      if (error === undefined || signal.aborted) {
        resolve();
      } else {
        reject(error);
      }
    };

    /** Ends the stream because it is no longer wanted. */
    const stop = () => {
      finish();
    };

    if (signal.aborted) {
      finish();

      return;
    }

    signal.addEventListener('abort', stop, { once: true });
    heard();

    socket.once('secureConnect', () => {
      socket.write(stillGreeting(accessCode));
    });
    socket.on('data', (/** @type {Buffer} */ chunk) => {
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);

      try {
        const { pictures, rest } = cutStills(buffer);

        buffer = rest;

        for (const picture of pictures) {
          if (!hasPicture) {
            hasPicture = true;
            sink.describe({ kind: 'jpeg' });
          }

          heard();
          sink.frame({
            data: picture,
            isKey: true,
            timestampUs: (Date.now() - startedMs) * 1000,
          });
        }
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.on('error', (error) => {
      finish(new Error(`the camera did not answer on port ${String(port)}: ${error.message}`));
    });
    socket.on('close', () => {
      finish(
        new Error(
          hasPicture
            ? 'the printer closed the camera'
            : 'the printer closed the camera before a picture - check the access code',
        ),
      );
    });
  });
}

/**
 * Reads the RTSP stream until the signal ends it or the printer does.
 *
 * @param {BundleSdk} sdk - For the RTSP client.
 * @param {string} host - The printer.
 * @param {number} port - Its RTSP server's port.
 * @param {string} accessCode - Its access code.
 * @param {StreamSink} sink - Where the video goes.
 * @param {AbortSignal} signal - Ends the stream.
 * @returns {Promise<void>} Settles when the stream ended.
 * @throws {Error} When the printer refused or the session failed.
 */
async function readVideo(sdk, host, port, accessCode, sink, signal) {
  const url = `rtsps://${USER}:${encodeURIComponent(accessCode)}@${host}:${String(port)}${RTSP_PATH}`;
  let isDescribed = false;

  try {
    for await (const frame of sdk.openRtsp({ url, rejectUnauthorized: false, signal })) {
      if (!isDescribed) {
        isDescribed = true;
        sink.describe({ kind: 'h264', codec: frame.codec });
      }

      sink.frame({ data: frame.data, isKey: frame.isKey, timestampUs: frame.timestampUs });
    }
  } catch (error) {
    if (signal.aborted) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);

    throw new Error(
      /ECONNREFUSED/u.test(message)
        ? `nothing listens on port ${String(port)} - turn on LAN Mode Liveview on the printer`
        : message,
      { cause: error },
    );
  }
}

/**
 * Makes the stream source.
 *
 * @param {BundleSdk} sdk - What the hub hands a bundle.
 * @returns {StreamSource} The source, registered as `bambu-lab/camera`.
 */
export default function createBambuCamera(sdk) {
  const { z } = sdk;
  const argsSchema = z.object({
    kind: z.enum(['rtsp', 'chamber-image']),
    port: z.int().min(1).max(65_535).optional(),
  });

  return sdk.defineStreamSource({
    id: 'bambu-lab/camera',
    configSchema: z.object({
      url: z.string().regex(/^mqtts:\/\/[^/ ]+$/u),
      password: z.string().min(1).max(64),
    }),

    /**
     * Reads the camera the way its family sends it.
     *
     * @param {Config} config - The printer's address and access code.
     * @param {import('@nebula-home/contracts').JsonObject} args - `kind`, and a `port` when not
     *   the usual one.
     * @param {StreamSink} sink - Where the track and the frames go.
     * @param {AbortSignal} signal - Ends the stream.
     * @returns {Promise<void>} Settles when the stream ended.
     */
    open: async (config, args, sink, signal) => {
      const { kind, port } = argsSchema.parse(args);
      const host = new URL(config.url).hostname;

      if (kind === 'rtsp') {
        await readVideo(sdk, host, port ?? RTSP_PORT, config.password, sink, signal);
      } else {
        await readStills(host, port ?? STILL_PORT, config.password, sink, signal);
      }
    },
  });
}
