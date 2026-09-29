import { describe, expect, it } from 'vitest';

import { decodeLzma } from './lzma.js';

/**
 * Streams made by Python's `lzma.compress(data, format=lzma.FORMAT_ALONE)` - liblzma, the reference
 * encoder - of the texts below, in base64: its size unknown, ended by the end marker.
 */
const PACKED = {
  hello: 'XQAAgAD//////////wA0GUnuje+MhzIBsLm+r5pWvN///7feAAA=',
  empty: 'XQAAgAD//////////wCD//v//8AAAAA=',
  repeat: 'XQAAgAD//////////wAwmIitSzcSozGF3fpTBO3r30K4EvMf6piugQEUij687///fhwAAA==',
  grid: 'XQAAgAD//////////wAAb/3//6O3aZHtzg7v+JWKh2AbitzWBmhTpK0zVEc53iOMbl0UEJdKyNSKoryBtArGcuKr//+U5AAA',
};

/**
 * A map's piece as ECOVACS draws one: 100 by 100 cells, unknown along two edges, a wall, floor.
 *
 * @returns The cells.
 */
function grid(): Buffer {
  const cells = Buffer.alloc(100 * 100);

  for (let y = 0; y < 100; y += 1) {
    for (let x = 0; x < 100; x += 1) {
      cells[y * 100 + x] = x < 10 || y < 10 ? 0 : x === 10 || y === 10 ? 2 : 1;
    }
  }

  return cells;
}

/**
 * A stream with its size said in the header, as some encoders write it: the same stream, the
 * eight bytes of size filled in.
 *
 * @param packed - A stream of unknown size.
 * @param size - What it unpacks to.
 * @returns The stream, its size known.
 */
function withSize(packed: Buffer, size: number): Buffer {
  const copy = Buffer.from(packed);

  copy.writeUInt32LE(size, 5);
  copy.writeUInt32LE(0, 9);

  return copy;
}

describe('decodeLzma', () => {
  it('unpacks what liblzma packed: text, nothing, repeats and a map', () => {
    expect(decodeLzma(Buffer.from(PACKED.hello, 'base64')).toString()).toBe(
      'hello, hello, hello world',
    );
    expect(decodeLzma(Buffer.from(PACKED.empty, 'base64'))).toHaveLength(0);
    expect(decodeLzma(Buffer.from(PACKED.repeat, 'base64')).toString()).toBe(
      'abcabcabcabc'.repeat(400),
    );
    expect(decodeLzma(Buffer.from(PACKED.grid, 'base64')).equals(grid())).toBe(true);
  });

  it('stops at the size the header says', () => {
    const packed = Buffer.from(PACKED.hello, 'base64');

    expect(decodeLzma(withSize(packed, 25)).toString()).toBe('hello, hello, hello world');
    expect(decodeLzma(withSize(packed, 5)).toString()).toBe('hello');
  });

  it('refuses a stream that is too short, or not LZMA', () => {
    expect(() => decodeLzma(Buffer.alloc(4))).toThrow('shorter than its header');
    expect(() => decodeLzma(Buffer.from([0xff, ...Buffer.alloc(20)]))).toThrow('not LZMA');

    const packed = Buffer.from(PACKED.grid, 'base64');

    expect(() => decodeLzma(packed.subarray(0, 40))).toThrow('corrupt');
  });
});
