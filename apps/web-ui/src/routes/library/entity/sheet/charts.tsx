/**
 * The charts of the entity dialog, drawn as the Nebula canvas draws them: a band of when a thing
 * was on, a line of a number over time - stepped for a level that jumps, smooth for a reading -
 * with a soft fill under it, bars of a running total, and a row of four times along the bottom.
 *
 * Every chart answers the pointer: a guide follows it, and a tooltip says what the thing was at
 * that moment - the value, or the state and how long it lasted - and when. Each is drawn in as it
 * appears: the line from the left, the bars from the floor, the band's stretches from where they
 * began. Where a reading went quiet the line breaks over a grey hatched stretch rather than
 * running straight across; while the history is still read, a light passes over the chart's place.
 *
 * Plain SVG in a 320-wide box stretched to the dialog's width; the stroke keeps its width however
 * it is stretched, and the dots and the tooltip are drawn over it in the page's own pixels.
 */
import { useEffect, useId, useState, type PointerEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@nebulahome/ui';

import type { StateSegment, TimeWindow } from '@/library/history-series';
import { durationText } from '@/library/history-stats';
import { momentText, type LinePoint } from '@/routes/library/entity/sheet/history';
import {
  TONE_BAND,
  TONE_CHART,
  TONE_DOT,
  type SheetTone,
} from '@/routes/library/entity/sheet/tones';

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

/** Where the pointer is over a chart, from 0 at its left to 1 at its right; null when away. */
type Pointer = {
  readonly at: number | null;
  readonly onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerLeave: () => void;
};

/**
 * Follows the pointer across a chart.
 *
 * @returns Where it is, and the handlers that track it.
 */
function usePointer(): Pointer {
  const [at, setAt] = useState<number | null>(null);

  return {
    at,
    /**
     * Notes where the pointer is now.
     *
     * @param event - The move.
     */
    onPointerMove: (event) => {
      const box = event.currentTarget.getBoundingClientRect();

      setAt(
        box.width <= 0 ? null : Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      );
    },
    /** Forgets it once it leaves. */
    onPointerLeave: () => {
      setAt(null);
    },
  };
}

/** What a tooltip needs. */
type TipProps = {
  /** Where it points, from 0 to 1 across the chart. */
  readonly at: number;

  /** What it says first: the value, or the state. */
  readonly title: ReactNode;

  /** What it says under that: when. */
  readonly sub: string;

  /** The colour of its dot. */
  readonly tone: SheetTone;

  /** A colour of the dot's own instead, as a class: a state's colour on a timeline. */
  readonly dot?: string;
};

/**
 * The tooltip over a chart: above it, beside the guide, kept inside the chart at its edges.
 *
 * @param props - See {@link TipProps}.
 * @returns The tooltip.
 */
function ChartTip(props: TipProps) {
  const { at, title, sub, tone, dot } = props;
  // Centred over the guide, but turned inwards near an edge so it never leaves the chart.
  const shift = at < 0.2 ? '-14px' : at > 0.8 ? 'calc(-100% + 14px)' : '-50%';

  return (
    <div
      role="status"
      className="pointer-events-none absolute bottom-[calc(100%+8px)] z-10"
      // eslint-disable-next-line react/forbid-dom-props -- the tooltip follows the pointer
      style={{ left: `${(at * 100).toFixed(2)}%`, transform: `translateX(${shift})` }}
    >
      <div className="entity-tip flex flex-col gap-0.5 rounded-tile border border-border-strong bg-surface-high/95 px-2.75 py-1.75 whitespace-nowrap shadow-[0_12px_30px_-8px_rgb(0_0_0/0.6)] backdrop-blur">
        <span className="flex items-center gap-1.75 text-ui-sm font-medium text-foreground tabular">
          <span
            aria-hidden="true"
            className={cn('size-1.75 rounded-full', dot ?? TONE_DOT[tone])}
          />
          {title}
        </span>
        <span className="font-mono text-[10px] text-foreground-subtle">{sub}</span>
      </div>
    </div>
  );
}

/**
 * The guide under the pointer, and two faint lines at a third and two thirds of the window - where
 * the times under the chart fall.
 *
 * @param props - Where the pointer is.
 * @param props.at - From 0 to 1, or null when it is away.
 * @returns The lines.
 */
function Guides(props: { readonly at: number | null }) {
  return (
    <>
      {(['left-1/3', 'left-2/3'] as const).map((place) => (
        <span
          key={place}
          aria-hidden="true"
          className={cn('pointer-events-none absolute inset-y-0 w-px bg-border/70', place)}
        />
      ))}
      {props.at === null ? null : (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 w-px bg-foreground/35"
          // eslint-disable-next-line react/forbid-dom-props -- the guide follows the pointer
          style={{ left: `${(props.at * 100).toFixed(2)}%` }}
        />
      )}
    </>
  );
}

/** A stretch of the band: one or more segments in a row that were all active, or all not. */
type Run = {
  readonly from: number;
  readonly to: number;
  readonly isActive: boolean;
  readonly isAvailable: boolean;
};

/**
 * Joins segments in a row that read the same way - a lamp dimmed while on is still one stretch of
 * on - so the band draws one block for each, not one per change.
 *
 * @param segments - The segments, left to right.
 * @returns The stretches.
 */
export function runsOf(segments: readonly StateSegment[]): Run[] {
  const runs: Run[] = [];

  for (const segment of segments) {
    const last = runs.at(-1);

    if (
      last?.isActive === segment.isActive &&
      last.isAvailable === segment.isAvailable &&
      segment.from - last.to <= 1000
    ) {
      runs[runs.length - 1] = { ...last, to: segment.to };
    } else {
      runs.push({
        from: segment.from,
        to: segment.to,
        isActive: segment.isActive,
        isAvailable: segment.isAvailable,
      });
    }
  }

  return runs;
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

  /** The words of the two states, when a segment has none of its own: "On", "Off". */
  readonly words?: readonly [string, string];
};

/**
 * A band of when the thing was active: lit where it was on, open or detected, hatched where the
 * device did not answer; under the pointer, what it was and for how long.
 *
 * @param props - See {@link BandChartProps}.
 * @returns The band.
 */
export function BandChart(props: BandChartProps) {
  const { t } = useTranslation();
  const { segments, window, tone, label } = props;
  const pointer = usePointer();
  const runs = runsOf(segments);
  const moment = pointer.at === null ? null : window.from + pointer.at * (window.to - window.from);
  const run =
    moment === null ? undefined : runs.find((each) => moment >= each.from && moment <= each.to);
  const segment =
    moment === null ? undefined : segments.find((each) => moment >= each.from && moment <= each.to);
  const [onWord, offWord] = props.words ?? [t('common.on', 'On'), t('common.off', 'Off')];

  return (
    <div className="relative">
      <div
        role="img"
        aria-label={label}
        onPointerMove={pointer.onPointerMove}
        onPointerLeave={pointer.onPointerLeave}
        className="relative h-12 cursor-crosshair overflow-hidden rounded-tile bg-surface-raised"
      >
        <Guides at={null} />
        {runs.map((each, index) =>
          each.isAvailable ? null : (
            <span
              key={each.from}
              className="entity-grow-x absolute inset-y-0 bg-[repeating-linear-gradient(135deg,rgb(247_93_89/0.22)_0_4px,transparent_4px_8px)]"
              // eslint-disable-next-line react/forbid-dom-props -- where the silence falls, in its place
              style={{
                left: `${(across(each.from, window) * 100).toFixed(2)}%`,
                width: `${((across(each.to, window) - across(each.from, window)) * 100).toFixed(2)}%`,
                ['--i' as string]: index,
              }}
            />
          ),
        )}
        {runs.map((each, index) =>
          each.isActive && each.isAvailable ? (
            <span
              key={each.from}
              className={cn(
                'entity-grow-x absolute inset-y-1.5 rounded-[7px] transition-opacity duration-200',
                TONE_BAND[tone],
                run !== undefined && run !== each && 'opacity-55',
              )}
              // eslint-disable-next-line react/forbid-dom-props -- where the stretch falls in the window
              style={{
                left: `calc(${(across(each.from, window) * 100).toFixed(2)}% + 1px)`,
                width: `max(4px, calc(${((across(each.to, window) - across(each.from, window)) * 100).toFixed(2)}% - 2px))`,
                ['--i' as string]: index,
              }}
            />
          ) : null,
        )}
        <Guides at={pointer.at} />
      </div>
      {pointer.at === null || run === undefined ? null : (
        <ChartTip
          at={pointer.at}
          tone={run.isActive && run.isAvailable ? tone : 'muted'}
          title={
            !run.isAvailable
              ? t('entity.sheet.history.notAnswering', 'Not answering')
              : segment !== undefined && segment.label !== ''
                ? segment.label
                : run.isActive
                  ? onWord
                  : offWord
          }
          sub={t('entity.sheet.history.span', '{{from}} – {{to}} · {{duration}}', {
            from: momentText(run.from, window),
            to: momentText(run.to, window),
            duration: durationText(run.to - run.from),
          })}
        />
      )}
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

  /** Writes a value for the tooltip, with its unit: "21.4 °C". */
  readonly format?: (value: number) => string;

  /**
   * Reads where a gap really began and ended, when the points are buckets that put its edges on
   * the hour; the tooltip says the bucket's edges until it answers.
   */
  readonly readGap?: (gap: Gap, signal: AbortSignal) => Promise<Gap>;
};

/** A stretch with no reading in it: the line breaks there instead of running straight across. */
export type Gap = { readonly from: number; readonly to: number };

/** How many of its usual spacings a reading may go quiet for before the quiet is a gap. */
const GAP_SPACINGS = 5;

/** The shortest gap, as a share of the window: a moment's quiet on a month is no gap. */
const GAP_SHARE = 1 / 60;

/**
 * Where a reading went quiet: between two points further apart than five of its usual spacings
 * and than a sixtieth of the window - six minutes of six hours, twelve hours of a month. Nothing
 * was recorded there, the hub off or the device silent, so a line drawn across would make up the
 * readings in between.
 *
 * @param points - The points, left to right.
 * @param window - The window they cover.
 * @returns The gaps, left to right.
 */
export function gapsOf(points: readonly LinePoint[], window: TimeWindow): Gap[] {
  const pairs = points
    .slice(1)
    .map((point, index) => ({ from: points[index]?.at ?? 0, to: point.at }));
  const steps = pairs.map((pair) => pair.to - pair.from).filter((step) => step > 0);

  if (steps.length === 0) {
    return [];
  }

  const usual =
    steps.toSorted((first, second) => first - second)[Math.floor(steps.length / 2)] ?? 0;
  const least = Math.max(usual * GAP_SPACINGS, (window.to - window.from) * GAP_SHARE);

  return pairs.filter((pair) => pair.to - pair.from > least);
}

/**
 * Cuts a line's points at its gaps.
 *
 * @param points - The points, left to right.
 * @param gaps - Its gaps.
 * @returns The runs between the gaps, each one or more points.
 */
function runsAcross(points: readonly LinePoint[], gaps: readonly Gap[]): LinePoint[][] {
  const runs: LinePoint[][] = [];

  for (const point of points) {
    const run = runs.at(-1);
    const last = run?.at(-1);

    if (run === undefined || (last !== undefined && gaps.some((gap) => gap.from === last.at))) {
      runs.push([point]);
    } else {
      run.push(point);
    }
  }

  return runs;
}

/**
 * The exact edges of the gap under the pointer, read once per gap and kept.
 *
 * @param gap - The gap under the pointer, if any.
 * @param read - Reads its edges; none when the points are already the readings.
 * @returns Its exact edges once read, otherwise undefined.
 */
function useExactGap(gap: Gap | undefined, read: LineChartProps['readGap']): Gap | undefined {
  const [known, setKnown] = useState<ReadonlyMap<number, Gap>>(new Map());
  const from = gap?.from;
  const to = gap?.to;
  const isKnown = from !== undefined && known.has(from);

  useEffect(() => {
    if (from === undefined || to === undefined || read === undefined || isKnown) {
      return undefined;
    }

    const controller = new AbortController();

    read({ from, to }, controller.signal).then(
      (edges) => {
        setKnown((map) => new Map(map).set(from, edges));
      },
      // A read that failed or was cancelled leaves the bucket's edges.
      () => undefined,
    );

    return () => {
      controller.abort();
    };
  }, [from, to, read, isKnown]);

  return from === undefined ? undefined : known.get(from);
}

/**
 * The value a line has at a moment: the last step before it, or between the two points around it.
 *
 * @param points - The points, left to right.
 * @param at - The moment.
 * @param isStepped - Whether the line steps.
 * @returns The value, or null before the first point.
 */
function valueAt(points: readonly LinePoint[], at: number, isStepped: boolean): number | null {
  const after = points.findIndex((point) => point.at > at);
  const before = after === -1 ? points.at(-1) : points[after - 1];
  const next = after === -1 ? undefined : points[after];

  if (before === undefined) {
    return points[0]?.value ?? null;
  }

  if (isStepped || next === undefined || next.at === before.at) {
    return before.value;
  }

  return before.value + ((next.value - before.value) * (at - before.at)) / (next.at - before.at);
}

/**
 * A line of a number over the window, with a fade under it; under the pointer, its value then.
 *
 * @param props - See {@link LineChartProps}.
 * @returns The chart.
 */
export function LineChart(props: LineChartProps) {
  const { t } = useTranslation();
  const { points, window, tone, isStepped = false, height = 120, isStale = false, label } = props;
  const gradient = useId();
  const pointer = usePointer();
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
  /**
   * Writes a value for the tooltip.
   *
   * @param value - The value.
   * @returns It, with its unit.
   */
  const format = props.format ?? ((value: number): string => String(Math.round(value * 10) / 10));

  // A level holds between its changes; only a reading has gaps.
  const gaps = isStepped ? [] : gapsOf(points, window);
  const runs = runsAcross(points, gaps);
  /**
   * The path of one run of points.
   *
   * @param run - The points, left to right.
   * @returns The path's commands.
   */
  const pathOf = (run: readonly LinePoint[]): string =>
    run
      .map((point, index) => {
        const previous = run[index - 1];

        if (index === 0) {
          return `M${x(point.at).toFixed(1)} ${y(point.value).toFixed(1)}`;
        }

        return isStepped && previous !== undefined
          ? `L${x(point.at).toFixed(1)} ${y(previous.value).toFixed(1)} L${x(point.at).toFixed(1)} ${y(point.value).toFixed(1)}`
          : `L${x(point.at).toFixed(1)} ${y(point.value).toFixed(1)}`;
      })
      .join(' ');
  const line = runs.map(pathOf).join(' ');
  const area = runs
    .map(
      (run) =>
        `${pathOf(run)} L${x(run.at(-1)?.at ?? window.from).toFixed(1)} ${String(height)} L${x(run[0]?.at ?? window.from).toFixed(1)} ${String(height)} Z`,
    )
    .join(' ');
  const last = points.at(-1);
  const lastX = last === undefined ? 0 : x(last.at);
  const lastY = last === undefined ? height : y(last.value);
  const colours = TONE_CHART[isStale ? 'muted' : tone];
  const moment = pointer.at === null ? null : window.from + pointer.at * (window.to - window.from);
  const gap =
    moment === null ? undefined : gaps.find((each) => moment > each.from && moment < each.to);
  const hovered = moment === null || gap !== undefined ? null : valueAt(points, moment, isStepped);
  const edges = useExactGap(gap, props.readGap) ?? gap;

  return (
    <div className="relative">
      <div
        onPointerMove={pointer.onPointerMove}
        onPointerLeave={pointer.onPointerLeave}
        className="relative cursor-crosshair"
      >
        <Guides at={null} />
        {gaps.length === 0 ? null : (
          // Drawn in with the line, from the left, rather than standing there before it.
          <div aria-hidden="true" className="entity-reveal pointer-events-none absolute inset-0">
            {gaps.map((each) => {
              const left = across(each.from, window);
              const width = Math.max(1e-6, across(each.to, window) - left);

              return (
                <span
                  key={each.from}
                  className={cn(
                    // Faded out at the top and the bottom, so it is a quiet stretch rather than a
                    // block standing in the chart.
                    'absolute inset-y-0 overflow-hidden transition-opacity duration-200',
                    '[mask-image:linear-gradient(to_bottom,transparent,black_35%,black_80%,transparent)]',
                    gap !== undefined && gap !== each && 'opacity-55',
                  )}
                  // eslint-disable-next-line react/forbid-dom-props -- where nothing was recorded, in its place
                  style={{
                    left: `${(left * 100).toFixed(2)}%`,
                    width: `${(width * 100).toFixed(2)}%`,
                  }}
                >
                  {/* One hatching as wide as the chart, seen through each gap, so the stripes of
                      gaps apart from each other line up. */}
                  <span
                    className="absolute inset-y-0 bg-[repeating-linear-gradient(135deg,color-mix(in_oklab,var(--color-foreground-muted)_9%,transparent)_0_1.5px,transparent_1.5px_6px)]"
                    // eslint-disable-next-line react/forbid-dom-props -- the chart's width, set back to its left edge
                    style={{
                      left: `${((-left / width) * 100).toFixed(2)}%`,
                      width: `${(100 / width).toFixed(2)}%`,
                    }}
                  />
                </span>
              );
            })}
          </div>
        )}
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${String(WIDTH)} ${String(height)}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={label}
          className={cn('entity-reveal relative block', colours.fill)}
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
                <path
                  d={`M${lastX.toFixed(1)} ${lastY.toFixed(1)} L${String(WIDTH)} ${lastY.toFixed(1)}`}
                  fill="none"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  vectorEffect="non-scaling-stroke"
                  className={colours.stroke}
                />
              ) : null}
            </>
          )}
        </svg>
        {runs.map((run) => {
          const [alone] = run;

          // A reading alone between two gaps has no line to be on: it is a dot.
          return run.length !== 1 || alone === undefined ? null : (
            <span
              key={alone.at}
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute size-1.5 -translate-1/2 rounded-full',
                TONE_DOT[isStale ? 'muted' : tone],
              )}
              // eslint-disable-next-line react/forbid-dom-props -- where the lone reading falls
              style={{
                left: `${((x(alone.at) / WIDTH) * 100).toFixed(2)}%`,
                top: y(alone.value),
              }}
            />
          );
        })}
        {isStale && last !== undefined ? (
          <span
            aria-hidden="true"
            className={cn('absolute size-1.75 -translate-1/2 rounded-full', TONE_DOT.muted)}
            // eslint-disable-next-line react/forbid-dom-props -- where the device stopped answering
            style={{ left: `${((lastX / WIDTH) * 100).toFixed(2)}%`, top: lastY }}
          />
        ) : null}
        <Guides at={pointer.at} />
        {pointer.at === null || hovered === null ? null : (
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute size-2.5 -translate-1/2 rounded-full shadow-[0_0_0_3px_var(--color-well)]',
              TONE_DOT[isStale ? 'muted' : tone],
            )}
            // eslint-disable-next-line react/forbid-dom-props -- the dot rides the line under the pointer
            style={{ left: `${(pointer.at * 100).toFixed(2)}%`, top: y(hovered) }}
          />
        )}
      </div>
      {pointer.at === null || edges === undefined ? null : (
        <ChartTip
          at={pointer.at}
          tone="muted"
          title={t('entity.sheet.history.noData', 'No data')}
          sub={t('entity.sheet.history.span', '{{from}} – {{to}} · {{duration}}', {
            from: momentText(edges.from, window),
            to: momentText(edges.to, window),
            duration: durationText(edges.to - edges.from),
          })}
        />
      )}
      {pointer.at === null || hovered === null || moment === null ? null : (
        <ChartTip
          at={pointer.at}
          tone={isStale ? 'muted' : tone}
          title={format(hovered)}
          sub={momentText(moment, window)}
        />
      )}
    </div>
  );
}

