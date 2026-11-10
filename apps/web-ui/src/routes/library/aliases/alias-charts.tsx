/**
 * The small charts of the Parts tab: each part over the last 24 hours, read from the alias's own
 * state history and ending at now. A number is a line (a step when it is stored: it only moves
 * when told to), on/off and names are bands, a press is its marks; a picture, rooms or a text
 * show their last value. A diamond marks a change a person, an automation or a scene asked for.
 *
 * Only read: no scrubbing, no playhead.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { AliasPartConfig, AliasPartDef, StateHistoryPoint } from '@nebulahome/contracts';

import { partValueOf } from '@/library/alias-model';

/** The span the charts cover. */
export const WINDOW_MS = 24 * 60 * 60 * 1000;

/** A window of time, in milliseconds since the epoch. */
export type ChartWindow = { readonly from: number; readonly to: number };

/** One point of a line. */
export type ChartPoint = { readonly at: number; readonly value: number };

/** One stretch of a band. */
export type ChartSegment = { readonly from: number; readonly to: number; readonly value: string };

/** A change someone asked for. */
export type ChartMark = { readonly at: number; readonly title: string };

/** What one part's row draws. */
export type PartTrack =
  | { readonly kind: 'line'; readonly points: readonly ChartPoint[]; readonly isStep: boolean }
  | { readonly kind: 'band'; readonly segments: readonly ChartSegment[] }
  | { readonly kind: 'none' };

/** The causes a mark is drawn for: someone asked for the change. */
const ASKED = new Set(['user', 'automation', 'scene']);

/**
 * A value as a band's word.
 *
 * @param value - The value.
 * @returns The word, or null for none.
 */
function bandWord(value: unknown): string | null {
  if (typeof value === 'boolean') {
    return value ? 'on' : 'off';
  }

  return typeof value === 'string' ? value : null;
}

/**
 * What a part's row draws, from the alias's state history.
 *
 * @param def - The part.
 * @param config - Its source, for a stored number's step.
 * @param points - The alias's changes, oldest first.
 * @param window - The window drawn.
 * @param causeOf - A change's cause in words, for a mark's title.
 * @returns The track and the marks.
 */
export function partTrack(
  def: AliasPartDef,
  config: AliasPartConfig | undefined,
  points: readonly StateHistoryPoint[],
  window: ChartWindow,
  causeOf: (point: StateHistoryPoint) => string,
): { readonly track: PartTrack; readonly marks: readonly ChartMark[] } {
  const marks: ChartMark[] = [];
  let previous: unknown;

  for (const point of points) {
    const value = partValueOf(def, point.state);
    const at = point.time.getTime();
    const isChange = JSON.stringify(value) !== JSON.stringify(previous);

    // A command shows on a Stored part: what it set is what the part holds.
    if (
      isChange &&
      config?.from === 'stored' &&
      at >= window.from &&
      point.context !== undefined &&
      ASKED.has(point.context.type)
    ) {
      marks.push({ at, title: causeOf(point) });
    }

    previous = value;
  }

  if (def.kind === 'number') {
    const line = points.flatMap((point) => {
      const value = partValueOf(def, point.state);

      return typeof value === 'number' && point.isAvailable
        ? [{ at: Math.max(point.time.getTime(), window.from), value }]
        : [];
    });

    return {
      track:
        line.length === 0
          ? { kind: 'none' }
          : { kind: 'line', points: line, isStep: config?.from === 'stored' },
      marks,
    };
  }

  if (def.kind === 'boolean' || def.kind === 'enum') {
    const segments: ChartSegment[] = [];

    for (const [index, point] of points.entries()) {
      const word = point.isAvailable ? bandWord(partValueOf(def, point.state)) : null;
      const next = points[index + 1];
      const from = Math.max(point.time.getTime(), window.from);
      const to = next === undefined ? window.to : next.time.getTime();
      const last = segments.at(-1);

      if (word === null || to <= from) {
        continue;
      }

      if (last?.value === word && last.to === from) {
        segments[segments.length - 1] = { ...last, to };
      } else {
        segments.push({ from, to, value: word });
      }
    }

    return { track: segments.length === 0 ? { kind: 'none' } : { kind: 'band', segments }, marks };
  }

  return { track: { kind: 'none' }, marks };
}

