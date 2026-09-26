/**
 * Houses under a pitched roof: the European one, and the American one.
 *
 * Each building is the same shell - a gable facing the lower left, a long wall facing the viewer,
 * a roof whose near slope takes the panels - with the details a real house has: a plinth, sills,
 * shingle rows, a ridge cap, a gutter along the eave and a downpipe at the far corner. What makes
 * a style is shape and detail, never colour: the European house has its front door in the gable,
 * with a step, a lamp and a window under the ridge; the American one is a garage wing, its wide
 * door open and the panels on its roof, in front of the house proper - larger, two storeys, its
 * front door on the stretch of wall past the garage and windows on both floors.
 *
 * Drawn in the house tokens, so it is a house at night in the dark theme - dark walls, windows lit
 * from inside - and a house by day in the light one.
 */
import type { ReactNode } from 'react';

import { GarageDoor } from '@/routes/dashboard/cards/energy/garage';
import {
  AMERICAN_DOOR,
  between,
  outFromWall,
  patch,
  polygon,
  up,
  type Body,
  type HouseGeometry,
  type Point,
  type Surface,
} from '@/routes/dashboard/cards/energy/geometry';
import { Window } from '@/routes/dashboard/cards/energy/house-parts';

/** How far the roof reaches past the walls, as a share of the slope and of the eave. */
const OVERHANG = { down: -0.08, sideways: 0.03 } as const;

/** How high the plinth runs along the foot of the walls. */
const PLINTH = 6;

/** What the house needs. */
export type GableHouseProps = {
  readonly geometry: HouseGeometry;
};

/**
 * The shadow a building stands in, spread a little towards the viewer.
 *
 * @param props - The building.
 * @param props.body - The building.
 * @returns The shadow.
 */
function Shadow(props: { readonly body: Body }) {
  const { onGable, onGround, onWall, corners, shortSide } = props.body;
  const reach = 26;

  return (
    <polygon
      points={polygon([
        onGable(1.12, 0),
        onGround(-0.06, reach * 0.2),
        onGround(1.06, reach),
        onWall(1.06, 0),
        { x: corners.right.x - shortSide - 8, y: corners.right.y - shortSide / 2 - 4 },
      ])}
      className="fill-house-ground"
      opacity={0.9}
    />
  );
}

/**
 * The shingle rows across a roof, parallel to the eave.
 *
 * @param props - The building.
 * @param props.body - The building.
 * @returns The lines.
 */
function Shingles(props: { readonly body: Body }) {
  const { onRoof } = props.body;
  const rows = [...Array(11).keys()].map(
    (index) => OVERHANG.down + ((1 - OVERHANG.down) * (index + 1)) / 12,
  );

  return (
    <g className="stroke-house-roof-edge" opacity={0.7}>
      {rows.map((upward) => {
        const from = onRoof(-OVERHANG.sideways, upward);
        const to = onRoof(1 + OVERHANG.sideways, upward);

        return (
          <line
            key={upward.toFixed(3)}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            strokeWidth={0.7}
          />
        );
      })}
    </g>
  );
}

/** What one building's shell needs. */
type ShellProps = {
  readonly body: Body;

  /** What is on the gable: a door, a garage, windows. */
  readonly gable?: ReactNode;

  /** What is on the long wall. */
  readonly wall?: ReactNode;

  /** What lies on the roof, drawn over it: the panels of a building the scene does not draw. */
  readonly roof?: ReactNode;

  /**
   * Whether the downpipe at the far corner shows: not on a building behind another, where it
   * would stand over the near one's roof.
   */
  readonly hasDownpipe?: boolean;
};

/**
 * One building under a pitched roof: its two walls with their plinth, its roof with its rows,
 * ridge, gutter and downpipe, and what the caller puts on each.
 *
 * @param props - See {@link ShellProps}.
 * @returns The group.
 */
