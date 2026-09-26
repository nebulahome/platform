/**
 * Where everything on the energy card's drawing is, for each style of house.
 *
 * Houses in a two-to-one projection, in drawing units: a long wall faces the lower right, a gable
 * the lower left, and the roof over the long wall - a slope facing the viewer, or a flat top
 * behind a parapet - is where the panels go. Every part is placed by where it is on a building -
 * how far along a wall, how high up it, how far up the roof - rather than by screen coordinates,
 * so a battery moved along the wall stays on the wall, and a style that makes the house longer or
 * taller moves everything on it with it.
 *
 * Each style also says which part of it must be seen - its `focus` - and the scene scales that to
 * the card, letting the rest reach past the card's edges: the American house proper, behind its
 * garage wing, may lose its far gable to the edge, the way the picture it is drawn after is
 * framed.
 *
 * The battery, the gateway and the wires are on the long wall of the building nearest the viewer
 * in every style, so the flows are drawn the same whichever house is chosen. The American house
 * has a second building: the house proper, behind its garage wing, with a roof of panels of its
 * own.
 */
import type { HouseStyle } from '@nebula-home/contracts';

/** A point in the drawing. */
export type Point = { readonly x: number; readonly y: number };

/** A rectangle in the drawing. */
export type Box = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** One step along a building's short side, and along its long side, on the ground. */
const ACROSS: Point = { x: 1, y: 0.5 };
const ALONG: Point = { x: -1, y: 0.5 };

/** How high the flat roof's parapet stands over the roof. */
export const PARAPET_HEIGHT = 9;

/** What a building measures, in drawing units, and where its front corner stands. */
type Dimensions = {
  /**
   * The front corner, on the ground. Left of the middle for a house alone, so the labels on the
   * right - what the house uses, what the grid gives - have the room a figure in kilowatts takes
   * before the box ends.
   */
  readonly front: Point;
  readonly longSide: number;
  readonly shortSide: number;
  readonly wallHeight: number;

  /** How high the ridge is; the wall's height for a flat roof. */
  readonly ridgeHeight: number;
  readonly roof: 'gable' | 'flat';
};

/** The building behind the one nearest the viewer, where a style has one. */
type AnnexDimensions = {
  /** Where it starts and ends along the near building's long wall. */
  readonly along: readonly [number, number];

  /** How far behind the near building's long wall its own long wall stands. */
  readonly behind: number;
  readonly shortSide: number;
  readonly wallHeight: number;
  readonly ridgeHeight: number;
};

/** Each style's house. */
const DIMENSIONS: Readonly<Record<HouseStyle, Dimensions>> = {
  european: {
    front: { x: 138, y: 302 },
    longSide: 195,
    shortSide: 115,
    wallHeight: 71,
    ridgeHeight: 126,
    roof: 'gable',
  },

  // The garage wing, in the proportions of the picture: twice as long as it is wide, walls three
  // quarters of its width high, and a roof steep enough to carry a big array; its gable - the
  // garage door - faces the lower left.
  american: {
    front: { x: 196, y: 300 },
    longSide: 236,
    shortSide: 118,
    wallHeight: 86,
    ridgeHeight: 156,
    roof: 'gable',
  },

  // A cube with a flat top: taller walls, the roof a terrace behind its parapet.
  arabic: {
    front: { x: 138, y: 302 },
    longSide: 195,
    shortSide: 115,
    wallHeight: 96,
    ridgeHeight: 96,
    roof: 'flat',
  },
};

/**
 * The American house proper: two storeys, taller than its garage wing, behind it and reaching
 * well past its gable.
 */
const AMERICAN_ANNEX: AnnexDimensions = {
  along: [-0.1, 0.78],
  behind: 120,
  shortSide: 110,
  wallHeight: 104,
  ridgeHeight: 176,
};

/** Where the parts that the wires join sit on the long wall: along, and the band they span. */
export type Places = {
  readonly battery: {
    readonly from: number;
    readonly to: number;
    readonly bottom: number;
    readonly top: number;
  };
  readonly gateway: {
    readonly at: number;
    readonly halfWidth: number;
    readonly bottom: number;
    readonly top: number;
  };
  readonly windows: readonly { readonly from: number; readonly to: number }[];
  readonly windowBand: { readonly bottom: number; readonly top: number };
  readonly wireHeight: number;
  readonly gridReach: number;
};

/** Where the panels are on a roof: along it, and up the slope or across the flat top. */
export type PanelField = {
  readonly along: readonly [number, number];
  readonly up: readonly [number, number];
};

