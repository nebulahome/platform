/**
 * An entity's History: how it has behaved over whatever stretch of time is asked, and its recent
 * changes with what caused them.
 *
 * As the board draws it: the window chosen by the presets beside the heading - 1 h, 6 h, 24 h,
 * 7 d, 30 d - or Custom… for any stretch by its two ends; a row of figures over the window; the
 * chart; and a line saying the times are the viewer's own, with Show as a table for whoever
 * would rather read the values. A reading is drawn from its telemetry and its figures are now,
 * lowest, average and highest; anything else from its state changes - the numbers in its state as
 * a line that holds each value, whether it was on as a band - and its figures are how long it was
 * on and how often it turned on.
 *
 * A preset is read again every minute, so a page left open keeps drawing to now; a stretch chosen
 * by its ends is the past, and is read once.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { EntityView, JsonObject } from '@nebulahome/contracts';
import { AppIcon, Section, Segmented } from '@nebulahome/ui';

import { HistoryChart } from '@/components/history-chart';
import { TimeRangePicker } from '@/components/time-range-picker';
import { dateTimeFormat, numberFormat } from '@/i18n/formatters';
import { defineMessage, type Message, text, translate } from '@/i18n/messages';
import { toMessage } from '@/lib/error-message';
import { absoluteTime } from '@/lib/format-time';
import { fetchStateHistory, fetchTelemetry, LIBRARY_QUERY_KEYS } from '@/library/api';
import { hasCapability } from '@/library/entity-control';
import { describeState, type Reading } from '@/library/entity-reading';
import {
  HISTORY_RANGES,
  numericFieldsOf,
  numericSeries,
  stateSegments,
  telemetryResolutionFor,
  windowOfChoice,
  type HistoryChoice,
  type HistoryRange,
} from '@/library/history-series';
import { activeStats, durationText, numericStats } from '@/library/history-stats';
import { RecentChanges } from '@/routes/library/entity/recent-changes';
import { StateBand } from '@/routes/library/entity/state-band';
import { TransportBand } from '@/routes/library/entity/transport-band';
import { sourceStretches, type EntityWays } from '@/routes/library/entity/transport-panel';

/** How often an open panel reads a window ending now again. */
const REFRESH_MS = 60_000;

/**
 * How a figure is written on the chart.
 *
 * @returns The formatter, in the reader's language.
 */
const numbers = (): Intl.NumberFormat => numberFormat({ maximumFractionDigits: 2 });

/** What the panel shows when it opens. */
const INITIAL_CHOICE: HistoryChoice = { kind: 'preset', range: '24h' };

/** What each preset is called beside the heading. */
const PRESET_LABELS: Readonly<Record<HistoryRange, Message>> = {
  '1h': defineMessage('entity.historyPanel.n1H', '1 h'),
  '6h': defineMessage('entity.historyPanel.n6H', '6 h'),
  '24h': defineMessage('entity.historyPanel.n24H', '24 h'),
  '7d': defineMessage('entity.historyPanel.n7D', '7 d'),
  '30d': defineMessage('entity.historyPanel.n30D', '30 d'),
};

/** The viewer's time zone, for the line under the chart. */
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * The part of the cache key that says which window: the preset's name, shared with the cards
 * that draw the same entity, or the two ends of a stretch.
 *
 * @param choice - The choice.
 * @returns The key parts.
 */
function choiceKey(choice: HistoryChoice): readonly (string | number)[] {
  return choice.kind === 'preset' ? [choice.range] : ['custom', choice.from, choice.to];
}

/** What the panel needs. */
export type HistoryPanelProps = {
  readonly entity: EntityView;

  /** Its reading now, for the unit and for a window with no change in it. */
  readonly reading: Reading;

  /** Its state now, as JSON, for the same reason. */
  readonly current: JsonObject | null;

  /** How it is read, for one read two ways: each change says which way it came in. */
  readonly ways?: EntityWays | null;
};

/**
 * The word a band calls its filled state by.
 *
 * @param entity - The entity.
 * @returns "On", "Open", "Detected", "Unlocked" or "Playing".
 */