function Shell(props: ShellProps) {
  const { body, gable, wall, roof, hasDownpipe = true } = props;
  const { corners, onWall, onGable, onRoof, wallHeight, ridgeHeight } = body;
  const { front, right, left } = corners;
  const ridgeAtGable = up(onGable(0.5, 0), ridgeHeight);
  const eave = [
    onRoof(-OVERHANG.sideways, OVERHANG.down),
    onRoof(1 + OVERHANG.sideways, OVERHANG.down),
  ];
  const ridge = [onRoof(-OVERHANG.sideways, 1), onRoof(1 + OVERHANG.sideways, 1)];
  const pipe = [outFromWall(onWall(0.985, wallHeight - 2), 2), outFromWall(onWall(0.985, 2), 2)];

  return (
    <g>
      {/* The gable wall, in its own shade: it faces away from the light. */}
      <polygon
        points={polygon([front, left, up(left, wallHeight), ridgeAtGable, up(front, wallHeight)])}
        className="fill-house-wall-shade"
      />
      <polygon
        points={polygon(patch(onGable, [0, 0], [1, PLINTH]))}
        className="fill-house-plinth"
      />
      {gable}

      {/* The long wall, its plinth, and what is on it. */}
      <polygon
        points={polygon([front, right, up(right, wallHeight), up(front, wallHeight)])}
        className="fill-house-wall"
      />
      <polygon points={polygon(patch(onWall, [0, 0], [1, PLINTH]))} className="fill-house-plinth" />
      {wall}

      {/* The roof over the long wall, reaching past it, its rows, its ridge and its gutter. */}
      <polygon
        points={polygon(
          patch(onRoof, [-OVERHANG.sideways, OVERHANG.down], [1 + OVERHANG.sideways, 1]),
        )}
        className="fill-house-roof stroke-house-roof-edge"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <Shingles body={body} />
      {roof}
      <line
        x1={ridge[0]?.x}
        y1={ridge[0]?.y}
        x2={ridge[1]?.x}
        y2={ridge[1]?.y}
        className="stroke-house-roof-edge"
        strokeWidth={3}
        strokeLinecap="round"
      />
      <line
        x1={eave[0]?.x}
        y1={eave[0]?.y}
        x2={eave[1]?.x}
        y2={eave[1]?.y}
        className="stroke-house-trim"
        strokeWidth={3.5}
        strokeLinecap="round"
      />

      {/* The far slope's edge over the gable, which is all of that slope that shows. */}
      <line
        x1={ridgeAtGable.x}
        y1={ridgeAtGable.y}
        x2={up(left, wallHeight).x - 6}
        y2={up(left, wallHeight).y + 4}
        className="stroke-house-roof-edge"
        strokeWidth={4}
        strokeLinecap="round"
      />

      {/* The downpipe, from the gutter down the far corner to the ground. */}
      {hasDownpipe ? (
        <g className="stroke-house-trim" strokeLinecap="round">
          <line x1={pipe[0]?.x} y1={pipe[0]?.y} x2={pipe[1]?.x} y2={pipe[1]?.y} strokeWidth={2.2} />
          <line
            x1={between(eave[1] ?? right, pipe[0] ?? right, 0.1).x}
            y1={between(eave[1] ?? right, pipe[0] ?? right, 0.1).y}
            x2={pipe[0]?.x}
            y2={pipe[0]?.y}
            strokeWidth={2}
          />
        </g>
      ) : null}
    </g>
  );
}

/**
 * The European house's gable: the front door with its step and lamp, and a window under the
 * ridge.
 *
 * @param props - The building.
 * @param props.body - The building.
 * @returns The group.
 */
function FrontDoor(props: { readonly body: Body }) {
  const { onGable, wallHeight } = props.body;

  return (
    <g>
      <Door surface={onGable} from={0.36} to={0.62} out={{ x: -6, y: 3 }} />
      <Window corners={patch(onGable, [0.42, wallHeight + 9], [0.58, wallHeight + 29])} />
    </g>
  );
}

/** What a front door needs. */
type DoorProps = {
  /** The wall it is in. */
  readonly surface: Surface;

  /** Where it starts and ends along that wall. */
  readonly from: number;
  readonly to: number;

  /** Which way is out of that wall, on the ground: where the step lies. */
  readonly out: Point;
};

/**
 * A front door: the door, its knob, the step before it and the lamp beside it.
 *
 * @param props - See {@link DoorProps}.
 * @returns The group.
 */
