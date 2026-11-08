/**
 * A sensor and a binary sensor, as the canvas draws them (`N-Entity-Modal-B`,
 * `N-Entity-Sensor-Readings`, `N-Entity-Sensor-More`, `N-Entity-Binary-Door`,
 * `N-Entity-Binary-More`, `N-Entity-States-Shared`). A value and its past: the kind of value picks
 * the chart, and the chart is the body - there is no History button.
 *
 * - a measurement: a line with its lowest, average and highest;
 * - a running total: bars by hour, day or day of the month;
 * - a value from a list: a band coloured by value, and how long it was each;
 * - free text: the last values with their times; a time: how long until it, or since;
 * - a binary sensor: its class's words, glyph and colour, a band of when it was on, and three
 *   figures.
 *
 * A sensor that no longer answers keeps its last value, greyed, and its line carries on dashed.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { EntityView, StateHistoryPoint } from '@nebulahome/contracts';
import { AppIcon, cn, type UiIconId } from '@nebulahome/ui';

import { text } from '@/i18n/messages';
import { shortTime } from '@/lib/format-time';
import { paramsOf } from '@/library/entity-control';
import { BINARY_WORDS, describeState, ON_OFF_WORDS } from '@/library/entity-reading';
import { stateSegments, type TimeWindow } from '@/library/history-series';
import { durationText } from '@/library/history-stats';
import {
  AxisRow,
  BandChart,
  ChartLoading,
  LineChart,
  StatsLoading,
  StretchChart,
  TotalBars,
} from '@/routes/library/entity/sheet/charts';
import { axisLabels, clockText, timesText } from '@/routes/library/entity/sheet/history';
import { useSinceLine } from '@/routes/library/entity/sheet/parts/sheet-controls';
import {
  MonoLabel,
  RangePill,
  StatTiles,
  ValueHead,
  type StatTile,
} from '@/routes/library/entity/sheet/parts/sheet-parts';
import {
  SHEET_RANGES,
  TOTAL_RANGES,
  type SheetBodyProps,
  type SheetRange,
} from '@/routes/library/entity/sheet/sheet-types';
import {
  TILE_LIT,
  TILE_REST,
  TONE_TEXT,
  type SheetTone,
} from '@/routes/library/entity/sheet/tones';

/** What the history card needs. */
type HistoryCardProps = {
  readonly range: SheetRange;
  readonly ranges: readonly SheetRange[];
  readonly onRange: (range: SheetRange) => void;
  readonly children: ReactNode;
};

/**
 * The card a sensor's chart sits in: HISTORY and its windows over it.
 *
 * @param props - See {@link HistoryCardProps}.
 * @returns The card.
 */
function HistoryCard(props: HistoryCardProps) {
  const { t } = useTranslation();
  const labels: Readonly<Record<SheetRange, string>> = {
    '6h': '6h',
    '24h': '24h',
    '7d': '7d',
    day: t('entity.sheet.history.day', 'Day'),
    week: t('entity.sheet.history.week', 'Week'),
    month: t('entity.sheet.history.month', 'Month'),
  };

  return (
    <div className="flex flex-col gap-3 rounded-panel border border-border bg-well p-3.5">
      <div className="flex items-center justify-between gap-2">
        <MonoLabel>{t('entity.sheet.history.title', 'History')}</MonoLabel>
        <RangePill
          ground="well"
          choices={props.ranges.map((value) => ({ value, label: labels[value] }))}
          value={props.range}
          onChange={props.onRange}
        />
      </div>
      {props.children}
    </div>
  );
}

/**
 * A round mark with a glyph, in a colour: what a sensor that is not a number opens with.
 *
 * @param props - The glyph and the colour.
 * @param props.icon - The glyph.
 * @param props.tone - The colour.
 * @param props.isStale - Whether the sensor no longer answers.
 * @returns The mark.
 */
function RoundMark(props: { icon: UiIconId; tone: SheetTone; isStale: boolean }) {
  return (
    <span
      className={cn(
        'flex size-15 shrink-0 items-center justify-center rounded-full border',
        TILE_LIT[props.isStale ? 'muted' : props.tone],
      )}
    >
      <AppIcon id={props.icon} size={24} />
    </span>
  );
}

/** The colours a value from a list is banded in, in turn; "off" and "idle" are greyed. */
const BAND_COLOURS = [
  'bg-cyan',
  'bg-violet',
  'bg-lamp',
  'bg-success',
  'bg-primary',
  'bg-media',
  'bg-heat',
];