/** Words a band draws faint: nothing is happening. */
const QUIET = new Set(['off', 'idle', 'stopped', 'closed', 'locked', 'docked', 'none', 'standby']);

/**
 * The colour of a band's stretch.
 *
 * @param value - Its word.
 * @param order - The band's words, in the order first seen.
 * @returns The classes.
 */
export function bandLook(value: string, order: readonly string[]): string {
  if (QUIET.has(value)) {
    return 'bg-foreground/[0.07]';
  }

  if (value === 'heating' || value === 'heat') {
    return 'bg-heat';
  }

  if (value === 'cooling' || value === 'cool') {
    return 'bg-cyan';
  }

  const shades = ['bg-primary/60', 'bg-primary/35', 'bg-foreground/25', 'bg-primary/20'];

  return shades[Math.max(0, order.indexOf(value)) % shades.length] ?? 'bg-foreground/25';
}

/**
 * Where a time falls across the window, as a share.
 *
 * @param at - The time.
 * @param window - The window.
 * @returns From 0 to 1.
 */
function share(at: number, window: ChartWindow): number {
  return Math.min(1, Math.max(0, (at - window.from) / (window.to - window.from)));
}

/**
 * A line's path, in the chart's 240 × 36 box.
 *
 * @param points - The points, oldest first.
 * @param window - The window.
 * @param range - The values at the bottom and the top.
 * @param range.lo - The bottom.
 * @param range.hi - The top.
 * @param isStep - Whether it holds each value until the next.
 * @returns The path.
 */
function linePath(
  points: readonly ChartPoint[],
  window: ChartWindow,
  range: { readonly lo: number; readonly hi: number },
  isStep: boolean,
): string {
  /**
   * A value's height, as the path writes it.
   *
   * @param value - The value.
   * @returns The y.
   */
  const y = (value: number): string => yOf(value, range).toFixed(1);
  /**
   * A time's place across, as the path writes it.
   *
   * @param at - The time.
   * @returns The x.
   */
  const x = (at: number): string => (share(at, window) * 240).toFixed(1);
  let path = '';

  for (const [index, point] of points.entries()) {
    if (index === 0) {
      path = `M${x(point.at)} ${y(point.value)}`;
    } else if (isStep) {
      path += ` H${x(point.at)} V${y(point.value)}`;
    } else {
      path += ` L${x(point.at)} ${y(point.value)}`;
    }
  }

  const last = points.at(-1);

  return last === undefined ? path : `${path} H240`;
}

/**
 * Where a value sits in the box.
 *
 * @param value - The value.
 * @param range - The values at the bottom and the top.
 * @param range.lo - The bottom.
 * @param range.hi - The top.
 * @returns The y, from 5 (the top) to 31 (the bottom).
 */
function yOf(value: number, range: { readonly lo: number; readonly hi: number }): number {
  const span = range.hi - range.lo;

  return span === 0 ? 18 : 31 - ((value - range.lo) / span) * 26;
}

/**
 * The values a line spans, with room above and below.
 *
 * @param lines - Every line drawn in the row.
 * @returns The bottom and the top.
 */
function rangeOf(lines: readonly (readonly ChartPoint[])[]): { lo: number; hi: number } {
  const values = lines.flat().map((point) => point.value);

  if (values.length === 0) {
    return { lo: 0, hi: 1 };
  }

  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = hi === lo ? Math.max(1, Math.abs(hi) * 0.05) : (hi - lo) * 0.08;

  return { lo: lo - pad, hi: hi + pad };
}

/** What a part's chart needs. */
export type PartChartProps = {
  readonly track: PartTrack;
  readonly marks: readonly ChartMark[];
  readonly window: ChartWindow;

  /** An edited source worked out over the same window, drawn dashed. */
  readonly edited?: readonly ChartPoint[] | undefined;

  /** The line's colour, as a text-colour class. */
  readonly tone?: string;
};

/**
 * One part's chart.
 *
 * @param props - See {@link PartChartProps}.
 * @returns The chart, or "No values yet".
 */
