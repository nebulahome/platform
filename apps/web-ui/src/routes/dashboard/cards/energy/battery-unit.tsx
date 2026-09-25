/**
 * The battery on the wall: a box standing proud of the long wall, with how full it is along its
 * edge in the battery's colour.
 *
 * Drawn only for a card that has a battery meter. The gateway - the box every wire meets at - is
 * here too, since it is the other thing mounted on the wall and it is always there.
 */
import {
  onWall,
  outFromWall,
  patch,
  polygon,
  PLACES,
  type Point,
} from '@/routes/dashboard/cards/energy/geometry';

/** How far the battery stands out from the wall. */
const BATTERY_DEPTH = 7;

/** How far the gateway stands out from the wall. */
const GATEWAY_DEPTH = 3;

/**
 * The same corners, moved out from the wall.
 *
 * @param corners - Corners on the wall.
 * @param depth - How far out.
 * @returns The corners in front.
 */
function outward(corners: readonly Point[], depth: number): Point[] {
  return corners.map((corner) => outFromWall(corner, depth));
}

/** What the battery needs. */
export type BatteryUnitProps = {
  /** How full it is, from 0 to 100; null when nothing says. */
  readonly level: number | null;
};

/**
 * Renders the battery.
 *
 * @param props - See {@link BatteryUnitProps}.
 * @returns The group.
 */
export function BatteryUnit(props: BatteryUnitProps) {
  const { level } = props;
  const { from, to, bottom, top } = PLACES.battery;
  const front = outward(patch(onWall, [from, bottom], [to, top]), BATTERY_DEPTH);
  const side = [
    onWall(from, bottom),
    outFromWall(onWall(from, bottom), BATTERY_DEPTH),
    outFromWall(onWall(from, top), BATTERY_DEPTH),
    onWall(from, top),
  ];
  const lid = [
    onWall(from, top),
    onWall(to, top),
    outFromWall(onWall(to, top), BATTERY_DEPTH),
    outFromWall(onWall(from, top), BATTERY_DEPTH),
  ];
  const stripe = 0.012;
  const filled = level === null ? 0 : Math.min(Math.max(level, 0), 100) / 100;
  const gauge = outward(
    patch(onWall, [from + 0.006, bottom + 2], [from + 0.006 + stripe, top - 2]),
    BATTERY_DEPTH,
  );
  const fill = outward(
    patch(
      onWall,
      [from + 0.006, bottom + 2],
      [from + 0.006 + stripe, bottom + 2 + (top - bottom - 4) * filled],
    ),
    BATTERY_DEPTH,
  );

  return (
    <g aria-hidden="true">
      <polygon points={polygon(side)} className="fill-house-window-frame" />
      <polygon points={polygon(lid)} className="fill-house-device" opacity={0.8} />
      <polygon
        points={polygon(front)}
        className="fill-house-device stroke-house-window-frame"
        strokeWidth={0.6}
      />
      <polygon points={polygon(gauge)} fill="var(--color-energy-battery)" opacity={0.2} />
      {filled > 0 ? <polygon points={polygon(fill)} fill="var(--color-energy-battery)" /> : null}
    </g>
  );
}

/**
 * Renders the gateway: the small box on the wall every wire meets at.
 *
 * @returns The group.
 */
export function Gateway() {
  const { at, halfWidth, bottom, top } = PLACES.gateway;
  const front = outward(
    patch(onWall, [at - halfWidth, bottom], [at + halfWidth, top]),
    GATEWAY_DEPTH,
  );
  const light = outFromWall(onWall(at, bottom + 5), GATEWAY_DEPTH);

  return (
    <g aria-hidden="true">
      <polygon
        points={polygon(front)}
        className="fill-house-roof stroke-house-roof-edge"
        strokeWidth={1}
      />
      <circle cx={light.x} cy={light.y} r={1.6} className="fill-house-window-frame" />
    </g>
  );
}
