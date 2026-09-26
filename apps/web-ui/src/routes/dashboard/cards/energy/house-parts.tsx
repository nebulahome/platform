/**
 * The small parts every house on the energy card is dressed with: its windows, with their frames,
 * their bars, their sills and - on an Arabic house - their arches and lattice.
 *
 * A window is four corners on a wall, going round from the lower left, so the same part sits on
 * the long wall and on the gable whichever way each faces.
 */
import { between, type Point } from '@/routes/dashboard/cards/energy/geometry';

/** What a window needs. */
export type WindowProps = {
  /** The four corners, going round from the lower left. */
  readonly corners: readonly Point[];

  /** How high the arch over it rises, in drawing units; none for a square window. */
  readonly arch?: number;

  /** Whether it is screened by a lattice rather than barred in four. */
  readonly hasLattice?: boolean;

  /** Whether a sill runs under it. */
  readonly hasSill?: boolean;
};

/**
 * The outline of a window, arched or square.
 *
 * @param corners - Lower left, lower right, upper right, upper left.
 * @param arch - How high the arch rises; 0 for none.
 * @returns The `d` of the path.
 */
function outline(corners: readonly [Point, Point, Point, Point], arch: number): string {
  const [a, b, c, d] = corners;
  /**
   * Writes a point for a path.
   *
   * @param point - The point.
   * @returns Its coordinates.
   */
  const f = (point: Point): string => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`;

  if (arch <= 0) {
    return `M${f(a)} L${f(b)} L${f(c)} L${f(d)} Z`;
  }

  // The control point twice the arch above the middle of the top, so the curve peaks at it.
  const top = between(d, c, 0.5);
  const control = { x: top.x, y: top.y - arch * 2 };

  return `M${f(a)} L${f(b)} L${f(c)} Q${f(control)} ${f(d)} Z`;
}

/**
 * Renders one window.
 *
 * @param props - See {@link WindowProps}.
 * @returns The window.
 */
export function Window(props: WindowProps) {
  const { corners, arch = 0, hasLattice = false, hasSill = true } = props;
  const [a, b, c, d] = corners;

  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    return null;
  }

  const shape = outline([a, b, c, d], arch);
  const rows = hasLattice ? [0.2, 0.4, 0.6, 0.8] : [0.5];
  const columns = hasLattice ? [0.25, 0.5, 0.75] : [0.5];
  // The sill reaches a little past the window at both ends, and sits just under it.
  const sillFrom = between(b, a, 1.12);
  const sillTo = between(a, b, 1.12);

  return (
    <g>
      <path
        d={shape}
        className="fill-house-window stroke-house-window-frame"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {rows.map((share) => (
        <line
          key={`row-${String(share)}`}
          x1={between(a, d, share).x}
          y1={between(a, d, share).y}
          x2={between(b, c, share).x}
          y2={between(b, c, share).y}
          className="stroke-house-window-frame"
          strokeWidth={hasLattice ? 0.8 : 1.4}
        />
      ))}
      {columns.map((share) => (
        <line
          key={`column-${String(share)}`}
          x1={between(a, b, share).x}
          y1={between(a, b, share).y}
          x2={between(d, c, share).x}
          y2={
            between(d, c, share).y -
            (hasLattice || arch > 0 ? arch * (1 - Math.abs(share - 0.5) * 2) : 0)
          }
          className="stroke-house-window-frame"
          strokeWidth={hasLattice ? 0.8 : 1.4}
        />
      ))}
      {hasSill ? (
        <line
          x1={sillFrom.x}
          y1={sillFrom.y + 1.6}
          x2={sillTo.x}
          y2={sillTo.y + 1.6}
          className="stroke-house-trim"
          strokeWidth={2.4}
          strokeLinecap="round"
        />
      ) : null}
    </g>
  );
}
