import { inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { encodePalettedPng } from './png.js';

/**
 * The chunks of a PNG, by type.
 *
 * @param png - The PNG.
 * @returns Each chunk's data.
 */
function chunksOf(png: Buffer): Map<string, Buffer> {
  const chunks = new Map<string, Buffer>();
  let offset = 8;

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);

    chunks.set(type, png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }

  return chunks;
}

describe('encodePalettedPng', () => {
  it('writes a PNG of the palette and the pixels, unknown cells transparent', () => {
    const png = encodePalettedPng({
      width: 3,
      height: 2,
      palette: [
        [0, 0, 0, 0],
        [200, 220, 240],
        [40, 40, 60],
      ],
      pixels: Uint8Array.from([0, 1, 2, 2, 1, 0]),
    });
    const chunks = chunksOf(png);

    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(chunks.get('IHDR')?.readUInt32BE(0)).toBe(3);
    expect(chunks.get('IHDR')?.readUInt32BE(4)).toBe(2);
    expect([...(chunks.get('PLTE') ?? [])]).toEqual([0, 0, 0, 200, 220, 240, 40, 40, 60]);
    expect([...(chunks.get('tRNS') ?? [])]).toEqual([0]);
    expect([...inflateSync(chunks.get('IDAT') ?? Buffer.alloc(0))]).toEqual([
      0, 0, 1, 2, 0, 2, 1, 0,
    ]);
    expect(chunks.has('IEND')).toBe(true);
  });

  it('writes no transparency when every colour is opaque', () => {
    const png = encodePalettedPng({
      width: 1,
      height: 1,
      palette: [[1, 2, 3]],
      pixels: Uint8Array.from([0]),
    });

    expect(chunksOf(png).has('tRNS')).toBe(false);
  });

  it('refuses pixels that do not fill the size', () => {
    expect(() =>
      encodePalettedPng({
        width: 2,
        height: 2,
        palette: [[0, 0, 0]],
        pixels: Uint8Array.from([0]),
      }),
    ).toThrow('is 4 pixels');
  });
});
