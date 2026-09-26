/**
 * The Arabic house: a cube under a flat roof, the roof a terrace behind a parapet.
 *
 * Its windows are arched, one screened by a mashrabiya lattice; its door is arched too, in the
 * gable wall; the stair that reaches the terrace stands on it as a small room of its own at the
 * back. The panels stand in rows on the terrace, tilted towards the viewer, so the parapet in
 * front of them is drawn after them: {@link FlatHouseFront}.
 */
import {
  outFromWall,
  PARAPET_HEIGHT,
  patch,
  polygon,
  up,
  type HouseGeometry,
} from '@/routes/dashboard/cards/energy/geometry';
import { Window } from '@/routes/dashboard/cards/energy/house-parts';

/** How high the plinth runs along the foot of the walls. */
const PLINTH = 7;

/** Where the stair room stands on the terrace: along it, and back across it. */
const STAIR = { along: [0.03, 0.2], back: [0.68, 0.97], height: 22 } as const;

/** What the house needs. */
export type FlatHouseProps = {
  readonly geometry: HouseGeometry;
};

/**
 * The room the stair comes up into, at the back of the terrace: its two faces that show, its
 * top, and its arched door.
 *
 * @param props - The geometry.
 * @param props.geometry - Where the terrace is.
 * @returns The room.
 */
function StairRoom(props: { readonly geometry: HouseGeometry }) {
  const { onRoof } = props.geometry;
  const [a0, a1] = STAIR.along;
  const [b0, b1] = STAIR.back;
  const { height } = STAIR;
  const front = [
    onRoof(a0, b0),
    onRoof(a1, b0),
    up(onRoof(a1, b0), height),
    up(onRoof(a0, b0), height),
  ];
  const side = [
    onRoof(a0, b0),
    onRoof(a0, b1),
    up(onRoof(a0, b1), height),
    up(onRoof(a0, b0), height),
  ];
  const top = [
    up(onRoof(a0, b0), height),
    up(onRoof(a1, b0), height),
    up(onRoof(a1, b1), height),
    up(onRoof(a0, b1), height),
  ];

  /**
   * A point on the room's front face.
   *
   * @param along - How far along it, 0 to 1.
   * @param rise - How high up it.
   * @returns The point.
   */
  const onFront = (along: number, rise: number) => up(onRoof(a0 + (a1 - a0) * along, b0), rise);

  return (
    <g>
      <polygon points={polygon(side)} className="fill-house-wall-shade" />
      <polygon points={polygon(front)} className="fill-house-wall" />
      <polygon points={polygon(top)} className="fill-house-roof-edge" />
      <Window corners={patch(onFront, [0.35, 0], [0.65, 13])} arch={3} hasSill={false} />
    </g>
  );
}

/**
 * Renders the house, all but the parapet over the long wall.
 *
 * @param props - See {@link FlatHouseProps}.
 * @returns The group.
 */
