/**
 * A PNG encoder for pictures of a palette: a robot's map, where each cell is floor, wall, carpet
 * or unknown, drawn in a handful of colours.
 *
 * A bundle drawing a map has the cells and wants a picture it can put under the rooms and the path
 * of an SVG, and carries no dependencies of its own: the SDK hands it this (`sdk.images.png`). One
 * byte per pixel, an index into the palette, each row unfiltered and the whole deflated by
 * `node:zlib`: a floor plan of a few colours comes out at a few kilobytes. A colour with an alpha
 * below 255 is written in a `tRNS` chunk, so unknown cells can be transparent.
 */
import { crc32, deflateSync } from 'node:zlib';

/** The eight bytes every PNG starts with. */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The largest side drawn: a map is 800 cells across at most. */
const MAXIMUM_SIDE = 4096;

/** One colour of the palette: red, green, blue and, optionally, how opaque, each 0 to 255. */
export type PaletteColour =
  readonly [number, number, number] | readonly [number, number, number, number];

/** What a paletted picture is. */
export type PalettedPicture = {
  readonly width: number;
  readonly height: number;

  /** At most 256 colours. */
  readonly palette: readonly PaletteColour[];

  /** One index into the palette per pixel, row after row from the top left. */
  readonly pixels: Uint8Array;
};

/**
 * One chunk: its length, type, data and the CRC of the last two.
 *
 * @param type - Four letters.
 * @param data - What it holds.
 * @returns The chunk.
 */
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);

  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');

  const tail = Buffer.alloc(4);

  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);

  return Buffer.concat([head, data, tail]);
}

/**
 * Encodes a paletted picture as a PNG.
 *
 * @param picture - Its size, palette and pixels.
 * @returns The PNG's bytes.
 * @throws {Error} When the size, the palette or the pixels do not fit together.
 */
export function encodePalettedPng(picture: PalettedPicture): Buffer {
  const { width, height, palette, pixels } = picture;

  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAXIMUM_SIDE ||
    height > MAXIMUM_SIDE
  ) {
    throw new Error(
      `A picture is 1 to ${String(MAXIMUM_SIDE)} pixels a side, not ${String(width)} by ${String(height)}`,
    );
  }

  if (palette.length < 1 || palette.length > 256) {
    throw new Error('A palette has 1 to 256 colours');
  }

  if (pixels.length !== width * height) {
    throw new Error(
      `${String(width)} by ${String(height)} is ${String(width * height)} pixels, not ${String(pixels.length)}`,
    );
  }

  const header = Buffer.alloc(13);

  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per index
  header[9] = 3; // indexed colour
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const colours = Buffer.alloc(palette.length * 3);
  const alphas = Buffer.alloc(palette.length, 255);
  let lastTranslucent = -1;

  for (const [index, colour] of palette.entries()) {
    colours[index * 3] = colour[0];
    colours[index * 3 + 1] = colour[1];
    colours[index * 3 + 2] = colour[2];

    const alpha = colour[3] ?? 255;

    alphas[index] = alpha;

    if (alpha < 255) {
      lastTranslucent = index;
    }
  }

  // Each row is its filter byte - none - and then its indices.
  const rows = Buffer.alloc((width + 1) * height);

  for (let y = 0; y < height; y += 1) {
    rows[y * (width + 1)] = 0;

    for (let x = 0; x < width; x += 1) {
      const index = pixels[y * width + x] ?? 0;

      rows[y * (width + 1) + 1 + x] = index < palette.length ? index : 0;
    }
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('PLTE', colours),
    ...(lastTranslucent === -1 ? [] : [chunk('tRNS', alphas.subarray(0, lastTranslucent + 1))]),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
