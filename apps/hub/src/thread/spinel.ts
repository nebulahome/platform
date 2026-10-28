/**
 * Asking a Thread radio which firmware it runs, before the border router is given its port.
 *
 * An OpenThread RCP speaks Spinel framed as HDLC-lite: each frame between two `0x7E` flags, the
 * special bytes escaped, a 16-bit FCS (the PPP one) at its end. Asked for its `NCP_VERSION`
 * property it answers with a string such as `SL-OPENTHREAD/2.4.4.0_GitHub-…; EFR32; …`. A radio
 * flashed with Zigbee firmware (EZSP, ZNP) answers nothing of the kind, which is how one plugged
 * in by mistake is told apart before `otbr-agent` fails on it.
 */
import type { SerialSession } from '@nebulahome/package-runtime';

/** The flag between frames. */
const FLAG = 0x7e;

/** The byte before an escaped one. */
const ESCAPE = 0x7d;

/** What an escaped byte is XORed with. */
const ESCAPE_XOR = 0x20;

/** The bytes HDLC-lite escapes: the flag, the escape, XON, XOFF and the vendor's 0xF8. */
const SPECIAL = new Set([FLAG, ESCAPE, 0x11, 0x13, 0xf8]);

/** Spinel's header: a frame (flag bits `10`), interface 0, transaction 1. */
const HEADER = 0x81;

/** Spinel's commands and the property asked. */
const PROP_VALUE_GET = 0x02;
const PROP_VALUE_IS = 0x06;
const PROP_NCP_VERSION = 0x02;

/** How often the question is asked again while the radio says nothing. */
const ASK_EVERY_MS = 1000;

/**
 * The FCS HDLC-lite closes a frame with: CRC-16/X-25, as PPP has it.
 *
 * @param bytes - The frame's bytes, before escaping.
 * @returns The FCS.
 */
export function fcs16(bytes: Uint8Array): number {
  let fcs = 0xffff;

  for (const byte of bytes) {
    fcs ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      fcs = (fcs & 1) === 1 ? (fcs >>> 1) ^ 0x8408 : fcs >>> 1;
    }
  }

  return fcs ^ 0xffff;
}

/**
 * Frames bytes as HDLC-lite.
 *
 * @param payload - What the frame carries.
 * @returns The frame, flags included.
 */
export function encodeHdlc(payload: Uint8Array): Uint8Array {
  const fcs = fcs16(payload);
  const out = [FLAG];

  for (const byte of [...payload, fcs & 0xff, fcs >>> 8]) {
    if (SPECIAL.has(byte)) {
      out.push(ESCAPE, byte ^ ESCAPE_XOR);
    } else {
      out.push(byte);
    }
  }

  out.push(FLAG);

  return Uint8Array.from(out);
}

/**
 * Reads HDLC-lite frames out of chunks as a port hands them over.
 *
 * @returns A function taking each chunk and giving the frames it completed, FCS checked and
 * dropped; a frame whose FCS is wrong is left out.
 */
export function hdlcReader(): (chunk: Uint8Array) => Uint8Array[] {
  let frame: number[] = [];
  let isEscaped = false;

  return (chunk) => {
    const frames: Uint8Array[] = [];

    for (const byte of chunk) {
      if (byte === FLAG) {
        if (frame.length > 2) {
          const payload = Uint8Array.from(frame.slice(0, -2));
          const fcs = (frame.at(-2) ?? 0) | ((frame.at(-1) ?? 0) << 8);

          if (fcs16(payload) === fcs) {
            frames.push(payload);
          }
        }

        frame = [];
        isEscaped = false;
      } else if (byte === ESCAPE) {
        isEscaped = true;
      } else {
        frame.push(isEscaped ? byte ^ ESCAPE_XOR : byte);
        isEscaped = false;
      }
    }

    return frames;
  };
}

/** The question: `PROP_VALUE_GET NCP_VERSION`, framed. */
export const NCP_VERSION_QUESTION = encodeHdlc(
  Uint8Array.from([HEADER, PROP_VALUE_GET, PROP_NCP_VERSION]),
);

/**
 * The version a Spinel frame says, when it is the answer to the question.
 *
 * @param frame - A frame's payload.
 * @returns The version, or null for any other frame.
 */
export function ncpVersionOf(frame: Uint8Array): string | null {
  // Any interface and transaction: the radio may answer on the one it likes.
  if (
    frame.length < 4 ||
    (frame[0] ?? 0) >> 6 !== 2 ||
    frame[1] !== PROP_VALUE_IS ||
    frame[2] !== PROP_NCP_VERSION
  ) {
    return null;
  }

  const text = frame.subarray(3);
  const end = text.indexOf(0);

  return Buffer.from(end === -1 ? text : text.subarray(0, end))
    .toString('utf8')
    .trim()
    .slice(0, 256);
}

/**
 * Asks an open port for its RCP firmware's version, again every second until it answers or the
 * time is up.
 *
 * @param session - The port, open at the RCP's baud rate.
 * @param timeoutMs - How long it has to answer.
 * @returns The version, or null when nothing Spinel came back.
 */
export async function probeRcp(session: SerialSession, timeoutMs = 3000): Promise<string | null> {
  const read = hdlcReader();
  /**
   * Stops hearing the port; nothing until it is heard.
   *
   * @returns Nothing.
   */
  let stopHearing = (): void => undefined;
  let timer: NodeJS.Timeout | undefined;
  let asking: NodeJS.Timeout | undefined;

  try {
    return await new Promise<string | null>((resolve, reject) => {
      stopHearing = session.onData((chunk) => {
        for (const frame of read(chunk)) {
          const version = ncpVersionOf(frame);

          if (version !== null) {
            resolve(version);
          }
        }
      });
      timer = setTimeout(() => {
        resolve(null);
      }, timeoutMs);

      /** Asks once; a port that refuses ends the probe. */
      const ask = (): void => {
        session.write(NCP_VERSION_QUESTION).catch(reject);
      };

      ask();
      asking = setInterval(ask, ASK_EVERY_MS);
    });
  } finally {
    clearTimeout(timer);
    clearInterval(asking);
    stopHearing();
  }
}
