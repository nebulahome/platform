/**
 * How busy a container is: its processor and its memory, over the last 15 minutes, hour or day.
 *
 * Fifteen minutes is the supervisor's own samples, which come with the container. An hour and a
 * day are read from the container's processor and memory entities - the supervisor reports them
 * to the house like any device's - at the resolution a window that long is drawn at. Each chart
 * says its last value, its average and its peak over the window shown.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ContainerDetail } from '@nebulahome/contracts';
import { Section, Segmented } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { LiveAreaChart } from '@/components/live-area-chart';
import { defineMessage, type Message, text, translate } from '@/i18n/messages';
import { formatBytes, formatPercent } from '@/lib/format-bytes';
import { fetchDevices, fetchTelemetry, LIBRARY_QUERY_KEYS } from '@/library/api';
import { telemetryResolutionFor } from '@/library/history-series';

/** The windows the charts can show. */
const RANGES = ['15m', '1h', '24h'] as const;

/** One window. */
type UsageRange = (typeof RANGES)[number];

/** How long each window is. */
const RANGE_MS: Readonly<Record<UsageRange, number>> = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '24h': 24 * 60 * 60_000,
};

/** What each window is called. */
const RANGE_LABELS: Readonly<Record<UsageRange, Message>> = {
  '15m': defineMessage('containers.containerUsage.n15Min', '15 min'),
  '1h': defineMessage('containers.containerUsage.n1H', '1 h'),
  '24h': defineMessage('containers.containerUsage.n24H', '24 h'),
};

/** A point of a chart. */
type Point = { readonly at: number; readonly value: number | null };

/**
 * The average and the peak of a series, in words.
 *
 * @param points - The series.
 * @returns "avg 1.1% · peak 1.6%", or nothing for an empty series.
 */
function spread(points: readonly Point[]): string | null {
  const values = points.flatMap((point) => (point.value === null ? [] : [point.value]));

  if (values.length === 0) {
    return null;
  }

  const average = values.reduce((sum, value) => sum + value, 0) / values.length;

  return translate(
    'containers.containerUsage.avgAveragePeakMax',
    'avg {{average}}% · peak {{max}}%',
    { average: average.toFixed(1), max: Math.max(...values).toFixed(1) },
  );
}

/**
 * Reads one of the container's entities over a window, for an hour or a day.
 *
 * @param entityId - The entity, when the container has one.
 * @param range - The window.
 * @returns Its readings as chart points, or null while the window is the samples'.
 */
function useReadings(entityId: string | undefined, range: UsageRange): readonly Point[] | null {
  const query = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.history, entityId ?? '', 'usage', range],
    enabled: entityId !== undefined && range !== '15m',
    staleTime: 60_000,

    /**
     * Reads the readings.
     *
     * @param context - The abort signal.
     * @param context.signal - Cancels the reads.
     * @returns The readings.
     */
    queryFn: async ({ signal }) => {
      // The window ends at the minute the read starts: read when asked, not when drawn.
      const to = Math.floor(Date.now() / 60_000) * 60_000;
      const window = { from: to - RANGE_MS[range], to };

      return fetchTelemetry(
        { entityId: entityId ?? '', from: new Date(window.from), to: new Date(window.to) },
        telemetryResolutionFor(window),
        signal,
      );
    },
  });

  if (range === '15m') {
    return null;
  }

  return (query.data ?? []).map((point) => ({ at: point.time.getTime(), value: point.value }));
}

/** What one chart needs. */
type ChartProps = {
  readonly title: string;
  readonly value: string;
  readonly meta: string | null;
  readonly points: readonly Point[];
  readonly color: string;
  readonly dotClass: string;
};

/**
 * One chart: its name, its value now, its spread, and the line.
 *
 * @param props - See {@link ChartProps}.
 * @returns The chart.
 */
function UsageChart(props: ChartProps) {
  const { title, value, meta, points, color, dotClass } = props;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-ui-sm text-foreground-muted">{title}</span>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-reading-sm text-foreground tabular">{value}</span>
        {meta === null ? null : (
          <span className="text-caption text-foreground-subtle tabular">{meta}</span>
        )}
      </div>
      <div className="h-28">
        <LiveAreaChart
          data={points.map((point) => ({ at: point.at, value: point.value }))}
          series={[{ key: 'value', label: title, color, dotClass }]}
          domain={[0, 100]}
          formatValue={(reading) => formatPercent(reading)}
        />
      </div>
    </div>
  );
}

/** What the usage needs. */
export type ContainerUsageProps = {
  readonly container: ContainerDetail;
};

/**
 * Renders the Usage block.
 *
 * @param props - See {@link ContainerUsageProps}.
 * @returns The block.
 */
export function ContainerUsage(props: ContainerUsageProps) {
  const { t } = useTranslation();

  const { container } = props;
  const [range, setRange] = useState<UsageRange>('15m');
  const canRead = useSession((state) => state.can('device:read') && state.can('history:read'));
  const devices = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.devices,
    enabled: canRead && container.deviceId !== null,

    /**
     * Reads every device; the block keeps the container's.
     *
     * @param context - The abort signal.
     * @param context.signal - Cancels the request.
     * @returns The devices.
     */
    queryFn: async ({ signal }) => fetchDevices(signal),
  });
  const entityIds =
    devices.data?.find((device) => device.id === container.deviceId)?.entityIds ?? [];
  const cpuEntity = entityIds.find((id) => id.endsWith('_cpu_usage'));
  const memoryEntity = entityIds.find((id) => id.endsWith('_memory_usage'));
  const cpuReadings = useReadings(cpuEntity, range);
  const memoryReadings = useReadings(memoryEntity, range);
  const latest = container.samples.at(-1);
  const cpu: readonly Point[] =
    cpuReadings ??
    container.samples.map((sample) => ({ at: sample.at.getTime(), value: sample.cpuPercent }));
  const memory: readonly Point[] =
    memoryReadings ??
    container.samples.map((sample) => ({
      at: sample.at.getTime(),
      value:
        sample.memoryLimitBytes === 0
          ? null
          : (sample.memoryUsedBytes / sample.memoryLimitBytes) * 100,
    }));
  const hasLongerWindows = cpuEntity !== undefined && memoryEntity !== undefined;

  return (
    <Section
      title={t('containers.containerUsage.usage', 'Usage')}
      actions={
        hasLongerWindows ? (
          <Segmented
            label={t('containers.containerUsage.window', 'Window')}
            size="compact"
            options={RANGES.map((each) => ({ value: each, label: text(RANGE_LABELS[each]) }))}
            value={range}
            onChange={setRange}
          />
        ) : (
          <span className="text-caption text-foreground-subtle">
            {t('containers.containerUsage.last15Minutes', 'Last 15 minutes')}
          </span>
        )
      }
    >
      <div className="grid gap-8 rounded-card border border-border bg-surface p-5.5 lg:grid-cols-2">
        <UsageChart
          title={t('containers.containerUsage.processor', 'Processor')}
          value={formatPercent(latest?.cpuPercent ?? null)}
          meta={spread(cpu)}
          points={cpu}
          color="var(--color-cyan)"
          dotClass="bg-cyan"
        />
        <UsageChart
          title={t('containers.containerUsage.memory', 'Memory')}
          value={latest === undefined ? '—' : formatBytes(latest.memoryUsedBytes)}
          meta={
            latest === undefined || latest.memoryLimitBytes === 0
              ? spread(memory)
              : `of ${formatBytes(latest.memoryLimitBytes)}`
          }
          points={memory}
          color="var(--color-violet)"
          dotClass="bg-violet"
        />
      </div>
    </Section>
  );
}
