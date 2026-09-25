/**
 * The panels on the roof: a grid of cells laid on the slope that faces the viewer.
 *
 * Drawn only for a card that has a panels meter, so a house without them has a plain roof. The
 * cells light up faintly in the panels' own colour while they are producing, the way a real
 * array catches the sun.
 */
import { onRoof, patch, polygon } from '@/routes/dashboard/cards/energy/geometry';

/** How the array is laid out on the slope: its extent, and its cells. */
const ARRAY = {
  along: [0.07, 0.93],
  upSlope: [0.1, 0.86],
  columns: 6,
  rows: 3,
  gap: 0.012,
} as const;

/** What the array needs. */
export type SolarArrayProps = {
  /** Whether the panels are producing now. */
  readonly isProducing: boolean;
};

/**
 * Renders the array.
 *
 * @param props - See {@link SolarArrayProps}.
 * @returns The group.
 */
export function SolarArray(props: SolarArrayProps) {
  const { isProducing } = props;
  const [alongFrom, alongTo] = ARRAY.along;
  const [upFrom, upTo] = ARRAY.upSlope;
  const cellAlong = (alongTo - alongFrom) / ARRAY.columns;
  const cellUp = (upTo - upFrom) / ARRAY.rows;
  const cells = [...Array(ARRAY.columns * ARRAY.rows).keys()].map((index) => {
    const column = index % ARRAY.columns;
    const row = Math.floor(index / ARRAY.columns);
    const along = alongFrom + column * cellAlong;
    const upward = upFrom + row * cellUp;

    return patch(
      onRoof,
      [along + ARRAY.gap, upward + ARRAY.gap * 1.6],
      [along + cellAlong - ARRAY.gap, upward + cellUp - ARRAY.gap * 1.6],
    );
  });

  return (
    <g aria-hidden="true">
      <polygon
        points={polygon(patch(onRoof, [alongFrom, upFrom], [alongTo, upTo]))}
        className="fill-house-panel-line"
      />
      {cells.map((cell, index) => (
        <polygon
          // The cells never move or reorder: their place is who they are.
          // eslint-disable-next-line react/no-array-index-key -- see above
          key={index}
          points={polygon(cell)}
          className="fill-house-panel stroke-house-panel-line"
          strokeWidth={0.6}
        />
      ))}
      {isProducing ? (
        <polygon
          points={polygon(patch(onRoof, [alongFrom, upFrom], [alongTo, upTo]))}
          fill="var(--color-energy-solar)"
          opacity={0.1}
        />
      ) : null}
    </g>
  );
}
