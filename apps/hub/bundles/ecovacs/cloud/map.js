// @ts-check
/**
 * A DEEBOT's map, drawn: the floor plan it scanned, its rooms with their names, the path it took
 * and where it and its station are - one SVG, which the vacuum's image entity shows.
 *
 * What the robot sends, as the DeebotUniverse client library observed it (GPL-3.0: only its facts
 * are used here, the code is this bundle's own):
 *
 * - **the floor plan** in 64 pieces of 100 × 100 cells, eight by eight. `getMajorMap` names each
 *   piece by a CRC of what it holds - one CRC for a piece with nothing in it - and `getMinorMap`
 *   sends one piece, packed with LZMA and written in base64. A cell is nothing, floor, wall or
 *   carpet, and 50 mm a side. Pieces are laid down the columns - the first eight make the first
 *   column - and each piece's cells column by column too;
 * - **the rooms**, each an outline of corners in millimetres (`getMapSubSet`), packed the same way
 *   when the robot says `compress`;
 * - **the path** (`getMapTrace`, pushed as `onMapTrace`): five bytes a point, two little-endian
 *   16-bit numbers in centimetres and a byte whose top bit says the point does not join the one
 *   before;
 * - **where the robot and its station are** (`getPos`, pushed as `onPos`), in millimetres;
 * - **the virtual walls and no-mop zones** set in the app: map sets of the types `vw` and `mw`, a
 *   wall two corners and a zone more, in millimetres - `getMapSet_V2` packs the list whole;
 * - **the outline** (`getMapInfo_V2`, pushed as `onMapInfo_V2`), from a robot that sends no pieces:
 *   packed JSON, a list of entries each led by its type - `"1"` the walls, lines of `x,y,t` points
 *   where a `t` of `3-1-0` starts a new line; `"2"` the rooms, `x,y` corners; each string's first
 *   field an id. In millimetres too.
 *
 * What is packed is packed with LZMA, the header short of four bytes of its size, or - on the
 * newest robots - with Zstandard, which says so in its first four bytes.
 *
 * Millimetres grow up the map and cells down the picture: a point is drawn at `x / 50 + 400`
 * across and `400 - y / 50` down. None of this was seen on a real robot yet, which is why it is
 * all here, in one place, to be put right against one.
 *
 * The floor plan becomes a PNG of a palette (`sdk.images.png`) cropped to what the robot saw, set
 * into the SVG; everything else is drawn over it, so a robot that moves costs a new SVG and not a
 * new picture. Pure but for the codecs it is handed.
 */

import * as zlib from 'node:zlib';

/** @typedef {import('./vacuum.js').VacuumMap} VacuumMap */
/** @typedef {import('@nebulahome/package-runtime').BundleSdk} BundleSdk */

/** How many cells a piece is a side. */
export const PIECE_CELLS = 100;

/** How many pieces the map is a side. */
export const PIECES_ACROSS = 8;

/** How many millimetres a cell is a side. */
export const CELL_MM = 50;

/** Where the map's origin is, in cells from the top left of the picture. */
export const ORIGIN_CELLS = (PIECE_CELLS * PIECES_ACROSS) / 2;

/** The CRC `getMajorMap` gives a piece with nothing in it. */
export const EMPTY_PIECE_CRC = '1295764014';

/** How many millimetres a unit of the path is. */
const TRACE_UNIT_MM = 10;

/** How many cells of margin are left around what the robot saw. */
const MARGIN_CELLS = 10;

/** The first four bytes of a Zstandard frame. */
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

/** The type of an outline entry that is the walls, and of one that is the rooms. */
const OUTLINE_WALLS = '1';
const OUTLINE_ROOMS = '2';

/** What a point of the walls says when it starts a new line rather than joining the last. */
const OUTLINE_BREAK = '3-1-0';

/** The walls of the outline, drawn over the floor. */
const WALL_STROKE = '#2f4a73';

/** The floor under the outline's rooms, for a robot that sends no pieces: the floor plan's. */
const OUTLINE_FLOOR = '#cddcf0';

/** A virtual wall, and a no-mop zone, as the app draws them. */
const BARRIER_COLOURS = { virtual: '#e5484d', no_mop: '#f2a33a' };