export function FlatHouse(props: FlatHouseProps) {
  const { geometry } = props;
  const { corners, onWall, onGable, onRoof, onGround, places, shortSide, wallHeight } = geometry;
  const { front, right, left } = corners;
  const shadowReach = 30;
  const top = wallHeight + PARAPET_HEIGHT;

  return (
    <g aria-hidden="true">
      <polygon
        points={polygon([
          onGable(1.12, 0),
          onGround(-0.06, shadowReach * 0.2),
          onGround(1.06, shadowReach),
          onWall(1.06, 0),
          { x: right.x - shortSide - 8, y: right.y - shortSide / 2 - 4 },
        ])}
        className="fill-house-ground"
        opacity={0.9}
      />

      {/* The gable wall, its parapet, the arched door and the windows over it. */}
      <polygon
        points={polygon([front, left, up(left, top), up(front, top)])}
        className="fill-house-wall-shade"
      />
      <polygon
        points={polygon(patch(onGable, [0, 0], [1, PLINTH]))}
        className="fill-house-plinth"
      />
      <polygon
        points={polygon([
          onGable(0.36, 0),
          onGable(0.62, 0),
          onGable(0.62, 44),
          onGable(0.49, 56),
          onGable(0.36, 44),
        ])}
        className="fill-house-roof stroke-house-window-frame"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <circle
        cx={onGable(0.58, 24).x}
        cy={onGable(0.58, 24).y}
        r={1.4}
        className="fill-house-window"
      />
      <Window corners={patch(onGable, [0.2, 66], [0.32, 84])} arch={4} />
      <Window corners={patch(onGable, [0.68, 66], [0.8, 84])} arch={4} />

      {/* The terrace: its floor, and the inside of the parapet at its back and far end. */}
      <polygon points={polygon(patch(onRoof, [0, 0], [1, 1]))} className="fill-house-roof" />
      <polygon
        points={polygon([
          onRoof(0, 1),
          onRoof(1, 1),
          up(onRoof(1, 1), PARAPET_HEIGHT),
          up(onRoof(0, 1), PARAPET_HEIGHT),
        ])}
        className="fill-house-wall-shade"
      />
      <polygon
        points={polygon([
          onRoof(1, 0),
          onRoof(1, 1),
          up(onRoof(1, 1), PARAPET_HEIGHT),
          up(onRoof(1, 0), PARAPET_HEIGHT),
        ])}
        className="fill-house-wall"
        opacity={0.85}
      />
      <StairRoom geometry={geometry} />

      {/* The long wall, its plinth, and its arched windows - one behind a lattice. */}
      <polygon
        points={polygon([front, right, up(right, wallHeight), up(front, wallHeight)])}
        className="fill-house-wall"
      />
      <polygon points={polygon(patch(onWall, [0, 0], [1, PLINTH]))} className="fill-house-plinth" />
      {places.windows.map((window, index) => (
        <Window
          key={window.from}
          corners={patch(
            onWall,
            [window.from, places.windowBand.bottom],
            [window.to, places.windowBand.top - 8],
          )}
          arch={8}
          hasLattice={index === 0}
        />
      ))}

      {/* A spout through the parapet, to throw the rain off the terrace. */}
      <line
        x1={onWall(0.97, wallHeight + 2).x}
        y1={onWall(0.97, wallHeight + 2).y}
        x2={outFromWall(onWall(0.97, wallHeight + 1), 8).x}
        y2={outFromWall(onWall(0.97, wallHeight + 1), 8).y}
        className="stroke-house-trim"
        strokeWidth={2.4}
        strokeLinecap="round"
      />
    </g>
  );
}

/**
 * Renders the parapet over the long wall, with its battlements: in front of the panels on the
 * terrace, so drawn after them.
 *
 * @param props - See {@link FlatHouseProps}.
 * @returns The group.
 */
export function FlatHouseFront(props: FlatHouseProps) {
  const { onWall, wallHeight } = props.geometry;
  const top = wallHeight + PARAPET_HEIGHT;
  const merlons = [...Array(10).keys()].map((index) => (index + 0.2) / 10);

  return (
    <g aria-hidden="true">
      <polygon
        points={polygon(patch(onWall, [0, wallHeight], [1, top]))}
        className="fill-house-wall stroke-house-roof-edge"
        strokeWidth={0.8}
      />
      <line
        x1={onWall(0, wallHeight).x}
        y1={onWall(0, wallHeight).y}
        x2={onWall(1, wallHeight).x}
        y2={onWall(1, wallHeight).y}
        className="stroke-house-trim"
        strokeWidth={2}
      />
      <line
        x1={onWall(0, top).x}
        y1={onWall(0, top).y}
        x2={onWall(1, top).x}
        y2={onWall(1, top).y}
        className="stroke-house-trim"
        strokeWidth={1.6}
      />
      {merlons.map((from) => (
        <polygon
          key={from}
          points={polygon(patch(onWall, [from, top], [from + 0.55 / 10, top + 7]))}
          className="fill-house-wall stroke-house-roof-edge"
          strokeWidth={0.6}
        />
      ))}
    </g>
  );
}