function Door(props: DoorProps) {
  const { surface, from, to, out } = props;
  const width = to - from;
  const lamp = surface(to + width * 0.25, 42);
  const knob = surface(to - width * 0.15, 25);
  const step = [surface(from - width * 0.1, 0), surface(to + width * 0.1, 0)] as const;

  return (
    <g>
      <polygon
        points={polygon(patch(surface, [from, 0], [to, 50]))}
        className="fill-house-roof stroke-house-window-frame"
        strokeWidth={1.2}
      />
      <polygon
        points={polygon([
          step[0],
          step[1],
          { x: step[1].x + out.x, y: step[1].y + out.y },
          { x: step[0].x + out.x, y: step[0].y + out.y },
        ])}
        className="fill-house-trim"
      />
      <circle cx={knob.x} cy={knob.y} r={1.4} className="fill-house-window" />
      <circle cx={lamp.x} cy={lamp.y} r={2} className="fill-house-window" />
    </g>
  );
}

/** The two floors of the American house proper, as shares of its walls' height. */
const FLOORS = [
  { bottom: 0.1, top: 0.36 },
  { bottom: 0.58, top: 0.84 },
] as const;

/**
 * The American house proper's gable: two tall windows on each floor and a row of three under
 * the ridge, all barred in panes.
 *
 * @param props - The building.
 * @param props.body - The building.
 * @returns The group.
 */
function AnnexGable(props: { readonly body: Body }) {
  const { onGable, wallHeight } = props.body;

  return (
    <g>
      {FLOORS.flatMap((floor) =>
        (
          [
            [0.18, 0.34],
            [0.66, 0.82],
          ] as const
        ).map(([from, to]) => (
          <Window
            key={`${String(floor.bottom)}-${String(from)}`}
            corners={patch(
              onGable,
              [from, wallHeight * floor.bottom],
              [to, wallHeight * floor.top],
            )}
            hasLattice
          />
        )),
      )}
      {[
        [0.3, 0.4],
        [0.45, 0.55],
        [0.6, 0.7],
      ].map(([from = 0, to = 0]) => (
        <Window
          key={from}
          corners={patch(onGable, [from, wallHeight + 8], [to, wallHeight + 20])}
          hasSill={false}
        />
      ))}
    </g>
  );
}

/**
 * The American house proper's front: its door, on the stretch of wall past the garage's gable,
 * and windows on both floors - those behind the garage are hidden by it, as they would be.
 *
 * @param props - The building.
 * @param props.body - The building.
 * @returns The group.
 */
function AnnexFront(props: { readonly body: Body }) {
  const { onWall, wallHeight } = props.body;
  const windows = [
    [0.025, 0.07],
    [0.22, 0.265],
    [0.42, 0.465],
    [0.62, 0.665],
    [0.82, 0.865],
  ] as const;

  return (
    <g>
      {windows.flatMap(([from, to]) =>
        FLOORS.map((floor) => (
          <Window
            key={`${String(floor.bottom)}-${String(from)}`}
            corners={patch(onWall, [from, wallHeight * floor.bottom], [to, wallHeight * floor.top])}
            hasLattice
          />
        )),
      )}
      <Door surface={onWall} from={AMERICAN_DOOR.from} to={AMERICAN_DOOR.to} out={{ x: 6, y: 3 }} />
    </g>
  );
}

/**
 * The windows along a long wall, barred in four and lit.
 *
 * @param props - The geometry.
 * @param props.geometry - Where the windows are.
 * @returns The group.
 */
function WallWindows(props: { readonly geometry: HouseGeometry }) {
  const { onWall, places } = props.geometry;

  return (
    <g>
      {places.windows.map((window) => (
        <Window
          key={window.from}
          corners={patch(
            onWall,
            [window.from, places.windowBand.bottom],
            [window.to, places.windowBand.top],
          )}
        />
      ))}
    </g>
  );
}

/**
 * Renders the house.
 *
 * @param props - See {@link GableHouseProps}.
 * @returns The group.
 */
export function GableHouse(props: GableHouseProps) {
  const { geometry } = props;
  const { annex } = geometry;
  const isAmerican = geometry.style === 'american';

  return (
    <g aria-hidden="true">
      {annex === null ? null : <Shadow body={annex} />}
      <Shadow body={geometry} />

      {/* The house behind stands further from the viewer, so it is drawn first. */}
      {annex === null ? null : (
        <Shell
          body={annex}
          hasDownpipe={false}
          gable={<AnnexGable body={annex} />}
          wall={<AnnexFront body={annex} />}
        />
      )}

      <Shell
        body={geometry}
        gable={isAmerican ? <GarageDoor body={geometry} /> : <FrontDoor body={geometry} />}
        wall={<WallWindows geometry={geometry} />}
      />
    </g>
  );
}