/**
 * The floor plan's colours, by what a cell holds: nothing (transparent), floor, wall, carpet.
 *
 * @type {ReadonlyArray<readonly [number, number, number, number]>}
 */
const PALETTE = [
  [0, 0, 0, 0],
  [205, 221, 240, 255],
  [47, 74, 115, 255],
  [170, 196, 228, 255],
];

/** The rooms' fills, one after another. */
const ROOM_FILLS = ['#6aa9ff', '#7ccf9a', '#f2b86b', '#c58af0', '#f08a8a', '#5fc7c9', '#d6c35a'];

/**
 * Unpacks what ECOVACS packs: base64 of an LZMA stream whose header lacks the upper half of its
 * size, which the alone format has eight bytes for - or, from the newest robots, of a Zstandard
 * frame.
 *
 * @param {string} value - The base64.
 * @param {(bytes: Uint8Array) => Buffer} lzma - `sdk.codecs.lzma`.
 * @returns {Buffer} What it holds.
 * @throws {Error} When it is not a packed stream.
 */
export function unpack(value, lzma) {
  const raw = Buffer.from(value, 'base64');

  if (raw.length >= 4 && ZSTD_MAGIC.every((byte, index) => raw[index] === byte)) {
    if (typeof zlib.zstdDecompressSync !== 'function') {
      throw new Error('This Node.js cannot unpack Zstandard');
    }

    return zlib.zstdDecompressSync(raw);
  }

  if (raw.length < 9) {
    throw new Error('Too short to be packed');
  }

  return lzma(Buffer.concat([raw.subarray(0, 9), Buffer.alloc(4), raw.subarray(9)]));
}

/**
 * One piece of the floor plan, unpacked: what each of its cells holds, column by column.
 *
 * @param {string} value - The piece as `getMinorMap` sends it.
 * @param {(bytes: Uint8Array) => Buffer} lzma - `sdk.codecs.lzma`.
 * @returns {Uint8Array} Ten thousand cells, each 0 to 3.
 * @throws {Error} When the piece is not one.
 */
export function pieceCellsOf(value, lzma) {
  const cells = unpack(value, lzma);

  if (cells.length < PIECE_CELLS * PIECE_CELLS) {
    throw new Error(
      `A piece is ${String(PIECE_CELLS * PIECE_CELLS)} cells, not ${String(cells.length)}`,
    );
  }

  return new Uint8Array(cells.subarray(0, PIECE_CELLS * PIECE_CELLS));
}

/**
 * The points of the path a trace carries, in millimetres, and whether each joins the one before.
 *
 * @param {string} value - `traceValue`, packed.
 * @param {(bytes: Uint8Array) => Buffer} lzma - `sdk.codecs.lzma`.
 * @returns {Array<[number, number, boolean]>} The points.
 */
export function tracePointsOf(value, lzma) {
  const bytes = unpack(value, lzma);

  /** @type {Array<[number, number, boolean]>} */
  const points = [];

  for (let offset = 0; offset + 5 <= bytes.length; offset += 5) {
    points.push([
      bytes.readInt16LE(offset) * TRACE_UNIT_MM,
      bytes.readInt16LE(offset + 2) * TRACE_UNIT_MM,
      ((bytes[offset + 4] ?? 0) & 0x80) === 0,
    ]);
  }

  return points;
}

/**
 * A room's data with its outline unpacked, for a robot that packs it (`compress: 1`).
 *
 * @param {unknown} data - `getMapSubSet`'s data.
 * @param {(bytes: Uint8Array) => Buffer} lzma - `sdk.codecs.lzma`.
 * @returns {unknown} The same data, its `value` the corners as text.
 */
export function unpackedSubset(data, lzma) {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return data;
  }

  const record = /** @type {Record<string, unknown>} */ (data);

  if (Number(record['compress']) !== 1 || typeof record['value'] !== 'string') {
    return data;
  }

  try {
    return { ...record, compress: 0, value: unpack(record['value'], lzma).toString('latin1') };
  } catch {
    return { ...record, value: '' };
  }
}