/** The values a list's band draws grey. */
const RESTING = new Set(['off', 'idle', 'none', 'standby']);

/**
 * Cuts a window of text values into stretches.
 *
 * @param points - The changes, oldest first.
 * @param window - The window.
 * @param current - The value now.
 * @returns The stretches, left to right.
 */
function textStretches(
  points: readonly StateHistoryPoint[],
  window: TimeWindow,
  current: string,
): { from: number; to: number; value: string }[] {
  /**
   * Reads the text off a state.
   *
   * @param state - The state, as history holds it.
   * @returns The text, or undefined.
   */
  const read = (state: unknown): string | undefined =>
    (state as { sensor_text?: { value?: unknown } } | null)?.sensor_text?.value as
      string | undefined;
  const first = points[0];
  const marks = [
    {
      at: window.from,
      value: (first === undefined ? current : read(first.previousState)) ?? current,
    },
    ...points.map((point) => ({
      at: Math.max(window.from, point.time.getTime()),
      value: read(point.state) ?? current,
    })),
  ];

  return marks
    .map((mark, index) => ({
      from: mark.at,
      to: marks[index + 1]?.at ?? window.to,
      value: mark.value,
    }))
    .filter((stretch) => stretch.to > stretch.from);
}

/**
 * Formats a reading with its unit and decimals.
 *
 * @param value - The reading.
 * @param entity - Its unit and precision.
 * @returns "21.4", the unit apart.
 */
function figure(value: number, entity: Pick<EntityView, 'displayPrecision'>): string {
  const decimals = entity.displayPrecision ?? (Number.isInteger(value) ? 0 : 1);

  return value.toFixed(decimals);
}

/**
 * The body of a sensor.
 *
 * @param props - See {@link SheetBodyProps}.
 * @returns The body.
 */
