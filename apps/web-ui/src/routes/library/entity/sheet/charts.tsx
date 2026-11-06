/**
 * The charts of the entity dialog, drawn as the Nebula canvas draws them: a band of when a thing
 * was on, a line of a number over time - stepped for a level that jumps, smooth for a reading -
 * with a soft fill under it, and a row of four times along the bottom.
 *
 * Plain SVG in a 320-wide box stretched to the dialog's width; the stroke keeps its width however
 * it is stretched.
 */
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@nebulahome/ui';

import type { StateSegment, TimeWindow } from '@/library/history-series';
import type { LinePoint } from '@/routes/library/entity/sheet/history';
import { TONE_BAND, TONE_CHART, type SheetTone } from '@/routes/library/entity/sheet/tones';

/** The box every line is drawn in. */
const WIDTH = 320;

/**
 * Where a moment falls across a window, from 0 to 1.
 *
 * @param at - The moment.
 * @param window - The window.
 * @returns The fraction, clamped to the window.
 */
function across(at: number, window: TimeWindow): number {
  const span = window.to - window.from;

  return span <= 0 ? 0 : Math.min(1, Math.max(0, (at - window.from) / span));
}

/** What the band needs. */
export type BandChartProps = {
  /** The stretches, left to right. */
  readonly segments: readonly StateSegment[];

  /** The window they cover. */
  readonly window: TimeWindow;

  /** The colour of the active stretches. */
  readonly tone: SheetTone;

  /** What it shows, to a screen reader. */
  readonly label: string;
};

/**
 * A band of when the thing was active: lit where it was on, open or detected.
 *
 * @param props - See {@link BandChartProps}.
 * @returns The band.
 */
export function BandChart(props: BandChartProps) {
  const { segments, window, tone, label } = props;

  return (
    <div
      role="img"
      aria-label={label}
      className="relative h-14 overflow-hidden rounded-tile bg-surface-raised"
    >
      {segments
        .filter((segment) => segment.isActive)
        .map((segment) => {
          const left = across(segment.from, window) * 100;
          const width = Math.max(
            0.6,
            (across(segment.to, window) - across(segment.from, window)) * 100,
          );

          return (
            <span
              key={segment.from}
              className={cn('absolute inset-y-0 rounded-[4px]', TONE_BAND[tone])}
              // eslint-disable-next-line react/forbid-dom-props -- where the stretch falls in the window
              style={{ left: `${left.toFixed(2)}%`, width: `${width.toFixed(2)}%` }}
            />
          );
        })}
    </div>
  );
}

/** What a line needs. */
export type LineChartProps = {
  /** The points, left to right. */
  readonly points: readonly LinePoint[];

  /** The window they cover. */
  readonly window: TimeWindow;

  /** The values at the bottom and the top; the points' own lowest and highest when not given. */
  readonly domain?: readonly [number, number];

  /** Its colour. */
  readonly tone: SheetTone;

  /** Whether it steps from value to value, as a level does, or runs smoothly, as a reading. */
  readonly isStepped?: boolean;

  /** Its height: 120 in a drawer, 128 as a sensor's body. */
  readonly height?: number;

  /**
   * Whether the device stopped answering after the last point: the line then carries on dashed
   * to the right edge, at the last value, with a dot where it stopped.
   */
  readonly isStale?: boolean;

  /** What it shows, to a screen reader. */
  readonly label: string;
};

/**
 * A line of a number over the window, with a fade under it.
 *
 * @param props - See {@link LineChartProps}.
 * @returns The chart.
 */