/**
 * A list of virtual walls or no-mop zones as `getMapSet_V2` sends it - the subsets packed, each an
 * array of its id and then its corners - as `getMapSet` would have: `{ type, subsets }`, each
 * subset its `mssid` and its corners as text.
 *
 * @param {unknown} data - `getMapSet_V2`'s data.
 * @param {'vw' | 'mw'} type - Which the list is of.
 * @param {(bytes: Uint8Array) => Buffer} lzma - `sdk.codecs.lzma`.
 * @returns {{ type: string; subsets: Array<{ mssid: string; value: string }> } | undefined} The
 *   list, or undefined when the data is none.
 */
export function barrierSetOf(data, type, lzma) {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return undefined;
  }

  const packed = /** @type {Record<string, unknown>} */ (data)['subsets'];
  let subsets = packed;

  if (typeof packed === 'string') {
    try {
      subsets = packed === '' ? [] : JSON.parse(unpack(packed, lzma).toString('utf8'));
    } catch {
      return undefined;
    }
  }

  if (!Array.isArray(subsets)) {
    return undefined;
  }

  return {
    type,
    subsets: subsets.flatMap((subset) => {
      if (!Array.isArray(subset) || subset.length < 5) {
        return [];
      }

      const [id, ...corners] = subset;

      return typeof id === 'string' || typeof id === 'number'
        ? [{ mssid: String(id), value: corners.join(',') }]
        : [];
    }),
  };
}

/**
 * What the outline a robot sent whole holds: its walls, lines of points, and its rooms, each
 * an area - in millimetres. Nothing for an outline that cannot be read.
 *
 * @param {string} value - The outline, packed, as `getMapInfo_V2` sends it.
 * @param {(bytes: Uint8Array) => Buffer} lzma - `sdk.codecs.lzma`.
 * @returns {{ walls: Array<Array<[number, number]>>; rooms: Array<Array<[number, number]>> }}
 *   The walls and the rooms.
 */
export function outlineShapesOf(value, lzma) {
  /** @type {Array<Array<[number, number]>>} */
  const walls = [];

  /** @type {Array<Array<[number, number]>>} */
  const rooms = [];
  let entries;

  try {
    entries = JSON.parse(unpack(value, lzma).toString('utf8'));
  } catch {
    return { walls, rooms };
  }

  if (!Array.isArray(entries)) {
    return { walls, rooms };
  }

  for (const entry of entries) {
    if (!Array.isArray(entry) || (entry[0] !== OUTLINE_WALLS && entry[0] !== OUTLINE_ROOMS)) {
      continue;
    }

    for (const text of entry.slice(1)) {
      if (typeof text !== 'string') {
        continue;
      }

      // The first field names the line or the room; the points follow.
      const fields = text.split(';').slice(1);

      if (entry[0] === OUTLINE_ROOMS) {
        const corners = fields
          .map((field) => field.split(',').slice(0, 2).map(Number))
          .filter((pair) => pair.length === 2 && pair.every((part) => Number.isFinite(part)))
          .map((pair) => /** @type {[number, number]} */ ([pair[0] ?? 0, pair[1] ?? 0]));

        if (corners.length >= 3) {
          rooms.push(corners);
        }

        continue;
      }

      /** @type {Array<[number, number]>} */
      let line = [];
      let first;
      let isFirstJoined = false;

      for (const field of fields) {
        const [x, y, joins] = field.split(',');
        const point = /** @type {[number, number]} */ ([Number(x), Number(y)]);

        if (!point.every((part) => Number.isFinite(part))) {
          continue;
        }

        const isJoined = joins?.trim() !== OUTLINE_BREAK;

        if (first === undefined) {
          first = point;
          isFirstJoined = isJoined;
        }

        if (!isJoined && line.length > 0) {
          walls.push(line);
          line = [];
        }

        line.push(point);
      }

      // A first point that joins another joins the last: the line goes round.
      if (first !== undefined && isFirstJoined) {
        line.push(first);
      }

      if (line.length >= 2) {
        walls.push(line);
      }
    }
  }

  return { walls, rooms };
}