export function SensorBody(props: SheetBodyProps) {
  const { t } = useTranslation();
  const { entity, state, history, now } = props;
  const since = useSinceLine(entity);
  const isStale = !entity.isAvailable;
  const unit = entity.unitOfMeasurement ?? '';
  const numeric = state.sensor_numeric?.value;
  const textValue = state.sensor_text?.value;
  const options = paramsOf(entity, 'sensor_text')?.options ?? [];
  const isTime = entity.deviceClass === 'timestamp' || entity.deviceClass === 'date';
  const isTotal = entity.stateClass === 'total' || entity.stateClass === 'total_increasing';
  const lastSeen = entity.lastUpdated?.getTime() ?? now;

  if (numeric !== undefined && !isTime) {
    const points = history.telemetry.map((point) => ({
      at: point.time.getTime(),
      value: point.value,
    }));
    const values = points.map((point) => point.value);
    const hourAgo = history.telemetry.findLast(
      (point) => point.time.getTime() <= now - 3_600_000,
    )?.value;
    const trend = hourAgo === undefined ? null : numeric - hourAgo;
    const read = t('entity.sheet.sensor.readAgo', 'read {{ago}} ago', {
      ago: durationText(Math.max(0, now - lastSeen)),
    });
    const line = isStale
      ? t('entity.sheet.sensor.readAt', 'Read at {{time}}', { time: clockText(lastSeen) })
      : isTotal
        ? t('entity.sheet.sensor.soFar', 'So far this {{window}}', {
            window:
              history.range === 'week'
                ? t('entity.sheet.history.weekWord', 'week')
                : history.range === 'month'
                  ? t('entity.sheet.history.monthWord', 'month')
                  : t('entity.sheet.history.dayWord', 'day'),
          })
        : trend === null || Math.abs(trend) < 10 ** -(entity.displayPrecision ?? 1) / 2
          ? t('entity.sheet.sensor.steady', 'Steady in the last hour · {{read}}', { read })
          : trend > 0
            ? t('entity.sheet.sensor.up', 'Up {{change}} {{unit}} in the last hour · {{read}}', {
                change: figure(trend, entity),
                unit,
                read,
              })
            : t(
                'entity.sheet.sensor.down',
                'Down {{change}} {{unit}} in the last hour · {{read}}',
                {
                  change: figure(-trend, entity),
                  unit,
                  read,
                },
              );
    const slots = history.range === 'day' ? 24 : history.range === 'week' ? 7 : 30;
    const span = history.window.to - history.window.from;
    const bars = [...Array.from({ length: slots }).keys()].map((index) => {
      const from = history.window.from + (span * index) / slots;
      const inSlot = history.telemetry.filter((point) => {
        const at = point.time.getTime();

        return at >= from && at < from + span / slots;
      });

      return inSlot.length === 0
        ? null
        : Math.abs(
            Math.max(...inSlot.map((point) => point.max ?? point.value)) -
              Math.min(...inSlot.map((point) => point.min ?? point.value)),
          );
    });
    const totals = bars.filter((bar): bar is number => bar !== null);
    const stats: StatTile[] = isStale
      ? [
          {
            label: t('entity.sheet.sensor.lastValue', 'Last value'),
            value: `${figure(numeric, entity)} ${unit}`.trim(),
          },
          { label: t('entity.sheet.sensor.lastSeen', 'Last seen'), value: clockText(lastSeen) },
          {
            label: t('entity.sheet.sensor.gaps', 'Gaps'),
            value: String(history.states.filter((point) => !point.isAvailable).length),
          },
        ]
      : isTotal
        ? [
            {
              label: t('entity.sheet.sensor.inWindow', 'In this window'),
              value: `${figure(
                totals.reduce((sum, bar) => sum + bar, 0),
                entity,
              )} ${unit}`.trim(),
            },
            {
              label: t('entity.sheet.sensor.average', 'Average'),
              value:
                `${figure(totals.reduce((sum, bar) => sum + bar, 0) / Math.max(1, totals.length), entity)} ${unit}`.trim(),
            },
            {
              label: t('entity.sheet.sensor.highest', 'Highest'),
              value: `${figure(Math.max(0, ...totals), entity)} ${unit}`.trim(),
            },
          ]
        : values.length === 0
          ? []
          : [
              {
                label: t('entity.sheet.history.lowest', 'Lowest'),
                value: `${figure(Math.min(...values), entity)} ${unit}`.trim(),
              },
              {
                label: t('entity.sheet.history.average', 'Average'),
                value:
                  `${figure(values.reduce((sum, value) => sum + value, 0) / values.length, entity)} ${unit}`.trim(),
              },
              {
                label: t('entity.sheet.history.highest', 'Highest'),
                value: `${figure(Math.max(...values), entity)} ${unit}`.trim(),
              },
            ];

    return (
      <div className="flex grow flex-col gap-5 pt-2">
        <ValueHead
          value={figure(numeric, entity)}
          unit={unit === '' ? undefined : unit}
          line={line}
          size="reading"
          isStale={isStale}
        />
        <HistoryCard
          range={history.range}
          ranges={isTotal ? TOTAL_RANGES : SHEET_RANGES}
          onRange={history.onRange}
        >
          {history.isLoading === true ? (
            <ChartLoading className="h-32" />
          ) : isTotal ? (
            <>
              <TotalBars
                key={history.range}
                bars={bars}
                window={history.window}
                format={(value) => `${figure(value, entity)} ${unit}`.trim()}
                tone={isStale ? 'muted' : 'success'}
                label={t('entity.sheet.sensor.perSlot', 'How much each slot added')}
              />
              <AxisRow labels={axisLabels(history.window, history.range)} />
            </>
          ) : (
            <LineChart
              key={history.range}
              points={points}
              window={history.window}
              tone="cyan"
              height={128}
              isStale={isStale}
              format={(value) => `${figure(value, entity)} ${unit}`.trim()}
              label={t('entity.sheet.sensor.overTime', '{{name}} over the last {{range}}', {
                name: entity.name,
                range: history.range,
              })}
            />
          )}
          {history.isLoading === true ? (
            <StatsLoading />
          ) : stats.length === 0 ? null : (
            <StatTiles stats={stats} />
          )}
        </HistoryCard>
      </div>
    );
  }

  const value = textValue ?? (numeric === undefined ? null : String(numeric));

  if (isTime && value !== null) {
    const at = Number.isNaN(Number(value))
      ? Date.parse(value)
      : Number(value) * (Number(value) < 1e12 ? 1000 : 1);
    const isFuture = at > now;

    return (
      <div className="flex grow flex-col gap-4.5 pt-1">
        <div className="flex items-center gap-3.5">
          <RoundMark icon="alarm-clock" tone="lamp" isStale={isStale} />
          <div className="flex flex-col gap-0.75">
            <span className="text-[30px] leading-[1.1] font-medium tracking-[-0.02em] select-text">
              {Number.isNaN(at)
                ? value
                : isFuture
                  ? t('entity.sheet.sensor.inDuration', 'In {{duration}}', {
                      duration: durationText(at - now),
                    })
                  : t('entity.sheet.sensor.ago', '{{duration}} ago', {
                      duration: durationText(now - at),
                    })}
            </span>
            <span className="text-ui-sm text-foreground-subtle">
              {Number.isNaN(at) ? since : shortTime(new Date(at), new Date(now))}
            </span>
          </div>
        </div>
        <LastValues points={history.states} now={now} current={value} />
      </div>
    );
  }

  if (options.length > 0 && value !== null) {
    const stretches = textStretches(history.states, history.window, value);
    /**
     * The colour a value is banded in.
     *
     * @param option - The value.
     * @returns Its colour, as a class.
     */
    const colourOf = (option: string): string =>
      RESTING.has(option.toLowerCase())
        ? 'bg-[#3a3f5c]'
        : (BAND_COLOURS[
            options.filter((each) => !RESTING.has(each.toLowerCase())).indexOf(option) %
              BAND_COLOURS.length
          ] ?? 'bg-cyan');
    const totals = options
      .map((option) => ({
        option,
        ms: stretches
          .filter((stretch) => stretch.value === option)
          .reduce((sum, stretch) => sum + stretch.to - stretch.from, 0),
      }))
      .filter((each) => each.ms > 0)
      .sort(
        (a, b) =>
          Number(RESTING.has(a.option.toLowerCase())) - Number(RESTING.has(b.option.toLowerCase())),
      );

    return (
      <div className="flex grow flex-col gap-4.5 pt-1">
        <div className="flex items-center gap-3.5">
          <RoundMark icon="waves-horizontal" tone="violet" isStale={isStale} />
          <div className="flex flex-col gap-0.75">
            <span className="text-[30px] leading-[1.1] font-medium tracking-[-0.02em] select-text">
              {value}
            </span>
            <span className="text-ui-sm text-foreground-subtle">{since}</span>
          </div>
        </div>
        <HistoryCard range={history.range} ranges={SHEET_RANGES} onRange={history.onRange}>
          {history.isLoading === true ? (
            <ChartLoading className="h-9" />
          ) : (
            <StretchChart
              key={history.range}
              stretches={stretches}
              window={history.window}
              colourOf={colourOf}
              label={t('entity.sheet.sensor.byValue', 'Its values over the window')}
            />
          )}
          <AxisRow
            labels={axisLabels(history.window, history.range).filter((label, index) => index !== 1)}
          />
          <div className={cn('flex flex-col', history.isLoading === true && 'hidden')}>
            {totals.map((each) => (
              <div key={each.option} className="flex h-7 items-center gap-2">
                <span className={cn('size-2.5 rounded-[3px]', colourOf(each.option))} />
                <span className="grow text-ui-sm select-text">{each.option}</span>
                <span className="font-mono text-mono-caption text-foreground-muted select-text">
                  {durationText(each.ms)}
                </span>
              </div>
            ))}
          </div>
        </HistoryCard>
      </div>
    );
  }

  return (
    <div className="flex grow flex-col gap-4.5 pt-1">
      <div className="flex items-center gap-3.5">
        <RoundMark icon="text-align-start" tone="cyan" isStale={isStale} />
        <div className="flex min-w-0 flex-col gap-0.75">
          <span className="truncate text-[30px] leading-[1.1] font-medium tracking-[-0.02em] select-text">
            {value ?? '—'}
          </span>
          <span className="text-ui-sm text-foreground-subtle">
            {t('entity.sheet.sensor.changedAgo', 'Changed {{ago}} ago', {
              ago: durationText(Math.max(0, now - (entity.lastChanged?.getTime() ?? now))),
            })}
          </span>
        </div>
      </div>
      <LastValues points={history.states} now={now} current={value ?? '—'} />
    </div>
  );
}

