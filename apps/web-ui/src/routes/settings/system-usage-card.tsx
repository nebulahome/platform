/**
 * One reading with a ceiling - the processor, the memory - as a ring and a quarter of an hour.
 *
 * The ring answers "how full", the chart "and lately", and the lines beside the ring say what
 * the machine has, so a 90% on two cores and one on thirty-two are not read the same way.
 */
import { Panel } from '@nebulahome/ui';

import { LiveAreaChart } from '@/components/live-area-chart';
import { UsageRing } from '@/components/usage-ring';
import { formatPercent } from '@/lib/format-bytes';
import type { ChartPoint } from '@/system/system-readings';

/** What the card needs. */
export type SystemUsageCardProps = {
  /** What is measured: `Processor`, `Memory`. */
  readonly title: string;

  /** The share in use now, or null for none. */
  readonly percent: number | null;

  /** What the machine has, one line each and each different: the model, the cores, the bytes. */
  readonly details: readonly string[];

  /** The quarter of an hour, oldest first. */
  readonly series: readonly ChartPoint[];

  /** A colour token: `var(--color-primary)`. */
  readonly color: string;

  /** The same colour as a background class: `bg-primary`. */
  readonly dotClass: string;
};

/**
 * Renders the card.
 *
 * @param props - See {@link SystemUsageCardProps}.
 * @returns The card.
 */
export function SystemUsageCard(props: SystemUsageCardProps) {
  const { title, percent, details, series, color, dotClass } = props;

  return (
    // A grid cell is as wide as its longest word unless told otherwise, and a processor's name
    // is a long word: without the floor it pushes the card past the page on a phone.
    <Panel title={title} className="min-w-0">
      <div className="flex items-center gap-5 px-4 pt-4">
        <UsageRing percent={percent} color={color} />

        <div className="flex min-w-0 flex-col gap-1">
          <span className="sr-only">
            {title} at {formatPercent(percent)}
          </span>
          {details.map((detail, index) => (
            <span
              key={detail}
              className={
                index === 0
                  ? 'truncate text-ui text-foreground'
                  : 'truncate text-caption text-foreground-subtle'
              }
            >
              {detail}
            </span>
          ))}
        </div>
      </div>

      <div className="h-28 px-2 pt-2">
        <LiveAreaChart
          data={series.map((point) => ({ at: point.at, value: point.value }))}
          series={[{ key: 'value', label: title, color, dotClass }]}
          domain={[0, 100]}
          formatValue={(value) => formatPercent(value)}
        />
      </div>

      <p className="px-4 pt-2.5 pb-3.5 text-label text-foreground-subtle uppercase">
        Last 15 minutes
      </p>
    </Panel>
  );
}
