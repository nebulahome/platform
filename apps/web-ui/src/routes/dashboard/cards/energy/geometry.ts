/**
 * Where everything on the energy card's drawing is.
 *
 * One house in a two-to-one projection, drawn in a fixed box of 380 by 364 units that the card
 * scales to whatever size it has: the long wall faces the lower right, the gable the lower left,
 * and the roof slope over the long wall - the one the panels go on - faces the viewer. Every part
 * is placed by where it is on the house - how far along a wall, how high up it, how far up the
 * roof - rather than by screen coordinates, so a battery moved along the wall stays on the wall.
 */

/** The drawing's box. */
export const VIEW_WIDTH = 380;
export const VIEW_HEIGHT = 364;

/** A point in the drawing. */
export type Point = { readonly x: number; readonly y: number };

/**
 * The front corner of the house, on the ground.
 *
 * Left of the middle, so the labels on the right - what the house uses, what the grid gives -
 * have the room a figure in kilowatts takes before the box ends.
 */
const FRONT: Point = { x: 138, y: 302 };

/** One step along the house's short side, and along its long side, on the ground. */
const ACROSS: Point = { x: 1, y: 0.5 };
const ALONG: Point = { x: -1, y: 0.5 };

/** The house's size, in drawing units. */
export const SHORT_SIDE = 115;
export const LONG_SIDE = 195;
export const WALL_HEIGHT = 71;
export const RIDGE_HEIGHT = 126;

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

/** The four corners on the ground: front, right, back, left. */
export const CORNERS = {
  front: FRONT,
  right: move(FRONT, ALONG, -LONG_SIDE),
  left: move(FRONT, ACROSS, -SHORT_SIDE),
} as const;

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
 * A point on the long wall, the one facing the lower right.
 *
 * @param along - How far along it, from the front corner (0) to the right one (1).
 * @param height - How high up it.
 * @returns The point.
 */
export function onWall(along: number, height: number): Point {
  return up(move(FRONT, ALONG, -LONG_SIDE * along), height);
}

/**
 * A point on the gable wall, the one facing the lower left.
 *
 * @param along - How far along it, from the front corner (0) to the left one (1).
 * @param height - How high up it.
 * @returns The point.
 */
export function onGable(along: number, height: number): Point {
  return up(move(FRONT, ACROSS, -SHORT_SIDE * along), height);
}

/**
 * A point on the roof slope over the long wall.
 *
 * @param along - How far along the eave, from the gable end (0) to the far end (1).
 * @param upSlope - How far up the slope, from the eave (0) to the ridge (1); below 0 is the
 * overhang past the wall.
 * @returns The point.
 */
export function onRoof(along: number, upSlope: number): Point {
  const eave = onWall(along, WALL_HEIGHT);
  const ridgeAtGable = up(move(FRONT, ACROSS, -SHORT_SIDE / 2), RIDGE_HEIGHT);
  const gableEave = onWall(0, WALL_HEIGHT);

  return {
    x: eave.x + (ridgeAtGable.x - gableEave.x) * upSlope,
    y: eave.y + (ridgeAtGable.y - gableEave.y) * upSlope,
  };
}

/**
 * Moves a point out from the long wall, towards the viewer: what sits on the wall is this far
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
 * A point on the ground in front of the long wall.
 *
 * @param along - How far along the wall.
 * @param distance - How far out from it.
 * @returns The point.
 */
export function onGround(along: number, distance: number): Point {
  return outFromWall(onWall(along, 0), distance);
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

/** Where the parts that the wires join sit on the long wall: along, and the band they span. */
export const PLACES = {
  battery: { from: 0.07, to: 0.19, bottom: 5, top: 57 },
  gateway: { at: 0.465, halfWidth: 0.025, bottom: 21, top: 41 },
  windows: [
    { from: 0.64, to: 0.73 },
    { from: 0.79, to: 0.88 },
  ],
  windowBand: { bottom: 21, top: 57 },
  wireHeight: 31,
  gridReach: 70,
} as const;
