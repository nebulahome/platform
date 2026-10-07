/**
 * The alias editor's Preview: what the formula would have read over the last day, as a line under
 * the sources, with its lowest and highest point on the right.
 *
 * As the board draws it: one card, a caption that says where the line comes from - the sources'
 * history, not the alias's, since an alias being written has none - and a line with a faint fill
 * under it. No axes and no tooltip: the preview answers "does this formula do what I meant", which
 * its shape and its range say; the alias's own page has the chart to read values off.
 */
import { toMessage } from '@/lib/error-message';
import { previewRange, type PreviewPoint } from '@/library/alias-preview';
import type { AliasPreview } from '@/library/use-alias-preview';

/** How a figure is written in the range. */
const FIGURES = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

/** What the card needs. */
export type AliasPreviewCardProps = {
  readonly preview: AliasPreview;

  /** The alias's unit symbol, or empty. */
  readonly unit: string;
};

/**
 * The line and the fill under it, inside a 100 × 48 box.
 *
 * @param points - The preview, oldest first.
 * @param window - Its first and last moment.
 * @param window.from - The first, in milliseconds.
 * @param window.to - The last, in milliseconds.
 * @returns The two paths.
 */
function pathsOf(
  points: readonly PreviewPoint[],
  window: { readonly from: number; readonly to: number },
): { readonly line: string; readonly area: string } {
  const range = previewRange(points) ?? { min: 0, max: 1 };
  const span = range.max - range.min || 1;
  const width = window.to - window.from || 1;
  const coordinates = points.map((point) => {
    const x = ((point.at - window.from) / width) * 100;
    const y = 46 - ((point.value - range.min) / span) * 40;

    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = `M${coordinates.join(' L')}`;
  const first = coordinates[0]?.split(',')[0] ?? '0';
  const last = coordinates.at(-1)?.split(',')[0] ?? '100';

  return { line, area: `${line} L${last},48 L${first},48 Z` };
}

/**
 * Renders the preview.
 *
 * @param props - See {@link AliasPreviewCardProps}.
 * @returns The card.
 */
export function AliasPreviewCard(props: AliasPreviewCardProps) {
  const { preview, unit } = props;
  const points = preview.status === 'ready' ? preview.points : [];
  const range = previewRange(points);
  const paths = preview.status === 'ready' && points.length >= 2 ? pathsOf(points, preview) : null;

  /**
   * A figure with the alias's unit.
   *
   * @param value - The figure.
   * @returns The words.
   */
  const withUnit = (value: number): string =>
    unit === '' ? FIGURES.format(value) : `${FIGURES.format(value)} ${unit}`;

  return (
    <section
      aria-label="Preview"
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-caption text-foreground-subtle">
        <span>Preview · last 24 h, from the sources’ history</span>
        {range === null ? null : (
          <span className="font-mono tabular">
            min {withUnit(range.min)} · max {withUnit(range.max)}
          </span>
        )}
      </div>
      {preview.status === 'waiting' ? (
        <p className="py-6 text-center text-ui-sm text-foreground-subtle">
          Choose an entity for every source to see the last day.
        </p>
      ) : preview.status === 'reading' ? (
        <p className="py-6 text-center text-ui-sm text-foreground-subtle">
          Reading the sources’ history…
        </p>
      ) : preview.status === 'failed' ? (
        <p role="alert" className="py-6 text-center text-ui-sm text-danger">
          {toMessage(preview.error)}
        </p>
      ) : paths === null ? (
        <p className="py-6 text-center text-ui-sm text-foreground-subtle">
          Nothing to draw: the sources kept no numbers in the last day, or the formula does not give
          one.
        </p>
      ) : (
        <svg
          role="img"
          aria-label={
            range === null
              ? 'The last day'
              : `The last day, from ${withUnit(range.min)} to ${withUnit(range.max)}`
          }
          viewBox="0 0 100 48"
          preserveAspectRatio="none"
          className="h-24 w-full text-cyan"
        >
          <path d={paths.area} fill="currentColor" fillOpacity={0.12} />
          <path
            d={paths.line}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
    </section>
  );
}