function activeWordOf(entity: EntityView): string {
  if (hasCapability(entity, 'cover')) {
    return translate('entity.historyPanel.open', 'Open');
  }

  if (hasCapability(entity, 'lock')) {
    return translate('entity.historyPanel.unlocked', 'Unlocked');
  }

  if (hasCapability(entity, 'media_player')) {
    return translate('entity.historyPanel.playing', 'Playing');
  }

  return hasCapability(entity, 'sensor_binary')
    ? describeState({ sensor_binary: { isOn: true } }, entity)
    : 'On';
}

/** What one figure needs. */
type FigureProps = {
  readonly label: string;
  readonly value: string;
  readonly note?: string | undefined;
};

/**
 * One figure of the row above the chart: what it is, the number in mono, a line under it.
 *
 * @param props - See {@link FigureProps}.
 * @returns The figure.
 */
function Figure(props: FigureProps) {
  const { label, value, note } = props;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-caption text-foreground-subtle">{label}</span>
      <span className="font-mono text-mono-ui text-foreground tabular">{value}</span>
      {note === undefined ? null : (
        <span className="truncate font-mono text-mono-caption text-foreground-subtle">{note}</span>
      )}
    </div>
  );
}

/**
 * Renders the History and the recent changes.
 *
 * @param props - See {@link HistoryPanelProps}.
 * @returns The two blocks.
 */
