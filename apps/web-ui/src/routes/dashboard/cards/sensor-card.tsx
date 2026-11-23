/**
 * A sensor that reads a number, or a line of text (`K-All` Sensor and Text sensor).
 *
 * The number is the point, so it is the largest thing on the card at every size, and the line
 * beside it says how far it moved in the last hour. The strip and the tall card add the day as a
 * thin line over a fading fill, with its lowest and highest; the square one gives the line the
 * room it wants, the lowest, average and highest beside it, and a switch between 6 h, 24 h and
 * 7 d. A humidity is read on a dial on the tall card, against the comfortable band; a battery
 * carries its glyph and says when it wants replacing.
 *
 * A card set to draw bars (`K-New` Bars) draws one bar an hour, or a day over a week, the running
 * one lit; for a price, the cheap hours green and the dear ones amber. A sensor without a past yet
 * keeps its size (`K-Capabilities`): the chart's place says the chart starts with the next
 * readings, and the lowest, average and highest wait for a dash.
 *
 * A reading in words - a text sensor - is written out: whole on the tile, and on the strip split
 * at its first "·" into a headline and the rest.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@nebulahome/ui';

import { dateTimeFormat } from '@/i18n/formatters';
import { clockText } from '@/lib/format-time';
import { hasCapability, isPasswordText } from '@/library/entity-control';
import { NO_READING } from '@/library/entity-reading';
import type { HistoryRange } from '@/library/history-series';
import { BigValue, Caption, CardHead } from '@/routes/dashboard/cards/card-kit';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import { cardTime, sizeKey, type EntityCardModel } from '@/routes/dashboard/cards/entity-model';
import {
  AreaLine,
  BatteryGlyph,
  decimalsOf,
  Dial,
  formatReading,
  LOW_BATTERY,
  NoHistory,
  RangeSwitch,
  rangeName,
  ReadingBars,
  readingLook,
  stateCaption,
  TimeAxis,
  type ShownRange,
} from '@/routes/dashboard/cards/reading-parts';
import {
  barsOf,
  changeInLastHour,
  priceLevels,
  summaryOf,
} from '@/routes/dashboard/cards/reading-series';
import { useTelemetry } from '@/routes/dashboard/cards/use-card-history';

/** The comfortable band of a room's humidity, in percent. */
const COMFORT = { low: 40, high: 60 } as const;

/** A unit of a price: money for a kilowatt-hour or a megawatt-hour, "€/kWh". */
const PRICE_UNIT = /\/\s*[kKmM]?Wh$/u;

/**
 * Writes a figure with its unit, close up for a percentage.
 *
 * @param figure - The figure, written.
 * @param unit - Its unit, if any.
 * @returns "18.6 °C", "62%".
 */
function withUnit(figure: string, unit: string | undefined): string {
  if (unit === undefined || unit === '') {
    return figure;
  }

  return unit === '%' ? `${figure}%` : `${figure} ${unit}`;
}