/**
 * The pieces of the floor plan to ask for: those the robot says hold something and were not
 * received since.
 *
 * @param {VacuumMap} map - What is known of the map.
 * @returns {number[]} Their indices.
 */
export function piecesToAsk(map) {
  return map.pieceCrcs.flatMap((crc, index) =>
    crc !== null && crc !== '' && crc !== EMPTY_PIECE_CRC && map.pieces[String(index)] === undefined
      ? [index]
      : [],
  );
}

/**
 * Where a point in millimetres is on the picture, in cells.
 *
 * @param {number} x - Millimetres across.
 * @param {number} y - Millimetres up.
 * @returns {[number, number]} Cells across and down.
 */
export function cellOf(x, y) {
  return [x / CELL_MM + ORIGIN_CELLS, ORIGIN_CELLS - y / CELL_MM];
}

/**
 * A number, short: at most two decimals.
 *
 * @param {number} value - The number.
 * @returns {string} It.
 */
function short(value) {
  return String(Math.round(value * 100) / 100);
}

/**
 * Points as an SVG polygon or polyline lists them.
 *
 * @param {ReadonlyArray<readonly [number, number]>} cells - The points, in cells.
 * @returns {string} `x,y x,y …`.
 */
function pointsOf(cells) {
  return cells.map(([x, y]) => `${short(x)},${short(y)}`).join(' ');
}

/**
 * Text, safe inside an SVG.
 *
 * @param {string} text - The text.
 * @returns {string} It, escaped.
 */
function escaped(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * The whole floor plan, one cell a pixel, from the pieces received.
 *
 * @param {VacuumMap} map - What is known of the map.
 * @param {(bytes: Uint8Array) => Buffer} lzma - `sdk.codecs.lzma`.
 * @returns {{ cells: Uint8Array; side: number } | null} The cells, row after row, or null when no
 *   piece holds anything.
 */
function floorPlanOf(map, lzma) {
  const side = PIECE_CELLS * PIECES_ACROSS;
  const cells = new Uint8Array(side * side);
  let isAny = false;

  for (const [key, value] of Object.entries(map.pieces)) {
    const index = Number(key);

    if (!Number.isInteger(index) || index < 0 || index >= PIECES_ACROSS * PIECES_ACROSS) {
      continue;
    }

    let piece;

    try {
      piece = pieceCellsOf(value, lzma);
    } catch {
      continue;
    }

    // Down the columns: the first eight pieces are the first column.
    const left = Math.floor(index / PIECES_ACROSS) * PIECE_CELLS;
    const top = (index % PIECES_ACROSS) * PIECE_CELLS;

    for (let column = 0; column < PIECE_CELLS; column += 1) {
      for (let row = 0; row < PIECE_CELLS; row += 1) {
        const cell = piece[column * PIECE_CELLS + row] ?? 0;

        if (cell !== 0) {
          cells[(top + row) * side + left + column] = cell < PALETTE.length ? cell : 1;
          isAny = true;
        }
      }
    }
  }

  return isAny ? { cells, side } : null;
}

/**
 * The part of the picture worth drawing: what the robot saw, its rooms, and where it is.
 *
 * @param {Uint8Array | null} cells - The floor plan, when there is one.
 * @param {number} side - Its side.
 * @param {Array<[number, number]>} points - Everything else, in cells.
 * @returns {{ left: number; top: number; width: number; height: number } | null} The box, in
 *   cells, or null when there is nothing to draw.
 */
function boundsOf(cells, side, points) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  if (cells !== null) {
    for (let row = 0; row < side; row += 1) {
      for (let column = 0; column < side; column += 1) {
        if (cells[row * side + column] !== 0) {
          left = Math.min(left, column);
          right = Math.max(right, column + 1);
          top = Math.min(top, row);
          bottom = Math.max(bottom, row + 1);
        }
      }
    }
  }

  for (const [x, y] of points) {
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }

  if (!Number.isFinite(left)) {
    return null;
  }

  const boxLeft = Math.max(0, Math.floor(left) - MARGIN_CELLS);
  const boxTop = Math.max(0, Math.floor(top) - MARGIN_CELLS);

  return {
    left: boxLeft,
    top: boxTop,
    width: Math.max(20, Math.min(side, Math.ceil(right) + MARGIN_CELLS) - boxLeft),
    height: Math.max(20, Math.min(side, Math.ceil(bottom) + MARGIN_CELLS) - boxTop),
  };
}

