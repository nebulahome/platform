/**
 * One tile of the system monitor's row, as the board draws it: what is measured with a line of
 * detail on the right, the share in large figures, a faint line of the last minutes, and a bar.
 *
 * The bar and the line take the measure's colour - the processor cyan, memory the lamp's, the
 * disk violet - so the three read apart at a glance; a share past 90% says so in words as well.
 * The line is drawn from the samples the page already has: a path in a box, no axes, nothing to
 * read off it but its shape.
 */
import { useTranslation } from 'react-i18next';

import { cn } from '@nebulahome/ui';

import { formatPercent } from '@/lib/format-bytes';

/** What a tile's colour is. */
type TileColour = 'cyan' | 'lamp' | 'violet';

/** The classes of each colour: the bar's fill and the line's stroke. */
const COLOURS: Readonly<Record<TileColour, { readonly bar: string; readonly line: string }>> = {
  cyan: { bar: 'bg-cyan', line: 'text-cyan' },
  lamp: { bar: 'bg-lamp', line: 'text-lamp' },
  violet: { bar: 'bg-violet', line: 'text-violet' },
};

/** What a tile needs. */
export type SystemTileProps = {
  readonly title: string;

  /** On the right of the title: "i7-13700K · 24 cores", "30.8 of 34.1 GB". */
  readonly detail: string;

  /** The share, from 0 to 100; null before the first reading. */
  readonly percent: number | null;

  /** The last minutes, oldest first, for the faint line; empty for none. */
  readonly series?: readonly (number | null)[];

  readonly colour: TileColour;
};

/**
 * The points of a series inside a 100 × 24 box.
 *
 * @param series - The values, from 0 to 100.
 * @returns The polyline's points.
 */
function pointsOf(series: readonly (number | null)[]): string {
  const values = series.flatMap((value) => (value === null ? [] : [value]));
  const step = values.length < 2 ? 0 : 100 / (values.length - 1);

  return values
    .map(
      (value, index) => `${(index * step).toFixed(1)},${(24 - (value / 100) * 22 - 1).toFixed(1)}`,
    )
    .join(' ');
}

/**
 * Renders a tile.
 *
 * @param props - See {@link SystemTileProps}.
 * @returns The tile.
 */
export function SystemTile(props: SystemTileProps) {
  const { t } = useTranslation();
  const { title, detail, percent, series = [], colour } = props;
  const look = COLOURS[colour];
  const isHigh = percent !== null && percent >= 90;

  return (
    <section
      aria-label={title}
      className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-surface p-4.5 shadow-edge"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-ui-sm text-foreground-muted">{title}</span>
        <span className="truncate text-caption text-foreground-subtle">{detail}</span>
      </div>
      <div className="flex items-end justify-between gap-3">
        <span className="font-mono text-reading text-foreground tabular">
          {formatPercent(percent)}
        </span>
        {series.length < 2 ? null : (
          <svg
            aria-hidden="true"
            viewBox="0 0 100 24"
            preserveAspectRatio="none"
            className={cn('h-6 w-28 shrink-0', look.line)}
          >
            <polyline
              points={pointsOf(series)}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
      </div>
      <div className="h-1.5 overflow-hidden rounded-pill bg-surface-high">
        <div
          className={cn('h-full rounded-pill', isHigh ? 'bg-warning' : look.bar)}
          /* eslint-disable-next-line react/forbid-dom-props -- the bar's width is the share itself. */
          style={{ width: `${String(Math.max(0, Math.min(100, percent ?? 0)))}%` }}
        />
      </div>
      {isHigh ? (
        <span className="text-caption text-warning">{t('system.nearlyFull', 'Nearly full')}</span>
      ) : null}
    </section>
  );
}