/**
 * Renders a numeric or text sensor card at its size.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function SensorCard(props: { readonly model: EntityCardModel }) {
  const { model } = props;

  return hasCapability(model.entity, 'sensor_numeric') ? (
    <NumberCard model={model} />
  ) : (
    <TextCard model={model} />
  );
}

/**
 * Renders a sensor that reads in words.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
function TextCard(props: { readonly model: EntityCardModel }) {
  const { t } = useTranslation();

  const { model } = props;
  const { state, title, reading } = model;
  const { head } = readingLook(model);
  // A password reads as its mask, which its reading already is.
  const value = isPasswordText(model.entity)
    ? reading.text
    : (state.sensor_text?.value ?? reading.text);
  const hasValue = value !== NO_READING && value !== '';
  const tone = hasValue && !model.isOffline ? undefined : 'text-foreground-subtle';

  if (sizeKey(model.size) === '1x1') {
    return (
      <CardFrame label={title}>
        <CardHead
          model={head}
          isActive={null}
          tail={
            model.reportedAt === null || !hasValue ? undefined : (
              <Caption>{cardTime(new Date(model.reportedAt))}</Caption>
            )
          }
        />
        <div className="grow" />
        <span className={cn('truncate text-[16px] leading-[normal] font-medium', tone)}>
          {hasValue ? value : NO_READING}
        </span>
      </CardFrame>
    );
  }

  const [headline = NO_READING, ...rest] = hasValue ? value.split(' · ') : [];
  const since =
    model.changedAt === null
      ? ''
      : t('dashboard.cards.sensorCard.sinceChanged', 'since {{changed}}', {
          changed: cardTime(model.changedAt),
        });

  return (
    <CardFrame label={title}>
      <div className="flex min-h-0 grow items-center gap-5">
        <div className="w-47.5 shrink-0">
          <CardHead model={head} isActive={null} />
        </div>
        <span aria-hidden="true" className="w-px self-stretch bg-border" />
        <div className="flex min-w-0 grow flex-col gap-1">
          <span className={cn('truncate text-[18px] leading-[normal] font-medium', tone)}>
            {headline}
          </span>
          <span className="truncate text-ui-sm leading-[normal] text-foreground-muted">
            {stateCaption(model, hasValue) ?? (rest.length > 0 ? rest.join(' · ') : since)}
          </span>
        </div>
      </div>
    </CardFrame>
  );
}

/**
 * Renders a sensor that reads a number, at its size.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
function NumberCard(props: { readonly model: EntityCardModel }) {
  const { t } = useTranslation();

  const { model } = props;
  const { entity, state, title, card, hidden } = model;
  const key = sizeKey(model.size);
  const { head, color } = readingLook(model);
  const [chosen, setChosen] = useState<ShownRange>(card.range === '7d' ? '7d' : '24h');
  const isBars = card.chart === 'bars';
  const isDial = key === '1x2' && !isBars && entity.deviceClass === 'humidity';
  // A bar chart of one hour would be one bar: it draws the day instead.
  const range: HistoryRange =
    key === '2x2' ? chosen : isBars && card.range === '1h' ? '24h' : (card.range ?? '24h');
  // The tile and the dial only say how far the reading moved: an hour is all they read.
  const history = useTelemetry(
    entity.entityId,
    key === '1x1' || isDial ? '1h' : range,
    model.canReadHistory,
  );
  const value = state.sensor_numeric?.value;
  const unit = model.reading.sensorFigure?.unit ?? entity.unitOfMeasurement ?? undefined;
  const points = history?.points ?? [];
  const period = history?.window;
  // The window ends when it was read: the moment the change is measured to.
  const change = period === undefined ? null : changeInLastHour(points, value, period.to);
  // What is worked out from the reading - a change, an average - is written as the reading is.
  const places = value === undefined ? 1 : decimalsOf(value, entity);
  const isLow = entity.deviceClass === 'battery' && value !== undefined && value <= LOW_BATTERY;
  const isMuted = model.isOffline || value === undefined;
  const isWaiting = history !== undefined && points.length < 2;
  const summary = summaryOf(points);
  const showsChart = !hidden.has('chart');

  /**
   * The reading in large figures with its unit; a dash with the unit before the first reading.
   *
   * @param size - How large, as the card's size wants it.
   * @returns The figure.
   */
  const figure = (size: 26 | 30 | 36) => (
    <BigValue
      value={value === undefined ? NO_READING : formatReading(value, entity)}
      unit={unit}
      size={size}
      className={isMuted ? 'text-foreground-subtle' : isLow ? 'text-warning' : undefined}
    />
  );

  /**
   * How far the reading moved in the last hour.
   *
   * @param form - Short on a tile, "▲ 0.6 in 1 h"; long under a large figure, with the unit.
   * @returns The line, or null when it cannot be told.
   */
  const trend = (form: 'short' | 'long'): string | null => {
    if (change === null) {
      return null;
    }

    const amount = formatReading(Math.abs(change), entity, places);
    const moved = form === 'short' ? amount : withUnit(amount, unit);

    if (Math.abs(change) < 10 ** -places / 2) {
      return form === 'short'
        ? t('dashboard.cards.sensorCard.steadyShort', 'Steady in 1 h')
        : t('dashboard.cards.sensorCard.steadyLong', 'Steady in the last hour');
    }

    if (form === 'short') {
      return change > 0
        ? t('dashboard.cards.sensorCard.upShort', '▲ {{change}} in 1 h', { change: moved })
        : t('dashboard.cards.sensorCard.downShort', '▼ {{change}} in 1 h', { change: moved });
    }

    return change > 0
      ? t('dashboard.cards.sensorCard.upLong', '▲ {{change}} in the last hour', { change: moved })
      : t('dashboard.cards.sensorCard.downLong', '▼ {{change}} in the last hour', {
          change: moved,
        });
  };
  const replace = isLow ? t('dashboard.cards.sensorCard.replaceSoon', 'Replace soon') : null;
  const time =
    model.reportedAt === null || value === undefined ? undefined : (
      <Caption>{cardTime(new Date(model.reportedAt))}</Caption>
    );
  const captionTone = isMuted
    ? 'text-foreground-subtle'
    : isLow
      ? 'text-warning'
      : 'text-foreground-muted';

  if (key === '1x1') {
    return (
      <CardFrame label={title}>
        <CardHead
          model={head}
          isActive={null}
          tail={
            entity.deviceClass === 'battery' && value !== undefined ? (
              <BatteryGlyph percent={value} />
            ) : (
              time
            )
          }
        />
        <div className="grow" />
        <div className="flex min-w-0 items-baseline justify-between gap-2.5">
          {figure(26)}
          <Caption className={captionTone}>
            {stateCaption(model, value !== undefined) ?? replace ?? trend('short') ?? ''}
          </Caption>
        </div>
      </CardFrame>
    );
  }

  if (isDial) {
    const comfort =
      value === undefined || isMuted
        ? null
        : value < COMFORT.low
          ? { word: t('dashboard.cards.sensorCard.dry', 'Dry'), tone: 'text-warning' }
          : value > COMFORT.high
            ? { word: t('dashboard.cards.sensorCard.humid', 'Humid'), tone: 'text-warning' }
            : {
                word: t('dashboard.cards.sensorCard.comfortable', 'Comfortable'),
                tone: 'text-success',
              };

    return (
      <CardFrame label={title}>
        <CardHead model={head} isActive={null} tail={time} />
        <div className="mt-0.5 flex min-h-0 grow items-center justify-center">
          <Dial
            percent={value ?? null}
            color={isMuted ? 'var(--color-foreground-disabled)' : color}
          >
            {figure(30)}
            {comfort === null ? null : <Caption className={comfort.tone}>{comfort.word}</Caption>}
          </Dial>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-2.5">
          <Caption>
            {t('dashboard.cards.sensorCard.comfortBand', 'Comfort {{low}}–{{high}}%', COMFORT)}
          </Caption>
          <Caption className={captionTone}>
            {stateCaption(model, value !== undefined) ?? trend('short') ?? ''}
          </Caption>
        </div>
      </CardFrame>
    );
  }

  const line =
    period === undefined
      ? []
      : [
          ...points.map((point) => ({ at: point.time.getTime(), value: point.value })),
          ...(value === undefined ? [] : [{ at: period.to, value }]),
        ];
  const firstAt =
    points[0]?.time ?? (model.reportedAt === null ? null : new Date(model.reportedAt));
  const isDays = range === '7d';
  const bars =
    period === undefined
      ? []
      : barsOf(
          points,
          period,
          isDays ? 'day' : 'hour',
          entity.stateClass === 'total' || entity.stateClass === 'total_increasing',
        );
  const values = bars.map((bar) => bar.value);
  const isPrice = PRICE_UNIT.test(unit ?? '');

  /**
   * Names a bar: its day, or the hour it began.
   *
   * @param from - When it began.
   * @param form - The day as a letter under a bar, short, or whole in a sentence.
   * @returns "T", "Tue", "Tuesday", or "19:00".
   */
  const barName = (from: number, form: 'narrow' | 'short' | 'long'): string =>
    isDays ? dateTimeFormat({ weekday: form }).format(from) : clockText(from);

  /**
   * The line under a bar chart's figure: the running hour or day against the one before.
   *
   * @returns "today · 9% less than Monday", or null when there is nothing to set it against.
   */
  const comparison = (): string | null => {
    const now = values.at(-1);
    const before = values.at(-2);
    const previous = bars.at(-2);

    if (now === null || now === undefined || before === null || before === undefined) {
      return null;
    }

    if (previous === undefined || before === 0) {
      return null;
    }

    const percent = Math.round((Math.abs(now - before) / Math.abs(before)) * 100);
    const words = {
      when: isDays
        ? t('dashboard.cards.sensorCard.today', 'today')
        : t('dashboard.cards.sensorCard.thisHour', 'this hour'),
      before: barName(previous.from, 'long'),
      percent,
    };

    if (percent === 0) {
      return t('dashboard.cards.sensorCard.sameAs', '{{when}} · the same as {{before}}', words);
    }

    return now < before
      ? t(
          'dashboard.cards.sensorCard.lessThan',
          '{{when}} · {{percent}}% less than {{before}}',
          words,
        )
      : t(
          'dashboard.cards.sensorCard.moreThan',
          '{{when}} · {{percent}}% more than {{before}}',
          words,
        );
  };
  const barsLabel = isDays
    ? t('dashboard.cards.sensorCard.dayByDay', 'Day by day, the last 7 days')
    : t('dashboard.cards.sensorCard.hourByHour', 'Hour by hour, the last {{span}}', {
        span: rangeName(range),
      });
  const tallCaption =
    stateCaption(model, value !== undefined) ??
    (isWaiting && firstAt !== null
      ? t('dashboard.cards.sensorCard.firstReading', 'First reading at {{time}}', {
          time: cardTime(firstAt),
        })
      : null) ??
    replace ??
    (isBars ? comparison() : trend('long')) ??
    '';

  if (key === '2x1') {
    if (isBars) {
      return (
        <CardFrame label={title}>
          <div className="flex min-h-0 grow items-center gap-4">
            <div className="w-50 shrink-0">
              <CardHead model={head} isActive={null} />
              <div className="mt-2">{figure(26)}</div>
            </div>
            <div className="min-w-0 grow">
              {!showsChart || period === undefined ? null : isWaiting ? (
                <NoHistory className="h-11" />
              ) : (
                <ReadingBars
                  values={values}
                  isPrice={isPrice}
                  color={color}
                  className="h-15"
                  gap={isDays ? 'gap-2' : 'gap-[3px]'}
                  label={barsLabel}
                />
              )}
            </div>
          </div>
        </CardFrame>
      );
    }

    return (
      <CardFrame label={title}>
        <div className="flex min-h-0 grow gap-5">
          <div className="flex w-50 shrink-0 flex-col justify-between">
            <CardHead model={head} isActive={null} />
            {figure(26)}
          </div>
          {!showsChart || period === undefined ? null : (
            <div className="flex min-w-0 grow flex-col justify-between">
              <div className="flex min-w-0 items-center justify-between gap-2.5">
                <Caption>{rangeName(range)}</Caption>
                <Caption>
                  {summary === null
                    ? ''
                    : t('dashboard.cards.sensorCard.maxMax', 'max {{max}}', {
                        max: withUnit(formatReading(summary.max, entity, places), unit),
                      })}
                </Caption>
              </div>
              {isWaiting ? (
                <NoHistory className="h-11" />
              ) : (
                <AreaLine points={line} window={period} color={color} height={44} />
              )}
            </div>
          )}
        </div>
      </CardFrame>
    );
  }

  if (key === '1x2') {
    return (
      <CardFrame label={title}>
        <CardHead
          model={head}
          isActive={null}
          tail={isBars ? undefined : <Caption>{rangeName(range)}</Caption>}
        />
        <div className="mt-3.5 flex flex-col gap-1.5">
          {figure(36)}
          <Caption className={captionTone}>{tallCaption}</Caption>
        </div>
        <div className="grow" />
        {!showsChart || period === undefined ? null : isWaiting ? (
          <NoHistory className="h-15.5" isWrapped />
        ) : isBars ? (
          <div className="flex flex-col gap-1.5">
            <ReadingBars
              values={values}
              isPrice={isPrice}
              color={color}
              className="h-14"
              gap={isDays ? 'gap-1.5' : 'gap-[3px]'}
              labels={isDays ? bars.map((bar) => barName(bar.from, 'narrow')) : undefined}
              label={barsLabel}
            />
          </div>
        ) : (
          <div className="-mx-4 -mb-4 flex flex-col">
            <div className="flex min-w-0 items-center justify-between gap-2.5 px-4 pb-1">
              <Caption>
                {summary === null
                  ? ''
                  : t('dashboard.cards.sensorCard.minMin', 'min {{min}}', {
                      min: formatReading(summary.min, entity, places),
                    })}
              </Caption>
              <Caption>
                {summary === null
                  ? ''
                  : t('dashboard.cards.sensorCard.maxMax', 'max {{max}}', {
                      max: formatReading(summary.max, entity, places),
                    })}
              </Caption>
            </div>
            <AreaLine points={line} window={period} color={color} height={62} />
          </div>
        )}
      </CardFrame>
    );
  }

  const levels = isPrice ? priceLevels(values) : [];
  const known = bars.flatMap((bar) => (bar.value === null ? [] : [{ ...bar, value: bar.value }]));
  const lowest = known.reduce<(typeof known)[number] | undefined>(
    (best, bar) => (best === undefined || bar.value < best.value ? bar : best),
    undefined,
  );
  const highest = known.reduce<(typeof known)[number] | undefined>(
    (best, bar) => (best === undefined || bar.value > best.value ? bar : best),
    undefined,
  );
  const rows = isBars
    ? [
        {
          label: t('dashboard.cards.sensorCard.lowest', 'Lowest'),
          value:
            lowest === undefined
              ? undefined
              : `${barName(lowest.from, 'short')} · ${formatReading(lowest.value, entity, places)}`,
        },
        {
          label: t('dashboard.cards.sensorCard.highest', 'Highest'),
          value:
            highest === undefined
              ? undefined
              : `${barName(highest.from, 'short')} · ${formatReading(highest.value, entity, places)}`,
        },
      ]
    : [
        { label: t('dashboard.cards.sensorCard.min', 'Min'), value: summary?.min },
        { label: t('dashboard.cards.sensorCard.average', 'Average'), value: summary?.average },
        { label: t('dashboard.cards.sensorCard.max', 'Max'), value: summary?.max },
      ].map((row) => ({
        label: row.label,
        value:
          row.value === undefined
            ? undefined
            : withUnit(formatReading(row.value, entity, places), unit),
      }));
  const level = levels.at(-1) ?? null;
  const tail =
    isPrice && isBars ? (
      level === null ? undefined : (
        <span
          className={cn(
            'inline-flex h-6 items-center gap-1.5 rounded-pill border border-border-strong px-2.5 text-caption font-medium whitespace-nowrap',
            level === 'low' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              level === 'low' ? 'bg-success' : 'bg-warning',
            )}
          />
          {level === 'low'
            ? t('dashboard.cards.sensorCard.lowNow', 'Low now')
            : t('dashboard.cards.sensorCard.highNow', 'High now')}
        </span>
      )
    ) : (
      <RangeSwitch value={chosen} onChange={setChosen} />
    );

  return (
    <CardFrame label={title}>
      <CardHead model={head} isActive={null} tail={tail} />
      <div className="mt-3.5 flex min-h-0 grow gap-6">
        <div className="flex w-37.5 shrink-0 flex-col">
          {figure(36)}
          <div className="mt-auto">
            {rows.map((row, index) => (
              <div
                key={row.label}
                className={cn(
                  'flex min-w-0 items-center justify-between gap-2.5 py-[7px]',
                  index > 0 && 'border-t border-border',
                )}
              >
                <Caption>{row.label}</Caption>
                {row.value === undefined ? (
                  <Caption>{NO_READING}</Caption>
                ) : (
                  <span
                    className={cn(
                      'whitespace-nowrap text-foreground tabular-nums',
                      isBars ? 'text-caption' : 'text-ui-sm leading-4',
                    )}
                  >
                    {row.value}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
        {!showsChart || period === undefined ? null : (
          <div className="flex min-w-0 grow flex-col justify-end gap-1.5">
            {isWaiting ? (
              <NoHistory className="h-30" />
            ) : isBars ? (
              <>
                <ReadingBars
                  values={values}
                  isPrice={isPrice}
                  color={color}
                  className="h-26"
                  gap={isDays ? 'gap-2' : 'gap-[3px]'}
                  labels={isDays ? bars.map((bar) => barName(bar.from, 'narrow')) : undefined}
                  label={barsLabel}
                />
                {isDays ? null : <TimeAxis window={period} />}
              </>
            ) : (
              <>
                <div className="flex min-h-0 grow items-end">
                  <AreaLine points={line} window={period} color={color} height={115} hasDot />
                </div>
                <TimeAxis window={period} />
              </>
            )}
          </div>
        )}
      </div>
    </CardFrame>
  );
}