export function LineChart(props: LineChartProps) {
  const { points, window, tone, isStepped = false, height = 120, isStale = false, label } = props;
  const gradient = useId();
  const values = points.map((point) => point.value);
  const [low, high] = props.domain ?? [Math.min(...values), Math.max(...values)];
  const span = high - low || 1;
  /**
   * Where a value sits up the box: a stepped level on the floor at zero, a reading floating
   * between its own extremes.
   *
   * @param value - The value.
   * @returns Its height, from the top.
   */
  const y = (value: number): number =>
    isStepped
      ? height - 4 - ((value - low) / span) * (height - 14)
      : height - 10 - ((value - low) / span) * (height - 20);
  /**
   * Where a moment sits across the box.
   *
   * @param at - The moment.
   * @returns Its place, from the left.
   */
  const x = (at: number): number => across(at, window) * WIDTH;

  const line = points
    .map((point, index) => {
      const previous = points[index - 1];

      if (index === 0) {
        return `M${x(point.at).toFixed(1)} ${y(point.value).toFixed(1)}`;
      }

      return isStepped && previous !== undefined
        ? `L${x(point.at).toFixed(1)} ${y(previous.value).toFixed(1)} L${x(point.at).toFixed(1)} ${y(point.value).toFixed(1)}`
        : `L${x(point.at).toFixed(1)} ${y(point.value).toFixed(1)}`;
    })
    .join(' ');
  const last = points.at(-1);
  const lastX = last === undefined ? 0 : x(last.at);
  const lastY = last === undefined ? height : y(last.value);
  const area = `${line} L${lastX.toFixed(1)} ${String(height)} L${x(points[0]?.at ?? window.from).toFixed(1)} ${String(height)} Z`;
  const colours = TONE_CHART[isStale ? 'muted' : tone];

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${String(WIDTH)} ${String(height)}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className={cn('block', colours.fill)}
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.32} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      {points.length === 0 ? null : (
        <>
          <path d={area} fill={`url(#${gradient})`} />
          <path
            d={line}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className={colours.stroke}
          />
          {isStale ? (
            <>
              <path
                d={`M${lastX.toFixed(1)} ${lastY.toFixed(1)} L${String(WIDTH)} ${lastY.toFixed(1)}`}
                fill="none"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
                className={colours.stroke}
              />
              <circle cx={lastX} cy={lastY} r={3.5} fill="currentColor" />
            </>
          ) : null}
        </>
      )}
    </svg>
  );
}

/** What the row of times needs. */
export type AxisRowProps = {
  /** The four labels, left to right. */
  readonly labels: readonly string[];
};

/**
 * The times along the bottom of a chart.
 *
 * @param props - See {@link AxisRowProps}.
 * @returns The row.
 */
export function AxisRow(props: AxisRowProps) {
  return (
    <div className="flex justify-between font-mono text-[10px] text-foreground-subtle">
      {props.labels.map((label, index) => (
        // Two labels may read the same on a short window, so the place keys them.
        // eslint-disable-next-line react/no-array-index-key -- the labels are positions on the axis
        <span key={index}>{label}</span>
      ))}
    </div>
  );
}

/** What the bars of a running total need. */
export type TotalBarsProps = {
  /** One bar per slot, in the reading's unit; null for a slot not reached yet. */
  readonly bars: readonly (number | null)[];

  /** Its colour. */
  readonly tone: SheetTone;

  /** What it shows, to a screen reader. */
  readonly label: string;
};

/**
 * Bars of a running total, one per hour of the day or per day of the week or month.
 *
 * @param props - See {@link TotalBarsProps}.
 * @returns The bars.
 */
export function TotalBars(props: TotalBarsProps) {
  const { t } = useTranslation();
  const { bars, tone, label } = props;
  const highest = Math.max(1e-9, ...bars.map((bar) => bar ?? 0));

  return (
    <div role="img" aria-label={label} className="flex h-32 items-end gap-0.75">
      {bars.map((bar, index) => (
        <span
          // eslint-disable-next-line react/no-array-index-key -- a bar is its slot
          key={index}
          title={bar === null ? t('entity.sheet.history.notYet', 'Not yet') : undefined}
          className={cn(
            'min-w-0 flex-1 rounded-t-[3px]',
            bar === null ? 'h-0.5 bg-border' : TONE_BAND[tone],
          )}
          // eslint-disable-next-line react/forbid-dom-props -- the bar's height is its value
          style={
            bar === null
              ? undefined
              : { height: `${Math.max(2, (bar / highest) * 100).toFixed(1)}%` }
          }
        />
      ))}
    </div>
  );
}
