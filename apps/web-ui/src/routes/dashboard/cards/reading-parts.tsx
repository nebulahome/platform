/**
 * The parts the reading cards are drawn with besides the kit's (`card-kit.tsx`), measure for
 * measure as the boards `K-All`, `K-Capabilities` and `K-New` draw them: the day's area line, the
 * bars of the bar chart, the time under a chart, the switch of its span, the humidity dial, the
 * battery, and the dashed place a chart waits in before there are readings to draw.
 *
 * A reading takes no command, so none of these is a control but the span switch, which only
 * changes what the card shows.
 */
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { EntityView } from '@nebulahome/contracts';
import { cn, Segmented } from '@nebulahome/ui';

import { dateTimeFormat, numberFormat } from '@/i18n/formatters';
import { translate } from '@/i18n/messages';
import type { HistoryRange, TimeWindow } from '@/library/history-series';
import { cardTime, type EntityCardModel } from '@/routes/dashboard/cards/entity-model';
import { HOUR_MS, priceLevels } from '@/routes/dashboard/cards/reading-series';

/** The readings drawn green, as the boards draw power and money; the rest in the sensor's cyan. */
const GREEN_CLASSES: ReadonlySet<string> = new Set(['power', 'energy', 'monetary']);

/**
 * How a reading's card is lit: its head, and the colour of its line and its current bar.
 *
 * @param model - The card.
 * @returns The model its head is drawn with, and the colour.
 */
export function readingLook(model: EntityCardModel): {
  readonly head: EntityCardModel;
  readonly color: string;
} {
  const isGreen = GREEN_CLASSES.has(model.entity.deviceClass ?? '');

  return {
    // A reading takes no command: its head ends on its own time or span, never on the eye.
    head: {
      ...model,
      canControl: true,
      kind: isGreen ? { ...model.kind, tone: 'secure' } : model.kind,
    },
    color: isGreen ? 'var(--color-success)' : 'var(--color-cyan)',
  };
}

/**
 * What a reading card says in place of its own line when it has nothing to say: when it was last
 * heard from, or that it has not spoken yet.
 *
 * @param model - The card.
 * @param hasValue - Whether the entity has ever reported.
 * @returns The line, or null when the card says its own.
 */
export function stateCaption(model: EntityCardModel, hasValue: boolean): string | null {
  if (model.isOffline) {
    return model.changedAt === null
      ? translate('dashboard.cards.kit.unreachable', 'Not reachable')
      : translate('dashboard.cards.kit.lastSeen', 'last seen {{time}}', {
          time: cardTime(model.changedAt),
        });
  }

  return hasValue ? null : translate('dashboard.cards.readingParts.noReadingYet', 'No reading yet');
}

/**
 * How many decimals a reading is written with: its own precision when it declares one, else as
 * many as it has, up to three under one (a price) and two otherwise.
 *
 * @param value - The reading.
 * @param entity - Its declared precision.
 * @returns The decimals: 1 for 21.4, 2 for 3.42, 3 for 0.098.
 */
export function decimalsOf(value: number, entity: Pick<EntityView, 'displayPrecision'>): number {
  if (entity.displayPrecision !== undefined && entity.displayPrecision !== null) {
    return entity.displayPrecision;
  }

  const rounded = Number(value.toFixed(Math.abs(value) < 1 && value !== 0 ? 3 : 2));

  return String(rounded).split('.')[1]?.length ?? 0;
}

/**
 * Writes a reading, or a number worked out from readings - an average, a change - with the
 * decimals the reading itself shows.
 *
 * @param value - The number.
 * @param entity - Its declared precision.
 * @param decimals - How many decimals at most; the number's own by default.
 * @returns "21.4", "3.42", "0.098".
 */
export function formatReading(
  value: number,
  entity: Pick<EntityView, 'displayPrecision'>,
  decimals: number = decimalsOf(value, entity),
): string {
  return numberFormat({
    minimumFractionDigits: Math.min(decimals, entity.displayPrecision ?? 0),
    maximumFractionDigits: decimals,
  }).format(value);
}

/** How wide the line's drawing is, in its own units; it is stretched to the card's width. */
const LINE_WIDTH = 1000;

/** Room kept above the highest reading and below the lowest, in pixels. */
const LINE_TOP = 5;
const LINE_BOTTOM = 2;

