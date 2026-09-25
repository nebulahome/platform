/**
 * The house itself: its shadow on the ground, its two walls, its roof, its door and its windows.
 *
 * Drawn in the house tokens, so it is a house at night in the dark theme - dark walls, windows lit
 * from inside - and a house by day in the light one. Nothing on it depends on the meters: the
 * panels, the battery and the wires are drawn over it, each only when the card has what it shows.
 */
import {
  CORNERS,
  onGable,
  onGround,
  onRoof,
  onWall,
  patch,
  polygon,
  PLACES,
  RIDGE_HEIGHT,
  SHORT_SIDE,
  up,
  WALL_HEIGHT,
  type Point,
} from '@/routes/dashboard/cards/energy/geometry';

/** How far the roof reaches past the walls, as a share of the slope and of the eave. */
const OVERHANG = { down: -0.08, sideways: 0.03 } as const;

/**
 * One window: its frame, the light in it, and the bars across it.
 *
 * @param props - The four corners, going round from the lower left.
 * @param props.corners - Where it is.
 * @returns The window.
 */
function Window(props: { readonly corners: readonly Point[] }) {
  const { corners } = props;
  const [a, b, c, d] = corners;

  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    return null;
  }

  /**
   * The point halfway between two others.
   *
   * @param p - One.
   * @param q - The other.
   * @returns Their middle.
   */
  const mid = (p: Point, q: Point): Point => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });

  return (
    <g>
      <polygon
        points={polygon(corners)}
        className="fill-house-window stroke-house-window-frame"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <line
        x1={mid(a, b).x}
        y1={mid(a, b).y}
        x2={mid(d, c).x}
        y2={mid(d, c).y}
        className="stroke-house-window-frame"
        strokeWidth={1.4}
      />
      <line
        x1={mid(a, d).x}
        y1={mid(a, d).y}
        x2={mid(b, c).x}
        y2={mid(b, c).y}
        className="stroke-house-window-frame"
        strokeWidth={1.4}
      />
    </g>
  );
}

/**
 * Renders the house.
 *
 * @returns The group.
 */
export function House() {
  const { front, right, left } = CORNERS;
  const ridgeAtGable = up(onGable(0.5, 0), RIDGE_HEIGHT);
  const shadowReach = 26;

  return (
    <g aria-hidden="true">
      {/* The shadow the house stands in, spread a little towards the viewer. */}
      <polygon
        points={polygon([
          onGable(1.12, 0),
          onGround(-0.06, shadowReach * 0.2),
          onGround(1.06, shadowReach),
          up(onWall(1.06, 0), 0),
          { x: right.x - SHORT_SIDE - 8, y: right.y - SHORT_SIDE / 2 - 4 },
        ])}
        className="fill-house-ground"
        opacity={0.9}
      />

      {/* The gable wall, in its own shade: it faces away from the light. */}
      <polygon
        points={polygon([front, left, up(left, WALL_HEIGHT), ridgeAtGable, up(front, WALL_HEIGHT)])}
        className="fill-house-wall-shade"
      />

      {/* The door, and the small window under the ridge. */}
      <polygon
        points={polygon(patch(onGable, [0.36, 0], [0.62, 50]))}
        className="fill-house-roof stroke-house-window-frame"
        strokeWidth={1.2}
      />
      <circle
        cx={onGable(0.58, 25).x}
        cy={onGable(0.58, 25).y}
        r={1.4}
        className="fill-house-window"
      />
      <Window corners={patch(onGable, [0.42, 80], [0.58, 100])} />

      {/* The long wall. */}
      <polygon
        points={polygon([front, right, up(right, WALL_HEIGHT), up(front, WALL_HEIGHT)])}
        className="fill-house-wall"
      />

      {PLACES.windows.map((window) => (
        <Window
          key={window.from}
          corners={patch(
            onWall,
            [window.from, PLACES.windowBand.bottom],
            [window.to, PLACES.windowBand.top],
          )}
        />
      ))}

      {/* The roof over the long wall, reaching past it, and its edges. */}
      <polygon
        points={polygon(
          patch(onRoof, [-OVERHANG.sideways, OVERHANG.down], [1 + OVERHANG.sideways, 1]),
        )}
        className="fill-house-roof stroke-house-roof-edge"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <line
        x1={onRoof(-OVERHANG.sideways, OVERHANG.down).x}
        y1={onRoof(-OVERHANG.sideways, OVERHANG.down).y}
        x2={onRoof(1 + OVERHANG.sideways, OVERHANG.down).x}
        y2={onRoof(1 + OVERHANG.sideways, OVERHANG.down).y}
        className="stroke-house-roof-edge"
        strokeWidth={3.5}
        strokeLinecap="round"
      />

      {/* The far slope's edge over the gable, which is all of that slope that shows. */}
      <line
        x1={ridgeAtGable.x}
        y1={ridgeAtGable.y}
        x2={up(left, WALL_HEIGHT).x - 6}
        y2={up(left, WALL_HEIGHT).y + 4}
        className="stroke-house-roof-edge"
        strokeWidth={4}
        strokeLinecap="round"
      />
    </g>
  );
}
