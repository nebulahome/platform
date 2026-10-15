/**
 * A sensor that reads a number, or a line of text.
 *
 * The number is the point, so it is the largest thing on the card at every size. The tall card
 * adds the day's line under it; the square card gives the line the room it wants, with the lowest
 * and highest of the window and how far the reading has moved since it began. A reading in words -
 * a text sensor - is written out, as much of it as the card can hold.
 */
import { useTranslation } from 'react-i18next';

import { CardHeading, Figure } from '@nebulahome/ui';

import { LiveAreaChart } from '@/components/live-area-chart';
import { numberFormat } from '@/i18n/formatters';
import { defineMessage, text } from '@/i18n/messages';
import type { HistoryRange } from '@/library/history-series';
import { CardFrame, EndReading, TileRow } from '@/routes/dashboard/cards/card-parts';
import { cardTime, sizeKey, type EntityCardModel } from '@/routes/dashboard/cards/entity-model';
import { useTelemetry } from '@/routes/dashboard/cards/use-card-history';

/**
 * How a reading is written on a card.
 *
 * @returns The formatter, in the reader's language.
 */
const numbers = (): Intl.NumberFormat => numberFormat({ maximumFractionDigits: 1 });

/** The series the chart draws: the reading, in the accent. */
const SERIES = [
  {
    key: 'value',
    label: defineMessage('dashboard.cards.sensorCard.reading', 'Reading'),
    color: 'var(--color-primary)',
    dotClass: 'bg-primary',
  },
] as const;

/**
 * A reading as a figure and a unit.
 *
 * @param model - The card.
 * @returns The figure, a dash when there is none, and the unit.
 */
function figureOf(model: EntityCardModel): {
  readonly value: string;
  readonly unit: string | null;
} {
  const { reading, state, entity } = model;

  if (reading.sensorFigure !== null) {
    return { value: reading.sensorFigure.figure, unit: reading.sensorFigure.unit };
  }

  if (state.sensor_numeric !== undefined) {
    return { value: numbers().format(state.sensor_numeric.value), unit: entity.unitOfMeasurement };
  }

  return { value: state.sensor_text?.value ?? reading.text, unit: null };
}

/**
 * Renders a numeric or text sensor card at its size.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function SensorCard(props: { readonly model: EntityCardModel }) {
  const { t } = useTranslation();

  const { model } = props;
  const { entity, state, title, subtitle, reading, card } = model;
  const key = sizeKey(model.size);
  const isNumber = state.sensor_numeric !== undefined;
  const range: HistoryRange = card.range ?? '24h';
  const history = useTelemetry(
    entity.entityId,
    range,
    isNumber && model.canReadHistory && (key === '1x2' || key === '2x1' || key === '2x2'),
  );
  const { value, unit } = figureOf(model);
  const changed = model.changedAt === null ? null : cardTime(model.changedAt);

  if (key === '1x1') {
    return (
      <CardFrame label={title}>
        <TileRow
          icon={model.icon}
          kind={model.kind}
          isActive={null}
          isAvailable={reading.isAvailable}
          title={title}
          subtitle={subtitle}
          tail={
            <EndReading
              value={
                unit === null || unit === '' ? value : `${value}${unit === '%' ? '' : ' '}${unit}`
              }
              note={changed}
            />
          }
        />
      </CardFrame>
    );
  }

  const points = (history?.points ?? []).map((point) => ({
    at: point.time.getTime(),
    value: point.value,
  }));
  const now = state.sensor_numeric?.value;
  const nowAt = model.reportedAt ?? history?.window.to;
  const data =
    now === undefined || nowAt === undefined || points.length === 0
      ? points
      : [...points, { at: nowAt, value: now }];
  const lows = (history?.points ?? []).map((point) => point.min ?? point.value);
  const highs = (history?.points ?? []).map((point) => point.max ?? point.value);
  const first = history?.points[0]?.value;
  const moved = now === undefined || first === undefined ? null : now - first;
  const chart =
    data.length < 2 ? null : (
      <div className="h-full min-h-0 w-full">
        <LiveAreaChart
          data={data}
          series={SERIES.map((line) => ({ ...line, label: text(line.label) }))}
          formatValue={(reading) =>
            `${numbers().format(reading)}${unit === null ? '' : ` ${unit}`}`
          }
        />
      </div>
    );

  if (!isNumber) {
    return (
      <CardFrame label={title}>
        <CardHeading title={title} subtitle={subtitle} />
        <div className="grow" />
        <p className="line-clamp-2 text-subhead font-medium">{value}</p>
        {changed === null ? null : (
          <span className="text-caption text-foreground-subtle">
            {t('dashboard.cards.sensorCard.sinceChanged', 'since {{changed}}', { changed })}
          </span>
        )}
      </CardFrame>
    );
  }

  if (key === '2x1') {
    return (
      <CardFrame label={title}>
        <div className="flex h-full min-w-0 items-center gap-4">
          <div className="flex min-w-0 shrink-0 flex-col gap-1">
            <CardHeading title={title} subtitle={subtitle} />
            <Figure value={value} unit={unit} size="small" />
          </div>
          <div className="h-full min-w-0 grow">{chart}</div>
        </div>
      </CardFrame>
    );
  }

  if (key === '1x2') {
    return (
      <CardFrame label={title}>
        <CardHeading title={title} subtitle={subtitle} />
        <div className="grow" />
        <Figure value={value} unit={unit} />
        <div className="mt-3 h-12">{chart}</div>
      </CardFrame>
    );
  }

  return (
    <CardFrame label={title}>
      <CardHeading
        title={title}
        subtitle={subtitle}
        tail={
          <span className="rounded-full border border-border px-2 py-0.5 text-label text-foreground-subtle">
            {range}
          </span>
        }
      />
      <div className="flex min-h-0 grow items-end gap-5 pt-3">
        <div className="flex w-32 shrink-0 flex-col gap-1.5">
          <Figure value={value} unit={unit} />
          {moved === null ? null : (
            <span className="text-caption text-foreground-muted tabular">
              {moved >= 0 ? '+' : '−'}
              {t('dashboard.cards.sensorCard.movedInRange', '{{moved}} in {{range}}', {
                moved: numbers().format(Math.abs(moved)),
                range,
              })}
            </span>
          )}
        </div>
        <div className="flex h-full min-w-0 grow flex-col gap-1">
          <div className="min-h-0 grow">{chart}</div>
          {lows.length === 0 ? null : (
            <div className="flex justify-between font-mono text-label text-foreground-subtle tabular">
              <span>
                {t('dashboard.cards.sensorCard.minMin', 'min {{min}}', {
                  min: numbers().format(Math.min(...lows)),
                })}
              </span>
              <span>
                {t('dashboard.cards.sensorCard.maxMax', 'max {{max}}', {
                  max: numbers().format(Math.max(...highs)),
                })}
              </span>
            </div>
          )}
        </div>
      </div>
    </CardFrame>
  );
}
