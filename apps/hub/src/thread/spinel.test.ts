import { describe, expect, it } from 'vitest';

import type { SerialSession } from '@nebulahome/package-runtime';

import {
  encodeHdlc,
  fcs16,
  hdlcReader,
  NCP_VERSION_QUESTION,
  ncpVersionOf,
  probeRcp,
} from './spinel.js';

/**
 * The radio's answer: `PROP_VALUE_IS NCP_VERSION` with the version, NUL-terminated.
 *
 * @param version - What it says.
 * @returns The frame, framed.
 */
function answer(version: string): Uint8Array {
  return encodeHdlc(Uint8Array.from([0x81, 0x06, 0x02, ...Buffer.from(version), 0]));
}

/**
 * A port that answers each write with what a test says.
 *
 * @param reply - What the device answers a write with; null for nothing.
 * @returns The session, and what was written.
 */
function port(reply: (bytes: Uint8Array) => Uint8Array | null) {
  const listeners = new Set<(bytes: Uint8Array) => void>();
  const written: Uint8Array[] = [];
  const session: SerialSession = {
    write: async (bytes) => {
      written.push(bytes);

      const said = reply(bytes);

      if (said !== null) {
        setImmediate(() => {
          for (const listener of listeners) {
            listener(said);
          }
        });
      }

      return Promise.resolve();
    },
    onData: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    onClose: () => () => undefined,
    close: async () => Promise.resolve(),
  };

  return { session, written, listeners };
}

describe('HDLC-lite', () => {
  it('computes the PPP FCS', () => {
    // The CRC-16/X-25 check value.
    expect(fcs16(Buffer.from('123456789'))).toBe(0x906e);
  });

  it('frames the version question with flags, escapes nothing it need not, and closes with the FCS', () => {
    const fcs = fcs16(Uint8Array.from([0x81, 0x02, 0x02]));

    expect([...NCP_VERSION_QUESTION]).toEqual([
      0x7e,
      0x81,
      0x02,
      0x02,
      fcs & 0xff,
      fcs >>> 8,
      0x7e,
    ]);
  });

  it('escapes the special bytes, and reads them back across chunks', () => {
    const payload = Uint8Array.from([0x7e, 0x7d, 0x11, 0x13, 0xf8, 0x42]);
    const framed = encodeHdlc(payload);
    const read = hdlcReader();

    expect(framed.slice(1, 3)).toEqual(Uint8Array.from([0x7d, 0x5e]));
    expect(read(framed.subarray(0, 5))).toEqual([]);
    expect(read(framed.subarray(5))).toEqual([payload]);
  });

  it('drops a frame whose FCS is wrong', () => {
    const framed = encodeHdlc(Uint8Array.from([1, 2, 3]));

    framed[2] = 9;

    expect(hdlcReader()(framed)).toEqual([]);
  });
});

describe('ncpVersionOf', () => {
  it('reads the version out of the answer, on any transaction', () => {
    expect(
      ncpVersionOf(Uint8Array.from([0x80, 0x06, 0x02, ...Buffer.from('OPENTHREAD/1.4'), 0])),
    ).toBe('OPENTHREAD/1.4');
  });

  it('ignores any other frame: a reset notice, another property', () => {
    expect(ncpVersionOf(Uint8Array.from([0x80, 0x06, 0x00, 0x72]))).toBeNull();
    expect(ncpVersionOf(Uint8Array.from([0x81, 0x06, 0x03, 0x41, 0]))).toBeNull();
    expect(ncpVersionOf(Uint8Array.from([0x41, 0x06, 0x02, 0x41, 0]))).toBeNull();
  });
});

describe('probeRcp', () => {
  it('asks an OpenThread RCP its version', async () => {
    const { session, written, listeners } = port(() => answer('SL-OPENTHREAD/2.4.4.0; EFR32'));

    await expect(probeRcp(session, 1000)).resolves.toBe('SL-OPENTHREAD/2.4.4.0; EFR32');
    expect(written[0]).toEqual(NCP_VERSION_QUESTION);
    expect(listeners.size).toBe(0);
  });

  it('says null for a radio that speaks no Spinel, as a Zigbee coordinator', async () => {
    // EZSP's RST frame, unasked: not HDLC-lite with a good FCS.
    const { session } = port(() => Uint8Array.from([0x1a, 0xc0, 0x38, 0xbc, 0x7e]));

    await expect(probeRcp(session, 50)).resolves.toBeNull();
  });

  it('fails when the port will not take the question', async () => {
    const { session } = port(() => null);

    await expect(
      probeRcp({ ...session, write: async () => Promise.reject(new Error('Port closed')) }, 1000),
    ).rejects.toThrow('Port closed');
  });
});