/** A surface things are placed on: where a point is, given how far along and up it. */
export type Surface = (along: number, upward: number) => Point;

/** One building: its size, its corners, and where a point on each of its faces is. */
export type Body = Omit<Dimensions, 'front'> & {
  /** The four corners on the ground: front, right, and left (the back one is never seen). */
  readonly corners: { readonly front: Point; readonly right: Point; readonly left: Point };

  /**
   * A point on the long wall, the one facing the lower right.
   *
   * @param along - How far along it, from the front corner (0) to the right one (1).
   * @param height - How high up it.
   * @returns The point.
   */
  readonly onWall: Surface;

  /**
   * A point on the gable wall, the one facing the lower left.
   *
   * @param along - How far along it, from the front corner (0) to the left one (1).
   * @param height - How high up it.
   * @returns The point.
   */
  readonly onGable: Surface;

  /**
   * A point on the roof over the long wall.
   *
   * For a gable roof, the slope: `up` from the eave (0) to the ridge (1), below 0 the overhang.
   * For a flat roof, the top: `up` from the long wall's edge (0) to the back one (1).
   *
   * @param along - How far along the eave, from the gable end (0) to the far end (1).
   * @param up - How far up the slope, or across the top.
   * @returns The point.
   */
  readonly onRoof: Surface;

  /**
   * A point on the ground in front of the long wall.
   *
   * @param along - How far along the wall.
   * @param distance - How far out from it.
   * @returns The point.
   */
  readonly onGround: Surface;
};

/** The building behind, with the panels its roof takes. */
export type Annex = Body & { readonly panels: PanelField };

/** Everything the drawing places by, for one style. */
export type HouseGeometry = Body & {
  readonly style: HouseStyle;

  /**
   * The part of the drawing that must be seen, and that it is centred on: the near building with
   * its roof, and of the building behind, its roof. The scene fits this to the card and lets the
   * rest reach past the edges.
   */
  readonly focus: Box;

  /**
   * The focus with what lies on the ground before it - the shadow, and the grid's wire out to
   * where its label reads it - kept in the card when there is room to move the house for it.
   */
  readonly reach: Box;

  /**
   * The outline of everything standing - both buildings, walls and roofs, not the ground - as a
   * convex polygon: what a label's text may not cover.
   */
  readonly outline: readonly Point[];
  readonly places: Places;

  /** Where the panels go, centred on the roof. */
  readonly panels: PanelField;

  /**
   * Where the label lines end, and which side of its line each label's text is written on:
   * the panels' top row - on the American house, the house proper's, the higher roof - and, on
   * a pitched roof, the lit window at the far end, as in the picture, or the top of the parapet
   * on a flat one. The solar figure is written left of its line, over the sky beside the gable,
   * where it covers no roof.
   */
  readonly targets: {
    readonly solarAlong: number;
    readonly homeAlong: number;
    readonly solarSide: 'left' | 'right';
  };

  /** The building behind the near one, for a style that has one. */
  readonly annex: Annex | null;
};

/**
 * Moves a point.
 *
 * @param from - Where it starts.
 * @param by - How far, as a step.
 * @param times - How many steps.
 * @returns The moved point.
 */
function move(from: Point, by: Point, times: number): Point {
  return { x: from.x + by.x * times, y: from.y + by.y * times };
}

/**
 * Raises a point.
 *
 * @param point - The point.
 * @param height - How far up.
 * @returns The raised point.
 */
export function up(point: Point, height: number): Point {
  return { x: point.x, y: point.y - height };
}

/**
 * Moves a point out from a long wall, towards the viewer: what sits on the wall is this far
 * proud of it.
 *
 * @param point - A point on the wall.
 * @param depth - How far out.
 * @returns The point in front of it.
 */
export function outFromWall(point: Point, depth: number): Point {
  return move(point, ACROSS, depth);
}

/**
 * Moves a point back from a long wall, into the building: towards the gable's far corner.
 *
 * @param point - A point on or above the wall.
 * @param depth - How far back, in drawing units.
 * @returns The point behind it.
 */
export function backFromWall(point: Point, depth: number): Point {
  return move(point, ACROSS, -depth);
}

/**
 * Moves a point out from a gable wall, towards the viewer on the left.
 *
 * @param point - A point on the gable.
 * @param depth - How far out.
 * @returns The point in front of it.
 */
export function outFromGable(point: Point, depth: number): Point {
  return move(point, ALONG, depth);
}

/**
 * Builds one building.
 *
 * @param dimensions - Its size, and where its front corner stands.
 * @returns Its corners and faces.
 */
