/**
 * Up to four readings of the same unit on one chart (`K-New`, Compare): each line in the colour
 * of its row, the time span to switch at the top right. The square lists the rows beside the
 * chart; the large card writes them across the top in large figures, over a taller chart.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DashboardCompareCard, EntityView, TelemetryPoint } from '@nebulahome/contracts';
import { AppIcon } from '@nebulahome/ui';

import { kindName } from '@/dashboard/card-options';
import { capabilityStateOf } from '@/library/entity-control';
import type { TimeWindow } from '@/library/history-series';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import {
  formatReading,
  RangeSwitch,
  TimeAxis,
  type ShownRange,
} from '@/routes/dashboard/cards/reading-parts';
import { useTelemetry, type CardHistory } from '@/routes/dashboard/cards/use-card-history';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';

/** What the card needs. */
export type CompareCardProps = {
  /** The card as the layout stores it. */
  readonly card: DashboardCompareCard;

  /** What the page read for its cards. */
  readonly data: DashboardData;
};

/** The colours of the rows, in order: as the board draws them. */
const COLOURS = [
  'var(--color-cyan)',
  'var(--color-primary)',
  'var(--color-lamp)',
  'var(--color-success)',
] as const;

/** The chart's box, in its own units: stretched to the card. */
const CHART = { width: 300, height: 120 } as const;

/** One row: the sensor, its colour, its reading now and its past. */
type Row = {
  readonly entity: EntityView;
  readonly colour: string;
  readonly value: number | null;
  readonly history: CardHistory<TelemetryPoint> | undefined;
};

/**
 * The lines of the chart, on one scale for all of them.
 *
 * @param rows - The rows.
 * @param window - The span drawn.
 * @returns One path per row with a past, in the chart's units.
 */
