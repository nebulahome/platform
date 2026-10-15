/**
 * A chart of the last few minutes that moves as readings arrive.
 *
 * Recharts draws it, and every colour it is given is a token - `var(--color-…)` - so it follows
 * the theme the way everything else does, and changes with it. Each series is a line with a
 * fill that fades to nothing below it; a missing reading is a gap in the line rather than a drop
 * to zero, because "no reading" and "zero" are different answers.
 *
 * It eases from one reading to the next unless the person asked for less motion. It is drawn
 * for the eye only: the card around it says the same numbers in words, so the chart is hidden
 * from assistive technology rather than read out as a heap of path data.
 */
import { useId } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipValueType,
} from 'recharts';

import { cn } from '@nebulahome/ui';

import { dateTimeFormat } from '@/i18n/formatters';
import { useReducedMotion } from '@/lib/use-reduced-motion';

/** One line of the chart. */
export type ChartSeries = {
  /** The field of each point it reads. */
  readonly key: string;

  /** What the tooltip calls it. */
  readonly label: string;

  /** A colour token for the line and its fill: `var(--color-primary)`. */
  readonly color: string;

  /** The same colour as a background class, for the tooltip's dot: `bg-primary`. */
  readonly dotClass: string;
};

/** What the chart needs. */
export type LiveAreaChartProps = {
  /** The points, oldest first; `at` in milliseconds since the epoch. */
  readonly data: readonly ({ readonly at: number } & Readonly<Record<string, number | null>>)[];

  /** The lines to draw. */
  readonly series: readonly ChartSeries[];

  /** A fixed range for the values, such as 0 to 100; from zero to the largest by default. */
  readonly domain?: readonly [number, number];

  /** How a value reads in the tooltip. */
  readonly formatValue: (value: number) => string;
};

/** How long easing from one reading to the next takes. */
const EASING_MS = 700;

/**
 * Writes the time of a point.
 *
 * @param at - Milliseconds since the epoch.
 * @returns The time of day, to the second.
 */
function timeOf(at: number): string {
  return dateTimeFormat({ timeStyle: 'medium' }).format(at);
}

/** What the tooltip needs: what Recharts hands it, and the chart's own series. */
type ChartTooltipProps = TooltipContentProps<TooltipValueType, number | string> & {
  readonly series: readonly ChartSeries[];
  readonly formatValue: (value: number) => string;
};

/**
 * Draws the tooltip for the point under the pointer.
 *
 * @param props - See {@link ChartTooltipProps}.
 * @returns The tooltip, or nothing when no point is under the pointer.
 */
function ChartTooltip(props: ChartTooltipProps) {
  const { active, payload, label, series, formatValue } = props;

  if (!active || payload.length === 0 || typeof label !== 'number') {
    return null;
  }

  return (
    <div className="flex flex-col gap-1 rounded-field border border-border bg-surface-raised px-3 py-2 text-caption">
      <span className="text-foreground-subtle tabular">{timeOf(label)}</span>
      {series.map((line) => {
        const value = payload.find((entry) => entry.dataKey === line.key)?.value;

        return (
          <span key={line.key} className="flex items-center gap-2 text-foreground">
            <span aria-hidden className={cn('size-2 rounded-full', line.dotClass)} />
            <span className="text-foreground-muted">{line.label}</span>
            <span className="ml-auto font-medium tabular">
              {typeof value === 'number' ? formatValue(value) : '—'}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/**
 * Renders the chart, filling its parent.
 *
 * @param props - See {@link LiveAreaChartProps}.
 * @returns The chart.
 */
export function LiveAreaChart(props: LiveAreaChartProps) {
  const { data, series, domain, formatValue } = props;
  const isReduced = useReducedMotion();
  const gradient = useId().replaceAll(':', '');

  return (
    <div aria-hidden className="size-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={[...data]} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
          <defs>
            {series.map((line) => (
              <linearGradient
                key={line.key}
                id={`${gradient}-${line.key}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={line.color} stopOpacity={0.32} />
                <stop offset="100%" stopColor={line.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>

          <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 4" />
          <XAxis dataKey="at" type="number" domain={['dataMin', 'dataMax']} hide />
          <YAxis domain={domain === undefined ? [0, 'auto'] : [...domain]} hide />
          <Tooltip
            content={(tooltip) => (
              <ChartTooltip {...tooltip} series={series} formatValue={formatValue} />
            )}
            cursor={{ stroke: 'var(--color-border-strong)' }}
            isAnimationActive={false}
          />

          {series.map((line) => (
            <Area
              key={line.key}
              type="monotone"
              dataKey={line.key}
              stroke={line.color}
              strokeWidth={2}
              fill={`url(#${gradient}-${line.key})`}
              connectNulls={false}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0, fill: line.color }}
              isAnimationActive={!isReduced}
              animationDuration={EASING_MS}
              animationEasing="ease-out"
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
