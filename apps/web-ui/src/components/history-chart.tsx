/**
 * A chart of an entity's past: its readings over a window, with the times along the bottom and
 * the values up the side.
 *
 * The same drawing as the live chart - a line in a token colour over a fill that fades to
 * nothing, a gap where there was no reading - with the two things a chart of the past needs that
 * one of the last minute does not: axes, because the window is hours or days and the eye needs a
 * scale to read it against; and a stepped line for a state that holds its value until it
 * changes, since a lamp set to 80% at noon was not at 50% at eleven.
 *
 * It is drawn for the eye: the page around it names the numbers, so the chart is hidden from
 * assistive technology rather than read out as path data.
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

import type { ChartSeries } from '@/components/live-area-chart';

/** What the chart needs. */
export type HistoryChartProps = {
  /** The points, oldest first; `at` in milliseconds since the epoch. */
  readonly data: readonly ({ readonly at: number } & Readonly<Record<string, number | null>>)[];

  /** The lines to draw. */
  readonly series: readonly ChartSeries[];

  /** The window the chart covers, so an empty stretch at either end still shows as time. */
  readonly window: { readonly from: number; readonly to: number };

  /** A line that eases between readings, or one that holds each value until the next. */
  readonly curve: 'smooth' | 'stepped';

  /** How a value reads on the axis and in the tooltip. */
  readonly formatValue: (value: number) => string;

  /** A fixed range for the values, such as 0 to 100; fitted to the data otherwise. */
  readonly domain?: readonly [number, number];
};

/** The tick labels of a window: the time of day inside two days, the date beyond. */
const SHORT = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const DATED = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const FULL = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Past this span the axis names days rather than times. */
const DATED_AFTER_MS = 2 * 86_400_000;

/** What the tooltip needs: what Recharts hands it, and the chart's own series. */
type HistoryTooltipProps = TooltipContentProps<TooltipValueType, number | string> & {
  readonly series: readonly ChartSeries[];
  readonly formatValue: (value: number) => string;
};

/**
 * Draws the tooltip for the point under the pointer.
 *
 * @param props - See {@link HistoryTooltipProps}.
 * @returns The tooltip, or nothing when no point is under the pointer.
 */
function HistoryTooltip(props: HistoryTooltipProps) {
  const { active, payload, label, series, formatValue } = props;

  if (!active || payload.length === 0 || typeof label !== 'number') {
    return null;
  }

  return (
    <div className="flex flex-col gap-1 rounded-field border border-border bg-surface-raised px-3 py-2 text-caption">
      <span className="text-foreground-subtle tabular">{FULL.format(label)}</span>
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
 * @param props - See {@link HistoryChartProps}.
 * @returns The chart.
 */
export function HistoryChart(props: HistoryChartProps) {
  const { data, series, window, curve, formatValue, domain } = props;
  const gradient = useId().replaceAll(':', '');
  const ticks = window.to - window.from > DATED_AFTER_MS ? DATED : SHORT;

  return (
    <div aria-hidden className="size-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={[...data]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
                <stop offset="0%" stopColor={line.color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={line.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>

          <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 4" />
          <XAxis
            dataKey="at"
            type="number"
            scale="time"
            domain={[window.from, window.to]}
            tickFormatter={(at: number) => ticks.format(at)}
            tick={{ fill: 'var(--color-foreground-subtle)', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-border)' }}
            minTickGap={48}
          />
          <YAxis
            domain={domain === undefined ? ['auto', 'auto'] : [...domain]}
            tickFormatter={(value: number) => formatValue(value)}
            tick={{ fill: 'var(--color-foreground-subtle)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <Tooltip
            content={(tooltip) => (
              <HistoryTooltip {...tooltip} series={series} formatValue={formatValue} />
            )}
            cursor={{ stroke: 'var(--color-border-strong)' }}
            isAnimationActive={false}
          />

          {series.map((line) => (
            <Area
              key={line.key}
              type={curve === 'stepped' ? 'stepAfter' : 'monotone'}
              dataKey={line.key}
              stroke={line.color}
              strokeWidth={2}
              fill={`url(#${gradient}-${line.key})`}
              connectNulls={false}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0, fill: line.color }}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