function bodyOf(dimensions: Dimensions): Body {
  const { front, longSide, shortSide, wallHeight, ridgeHeight, roof } = dimensions;

  /**
   * A point on the long wall.
   *
   * @param along - How far along it.
   * @param height - How high up it.
   * @returns The point.
   */
  const onWall = (along: number, height: number): Point =>
    up(move(front, ALONG, -longSide * along), height);

  /**
   * A point on the gable wall.
   *
   * @param along - How far along it.
   * @param height - How high up it.
   * @returns The point.
   */
  const onGable = (along: number, height: number): Point =>
    up(move(front, ACROSS, -shortSide * along), height);

  const ridgeAtGable = up(move(front, ACROSS, -shortSide / 2), ridgeHeight);
  const gableEave = onWall(0, wallHeight);

  /**
   * A point on the roof.
   *
   * @param along - How far along the eave.
   * @param upward - How far up the slope, or across the flat top.
   * @returns The point.
   */
  const onRoof = (along: number, upward: number): Point => {
    const eave = onWall(along, wallHeight);

    if (roof === 'flat') {
      return backFromWall(eave, shortSide * upward);
    }

    return {
      x: eave.x + (ridgeAtGable.x - gableEave.x) * upward,
      y: eave.y + (ridgeAtGable.y - gableEave.y) * upward,
    };
  };

  return {
    longSide,
    shortSide,
    wallHeight,
    ridgeHeight,
    roof,
    corners: {
      front,
      right: move(front, ALONG, -longSide),
      left: move(front, ACROSS, -shortSide),
    },
    onWall,
    onGable,
    onRoof,

    /**
     * A point on the ground in front of the long wall.
     *
     * @param along - How far along the wall.
     * @param distance - How far out from it.
     * @returns The point.
     */
    onGround: (along: number, distance: number): Point => outFromWall(onWall(along, 0), distance),
  };
}

/**
 * Builds the building behind a near one.
 *
 * @param near - The near building.
 * @param annex - Where the one behind stands, and what it measures.
 * @returns The building, with the panels its roof takes.
 */
function annexOf(near: Body, annex: AnnexDimensions): Annex {
  const [from, to] = annex.along;

  return {
    ...bodyOf({
      front: backFromWall(near.onWall(from, 0), annex.behind),
      longSide: near.longSide * (to - from),
      shortSide: annex.shortSide,
      wallHeight: annex.wallHeight,
      ridgeHeight: annex.ridgeHeight,
      roof: 'gable',
    }),
    panels: { along: [0.08, 0.92], up: [0.14, 0.88] },
  };
}

/**
 * The smallest rectangle round some points.
 *
 * @param points - The points.
 * @returns The rectangle.
 */
function boxAround(points: readonly Point[]): Box {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);

  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * The convex hull of some points, going round.
 *
 * @param points - The points.
 * @returns The hull's corners, in order.
 */
function hullOf(points: readonly Point[]): Point[] {
  const sorted = points.toSorted((a, b) => a.x - b.x || a.y - b.y);
  /**
   * Whether three points turn clockwise, or not at all.
   *
   * @param o - The first.
   * @param a - The second.
   * @param b - The third.
   * @returns True when they do not turn anticlockwise.
   */
  const isClockwise = (o: Point, a: Point, b: Point): boolean =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x) <= 0;
  /**
   * One half of the hull, along the sorted points.
   *
   * @param ordered - The points, in the order to walk them.
   * @returns The half's corners.
   */
  const half = (ordered: readonly Point[]): Point[] => {
    const chain: Point[] = [];

    for (const point of ordered) {
      while (
        chain.length >= 2 &&
        isClockwise(chain[chain.length - 2] ?? point, chain[chain.length - 1] ?? point, point)
      ) {
        chain.pop();
      }

      chain.push(point);
    }

    chain.pop();

    return chain;
  };

  return [...half(sorted), ...half(sorted.toReversed())];
}

/**
 * The corners of a building standing: its walls' tops and feet, and its roof.
 *
 * @param body - The building.
 * @returns The points.
 */
function standingPointsOf(body: Body): Point[] {
  const { corners, onRoof, wallHeight } = body;

  return [
    corners.front,
    corners.right,
    corners.left,
    up(corners.front, wallHeight),
    up(corners.right, wallHeight),
    up(corners.left, wallHeight),
    onRoof(-0.03, 1),
    onRoof(1.03, 1),
    onRoof(-0.03, -0.08),
    onRoof(1.03, -0.08),
  ];
}

