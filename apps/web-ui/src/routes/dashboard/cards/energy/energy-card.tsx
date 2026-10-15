/**
 * The energy card: where the house's power comes from and goes to, now and over the day.
 *
 * At the top, what the house is doing in one word, in the colour of the power doing it -
 * charging from the panels is green, running on the grid yellow. Under it the house, with the
 * power moving along its wires and each meter's figure on a line down to what it reads - drawn
 * across the card's whole width, reaching its edges as the picture it is drawn after does. With
 * it, the day: what the panels made - or, without panels, what the house used - and, with panels,
 * how much of the day the house ran on its own power. On the large and tall cards in one row under
 * the house, so the house keeps the height; on the square card in a column beside it, where the
 * card is wide enough.
 */
import { useTranslation } from 'react-i18next';

import type { DashboardEnergyCard } from '@nebulahome/contracts';
import { AppIcon, cn, type UiIconId } from '@nebulahome/ui';

import { defineMessage, type Message, text, translate } from '@/i18n/messages';
import { formatEnergy, formatPower, mainSource, type EnergyHeadline } from '@/lib/energy-flow';
import { useElementSize } from '@/lib/use-element-size';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import { EnergyScene } from '@/routes/dashboard/cards/energy/energy-scene';
import { SOURCE_COLORS } from '@/routes/dashboard/cards/energy/flow-wire';
import { useEnergy, type EnergyModel } from '@/routes/dashboard/cards/energy/use-energy';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';

/** The one word the card leads with, for what the house is doing. */
const HEADLINES: Readonly<Record<EnergyHeadline, Message>> = {
  charging: defineMessage('dashboard.energy.energyCard.charging', 'Charging'),
  discharging: defineMessage('dashboard.energy.energyCard.onBattery', 'On battery'),
  exporting: defineMessage('dashboard.energy.energyCard.exporting', 'Exporting'),
  'self-powered': defineMessage('dashboard.energy.energyCard.selfPowered', 'Self-powered'),
  importing: defineMessage('dashboard.energy.energyCard.onTheGrid', 'On the grid'),
  idle: defineMessage('dashboard.energy.energyCard.idle', 'Idle'),
};

/**
 * The colour the headline is written in: the colour of the power doing what it says.
 *
 * @param model - What the card read.
 * @returns A CSS colour, or undefined for the plain text colour.
 */
function headlineColor(model: EnergyModel): string | undefined {
  const { flows, headline } = model;

  switch (headline) {
    case 'charging': {
      const source = mainSource({ solar: flows.solarToBattery, grid: flows.gridToBattery });

      return source === null ? undefined : SOURCE_COLORS[source];
    }
    case 'discharging':
      return SOURCE_COLORS.battery;
    case 'exporting':
    case 'self-powered':
      return SOURCE_COLORS.solar;
    case 'importing':
      return SOURCE_COLORS.grid;
    case 'idle':
      return undefined;
  }
}

/**
 * Says what the drawing shows, for somebody who cannot see it.
 *
 * @param model - What the card read.
 * @returns One sentence.
 */
function sceneLabel(model: EnergyModel): string {
  /**
   * A power in words.
   *
   * @param watts - The power.
   * @returns The words.
   */
  const said = (watts: number): string => {
    const { value, unit } = formatPower(watts);

    return unit === 'kW'
      ? translate('dashboard.energy.energyCard.kilowatts', '{{value}} kilowatts', { value })
      : translate('dashboard.energy.energyCard.watts', '{{value}} watts', { value });
  };
  const { readings, flows, batteryLevel } = model;
  const parts = [
    readings.solar === null
      ? null
      : translate('dashboard.energy.energyCard.panelsMakingSolar', 'panels making {{solar}}', {
          solar: said(readings.solar),
        }),
    readings.battery === null
      ? null
      : `${
          readings.battery < 0
            ? translate(
                'dashboard.energy.energyCard.batteryCharging',
                'battery charging at {{power}}',
                {
                  power: said(readings.battery),
                },
              )
            : translate('dashboard.energy.energyCard.batteryGiving', 'battery giving {{power}}', {
                power: said(readings.battery),
              })
        }${
          batteryLevel === null
            ? ''
            : translate('dashboard.energy.energyCard.percentFull', ', {{level}} percent full', {
                level: Math.round(batteryLevel),
              })
        }`,
    readings.grid === null
      ? null
      : readings.grid < 0
        ? translate('dashboard.energy.energyCard.selling', 'selling {{power}} to the grid', {
            power: said(readings.grid),
          })
        : translate('dashboard.energy.energyCard.buying', 'buying {{power}} from the grid', {
            power: said(readings.grid),
          }),
    translate('dashboard.energy.energyCard.houseUsingHome', 'house using {{home}}', {
      home: said(flows.home),
    }),
  ].filter((part): part is string => part !== null);

  return `${text(HEADLINES[model.headline])}: ${parts.join('; ')}.`;
}

/** What one line of the day needs. */
type DayLineProps = {
  readonly icon: UiIconId;
  readonly title: string;
  readonly detail: string;

  /** Whether the figure may take a second line, in the narrow column beside the house. */
  readonly wraps?: boolean;
};

/**
 * One line of the day: an icon, what it is, and the figure.
 *
 * @param props - See {@link DayLineProps}.
 * @returns The line.
 */
