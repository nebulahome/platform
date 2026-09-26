/**
 * The panels on the roof, drawn the way a real array looks from the street.
 *
 * One dark sheet of glass, edge to edge, ruled into modules by the black gaps between them and,
 * faintly, each module into its cells; a thin aluminium edge round the whole, the rails it is
 * clamped to showing past its ends, and the sheen of the sky across it. On a pitched roof it lies
 * on the slope that faces the viewer, with the same margin at both ends; on a flat roof it stands
 * in rows on tilted frames, facing the viewer.
 *
 * Drawn only for a card that has a panels meter, so a house without them has a plain roof. The
 * array lights up faintly in the panels' own colour while it is producing, the way a real array
 * catches the sun.
 */
import { useId } from 'react';

import {
  between,
  patch,
  polygon,
  up,
  type HouseGeometry,
  type Point,
  type Surface,
} from '@/routes/dashboard/cards/energy/geometry';

/** How many modules along and up an array on a pitched roof, and along a flat-roof row. */
const COLUMNS = 6;
const ROWS = 4;

/** How many cells a module is ruled into, along and up. */
const CELLS = { along: 3, up: 6 } as const;

/** How high a flat-roof row's back edge stands over its front, in drawing units. */
const TILT = 12;

/** How many flat-roof rows. */
const FLAT_ROWS = 3;

/** What one array needs. */
export type PanelArrayProps = {
  /** Where it lies. */
  readonly surface: Surface;

  /** Its extent along the surface, and up it. */
  readonly along: readonly [number, number];
  readonly upward: readonly [number, number];

  /** How many modules along, and up. */
  readonly columns: number;
  readonly rows: number;

  /** Whether the panels are producing now. */
  readonly isProducing: boolean;

  /** Whether to draw the rails showing past its ends: not on a frame of its own. */
  readonly hasRails?: boolean;
};

/**
 * The lines dividing a quadrilateral into equal parts, one way.
 *
 * @param corners - Lower left, lower right, upper right, upper left.
 * @param parts - Into how many.
 * @param isAlong - Whether the lines run up (dividing along) or along (dividing up).
 * @returns Each line's two ends.
 */
function dividers(
  corners: readonly [Point, Point, Point, Point],
  parts: number,
  isAlong: boolean,
): (readonly [Point, Point])[] {
  const [a, b, c, d] = corners;

  return [...Array(parts - 1).keys()].map((index) => {
    const share = (index + 1) / parts;

    return isAlong
      ? [between(a, b, share), between(d, c, share)]
      : [between(a, d, share), between(b, c, share)];
  });
}

/**
 * Renders one array: the sheet, its modules and cells, its edge, its rails and its sheen.
 *
 * @param props - See {@link PanelArrayProps}.
 * @returns The group.
 */