/** How far over the parapet a flat roof's stair house stands, with its own parapet. */
const STAIR_HOUSE_REACH = 34;

/**
 * The points of a house that must be seen.
 *
 * @param body - The near building.
 * @param annex - The building behind, if any: only its roof counts, so its far gable may be cut.
 * @returns The points.
 */
function focusPointsOf(body: Body, annex: Annex | null): Point[] {
  const { corners, onRoof, onWall, wallHeight, roof } = body;
  const top =
    roof === 'flat'
      ? [up(onRoof(0.03, 1), STAIR_HOUSE_REACH), up(onRoof(1, 0), PARAPET_HEIGHT)]
      : [onRoof(-0.03, 1), onRoof(1.03, 1), onRoof(-0.03, -0.08), onRoof(1.03, -0.08)];

  return [
    corners.front,
    corners.right,
    corners.left,
    up(corners.left, wallHeight),
    onWall(1, wallHeight),
    ...top,
    ...(annex === null ? [] : [annex.onRoof(0.45, 1), annex.onRoof(1.03, 1)]),
  ];
}

/**
 * Builds the geometry of one style of house.
 *
 * @param style - The style.
 * @returns Where everything is.
 */
export function geometryFor(style: HouseStyle): HouseGeometry {
  const body = bodyOf(DIMENSIONS[style]);
  const isAmerican = style === 'american';
  // On the American wing as in the picture: the battery by the corner, the gateway a third of the
  // way along, two tall windows at the far end.
  const places: Places = {
    battery: isAmerican
      ? { from: 0.05, to: 0.13, bottom: 5, top: 60 }
      : { from: 0.07, to: 0.19, bottom: 5, top: 57 },
    gateway: isAmerican
      ? { at: 0.36, halfWidth: 0.018, bottom: 26, top: 48 }
      : { at: 0.465, halfWidth: 0.025, bottom: 21, top: 41 },
    windows: isAmerican
      ? [
          { from: 0.74, to: 0.81 },
          { from: 0.85, to: 0.92 },
        ]
      : [
          { from: 0.64, to: 0.73 },
          { from: 0.79, to: 0.88 },
        ],
    windowBand:
      style === 'arabic'
        ? { bottom: 24, top: 62 }
        : isAmerican
          ? { bottom: 14, top: 68 }
          : { bottom: 21, top: 57 },
    wireHeight: isAmerican ? 37 : 31,
    gridReach: isAmerican ? 96 : 70,
  };
  const annex = isAmerican ? annexOf(body, AMERICAN_ANNEX) : null;
  const focus = focusPointsOf(body, annex);

  return {
    ...body,
    style,
    focus: boxAround(focus),
    reach: boxAround([
      ...focus,
      body.onGround(1.06, 26),
      body.onGround(places.gateway.at, places.gridReach),
    ]),
    outline: hullOf([
      ...focus,
      ...standingPointsOf(body),
      ...(annex === null ? [] : standingPointsOf(annex)),
    ]),
    places,
    // Centred along the roof, with the same margin at both ends, and up it as the roof allows.
    panels:
      body.roof === 'flat'
        ? { along: [0.1, 0.9], up: [0.1, 0.62] }
        : { along: [0.08, 0.92], up: [0.12, 0.86] },
    targets: {
      solarAlong: 0.3,
      homeAlong: body.roof === 'flat' ? 0.95 : (places.windows.at(-1)?.to ?? 0.88) + 0.012,
      solarSide: 'left',
    },
    annex,
  };
}

/**
 * Writes points as the `points` of a polygon.
 *
 * @param points - The corners, in order.
 * @returns The attribute value.
 */
export function polygon(points: readonly Point[]): string {
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
}

/**
 * Writes points as a path through them.
 *
 * @param points - The points, in order.
 * @returns The `d` of the path.
 */
export function path(points: readonly Point[]): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ');
}

/**
 * The four corners of a patch of a surface, going round.
 *
 * @param at - Places a point on the surface.
 * @param from - Where the patch starts, along and up.
 * @param to - Where it ends, along and up.
 * @returns The corners.
 */
export function patch(
  at: (along: number, upward: number) => Point,
  from: readonly [number, number],
  to: readonly [number, number],
): Point[] {
  return [at(from[0], from[1]), at(to[0], from[1]), at(to[0], to[1]), at(from[0], to[1])];
}

/**
 * The point a share of the way from one point to another.
 *
 * @param from - Where it starts.
 * @param to - Where it ends.
 * @param share - How far, from 0 to 1.
 * @returns The point.
 */
export function between(from: Point, to: Point, share: number): Point {
  return { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share };
}