/**
 * The floor plan cropped to a box, as a PNG in base64.
 *
 * @param {Uint8Array} cells - The floor plan.
 * @param {number} side - Its side.
 * @param {{ left: number; top: number; width: number; height: number }} box - The box.
 * @param {BundleSdk['images']['png']} png - `sdk.images.png`.
 * @returns {string} The PNG, in base64.
 */
function croppedPng(cells, side, box, png) {
  const width = Math.min(box.width, side - box.left);
  const height = Math.min(box.height, side - box.top);
  const pixels = new Uint8Array(width * height);

  for (let row = 0; row < height; row += 1) {
    pixels.set(
      cells.subarray((box.top + row) * side + box.left, (box.top + row) * side + box.left + width),
      row * width,
    );
  }

  return png({ width, height, palette: PALETTE, pixels }).toString('base64');
}

/**
 * The middle of an outline, where its name goes.
 *
 * @param {Array<[number, number]>} outline - The corners, in cells.
 * @returns {[number, number]} The middle.
 */
function middleOf(outline) {
  const xs = outline.map((point) => point[0]);
  const ys = outline.map((point) => point[1]);

  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

/**
 * Makes a drawer: it keeps the floor plan's PNG between drawings, so only a floor plan that
 * changed is encoded again.
 *
 * @param {Pick<BundleSdk, 'codecs' | 'images'>} sdk - The codecs.
 * @returns {(map: VacuumMap) => string | null} Draws a map as an SVG; null when there is nothing
 *   to draw yet.
 */
export function createMapDrawer(sdk) {
  /** @type {{ key: string; plan: { cells: Uint8Array; side: number } | null } | undefined} */
  let lastPlan;

  /** @type {{ key: string; png: string } | undefined} */
  let lastPng;

  /** @type {{ key: string; shapes: ReturnType<typeof outlineShapesOf> } | undefined} */
  let lastOutline;

  return (map) => {
    const planKey = map.pieceCrcs.join(',') + '|' + Object.keys(map.pieces).sort().join(',');

    if (lastPlan?.key !== planKey) {
      lastPlan = { key: planKey, plan: floorPlanOf(map, sdk.codecs.lzma) };
    }

    const outlineKey = map.outline ?? '';

    if (lastOutline?.key !== outlineKey) {
      lastOutline = {
        key: outlineKey,
        shapes:
          map.outline === null
            ? { walls: [], rooms: [] }
            : outlineShapesOf(map.outline, sdk.codecs.lzma),
      };
    }

    const { plan } = lastPlan;
    const side = PIECE_CELLS * PIECES_ACROSS;
    const rooms = map.rooms
      .filter((room) => room.outline.length >= 3)
      .map((room) => ({ ...room, cells: room.outline.map(([x, y]) => cellOf(x, y)) }));
    const walls = lastOutline.shapes.walls.map((line) => line.map(([x, y]) => cellOf(x, y)));
    // The outline's rooms are the floor of a robot that sends no pieces; with pieces, the floor
    // plan is.
    const floors =
      plan === null
        ? lastOutline.shapes.rooms.map((area) => area.map(([x, y]) => cellOf(x, y)))
        : [];
    const barriers = map.barriers
      .filter((barrier) => barrier.points.length >= 2)
      .map((barrier) => ({ ...barrier, cells: barrier.points.map(([x, y]) => cellOf(x, y)) }));
    const trace = map.trace.map(([x, y, joins]) => /** @type {const} */ ([...cellOf(x, y), joins]));
    const robot = map.robot === null ? null : cellOf(map.robot.x, map.robot.y);
    const station = map.station === null ? null : cellOf(map.station.x, map.station.y);
    const box = boundsOf(plan?.cells ?? null, side, [
      ...rooms.flatMap((room) => room.cells),
      ...walls.flat(),
      ...floors.flat(),
      ...barriers.flatMap((barrier) => barrier.cells),
      ...trace.map(([x, y]) => /** @type {[number, number]} */ ([x, y])),
      ...(robot === null ? [] : [robot]),
      ...(station === null ? [] : [station]),
    ]);

    if (box === null) {
      return null;
    }

    const parts = [];

    if (plan !== null) {
      const pngKey = `${planKey}|${String(box.left)},${String(box.top)},${String(box.width)},${String(box.height)}`;

      if (lastPng?.key !== pngKey) {
        lastPng = { key: pngKey, png: croppedPng(plan.cells, plan.side, box, sdk.images.png) };
      }

      parts.push(
        `<image x="${String(box.left)}" y="${String(box.top)}" width="${String(Math.min(box.width, side - box.left))}" height="${String(Math.min(box.height, side - box.top))}" image-rendering="pixelated" href="data:image/png;base64,${lastPng.png}"/>`,
      );
    }

    for (const floor of floors) {
      parts.push(`<polygon points="${pointsOf(floor)}" fill="${OUTLINE_FLOOR}"/>`);
    }

    for (const [index, room] of rooms.entries()) {
      const fill = ROOM_FILLS[index % ROOM_FILLS.length] ?? '#6aa9ff';

      parts.push(
        `<polygon points="${pointsOf(room.cells)}" fill="${fill}" fill-opacity="0.28" stroke="${fill}" stroke-width="0.6"/>`,
      );
    }

    if (walls.length > 0) {
      const path = walls
        .map((line) =>
          line.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${short(x)} ${short(y)}`).join(''),
        )
        .join('');

      parts.push(
        `<path d="${path}" fill="none" stroke="${WALL_STROKE}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
    }

    for (const barrier of barriers) {
      const colour = BARRIER_COLOURS[barrier.kind];

      // Two corners are a wall, drawn as a line; more are a zone.
      parts.push(
        barrier.cells.length === 2
          ? `<polyline points="${pointsOf(barrier.cells)}" fill="none" stroke="${colour}" stroke-width="1.4" stroke-dasharray="3 2" stroke-linecap="round"/>`
          : `<polygon points="${pointsOf(barrier.cells)}" fill="${colour}" fill-opacity="0.19" stroke="${colour}" stroke-width="1" stroke-dasharray="3 2"/>`,
      );
    }

    if (trace.length > 1) {
      let path = '';

      for (const [index, [x, y, joins]] of trace.entries()) {
        path += `${index === 0 || !joins ? 'M' : 'L'}${short(x)} ${short(y)}`;
      }

      parts.push(
        `<path d="${path}" fill="none" stroke="#ffffff" stroke-opacity="0.9" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
    }

    for (const room of rooms) {
      const [x, y] = middleOf(room.cells);

      parts.push(
        `<text x="${short(x)}" y="${short(y)}" font-size="7" font-family="system-ui, sans-serif" font-weight="600" text-anchor="middle" dominant-baseline="middle" fill="#1f2d44" stroke="#ffffff" stroke-width="1.6" paint-order="stroke">${escaped(room.name)}</text>`,
      );
    }

    if (station !== null) {
      parts.push(
        `<rect x="${short(station[0] - 3)}" y="${short(station[1] - 3)}" width="6" height="6" rx="1.5" fill="#1f9d55" stroke="#ffffff" stroke-width="1"/>`,
      );
    }

    if (robot !== null && map.robot !== null) {
      // Degrees counter-clockwise from the x axis, on a picture whose y axis points down.
      const radians = (-map.robot.angle * Math.PI) / 180;

      parts.push(
        `<circle cx="${short(robot[0])}" cy="${short(robot[1])}" r="4.5" fill="#2563eb" stroke="#ffffff" stroke-width="1.4"/>`,
        `<line x1="${short(robot[0])}" y1="${short(robot[1])}" x2="${short(robot[0] + Math.cos(radians) * 4)}" y2="${short(robot[1] + Math.sin(radians) * 4)}" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round"/>`,
      );
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${String(box.left)} ${String(box.top)} ${String(box.width)} ${String(box.height)}" width="${String(box.width * 2)}" height="${String(box.height * 2)}">${parts.join('')}</svg>`;
  };
}