/**
 * The place of the three figures under a chart while its history is read, as tall as they will
 * be, so the dialog keeps its height as they arrive.
 *
 * @param props - How they are drawn.
 * @param props.isBoxed - Whether each figure is boxed, as under a drawer's chart.
 * @returns The placeholders.
 */
export function StatsLoading(props: { readonly isBoxed?: boolean }) {
  return (
    <div aria-hidden="true" className="grid grid-cols-3 gap-2">
      {['first', 'second', 'third'].map((place) => (
        <div
          key={place}
          className={cn(
            'flex flex-col gap-1.5 py-px',
            props.isBoxed === true && 'rounded-inner border border-border bg-well p-3',
          )}
        >
          <span className="entity-loading h-3.5 w-3/5 rounded-chip" />
          <span className="entity-loading h-5.5 w-4/5 rounded-chip" />
        </div>
      ))}
    </div>
  );
}

/** What the place of a chart being read needs. */
export type ChartLoadingProps = {
  /** Its height, as a class: the chart's own. */
  readonly className: string;
};

/**
 * The place of a chart while its history is read: as tall as the chart will be, with a light
 * passing over it, so the dialog does not draw an empty chart and then jump.
 *
 * @param props - See {@link ChartLoadingProps}.
 * @returns The placeholder.
 */