export function PanelArray(props: PanelArrayProps) {
  const { surface, along, upward, columns, rows, isProducing, hasRails = true } = props;
  const glareId = `glare-${useId().replaceAll(':', '')}`;
  const [a, b, c, d] = patch(surface, [along[0], upward[0]], [along[1], upward[1]]);

  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    return null;
  }

  const sheet = [a, b, c, d] as const;
  // Rails a fifth of the way in from the top and the bottom, a little past both ends.
  const rails = [0.2, 0.8].map((share) => {
    const height = upward[0] + (upward[1] - upward[0]) * share;
    const reach = (along[1] - along[0]) * 0.025;

    return [surface(along[0] - reach, height), surface(along[1] + reach, height)] as const;
  });
  const cells = [
    ...dividers(sheet, columns * CELLS.along, true),
    ...dividers(sheet, rows * CELLS.up, false),
  ];
  const modules = [...dividers(sheet, columns, true), ...dividers(sheet, rows, false)];

  return (
    <g aria-hidden="true">
      <defs>
        <linearGradient id={glareId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-house-panel-glare)" stopOpacity={0.22} />
          <stop offset="0.5" stopColor="var(--color-house-panel-glare)" stopOpacity={0.04} />
          <stop offset="1" stopColor="var(--color-house-panel-glare)" stopOpacity={0} />
        </linearGradient>
      </defs>
      {hasRails
        ? rails.map(([from, to]) => (
            <line
              key={`${from.x.toFixed(1)}-${from.y.toFixed(1)}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              className="stroke-house-panel-frame"
              strokeWidth={1.4}
              strokeLinecap="round"
            />
          ))
        : null}
      <polygon points={polygon(sheet)} className="fill-house-panel" />
      <g className="stroke-house-panel-cell" strokeWidth={0.35} opacity={0.55}>
        {cells.map(([from, to]) => (
          <line
            key={`c${from.x.toFixed(2)}-${from.y.toFixed(2)}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
          />
        ))}
      </g>
      <g className="stroke-house-panel-cell" strokeWidth={1.3}>
        {modules.map(([from, to]) => (
          <line
            key={`m${from.x.toFixed(2)}-${from.y.toFixed(2)}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
          />
        ))}
      </g>
      <polygon points={polygon(sheet)} fill={`url(#${glareId})`} />
      <polygon
        points={polygon(sheet)}
        fill="none"
        className="stroke-house-panel-frame"
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
      {isProducing ? (
        <polygon points={polygon(sheet)} fill="var(--color-energy-solar)" opacity={0.1} />
      ) : null}
    </g>
  );
}

/** What the house's array needs. */
export type SolarArrayProps = {
  readonly geometry: HouseGeometry;

  /** Whether the panels are producing now. */
  readonly isProducing: boolean;
};

/**
 * Renders the array on the roof of the building nearest the viewer. The American house's own
 * roof carries one too, drawn with that building, behind this one.
 *
 * @param props - See {@link SolarArrayProps}.
 * @returns The group.
 */
export function SolarArray(props: SolarArrayProps) {
  const { geometry, isProducing } = props;
  const { onRoof, panels } = geometry;
  const [alongFrom, alongTo] = panels.along;
  const [upFrom, upTo] = panels.up;

  if (geometry.roof === 'gable') {
    return (
      <PanelArray
        surface={onRoof}
        along={panels.along}
        upward={panels.up}
        columns={COLUMNS}
        rows={ROWS}
        isProducing={isProducing}
      />
    );
  }

  // Rows across the terrace, each standing on a frame that lifts its back edge.
  const rowDepth = (upTo - upFrom) / FLAT_ROWS;
  const rows = [...Array(FLAT_ROWS).keys()].map((index) => {
    const front = upFrom + index * rowDepth;
    const back = front + rowDepth * 0.62;

    /**
     * A point on this row's tilted surface.
     *
     * @param along - How far along the terrace.
     * @param upward - How far up the row, from its front edge (0) to its back one (1).
     * @returns The point.
     */
    const surface: Surface = (along, upward) =>
      up(onRoof(along, front + (back - front) * upward), 2 + TILT * upward);

    return { key: index, back, surface };
  });

  return (
    <g aria-hidden="true">
      {/* Back to front, so a nearer row stands in front of the one behind it. */}
      {[...rows].reverse().map((row) => (
        <g key={row.key}>
          {[alongFrom + 0.02, alongTo - 0.02].map((along) => (
            <line
              key={along}
              x1={onRoof(along, row.back).x}
              y1={onRoof(along, row.back).y}
              x2={row.surface(along, 1).x}
              y2={row.surface(along, 1).y}
              className="stroke-house-panel-frame"
              strokeWidth={1.4}
            />
          ))}
          <PanelArray
            surface={row.surface}
            along={[alongFrom, alongTo]}
            upward={[0, 1]}
            columns={COLUMNS}
            rows={1}
            isProducing={isProducing}
            hasRails={false}
          />
        </g>
      ))}
    </g>
  );
}