/**
 * Renders a reading's past as a thin line over a fill that fades to nothing, across the whole
 * window, the lowest reading at the bottom and the highest at the top.
 *
 * @param props - What to draw.
 * @param props.points - The readings, oldest first; two at least.
 * @param props.window - The window, its start at the left edge and its end at the right.
 * @param props.color - The line's colour, a CSS colour.
 * @param props.height - How tall, in pixels.
 * @param props.hasDot - Whether the last reading is marked with a dot.
 * @returns The chart.
 */
export function AreaLine(props: {
  readonly points: readonly { readonly at: number; readonly value: number }[];
  readonly window: TimeWindow;
  readonly color: string;
  readonly height: number;
  readonly hasDot?: boolean;
}) {
  const { points, window, color, height, hasDot = false } = props;
  const gradient = useId().replaceAll(/[^\w-]/gu, '');
  const values = points.map((point) => point.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = Math.max(1, window.to - window.from);

  /**
   * Where a moment is across the drawing.
   *
   * @param at - The moment.
   * @returns Its x.
   */
  const x = (at: number): string => (((at - window.from) / span) * LINE_WIDTH).toFixed(1);

  /**
   * Where a reading is up the drawing.
   *
   * @param value - The reading.
   * @returns Its y.
   */
  const y = (value: number): string =>
    (high === low
      ? height / 2
      : LINE_TOP + (1 - (value - low) / (high - low)) * (height - LINE_TOP - LINE_BOTTOM)
    ).toFixed(1);
  const first = points[0];
  const last = points.at(-1);

  if (first === undefined || last === undefined) {
    return null;
  }

  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.at)} ${y(point.value)}`)
    .join(' ');

  return (
    <svg
      aria-hidden="true"
      width="100%"
      height={height}
      viewBox={`0 0 ${String(LINE_WIDTH)} ${String(height)}`}
      preserveAspectRatio="none"
      className="block shrink-0"
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity={0.32} />
          <stop offset="1" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path
        d={`${line} L${x(last.at)} ${String(height)} L${x(first.at)} ${String(height)} Z`}
        fill={`url(#${gradient})`}
      />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {hasDot ? (
        // A line of no length with round ends is a dot that stays round however wide the card.
        <path
          d={`M${x(last.at)} ${y(last.value)}h0`}
          stroke={color}
          strokeWidth={7}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  );
}

/** What the bar chart needs. */
export type ReadingBarsProps = {
  /** One a bar, oldest first, the running hour or day last; null where nothing was read. */
  readonly values: readonly (number | null)[];

  /** Whether they are prices: cheap ones green, dear ones amber, the running one ringed. */
  readonly isPrice: boolean;

  /** The running bar's colour, when they are not prices. */
  readonly color: string;

  /** Their height, as the card's size wants it. */
  readonly className: string;

  /** The gap between them, as the card's size wants it. */
  readonly gap: string;

  /** A word under each bar, the running one brighter: the days of a week. */
  readonly labels?: readonly string[] | undefined;

  /** What they show, for a screen reader. */
  readonly label: string;
};

/**
 * Renders a reading's past as one bar an hour or a day, the running one marked (`K-New` Bars).
 *
 * @param props - See {@link ReadingBarsProps}.
 * @returns The bars.
 */
export function ReadingBars(props: ReadingBarsProps) {
  const { values, isPrice, color, className, gap, labels, label } = props;
  // shortcut: bars stand on zero, so a negative reading draws as none; add a baseline if one ever needs it.
  const highest = Math.max(0, ...values.map((value) => value ?? 0));
  const levels = isPrice ? priceLevels(values) : [];
  const isMany = values.length > 12;

  return (
    <div className="flex flex-col gap-1.5">
      <div role="img" aria-label={label} className={cn('flex items-end', className, gap)}>
        {values.map((value, index) => {
          const isCurrent = index === values.length - 1;
          const level = levels[index] ?? null;

          return (
            <span
              // The bars are the hours or days of the window, in order, and never move.
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              className={cn(
                'min-w-0 flex-1 transition-[height] duration-300 ease-out',
                isMany ? 'rounded-[2px]' : 'rounded-[3px]',
                isPrice
                  ? level === 'low'
                    ? 'bg-success'
                    : level === 'high'
                      ? 'bg-warning'
                      : 'bg-foreground-disabled/80'
                  : isCurrent
                    ? undefined
                    : 'bg-surface-high',
                isPrice &&
                  isCurrent &&
                  'shadow-[0_0_0_2px_var(--color-surface),0_0_0_3px_var(--color-foreground)]',
              )}
              /* eslint-disable-next-line react/forbid-dom-props -- a bar is as tall as its reading,
              and the running one is lit in the reading's own colour. */
              style={{
                height:
                  value === null || highest === 0
                    ? 0
                    : `max(2px, ${String((Math.max(0, value) / highest) * 100)}%)`,
                ...(isCurrent && !isPrice ? { background: color } : {}),
              }}
            />
          );
        })}
      </div>
      {labels === undefined ? null : (
        <div
          aria-hidden="true"
          className={cn('flex font-mono text-label tracking-normal text-foreground-subtle', gap)}
        >
          {labels.map((word, index) => (
            <span
              // The words name the bars above them, in the same order.
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              className={cn(
                'min-w-0 flex-1 text-center',
                index === labels.length - 1 && 'text-foreground',
              )}
            >
              {word}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Renders the times under a chart: four moments of the window and "now" at its end.
 *
 * @param props - The window.
 * @param props.window - The window the chart above covers.
 * @returns The axis.
 */
export function TimeAxis(props: { readonly window: TimeWindow }) {
  const { t } = useTranslation();

  const { window } = props;
  const span = window.to - window.from;
  const isDays = span > 2 * 24 * HOUR_MS;
  const quarter = 15 * 60_000;
  const moments = [0, 1, 2, 3].map((index) => window.from + (span * index) / 4);

  return (
    <div className="flex justify-between font-mono text-label tracking-normal text-foreground-subtle">
      {moments.map((at) => (
        <span key={at}>
          {isDays
            ? dateTimeFormat({ weekday: 'short' }).format(at)
            : dateTimeFormat({ hour: '2-digit', minute: '2-digit' }).format(
                Math.round(at / quarter) * quarter,
              )}
        </span>
      ))}
      <span>{t('dashboard.cards.readingParts.now', 'now')}</span>
    </div>
  );
}

/** The spans the square card switches between. */
export type ShownRange = Extract<HistoryRange, '6h' | '24h' | '7d'>;

/**
 * A span as a card writes it.
 *
 * @param range - The span.
 * @returns "6 h", "24 h", "7 d".
 */
export function rangeName(range: HistoryRange): string {
  switch (range) {
    case '1h':
      return translate('dashboard.cards.readingParts.range1h', '1 h');
    case '6h':
      return translate('dashboard.cards.readingParts.range6h', '6 h');
    case '7d':
      return translate('dashboard.cards.readingParts.range7d', '7 d');
    case '30d':
      return translate('dashboard.cards.readingParts.range30d', '30 d');
    default:
      return translate('dashboard.cards.readingParts.range24h', '24 h');
  }
}

/**
 * Renders the switch at the right of a square card's head between 6 h, 24 h and 7 d. It only
 * changes what this card shows, here and now; the card keeps its own span.
 *
 * @param props - The span shown and what to do when another is chosen.
 * @param props.value - The span shown.
 * @param props.onChange - When another is chosen.
 * @returns The switch.
 */
export function RangeSwitch(props: {
  readonly value: ShownRange;
  readonly onChange: (range: ShownRange) => void;
}) {
  const { t } = useTranslation();

  const { value, onChange } = props;
  const ranges: readonly ShownRange[] = ['6h', '24h', '7d'];

  return (
    // Its own taps, not the card's: the face under it opens the entity.
    <span className="pointer-events-auto relative z-10">
      <Segmented
        size="compact"
        label={t('dashboard.cards.readingParts.timeSpan', 'Time span')}
        options={ranges.map((range) => ({ value: range, label: rangeName(range) }))}
        value={value}
        onChange={onChange}
        // The board's switch is the compact one with the medium one's words: 13 px, 14 px aside.
        className="gap-1 p-[3px] [&_label]:px-3.5 [&_label]:text-ui-sm [&>span]:top-[3px] [&>span]:bottom-[3px]"
      />
    </span>
  );
}

/** The dial's middle and the radius of its ring, in its 124-unit box. */
const DIAL_CENTRE = 62;
const DIAL_RADIUS = 57.5;

/** How far round the ring goes: three quarters, open at the bottom. */
const DIAL_SWEEP = 270;

/**
 * A point on the dial's ring.
 *
 * @param fraction - How far round, from 0 at the bottom left to 1 at the bottom right.
 * @returns Its x and y.
 */
function dialPoint(fraction: number): readonly [number, number] {
  const angle = ((-DIAL_SWEEP / 2 + fraction * DIAL_SWEEP) * Math.PI) / 180;

  return [DIAL_CENTRE + DIAL_RADIUS * Math.sin(angle), DIAL_CENTRE - DIAL_RADIUS * Math.cos(angle)];
}

/**
 * The ring from its start to a point on it.
 *
 * @param fraction - How far round.
 * @returns The path.
 */
function dialArc(fraction: number): string {
  const [fromX, fromY] = dialPoint(0);
  const [toX, toY] = dialPoint(fraction);
  const isLarge = fraction * DIAL_SWEEP > 180 ? 1 : 0;

  return `M${fromX.toFixed(2)} ${fromY.toFixed(2)} A${String(DIAL_RADIUS)} ${String(DIAL_RADIUS)} 0 ${String(isLarge)} 1 ${toX.toFixed(2)} ${toY.toFixed(2)}`;
}

/**
 * Renders a percentage as a three-quarter ring with a knob at the value, and the reading inside.
 *
 * @param props - What it shows.
 * @param props.percent - The percentage, or null before the first reading.
 * @param props.color - The ring's colour up to the value.
 * @param props.children - What is written inside: the figure and a word.
 * @returns The dial.
 */
export function Dial(props: {
  readonly percent: number | null;
  readonly color: string;
  readonly children: ReactNode;
}) {
  const { percent, color, children } = props;
  const fraction = percent === null ? 0 : Math.min(1, Math.max(0, percent / 100));
  const [knobX, knobY] = dialPoint(fraction);

  return (
    <div className="relative size-31 shrink-0">
      <svg aria-hidden="true" viewBox="0 0 124 124" className="size-full">
        <path
          d={dialArc(1)}
          fill="none"
          stroke="var(--color-surface-high)"
          strokeWidth={9}
          strokeLinecap="round"
        />
        {percent === null ? null : (
          <>
            {fraction > 0 ? (
              <path
                d={dialArc(fraction)}
                fill="none"
                stroke={color}
                strokeWidth={9}
                strokeLinecap="round"
              />
            ) : null}
            <circle cx={knobX} cy={knobY} r={6.5} fill="var(--color-foreground)" />
          </>
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        {children}
      </div>
    </div>
  );
}

/** At or under this, a battery wants replacing. */
export const LOW_BATTERY = 20;

/**
 * Renders a battery as a small glyph filled to its level, amber when low.
 *
 * @param props - The level.
 * @param props.percent - How full, 0 to 100.
 * @returns The glyph.
 */
export function BatteryGlyph(props: { readonly percent: number }) {
  const { percent } = props;

  return (
    <span
      aria-hidden="true"
      className="relative flex h-4 w-8.5 rounded-[4px] border-[1.5px] border-foreground-muted p-0.5"
    >
      <span
        className={cn(
          'h-full rounded-[1px] transition-[width] duration-300',
          percent <= LOW_BATTERY ? 'bg-warning' : 'bg-success',
        )}
        /* eslint-disable-next-line react/forbid-dom-props -- filled as far as the battery is. */
        style={{ width: `${String(Math.min(100, Math.max(0, percent)))}%` }}
      />
      <span className="absolute top-1 -right-1 h-[5px] w-0.5 rounded-[1px] bg-foreground-muted" />
    </span>
  );
}

/**
 * Renders the place a chart waits in until there are readings to draw: a dashed line above, and
 * why it is empty.
 *
 * @param props - Its size.
 * @param props.className - Its height, as the card's size wants it.
 * @param props.isWrapped - Whether the words go on two lines, on a narrow card.
 * @returns The place.
 */
export function NoHistory(props: { readonly className: string; readonly isWrapped?: boolean }) {
  const { t } = useTranslation();

  const { className, isWrapped = false } = props;

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center border-t border-dashed border-border-strong text-center text-caption leading-normal text-foreground-subtle',
        isWrapped ? 'whitespace-pre-line' : undefined,
        className,
      )}
    >
      {t('dashboard.cards.readingParts.chartStarts', 'The chart starts\nwith the next readings')}
    </div>
  );
}