export function ChartLoading(props: ChartLoadingProps) {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      aria-label={t('entity.sheet.history.loading', 'Reading the history')}
      className={cn('entity-loading rounded-tile', props.className)}
    />
  );
}

/** One stretch of a timeline of words: a text sensor reading one of its values for a while. */
export type Stretch = {
  readonly from: number;
  readonly to: number;
  readonly value: string;
};

/** What the timeline of words needs. */
export type StretchChartProps = {
  /** The stretches, left to right, covering the window. */
  readonly stretches: readonly Stretch[];

  /** The window they cover. */
  readonly window: TimeWindow;

  /** The colour of a value, as a class: `bg-…`. */
  readonly colourOf: (value: string) => string;

  /** What it shows, to a screen reader. */
  readonly label: string;
};

/**
 * A timeline of a text sensor's values: one block per stretch, as long as it lasted, each in its
 * value's colour; under the pointer, the value and how long it held.
 *
 * @param props - See {@link StretchChartProps}.
 * @returns The timeline.
 */
export function StretchChart(props: StretchChartProps) {
  const { t } = useTranslation();
  const { stretches, window, colourOf, label } = props;
  const pointer = usePointer();
  const moment = pointer.at === null ? null : window.from + pointer.at * (window.to - window.from);
  const hovered =
    moment === null
      ? undefined
      : stretches.find((stretch) => moment >= stretch.from && moment <= stretch.to);

  return (
    <div className="relative">
      <div
        role="img"
        aria-label={label}
        onPointerMove={pointer.onPointerMove}
        onPointerLeave={pointer.onPointerLeave}
        className="flex h-9 cursor-crosshair gap-0.5 overflow-hidden rounded-chip"
      >
        {stretches.map((stretch, index) => (
          <span
            key={stretch.from}
            className={cn(
              'entity-grow-x transition-opacity duration-200',
              colourOf(stretch.value),
              hovered !== undefined && hovered !== stretch && 'opacity-45',
            )}
            // eslint-disable-next-line react/forbid-dom-props -- each stretch as long as it lasted
            style={{ flex: `${String(stretch.to - stretch.from)} 1 0`, ['--i' as string]: index }}
          />
        ))}
      </div>
      {pointer.at === null || hovered === undefined ? null : (
        <ChartTip
          at={pointer.at}
          tone="muted"
          dot={colourOf(hovered.value)}
          title={hovered.value}
          sub={t('entity.sheet.history.span', '{{from}} – {{to}} · {{duration}}', {
            from: momentText(hovered.from, window),
            to: momentText(hovered.to, window),
            duration: durationText(hovered.to - hovered.from),
          })}
        />
      )}
    </div>
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

  /** The window the slots divide. */
  readonly window: TimeWindow;

  /** Its colour. */
  readonly tone: SheetTone;

  /** What it shows, to a screen reader. */
  readonly label: string;

  /** Writes a bar's value for the tooltip, with its unit: "1.2 kWh". */
  readonly format?: (value: number) => string;
};

/**
 * Bars of a running total, one per hour of the day or per day of the week or month, grown from
 * the floor one after another; under the pointer, how much its slot added and when - or that
 * nothing was recorded in it.
 *
 * @param props - See {@link TotalBarsProps}.
 * @returns The bars.
 */
export function TotalBars(props: TotalBarsProps) {
  const { t } = useTranslation();
  const { bars, window, tone, label } = props;
  const pointer = usePointer();
  const highest = Math.max(1e-9, ...bars.map((bar) => bar ?? 0));
  const hovered =
    pointer.at === null ? null : Math.min(bars.length - 1, Math.floor(pointer.at * bars.length));
  const slot = (window.to - window.from) / Math.max(1, bars.length);
  const value = hovered === null ? undefined : bars[hovered];
  /**
   * Writes a bar's value.
   *
   * @param each - The value.
   * @returns It, with its unit.
   */
  const format = props.format ?? ((each: number): string => String(Math.round(each * 100) / 100));

  return (
    <div className="relative">
      <div
        role="img"
        aria-label={label}
        onPointerMove={pointer.onPointerMove}
        onPointerLeave={pointer.onPointerLeave}
        className="flex h-32 cursor-crosshair items-end gap-0.75"
      >
        {bars.map((bar, index) => (
          <span
            // eslint-disable-next-line react/no-array-index-key -- a bar is its slot
            key={index}
            className={cn(
              'min-w-0 flex-1 rounded-t-[3px] transition-opacity duration-200',
              bar === null ? 'h-0.5 bg-border' : cn('entity-grow-y', TONE_BAND[tone]),
              hovered !== null && hovered !== index && 'opacity-45',
            )}
            // eslint-disable-next-line react/forbid-dom-props -- the bar's height is its value, its place its delay
            style={
              bar === null
                ? undefined
                : {
                    height: `${Math.max(2, (bar / highest) * 100).toFixed(1)}%`,
                    ['--i' as string]: index,
                  }
            }
          />
        ))}
      </div>
      {pointer.at === null || hovered === null ? null : (
        <ChartTip
          at={(hovered + 0.5) / bars.length}
          tone={value === null ? 'muted' : tone}
          title={
            value === null || value === undefined
              ? t('entity.sheet.history.noData', 'No data')
              : format(value)
          }
          sub={t('entity.sheet.history.slotSpan', '{{from}} – {{to}}', {
            from: momentText(window.from + slot * hovered, window),
            to: momentText(window.from + slot * (hovered + 1), window),
          })}
        />
      )}
    </div>
  );
}