function linesOf(
  rows: readonly Row[],
  window: TimeWindow,
): readonly { readonly colour: string; readonly d: string }[] {
  const values = rows.flatMap((row) => row.history?.points.map((point) => point.value) ?? []);

  if (values.length === 0) {
    return [];
  }

  const low = Math.min(...values);
  const high = Math.max(...values);
  const spread = high - low || 1;
  const span = window.to - window.from || 1;

  return rows.flatMap((row) => {
    const points = row.history?.points ?? [];

    if (points.length < 2) {
      return [];
    }

    const d = points
      .map((point, index) => {
        const x = ((point.time.getTime() - window.from) / span) * CHART.width;
        const y = CHART.height - 6 - ((point.value - low) / spread) * (CHART.height - 12);

        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');

    return [{ colour: row.colour, d }];
  });
}

/**
 * Renders the lines on their faint grid.
 *
 * @param props - The lines.
 * @param props.lines - See {@link linesOf}.
 * @param props.className - The chart's height and place.
 * @returns The chart.
 */
function Lines(props: {
  readonly lines: readonly { readonly colour: string; readonly d: string }[];
  readonly className: string;
}) {
  const { lines, className } = props;

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${String(CHART.width)} ${String(CHART.height)}`}
      preserveAspectRatio="none"
      className={className}
    >
      {[0.25, 0.5, 0.75].map((at) => (
        <line
          key={at}
          x1="0"
          x2={CHART.width}
          y1={CHART.height * at}
          y2={CHART.height * at}
          stroke="var(--color-border)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {lines.map((line) => (
        <path
          key={line.colour}
          d={line.d}
          fill="none"
          stroke={line.colour}
          strokeWidth="1.5"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className="animate-fade-in"
        />
      ))}
    </svg>
  );
}

/**
 * Renders a comparison.
 *
 * @param props - See {@link CompareCardProps}.
 * @returns The card.
 */
export function CompareCard(props: CompareCardProps) {
  const { t } = useTranslation();

  const { card, data } = props;
  const [range, setRange] = useState<ShownRange>(card.range === '7d' ? '7d' : '24h');
  const entities = card.entityIds.flatMap((id) => {
    const entity = data.entityById.get(id);

    return entity === undefined ? [] : [entity];
  });
  /**
   * The address of the n-th sensor, or a placeholder never read.
   *
   * @param index - Which.
   * @returns The address.
   */
  const idOf = (index: number): string => entities[index]?.entityId ?? 'none.none';

  /**
   * Whether the n-th sensor's past is read: it is there, and this person may.
   *
   * @param index - Which.
   * @returns True when it is read.
   */
  const isRead = (index: number): boolean => {
    const entity = entities[index];

    return entity !== undefined && data.canReadHistory(entity);
  };

  // Four reads, always the same hooks in the same order; a sensor that is not there is not read.
  const histories = [
    useTelemetry(idOf(0), range, isRead(0)),
    useTelemetry(idOf(1), range, isRead(1)),
    useTelemetry(idOf(2), range, isRead(2)),
    useTelemetry(idOf(3), range, isRead(3)),
  ];
  const rows: Row[] = entities.map((entity, index) => {
    const value = capabilityStateOf(entity, data.readings[entity.entityId]).sensor_numeric?.value;

    return {
      entity,
      colour: COLOURS[index] ?? COLOURS[0],
      value: value ?? null,
      history: histories[index],
    };
  });
  const title = card.title ?? kindName('compare');
  const unit = entities[0]?.unitOfMeasurement ?? '';
  const window = histories.find((history) => history !== undefined)?.window;
  const lines = window === undefined ? [] : linesOf(rows, window);

  /**
   * A row's reading, as the card writes it.
   *
   * @param row - The row.
   * @returns "21.4°" - a temperature's unit shortened to its degree.
   */
  const reading = (row: Row): string =>
    row.value === null
      ? '—'
      : `${formatReading(row.value, row.entity)}${unit.startsWith('°') ? '°' : ` ${unit}`}`;

  const head = (
    <div className="flex h-8 shrink-0 items-center gap-2.5">
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-field bg-cyan/14 text-cyan"
      >
        <AppIcon id="chart-line" size={16} />
      </span>
      <span className="flex min-w-0 grow flex-col">
        <span className="truncate text-ui leading-[18px] font-medium">{title}</span>
        <span className="truncate text-caption leading-4 text-foreground-subtle">
          {t('dashboard.cards.compareCard.sensors', {
            count: entities.length,
            defaultValue_one: '{{count}} sensor',
            defaultValue_other: '{{count}} sensors',
          })}
        </span>
      </span>
      <span className="relative z-10 shrink-0">
        <RangeSwitch value={range} onChange={setRange} />
      </span>
    </div>
  );

  if (entities.length === 0) {
    return (
      <CardFrame label={title} tone="faint">
        {head}
        <div className="flex grow items-center justify-center text-caption text-foreground-subtle">
          {t('dashboard.cards.compareCard.noneYet', 'No sensor to compare yet')}
        </div>
      </CardFrame>
    );
  }

  if (card.h >= 3) {
    return (
      <CardFrame label={title}>
        {head}
        <div className="mt-4 grid grid-cols-4 gap-3">
          {rows.map((row) => (
            <span key={row.entity.entityId} className="flex min-w-0 flex-col gap-1">
              <span className="flex min-w-0 items-center gap-1.5 text-label text-foreground-subtle">
                <Dot colour={row.colour} />
                <span className="truncate">{row.entity.name}</span>
              </span>
              <span className="text-[19px] leading-none font-medium tracking-[-0.02em] tabular-nums">
                {reading(row)}
              </span>
            </span>
          ))}
        </div>
        <Lines lines={lines} className="mt-4 min-h-0 w-full grow" />
        {window === undefined ? null : (
          <div className="mt-2.5">
            <TimeAxis window={window} />
          </div>
        )}
      </CardFrame>
    );
  }

  return (
    <CardFrame label={title}>
      {head}
      <div className="mt-4 flex min-h-0 grow gap-6">
        <ul className="flex w-[170px] shrink-0 flex-col justify-end">
          {rows.map((row, index) => (
            <li
              key={row.entity.entityId}
              className={
                index === 0
                  ? 'flex h-7.5 items-center justify-between gap-2'
                  : 'flex h-7.5 items-center justify-between gap-2 border-t border-border'
              }
            >
              <span className="flex min-w-0 items-center gap-2 text-ui-sm text-foreground-muted">
                <Dot colour={row.colour} />
                <span className="truncate">{row.entity.name}</span>
              </span>
              <span className="shrink-0 text-ui-sm text-foreground tabular-nums">
                {reading(row)}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex min-w-0 grow flex-col">
          <Lines lines={lines} className="min-h-0 w-full grow" />
          {window === undefined ? null : (
            <div className="mt-2">
              <TimeAxis window={window} />
            </div>
          )}
        </div>
      </div>
    </CardFrame>
  );
}

/**
 * Renders a row's colour dot.
 *
 * @param props - The colour.
 * @param props.colour - A CSS colour.
 * @returns The dot.
 */
function Dot(props: { readonly colour: string }) {
  const { colour } = props;

  return (
    <span
      aria-hidden="true"
      className="size-2 shrink-0 rounded-full"
      /* eslint-disable-next-line react/forbid-dom-props -- each row keeps its own colour. */
      style={{ background: colour }}
    />
  );
}