export function HistoryPanel(props: HistoryPanelProps) {
  const { t } = useTranslation();

  const { entity, reading, current, ways = null } = props;
  const [choice, setChoice] = useState<HistoryChoice>(INITIAL_CHOICE);
  const [fieldIndex, setFieldIndex] = useState(0);
  const [isTable, setTable] = useState(false);
  const isNumeric = hasCapability(entity, 'sensor_numeric');
  const fields = numericFieldsOf(entity);
  const unit = reading.sensorFigure?.unit ?? entity.unitOfMeasurement ?? '';
  const refetchInterval = choice.kind === 'preset' ? REFRESH_MS : false;

  const telemetry = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.history, entity.entityId, 'telemetry', ...choiceKey(choice)],
    /**
     * Reads the window's readings.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the reads when the panel goes away.
     * @returns The window and its readings.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const window = windowOfChoice(choice, Date.now());
      const points = await fetchTelemetry(
        { entityId: entity.entityId, from: new Date(window.from), to: new Date(window.to) },
        telemetryResolutionFor(window),
        signal,
      );

      return { window, points };
    },
    enabled: isNumeric,
    refetchInterval,
  });

  const changes = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.history, entity.entityId, 'state', ...choiceKey(choice)],
    /**
     * Reads the window's state changes.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the reads when the panel goes away.
     * @returns The window and its changes.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const window = windowOfChoice(choice, Date.now());
      const points = await fetchStateHistory(
        { entityId: entity.entityId, from: new Date(window.from), to: new Date(window.to) },
        signal,
      );

      return { window, points };
    },
    // A reading read two ways reads its rows too: they say which way each came in.
    enabled: !isNumeric || ways !== null,
    refetchInterval,
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
  const stats = telemetry.data === undefined ? null : numericStats(telemetry.data.points);
  const active = activeStats(segments);
  /**
   * A value with the entity's unit.
   *
   * @param value - The value.
   * @returns "21.4 °C".
   */
  const withUnit = (value: number): string =>
    unit === '' ? numbers().format(value) : `${numbers().format(value)} ${unit}`;
  const isBanded = segments.some((segment) => segment.isActive);
  const stretches =
    ways === null || changes.data === undefined
      ? []
      : sourceStretches(changes.data.points, changes.data.window.to);
  const fallbackStretches = stretches.filter(
    (stretch) => stretch.source === ways?.second.source.deviceId,
  );
  const fallbackMs = fallbackStretches.reduce((sum, stretch) => sum + stretch.to - stretch.from, 0);
  const lastFallback = fallbackStretches.at(-1);

  return (
    <>
      <Section
        title={t('entity.historyPanel.history', 'History')}
        actions={
          <>
            <Segmented
              label={t('entity.historyPanel.window', 'Window')}
              size="compact"
              options={HISTORY_RANGES.map((range) => ({
                value: range,
                label: text(PRESET_LABELS[range]),
              }))}
              // A stretch chosen by its ends lights no preset.
              value={choice.kind === 'preset' ? choice.range : ''}
              onChange={(range) => {
                if (range !== '') {
                  setChoice({ kind: 'preset', range });
                }
              }}
            />
            <TimeRangePicker value={choice} onChange={setChoice} />
          </>
        }
      >
        <div className="flex flex-col gap-5 rounded-card border border-border bg-surface p-5">
          {isNumeric && stats !== null ? (
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
              <Figure label={t('entity.historyPanel.now', 'Now')} value={withUnit(stats.now)} />
              <Figure
                label={t('entity.historyPanel.lowest', 'Lowest')}
                value={withUnit(stats.low)}
              />
              <Figure
                label={t('entity.historyPanel.average', 'Average')}
                value={withUnit(stats.average)}
              />
              <Figure
                label={t('entity.historyPanel.highest', 'Highest')}
                value={withUnit(stats.high)}
              />
            </div>
          ) : null}

          {!isNumeric && isBanded ? (
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
              <Figure
                label={t('entity.historyPanel.activeFor', '{{word}} for', {
                  word: activeWordOf(entity),
                })}
                value={durationText(active.activeMs)}
                note={t('entity.historyPanel.inThisWindow', 'in this window')}
              />
              <Figure
                label={t('entity.historyPanel.turned', 'Turned {{word}}', {
                  word: activeWordOf(entity).toLowerCase(),
                })}
                value={t('entity.historyPanel.times', {
                  count: active.turnedOn,
                  defaultValue_one: '{{count}} time',
                  defaultValue_other: '{{count}} times',
                })}
                note={
                  active.lastOnAt === null
                    ? undefined
                    : t('entity.historyPanel.lastAt', 'last at {{time}}', {
                        time: dateTimeFormat({ hour: '2-digit', minute: '2-digit' }).format(
                          new Date(active.lastOnAt),
                        ),
                      })
                }
              />
              {ways === null ? (
                <Figure
                  label={t('entity.historyPanel.longest', 'Longest')}
                  value={durationText(active.longestMs)}
                />
              ) : (
                <Figure
                  label={t('entity.historyPanel.through', 'Through {{way}}', {
                    way: ways.second.name,
                  })}
                  value={durationText(fallbackMs)}
                  note={
                    lastFallback === undefined
                      ? t('entity.historyPanel.notInWindow', 'not in this window')
                      : dateTimeFormat({
                          weekday: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        }).format(new Date(lastFallback.from))
                  }
                />
              )}
            </div>
          ) : null}

          {query.isPending ? (
            <p className="text-caption text-foreground-subtle">
              {t('entity.historyPanel.reading', 'Reading…')}
            </p>
          ) : query.error === null ? null : (
            <p role="alert" className="text-ui text-danger">
              {toMessage(query.error)}
            </p>
          )}

          {isNumeric && telemetry.data !== undefined ? (
            telemetry.data.points.length === 0 ? (
              <p className="text-caption text-foreground-subtle">
                {t('entity.historyPanel.nothingRecordedInThis', 'Nothing recorded in this window.')}
              </p>
            ) : isTable ? (
              <ValueTable
                rows={telemetry.data.points.map((point) => ({
                  at: point.time,
                  value: withUnit(point.value),
                }))}
              />
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
                      label:
                        reading.sensorFigure?.classLabel ??
                        t('entity.historyPanel.reading2', 'Reading'),
                      color: 'var(--color-cyan)',
                      dotClass: 'bg-cyan',
                    },
                  ]}
                  window={telemetry.data.window}
                  curve="smooth"
                  formatValue={withUnit}
                />
              </div>
            )
          ) : null}

          {!isNumeric && changes.data !== undefined ? (
            isTable ? (
              <ValueTable
                rows={[...changes.data.points].reverse().map((point) => ({
                  at: point.time,
                  value: point.isAvailable
                    ? describeState(point.state, entity)
                    : t('entity.historyPanel.unreachable', 'Unreachable'),
                }))}
              />
            ) : (
              <>
                {segments.length === 0 ? null : (
                  <div className="flex flex-col gap-2">
                    <span className="font-mono text-label text-foreground-subtle uppercase">
                      {t('entity.historyPanel.state', 'State')}
                    </span>
                    <StateBand
                      segments={segments}
                      window={changes.data.window}
                      activeWord={activeWordOf(entity)}
                    />
                  </div>
                )}
                {ways === null || stretches.length === 0 ? null : (
                  <TransportBand
                    ways={ways}
                    stretches={stretches}
                    window={changes.data.window}
                    fallbackMs={fallbackMs}
                  />
                )}
                {field === undefined ? null : (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-label text-foreground-subtle uppercase">
                        {field.label}
                      </span>
                      {fields.length > 1 ? (
                        <Segmented
                          label={t('entity.historyPanel.line', 'Line')}
                          size="compact"
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
                    </div>
                    <div className="h-48">
                      <HistoryChart
                        data={numericSeries(
                          changes.data.points,
                          [field],
                          changes.data.window,
                          current,
                        )}
                        series={[
                          {
                            key: 'f0',
                            label: field.label,
                            color: 'var(--color-lamp)',
                            dotClass: 'bg-lamp',
                          },
                        ]}
                        window={changes.data.window}
                        curve="stepped"
                        {...(field.unit === '%' ? { domain: [0, 100] as const } : {})}
                        formatValue={(value) => `${numbers().format(value)} ${field.unit}`}
                      />
                    </div>
                  </div>
                )}
              </>
            )
          ) : null}

          {isNumeric && ways !== null && changes.data !== undefined && stretches.length > 0 ? (
            <TransportBand
              ways={ways}
              stretches={stretches}
              window={changes.data.window}
              fallbackMs={fallbackMs}
            />
          ) : null}

          <p className="flex flex-wrap items-center gap-x-2 text-caption text-foreground-subtle">
            {ways === null ? null : (
              <span>
                {t(
                  'entity.historyPanel.keptWithWay',
                  'Each reading is kept with the way it came in.',
                )}
              </span>
            )}
            {t('entity.historyPanel.timesAreLocal', 'Times are local ({{zone}}).', {
              zone: TIME_ZONE,
            })}
            <button
              type="button"
              aria-pressed={isTable}
              onClick={() => {
                setTable(!isTable);
              }}
              className="inline-flex items-center gap-1 rounded-chip text-primary transition-colors hover:text-primary-hover"
            >
              <AppIcon id={isTable ? 'chart-line' : 'list'} size={13} />
              {isTable
                ? t('entity.historyPanel.showAsAChart', 'Show as a chart')
                : t('entity.historyPanel.showAsATable', 'Show as a table')}
            </button>
          </p>
        </div>
      </Section>

      {!isNumeric && changes.data !== undefined ? (
        <Section title={t('entity.historyPanel.recentChanges', 'Recent changes')}>
          <RecentChanges entity={entity} points={changes.data.points} ways={ways} />
        </Section>
      ) : null}
    </>
  );
}

/**
 * The window's values as a table, newest first: for whoever would rather read than see a chart.
 *
 * @param props - The rows.
 * @param props.rows - Each a time and its value in words.
 * @returns The table.
 */
function ValueTable(props: {
  readonly rows: readonly { readonly at: Date; readonly value: string }[];
}) {
  const { t } = useTranslation();

  const { rows } = props;

  return (
    <div className="max-h-80 overflow-y-auto rounded-tile border border-border">
      <table className="w-full text-left">
        <thead className="font-mono text-label text-foreground-subtle uppercase">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-normal">
              {t('entity.historyPanel.when', 'When')}
            </th>
            <th scope="col" className="px-4 py-2.5 font-normal">
              {t('entity.historyPanel.value', 'Value')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.at.getTime()} className="border-t border-border">
              <td className="px-4 py-2 font-mono text-mono-caption text-foreground-subtle tabular">
                {absoluteTime(row.at)}
              </td>
              <td className="px-4 py-2 font-mono text-mono-ui text-foreground tabular">
                {row.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