export function PartChart(props: PartChartProps) {
  const { track, marks, window, edited, tone = 'text-primary' } = props;

  if (track.kind === 'none' && (edited === undefined || edited.length === 0)) {
    return <NoValues />;
  }

  if (track.kind === 'band') {
    const order = [...new Set(track.segments.map((segment) => segment.value))];

    return (
      <>
        <span aria-hidden="true" className="absolute inset-x-0 top-[18px] h-px bg-border" />
        {track.segments.map((segment) => (
          <span
            key={segment.from}
            title={segment.value}
            className={`absolute top-[11px] h-[14px] rounded-[3px] ${bandLook(segment.value, order)}`}
            // eslint-disable-next-line react/forbid-dom-props -- a stretch spans its own share of the day
            style={{
              left: `${String(share(segment.from, window) * 100)}%`,
              width: `calc(${String((share(segment.to, window) - share(segment.from, window)) * 100)}% - 1px)`,
            }}
          />
        ))}
        <Marks marks={marks} window={window} top={18} />
      </>
    );
  }

  const line = track.kind === 'line' ? track.points : [];
  const range = rangeOf([line, edited ?? []]);
  const last = line.at(-1);

  return (
    <>
      <svg
        aria-hidden="true"
        viewBox="0 0 240 36"
        preserveAspectRatio="none"
        className={`absolute inset-0 h-full w-full ${edited === undefined ? tone : 'text-foreground-subtle'}`}
      >
        {line.length === 0 ? null : (
          <>
            {edited === undefined && track.kind === 'line' && !track.isStep ? (
              <path
                d={`${linePath(line, window, range, false)} V36 H${(share(line[0]?.at ?? window.from, window) * 240).toFixed(1)} Z`}
                fill="currentColor"
                opacity="0.1"
                stroke="none"
              />
            ) : null}
            <path
              d={linePath(line, window, range, track.kind === 'line' && track.isStep)}
              fill="none"
              stroke="currentColor"
              strokeWidth={edited === undefined ? 1.5 : 1.25}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>
      {edited === undefined || edited.length === 0 ? null : (
        <svg
          aria-hidden="true"
          viewBox="0 0 240 36"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full text-violet"
        >
          <path
            d={linePath(edited, window, range, false)}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
      {last === undefined ? null : (
        <span
          aria-hidden="true"
          className={`absolute right-[-3.5px] size-[7px] rounded-full ring-2 ring-surface ${
            edited === undefined ? tone.replace('text-', 'bg-') : 'bg-foreground-subtle'
          }`}
          // eslint-disable-next-line react/forbid-dom-props -- the dot sits at the last value's height
          style={{ top: yOf(last.value, range) - 3.5 }}
        />
      )}
      <Marks
        marks={marks}
        window={window}
        top={(at) => {
          const before = line.findLast((point) => point.at <= at) ?? line[0];

          return before === undefined ? 18 : yOf(before.value, range);
        }}
      />
    </>
  );
}

/**
 * The marks of changes someone asked for.
 *
 * @param props - The marks, the window and where each sits.
 * @param props.marks - The marks.
 * @param props.window - The window.
 * @param props.top - Their height in the box, or the height at a time.
 * @returns The marks.
 */
function Marks(props: {
  readonly marks: readonly ChartMark[];
  readonly window: ChartWindow;
  readonly top: number | ((at: number) => number);
}) {
  const { marks, window, top } = props;

  return (
    <>
      {marks.map((mark) => (
        <span
          key={mark.at}
          title={mark.title}
          className="absolute size-[7px] rotate-45 rounded-[1.5px] bg-foreground ring-2 ring-surface"
          // eslint-disable-next-line react/forbid-dom-props -- a mark sits at its own time and height
          style={{
            left: `calc(${String(share(mark.at, window) * 100)}% - 3.5px)`,
            top: (typeof top === 'number' ? top : top(mark.at)) - 3.5,
          }}
        />
      ))}
    </>
  );
}

/**
 * The box of a part with no history in the window.
 *
 * @param props - What it says.
 * @param props.children - The words, when not the default.
 * @returns The box.
 */
export function NoValues(props: { readonly children?: ReactNode }) {
  const { t } = useTranslation();

  return (
    <span className="absolute inset-0 flex items-center rounded-[6px] border border-dashed border-border px-3 text-caption text-foreground-subtle">
      {props.children ?? t('library.aliasPage.noValues', 'No values yet')}
    </span>
  );
}
