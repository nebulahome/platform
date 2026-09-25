/**
 * The energy card: where the house's power comes from and goes to, now and over the day.
 *
 * At the top, what the house is doing in one word, in the colour of the power doing it -
 * charging from the panels is green, running on the grid yellow. Under it the house, with the
 * power moving along its wires and each meter's figure on a line down to what it reads. On the
 * large card, the day: what the panels made - or, without panels, what the house used - and, with
 * panels, how much of the day the house ran on its own power.
 */
import type { DashboardEnergyCard } from '@nebula-home/contracts';
import { AppIcon, cn, type UiIconId } from '@nebula-home/ui';

import { formatPower, mainSource, type EnergyHeadline } from '@/lib/energy-flow';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import { EnergyScene } from '@/routes/dashboard/cards/energy/energy-scene';
import { SOURCE_COLORS } from '@/routes/dashboard/cards/energy/flow-wire';
import { useEnergy, type EnergyModel } from '@/routes/dashboard/cards/energy/use-energy';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';

/** The one word the card leads with, for what the house is doing. */
const HEADLINES: Readonly<Record<EnergyHeadline, string>> = {
  charging: 'Charging',
  discharging: 'On battery',
  exporting: 'Exporting',
  'self-powered': 'Self-powered',
  importing: 'On the grid',
  idle: 'Idle',
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

    return `${value} ${unit === 'kW' ? 'kilowatts' : 'watts'}`;
  };
  const { readings, flows, batteryLevel } = model;
  const parts = [
    readings.solar === null ? null : `panels making ${said(readings.solar)}`,
    readings.battery === null
      ? null
      : `battery ${readings.battery < 0 ? 'charging at' : 'giving'} ${said(readings.battery)}${
          batteryLevel === null ? '' : `, ${String(Math.round(batteryLevel))} percent full`
        }`,
    readings.grid === null
      ? null
      : `${readings.grid < 0 ? 'selling' : 'buying'} ${said(readings.grid)} ${
          readings.grid < 0 ? 'to' : 'from'
        } the grid`,
    `house using ${said(flows.home)}`,
  ].filter((part): part is string => part !== null);

  return `${HEADLINES[model.headline]}: ${parts.join('; ')}.`;
}

/** What one line of the day needs. */
type DayLineProps = {
  readonly icon: UiIconId;
  readonly title: string;
  readonly detail: string;
};

/**
 * One line of the day: an icon, what it is, and the figure.
 *
 * @param props - See {@link DayLineProps}.
 * @returns The line.
 */
function DayLine(props: DayLineProps) {
  const { icon, title, detail } = props;

  return (
    <div className="flex min-w-0 items-center gap-3 border-t border-border-soft py-2.5 first:border-t-0 [.grid-cols-2>&]:border-t-0">
      <AppIcon id={icon} size={18} className="shrink-0 text-foreground-subtle" />
      <div className="flex min-w-0 flex-col">
        <span className="text-title leading-tight font-semibold text-foreground">{title}</span>
        <span className="truncate text-caption text-foreground-muted tabular">{detail}</span>
      </div>
    </div>
  );
}

/**
 * Writes kilowatt-hours to one decimal.
 *
 * @param kwh - The energy.
 * @returns The figure with its unit.
 */
function kwhText(kwh: number): string {
  return `${kwh.toFixed(1)} kWh`;
}

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
  const { card, data } = props;
  const isLarge = card.h >= 3;
  const model = useEnergy(card, data, isLarge);
  const title = card.title ?? 'Energy';

  if (model.isEmpty) {
    return (
      <CardFrame label={title} tone="faint" className="items-center justify-center text-center">
        <AppIcon id="zap" size={20} className="text-foreground-subtle" />
        <p className="mt-2 max-w-52 text-caption text-foreground-muted">
          Pick the panels, battery and grid meters in this card&apos;s settings.
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
        : 'Needs access to history'
      : words(today);

  return (
    <CardFrame label={title} className="gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={cn(
            'text-subhead font-semibold',
            color === undefined && 'text-foreground-muted',
          )}
          /* eslint-disable-next-line react/forbid-dom-props -- the colour of the power, one of three
             tokens chosen at render. */
          style={color === undefined ? undefined : { color }}
        >
          {HEADLINES[model.headline]}
        </span>
        <span className="truncate text-caption text-foreground-subtle">{title}</span>
      </div>

      <div className="relative min-h-0 grow">
        <EnergyScene
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
      </div>

      {isLarge ? (
        // Stacked on the tall card, as the picture has them; side by side on the large one,
        // where two stacked lines would leave the house no room.
        <div
          className={cn(
            'grid',
            card.h >= 4 ? 'grid-cols-1' : 'grid-cols-2 gap-x-4 border-t border-border-soft',
          )}
        >
          <DayLine
            icon="chart-line"
            title="Energy"
            detail={dayDetail((day) =>
              day.generated === null
                ? `${kwhText(day.used)} used today`
                : `${kwhText(day.generated)} generated today`,
            )}
          />
          {model.hasSolar ? (
            <DayLine
              icon="leaf"
              title="Impact"
              detail={dayDetail((day) => `${String(day.selfPowered ?? 0)}% self-powered today`)}
            />
          ) : null}
        </div>
      ) : null}
    </CardFrame>
  );
}
