/**
 * An entity's History panel: how it has behaved over the last hour, day, week or month.
 *
 * A sensor is drawn from its telemetry, as a line of readings. Anything else is drawn from its
 * state changes: the numbers in its state - a lamp's brightness, a cover's position - as a line
 * that holds each value until the next change; whether it was on as a band; and the last few
 * changes with what caused them. The window is chosen in the panel's header and the data is read
 * again every minute, so a page left open keeps drawing to now.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import type { EntityView, JsonObject } from '@nebula-home/contracts';
import { Panel, Segmented } from '@nebula-home/ui';

import { HistoryChart } from '@/components/history-chart';
import { toMessage } from '@/lib/error-message';
import { fetchStateHistory, fetchTelemetry, LIBRARY_QUERY_KEYS } from '@/library/api';
import { hasCapability } from '@/library/entity-control';
import { describeState, type Reading } from '@/library/entity-reading';
import {
  HISTORY_RANGES,
  numericFieldsOf,
  numericSeries,
  stateSegments,
  telemetryResolutionFor,
  windowOf,
  type HistoryRange,
} from '@/library/history-series';
import { RecentChanges } from '@/routes/library/entity/recent-changes';
import { StateBand } from '@/routes/library/entity/state-band';

/** How often an open panel reads the window again. */
const REFRESH_MS = 60_000;

/** How a figure is written on the chart. */
const numbers = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

/** The window choices, as the header offers them. */
const RANGE_OPTIONS = HISTORY_RANGES.map((range) => ({ value: range, label: range }));

/** What the panel needs. */
export type HistoryPanelProps = {
  readonly entity: EntityView;

  /** Its reading now, for the unit and for a window with no change in it. */
  readonly reading: Reading;

  /** Its state now, as JSON, for the same reason. */
  readonly current: JsonObject | null;
};

/**
 * The word a band calls its filled state by.
 *
 * @param entity - The entity.
 * @returns "On", "Open", "Detected", "Unlocked" or "Playing".
 */
function activeWordOf(entity: EntityView): string {
  if (hasCapability(entity, 'cover')) {
    return 'Open';
  }

  if (hasCapability(entity, 'lock')) {
    return 'Unlocked';
  }

  if (hasCapability(entity, 'media_player')) {
    return 'Playing';
  }

  return hasCapability(entity, 'sensor_binary')
    ? describeState({ sensor_binary: { isOn: true } }, entity)
    : 'On';
}

/**
 * Renders the panel.
 *
 * @param props - See {@link HistoryPanelProps}.
 * @returns The panel.
 */
export function HistoryPanel(props: HistoryPanelProps) {
  const { entity, reading, current } = props;
  const [range, setRange] = useState<HistoryRange>('24h');
  const [fieldIndex, setFieldIndex] = useState(0);
  const isNumeric = hasCapability(entity, 'sensor_numeric');
  const fields = numericFieldsOf(entity);
  const unit = reading.sensorFigure?.unit ?? entity.unitOfMeasurement ?? '';

  const telemetry = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.history, entity.entityId, 'telemetry', range],
    /**
     * Reads the window's readings.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the reads when the panel goes away.
     * @returns The window and its readings.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const window = windowOf(range, Date.now());
      const points = await fetchTelemetry(
        { entityId: entity.entityId, from: new Date(window.from), to: new Date(window.to) },
        telemetryResolutionFor(range),
        signal,
      );

      return { window, points };
    },
    enabled: isNumeric,
    refetchInterval: REFRESH_MS,
  });

  const changes = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.history, entity.entityId, 'state', range],
    /**
     * Reads the window's state changes.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the reads when the panel goes away.
     * @returns The window and its changes.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const window = windowOf(range, Date.now());
      const points = await fetchStateHistory(
        { entityId: entity.entityId, from: new Date(window.from), to: new Date(window.to) },
        signal,
      );

      return { window, points };
    },
    enabled: !isNumeric,
    refetchInterval: REFRESH_MS,
  });

  const query = isNumeric ? telemetry : changes;
  const segments =
    changes.data === undefined
      ? []
      : stateSegments(
          changes.data.points,
          changes.data.window,
          { state: current, isAvailable: reading.isAvailable },
          (state) => describeState(state, entity),
        );
  const field = fields[Math.min(fieldIndex, fields.length - 1)];

  return (
    <Panel
      title="History"
      action={
        <Segmented
          label="Window"
          size="compact"
          options={RANGE_OPTIONS}
          value={range}
          onChange={setRange}
        />
      }
    >
      <div className="flex flex-col gap-4 px-4 py-4">
        {query.isPending ? (
          <p className="text-caption text-foreground-subtle">Reading…</p>
        ) : query.error === null ? null : (
          <p role="alert" className="text-ui text-danger">
            {toMessage(query.error)}
          </p>
        )}

        {isNumeric && telemetry.data !== undefined ? (
          telemetry.data.points.length === 0 ? (
            <p className="text-caption text-foreground-subtle">Nothing recorded in this window.</p>
          ) : (
            <div className="h-56">
              <HistoryChart
                data={telemetry.data.points.map((point) => ({
                  at: point.time.getTime(),
                  value: point.value,
                }))}
                series={[
                  {
                    key: 'value',
                    label: reading.sensorFigure?.classLabel ?? 'Reading',
                    color: 'var(--color-primary)',
                    dotClass: 'bg-primary',
                  },
                ]}
                window={telemetry.data.window}
                curve="smooth"
                formatValue={(value) =>
                  unit === '' ? numbers.format(value) : `${numbers.format(value)} ${unit}`
                }
              />
            </div>
          )
        ) : null}

        {!isNumeric && changes.data !== undefined ? (
          <>
            {field === undefined ? null : (
              <div className="flex flex-col gap-2">
                {fields.length > 1 ? (
                  <Segmented
                    label="Line"
                    size="compact"
                    className="self-start"
                    options={fields.map((candidate, index) => ({
                      value: String(index),
                      label: candidate.label,
                    }))}
                    value={String(fields.indexOf(field))}
                    onChange={(value) => {
                      setFieldIndex(Number(value));
                    }}
                  />
                ) : null}
                <div className="h-48">
                  <HistoryChart
                    data={numericSeries(changes.data.points, [field], changes.data.window, current)}
                    series={[
                      {
                        key: 'f0',
                        label: field.label,
                        color: 'var(--color-tag-amber)',
                        dotClass: 'bg-tag-amber',
                      },
                    ]}
                    window={changes.data.window}
                    curve="stepped"
                    {...(field.unit === '%' ? { domain: [0, 100] as const } : {})}
                    formatValue={(value) => `${numbers.format(value)} ${field.unit}`}
                  />
                </div>
              </div>
            )}
            {segments.length === 0 ? null : (
              <StateBand
                segments={segments}
                window={changes.data.window}
                activeWord={activeWordOf(entity)}
              />
            )}
            <RecentChanges entity={entity} points={changes.data.points} />
          </>
        ) : null}
      </div>
    </Panel>
  );
}