function DayLine(props: DayLineProps) {
  const { icon, title, detail, wraps = false } = props;

  return (
    <div className="flex min-w-0 items-center gap-2.5 border-t border-border py-2.5 first:border-t-0 [.grid-cols-2>&]:border-t-0">
      <AppIcon id={icon} size={16} className="shrink-0 text-foreground-subtle" />
      <div className="flex min-w-0 flex-col">
        <span className="text-ui leading-tight font-medium text-foreground">{title}</span>
        <span className={cn('text-caption text-foreground-muted tabular', !wraps && 'truncate')}>
          {detail}
        </span>
      </div>
    </div>
  );
}

/**
 * Writes an energy in the unit that suits it: Wh, kWh or MWh.
 *
 * @param kwh - The energy, in kilowatt-hours.
 * @returns The figure with its unit.
 */
function kwhText(kwh: number): string {
  return formatEnergy(kwh);
}

/** The narrowest the day's two lines are set side by side at, in pixels; stacked below it. */
const SIDE_BY_SIDE_WIDTH = 340;

/** The narrowest a square card sets the day in a column beside the house at, in pixels. */
const DAY_COLUMN_WIDTH = 380;

/** What the card needs. */
export type EnergyCardProps = {
  readonly card: DashboardEnergyCard;
  readonly data: DashboardData;
};

/**
 * Renders the energy card at its size.
 *
 * @param props - See {@link EnergyCardProps}.
 * @returns The card.
 */
export function EnergyCard(props: EnergyCardProps) {
  const { t } = useTranslation();

  const { card, data } = props;
  const isLarge = card.h >= 3;
  const { ref: dayRef, size: daySize } = useElementSize<HTMLDivElement>();
  const { ref: bodyRef, size: bodySize } = useElementSize<HTMLDivElement>();
  const isSideBySide = daySize.width === 0 || daySize.width >= SIDE_BY_SIDE_WIDTH;
  // Before the card is laid out - and in a test - the column is assumed to fit.
  const hasDayColumn = !isLarge && (bodySize.width === 0 || bodySize.width >= DAY_COLUMN_WIDTH);
  const model = useEnergy(card, data, isLarge || hasDayColumn);
  const title = card.title ?? t('dashboard.energy.energyCard.energy', 'Energy');

  if (model.isEmpty) {
    return (
      <CardFrame label={title} tone="faint" className="items-center justify-center text-center">
        <AppIcon id="zap" size={20} className="text-foreground-subtle" />
        <p className="mt-2 max-w-52 text-caption text-foreground-muted">
          {t(
            'dashboard.energy.energyCard.pickThePanelsBattery',
            "Pick the panels, battery and grid meters in this card's settings.",
          )}
        </p>
      </CardFrame>
    );
  }

  const color = headlineColor(model);
  const { today } = model;
  /**
   * Says a figure of the day, or why there is none yet.
   *
   * @param words - Says the figure, from the day.
   * @returns The line.
   */
  const dayDetail = (words: (value: NonNullable<typeof today>) => string): string =>
    today === undefined
      ? model.canReadDay
        ? 'Reading…'
        : t('dashboard.energy.energyCard.needsAccessToHistory', 'Needs access to history')
      : words(today);
  const dayLines = (
    <>
      <DayLine
        icon="chart-line"
        title={t('dashboard.energy.energyCard.energy', 'Energy')}
        wraps={!isLarge}
        detail={dayDetail((day) =>
          day.generated === null
            ? `${kwhText(day.used)} used today`
            : `${kwhText(day.generated)} generated today`,
        )}
      />
      {model.hasSolar ? (
        <DayLine
          icon="leaf"
          title={t('dashboard.energy.energyCard.impact', 'Impact')}
          wraps={!isLarge}
          detail={dayDetail((day) => `${String(day.selfPowered ?? 0)}% self-powered today`)}
        />
      ) : null}
    </>
  );
  const scene = (
    <EnergyScene
      houseStyle={card.houseStyle}
      meters={{
        solar: model.readings.solar,
        battery: model.readings.battery,
        batteryLevel: model.batteryLevel,
        grid: model.readings.grid,
        hasGrid: model.hasGrid,
      }}
      hasSolar={model.hasSolar}
      hasBattery={model.hasBattery}
      flows={model.flows}
      label={sceneLabel(model)}
    />
  );

  return (
    <CardFrame label={title} className="gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={cn('text-subhead font-medium', color === undefined && 'text-foreground-muted')}
          /* eslint-disable-next-line react/forbid-dom-props -- the colour of the power, one of three
             tokens chosen at render. */
          style={color === undefined ? undefined : { color }}
        >
          {text(HEADLINES[model.headline])}
        </span>
        <span className="truncate text-caption text-foreground-subtle">{title}</span>
      </div>

      {isLarge ? (
        <>
          <div className="relative -mx-4 min-h-0 grow">{scene}</div>
          {/* Side by side, on the tall card too: stacked, the two lines would take the height
              the house is drawn in. Stacked only where the card is too narrow for two. */}
          <div
            ref={dayRef}
            className={cn(
              'mt-1.5 grid border-t border-border',
              isSideBySide ? 'grid-cols-2 gap-x-4' : 'grid-cols-1',
            )}
          >
            {dayLines}
          </div>
        </>
      ) : (
        // The square card is short and wide: the day goes in a column beside the house.
        <div ref={bodyRef} className="flex min-h-0 grow">
          <div className={cn('relative min-h-0 grow', hasDayColumn ? '-ml-4' : '-mx-4')}>
            {scene}
          </div>
          {hasDayColumn ? (
            <div className="flex w-36 shrink-0 flex-col justify-center border-l border-border pl-3">
              {dayLines}
            </div>
          ) : null}
        </div>
      )}
    </CardFrame>
  );
}
