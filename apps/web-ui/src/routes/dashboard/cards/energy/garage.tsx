/**
 * The American house's garage door: the gable end of its garage wing, open.
 *
 * Nearly as wide as the gable and most of the wall's height, as in the picture it is drawn
 * after. The opening shows the inside - in shadow, with the inner face of the far long wall
 * catching a little light on the left and the floor at its foot. A lamp on either side of the
 * door, a lintel over it, and the door itself rolled up under the lintel.
 */
import { useId } from 'react';

import {
  outFromGable,
  patch,
  polygon,
  type Body,
  type Point,
} from '@/routes/dashboard/cards/energy/geometry';

/** Where the opening starts and ends along the gable, and how much of the wall's height it is. */
const OPENING = { from: 0.09, to: 0.91, share: 0.8 } as const;

/** How far into the garage the drawing shows. */
const DEPTH = 80;

/** What the door needs. */
export type GarageDoorProps = {
  /** The garage wing. */
  readonly body: Body;
};

/**
 * A point inside the garage, behind the gable.
 *
 * @param point - A point on the gable.
 * @param depth - How far in.
 * @returns The point.
 */
function inside(point: Point, depth: number): Point {
  return outFromGable(point, -depth);
}

/**
 * Renders the open garage door.
 *
 * @param props - See {@link GarageDoorProps}.
 * @returns The group.
 */
export function GarageDoor(props: GarageDoorProps) {
  const { onGable, wallHeight } = props.body;
  const clipId = `garage-${useId().replaceAll(':', '')}`;
  const { from, to } = OPENING;
  const height = wallHeight * OPENING.share;
  const opening = patch(onGable, [from, 0], [to, height]);
  // The inner face of the far long wall, running in from the opening's far edge.
  const edgeBottom = onGable(to, 0);
  const edgeTop = onGable(to, height);
  const sideWall = [edgeBottom, inside(edgeBottom, DEPTH), inside(edgeTop, DEPTH), edgeTop];
  const floor = [
    onGable(from, 0),
    edgeBottom,
    inside(edgeBottom, DEPTH),
    inside(onGable(from, 0), DEPTH),
  ];
  const lamps = [onGable(from - 0.045, height * 0.72), onGable(to + 0.045, height * 0.72)];
  const lintel = [onGable(from - 0.02, height), onGable(to + 0.02, height)];
  const rolled = patch(onGable, [from, height - 7], [to, height]);

  return (
    <g aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <polygon points={polygon(opening)} />
        </clipPath>
      </defs>
      <polygon points={polygon(opening)} className="fill-house-interior" />
      <g clipPath={`url(#${clipId})`}>
        <polygon points={polygon(floor)} className="fill-house-wall-shade" opacity={0.45} />
        <polygon points={polygon(sideWall)} className="fill-house-wall" />
      </g>
      <polygon
        points={polygon(rolled)}
        className="fill-house-roof stroke-house-window-frame"
        strokeWidth={0.8}
      />
      <polygon
        points={polygon(opening)}
        fill="none"
        className="stroke-house-window-frame"
        strokeWidth={1.2}
      />
      <line
        x1={lintel[0]?.x}
        y1={lintel[0]?.y}
        x2={lintel[1]?.x}
        y2={lintel[1]?.y}
        className="stroke-house-trim"
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      {lamps.map((lamp) => (
        <g key={lamp.x}>
          <line
            x1={lamp.x}
            y1={lamp.y - 4}
            x2={lamp.x}
            y2={lamp.y + 3}
            className="stroke-house-trim"
            strokeWidth={2.6}
            strokeLinecap="round"
          />
          <circle cx={lamp.x} cy={lamp.y - 0.5} r={1.3} className="fill-house-window" />
        </g>
      ))}
    </g>
  );
}