/**
 * Reads a sensor's value off a state from its history, in words.
 *
 * @param state - The state, as history holds it.
 * @returns The value, or a dash.
 */
function historyValueOf(state: unknown): string {
  const reading = state as {
    sensor_text?: { value?: unknown };
    sensor_numeric?: { value?: unknown };
  } | null;
  const value = reading?.sensor_text?.value ?? reading?.sensor_numeric?.value;

  return typeof value === 'string' || typeof value === 'number' ? String(value) : '—';
}

/**
 * The last values of a text sensor, newest first, each with when it came.
 *
 * @param props - The changes, the time now, and the value now.
 * @param props.points - The changes, oldest first.
 * @param props.now - The time now.
 * @param props.current - The value now.
 * @returns The list.
 */
function LastValues(props: { points: readonly StateHistoryPoint[]; now: number; current: string }) {
  const { t } = useTranslation();
  const rows = [...props.points]
    .reverse()
    .slice(0, 5)
    .map((point) => ({
      at: point.time.getTime(),
      value: historyValueOf(point.state),
    }));

  return (
    <div className="flex flex-col gap-2.5">
      <MonoLabel>{t('entity.sheet.sensor.lastValues', 'Last values')}</MonoLabel>
      <div className="flex flex-col">
        {(rows.length === 0 ? [{ at: props.now, value: props.current }] : rows).map(
          (row, index) => (
            <div key={row.at} className="flex h-10.5 items-center gap-3 border-t border-border">
              <span
                className={cn(
                  'size-2 rounded-full',
                  index === 0 ? 'bg-cyan' : 'bg-foreground-disabled',
                )}
              />
              <span
                className={cn(
                  'grow truncate text-ui select-text',
                  index === 0 ? 'text-foreground' : 'text-foreground-muted',
                )}
              >
                {row.value}
              </span>
              <span className="font-mono text-[11px] text-foreground-subtle select-text">
                {props.now - row.at < 86_400_000
                  ? clockText(row.at)
                  : shortTime(new Date(row.at), new Date(props.now))}
              </span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/** How a binary sensor's class is drawn: its colour while on, and its glyph on and off. */
export type BinaryLook = {
  readonly tone: SheetTone;
  readonly on: UiIconId;
  readonly off: UiIconId;
};

/** The look of each class. */
const BINARY_LOOKS: Readonly<Record<string, BinaryLook>> = {
  door: { tone: 'lamp', on: 'door-open', off: 'door-closed' },
  window: { tone: 'lamp', on: 'app-window', off: 'app-window' },
  opening: { tone: 'lamp', on: 'door-open', off: 'door-closed' },
  garage_door: { tone: 'lamp', on: 'warehouse', off: 'warehouse' },
  motion: { tone: 'lamp', on: 'footprints', off: 'footprints' },
  occupancy: { tone: 'lamp', on: 'user-round', off: 'user-round' },
  presence: { tone: 'lamp', on: 'user-round-check', off: 'user-round' },
  running: { tone: 'success', on: 'circle-play', off: 'circle-pause' },
  connectivity: { tone: 'success', on: 'wifi', off: 'wifi-off' },
  battery: { tone: 'danger', on: 'battery-warning', off: 'battery-full' },
  battery_charging: { tone: 'success', on: 'battery-charging', off: 'battery-full' },
  moisture: { tone: 'danger', on: 'droplets', off: 'droplet' },
  smoke: { tone: 'danger', on: 'cloud-fog', off: 'cloud' },
  gas: { tone: 'danger', on: 'cloud-alert', off: 'cloud-check' },
  problem: { tone: 'danger', on: 'triangle-alert', off: 'circle-check' },
  plug: { tone: 'primary', on: 'plug-zap', off: 'plug' },
  power: { tone: 'primary', on: 'zap', off: 'zap-off' },
  update: { tone: 'violet', on: 'circle-arrow-up', off: 'circle-check' },
};

/** A binary sensor of no class, or of one not drawn yet. */
const PLAIN_BINARY: BinaryLook = { tone: 'violet', on: 'circle-dot', off: 'circle' };

/**
 * How a binary sensor of a class is drawn: its colour while on - the alarms red, the openings
 * and the people amber - and its glyph on and off. Off, it is grey, as the dialog's header is.
 *
 * @param deviceClass - Its class.
 * @returns The look.
 */
export function binaryLookOf(deviceClass: string | null): BinaryLook {
  return BINARY_LOOKS[deviceClass ?? ''] ?? PLAIN_BINARY;
}

/** A binary sensor's tile while on: tinted in its colour, its glyph in the same colour. */
const BINARY_TILE: Readonly<Record<SheetTone, string>> = {
  lamp: 'border-lamp/40 bg-lamp/16 text-lamp',
  primary: 'border-primary/40 bg-primary/16 text-primary',
  success: 'border-success/40 bg-success/16 text-success',
  heat: 'border-heat/40 bg-heat/16 text-heat',
  cyan: 'border-cyan/40 bg-cyan/16 text-cyan',
  media: 'border-media/40 bg-media/16 text-media',
  violet: 'border-violet/40 bg-violet/16 text-violet',
  danger: 'border-danger/40 bg-danger/16 text-danger',
  muted: TILE_REST,
};

/**
 * The body of a binary sensor.
 *
 * @param props - See {@link SheetBodyProps}.
 * @returns The body.
 */
export function BinaryBody(props: SheetBodyProps) {
  const { t } = useTranslation();
  const { entity, state, history } = props;
  const since = useSinceLine(entity);
  const isOn = state.sensor_binary?.isOn === true;
  const isStale = !entity.isAvailable;
  const deviceClass = entity.deviceClass ?? '';
  const look = binaryLookOf(deviceClass);
  const isLit = isOn && !isStale;
  const [onWord, offWord] = BINARY_WORDS[deviceClass] ?? ON_OFF_WORDS;
  const segments = stateSegments(
    history.states,
    history.window,
    { state: entity.state, isAvailable: entity.isAvailable },
    (each) => describeState(each, entity),
  );
  const active = segments.filter((segment) => segment.isActive);
  const lastOn = active.at(-1);
  const longest = Math.max(0, ...active.map((segment) => segment.to - segment.from));
  const opens = ['door', 'window', 'opening', 'garage_door'].includes(deviceClass);
  const stats: StatTile[] = opens
    ? [
        { label: t('entity.sheet.history.opened', 'Opened'), value: timesText(active.length) },
        {
          label: t('entity.sheet.binary.longestOpen', 'Longest open'),
          value: durationText(longest),
        },
        {
          label: t('entity.sheet.history.lastOpened', 'Last opened'),
          value: lastOn === undefined ? '—' : clockText(lastOn.from),
        },
      ]
    : [
        { label: text(onWord), value: timesText(active.length) },
        { label: t('entity.sheet.binary.longest', 'Longest'), value: durationText(longest) },
        {
          label: t('entity.sheet.binary.lastWord', 'Last {{word}}', {
            word: text(offWord).toLowerCase(),
          }),
          value: lastOn === undefined ? '—' : clockText(lastOn.to),
        },
      ];

  return (
    <div className="flex grow flex-col gap-5 pt-2">
      <div className="flex items-center gap-4">
        <span
          className={cn(
            'relative grid size-16 shrink-0 place-items-center',
            isLit && TONE_TEXT[look.tone],
          )}
        >
          {isLit ? (
            // A soft halo breathing round it while on, centred on the tile.
            <span
              aria-hidden="true"
              className="entity-breathe absolute -inset-2 rounded-full bg-current/16 blur-md"
            />
          ) : null}
          <span
            className={cn(
              'entity-tint relative flex size-16 items-center justify-center rounded-full border',
              isLit ? BINARY_TILE[look.tone] : TILE_REST,
            )}
          >
            <span key={String(isOn)} className="entity-pop flex">
              <AppIcon id={isOn ? look.on : look.off} size={26} />
            </span>
          </span>
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <span
            key={String(isOn)}
            className={cn(
              'entity-tick text-[28px] font-medium tracking-[-0.02em] select-text',
              isStale && 'text-foreground-subtle',
            )}
          >
            {text(isOn ? onWord : offWord)}
          </span>
          <span className="text-ui-sm leading-[1.45] text-foreground-subtle">
            {opens
              ? t('entity.sheet.binary.sinceOpened', '{{since}} · opened {{times}}', {
                  since,
                  times: timesText(active.length),
                })
              : since}
          </span>
        </div>
      </div>
      <HistoryCard range={history.range} ranges={SHEET_RANGES} onRange={history.onRange}>
        {history.isLoading === true ? (
          <ChartLoading className="h-12" />
        ) : (
          <BandChart
            key={history.range}
            segments={segments}
            window={history.window}
            words={[text(onWord), text(offWord)]}
            tone={isStale ? 'muted' : look.tone}
            label={t('entity.sheet.history.whenOn', 'When it was on, over the last {{range}}', {
              range: history.range,
            })}
          />
        )}
        <AxisRow labels={axisLabels(history.window, history.range)} />
        {history.isLoading === true ? <StatsLoading /> : <StatTiles stats={stats} />}
      </HistoryCard>
    </div>
  );
}
