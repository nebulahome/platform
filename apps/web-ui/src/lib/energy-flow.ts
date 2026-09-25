/**
 * Where a house's power comes from and goes to, worked out from what its meters say.
 *
 * Three sources can feed the house - the panels, the battery and the grid - and the power they
 * give has to be shared out along the wires the energy card draws: the panels feed the house
 * first, then charge the battery, and send what is left to the grid; the battery feeds the house
 * and, if anything is left, the grid; the grid feeds the house and whatever charging the panels
 * could not cover. That order is the one a home battery system runs by, and it is the only one
 * that can be told apart from four numbers.
 *
 * Every figure here is in watts. Meters disagree about signs, so a card says which way its own
 * count; after that, a battery's power is positive while it discharges and a grid's while the
 * house buys from it.
 *
 * The day's figures come from the readings kept every minute: a meter's average over each minute
 * is the energy that went through it in that minute, which is enough to say how many kilowatt-
 * hours the panels made today and how much of the house's use they covered.
 */
import type { TelemetryPoint } from '@nebula-home/contracts';

/** Below this many watts a flow is noise from the meter, and is drawn as none. */
export const IDLE_WATTS = 10;

/** What the meters say now, in watts; null for a meter the card has none of. */
export type PowerReadings = {
  /** What the panels produce; never negative. */
  readonly solar: number | null;

  /** Positive while the battery discharges, negative while it charges. */
  readonly battery: number | null;

  /** Positive while the house buys from the grid, negative while it sells. */
  readonly grid: number | null;

  /** What the house uses, when a meter says so; worked out from the others otherwise. */
  readonly home: number | null;
};

/** How the power is shared out along the wires, in watts, none negative. */
export type PowerFlows = {
  readonly solarToHome: number;
  readonly solarToBattery: number;
  readonly solarToGrid: number;
  readonly batteryToHome: number;
  readonly batteryToGrid: number;
  readonly gridToHome: number;
  readonly gridToBattery: number;

  /** What the house uses. */
  readonly home: number;
};

/** A source of power, which is also the colour its flow is drawn in. */
export type PowerSource = 'solar' | 'battery' | 'grid';

/** What the house is doing, in the one word the card leads with. */
export type EnergyHeadline =
  'charging' | 'discharging' | 'exporting' | 'self-powered' | 'importing' | 'idle';

/**
 * Turns a reading into watts.
 *
 * @param value - The reading.
 * @param unit - Its unit as the entity declares it; watts when it says nothing.
 * @returns The reading in watts.
 */
export function toWatts(value: number, unit: string | null): number {
  switch (unit?.trim()) {
    case 'kW':
      return value * 1000;
    case 'MW':
      return value * 1_000_000;
    case 'mW':
      return value / 1000;
    default:
      return value;
  }
}

/**
 * Writes a power the way the card shows it: watts below a kilowatt, kilowatts to one decimal
 * above, megawatts to two from a thousand kilowatts.
 *
 * @param watts - The power, in watts; its sign is the caller's to say in words.
 * @returns The figure and its unit.
 */
export function formatPower(watts: number): { readonly value: string; readonly unit: string } {
  const magnitude = Math.abs(watts);

  // Rounded first at every step, so 999.6 W reads 1.0 kW and 999,960 W reads 1.00 MW rather
  // than 1000 W and 1000.0 kW.
  if (Math.round(magnitude) < 1000) {
    return { value: String(Math.round(magnitude)), unit: 'W' };
  }

  if (Math.round(magnitude / 100) >= 10_000) {
    return { value: (magnitude / 1_000_000).toFixed(2), unit: 'MW' };
  }

  return { value: (magnitude / 1000).toFixed(1), unit: 'kW' };
}

/**
 * Writes an energy the same way: watt-hours below a kilowatt-hour, kilowatt-hours to one decimal
 * above, megawatt-hours to two from a thousand kilowatt-hours.
 *
 * @param kwh - The energy, in kilowatt-hours.
 * @returns The figure with its unit.
 */
export function formatEnergy(kwh: number): string {
  const { value, unit } = formatPower(kwh * 1000);

  return `${value} ${unit}h`;
}

/**
 * Shares the power out along the wires.
 *
 * @param readings - What the meters say now.
 * @returns The flows, and what the house uses.
 */
export function flowsOf(readings: PowerReadings): PowerFlows {
  const solar = Math.max(readings.solar ?? 0, 0);
  const discharge = Math.max(readings.battery ?? 0, 0);
  const charge = Math.max(-(readings.battery ?? 0), 0);
  const bought = Math.max(readings.grid ?? 0, 0);
  const sold = Math.max(-(readings.grid ?? 0), 0);

  const solarToGrid = Math.min(sold, solar);
  const batteryToGrid = Math.min(sold - solarToGrid, discharge);
  const solarToBattery = Math.min(charge, solar - solarToGrid);
  const gridToBattery = Math.min(charge - solarToBattery, bought);
  const derived = solar + discharge + bought - charge - sold;

  return {
    solarToHome: Math.max(solar - solarToGrid - solarToBattery, 0),
    solarToBattery,
    solarToGrid,
    batteryToHome: Math.max(discharge - batteryToGrid, 0),
    batteryToGrid,
    gridToHome: Math.max(bought - gridToBattery, 0),
    gridToBattery,
    home: Math.max(readings.home ?? derived, 0),
  };
}

/**
 * Says which source gives most along a wire, for the colour it is drawn in.
 *
 * @param shares - What each source gives.
 * @returns The one giving most, or null when none gives anything worth drawing.
 */
export function mainSource(
  shares: Readonly<Partial<Record<PowerSource, number>>>,
): PowerSource | null {
  let best: PowerSource | null = null;
  let most = IDLE_WATTS;

  for (const source of ['solar', 'battery', 'grid'] as const) {
    const share = shares[source] ?? 0;

    if (share > most) {
      best = source;
      most = share;
    }
  }

  return best;
}

/**
 * Says what the house is doing, most telling first: a battery charging or discharging, then the
 * house selling, then whether it is running on its own power or the grid's.
 *
 * @param readings - What the meters say now.
 * @returns The headline.
 */
export function headlineOf(readings: PowerReadings): EnergyHeadline {
  const battery = readings.battery ?? 0;
  const grid = readings.grid ?? 0;
  const solar = readings.solar ?? 0;

  if (battery < -IDLE_WATTS) {
    return 'charging';
  }

  if (battery > IDLE_WATTS) {
    return 'discharging';
  }

  if (grid < -IDLE_WATTS) {
    return 'exporting';
  }

  if (grid > IDLE_WATTS) {
    return 'importing';
  }

  return solar > IDLE_WATTS ? 'self-powered' : 'idle';
}

/** One meter's readings for the day, and which way it counts. */
export type DayReadings = {
  readonly points: readonly TelemetryPoint[];

  /** Multiplies each reading, to turn the meter's sign into the card's: 1 or -1. */
  readonly sign: 1 | -1;

  /** The meter's unit, to turn its readings into watts. */
  readonly unit: string | null;
};

/** How long one reading at the minute resolution stands for, at most, in milliseconds. */
const MINUTE_MS = 60_000;

/**
 * Adds up the energy a meter saw, splitting what went one way from what went the other.
 *
 * Each reading is the meter's average over its minute, so it counts for a minute - or for less,
 * when the next reading came sooner or the minute is still running. A gap longer than a minute is
 * a meter that was not reporting, and counts for nothing.
 *
 * @param day - The readings, oldest first, and which way the meter counts.
 * @param nowMs - The time now, which ends the last minute.
 * @returns Kilowatt-hours in the positive and the negative direction, both positive numbers.
 */
export function energyOf(
  day: DayReadings,
  nowMs: number,
): { readonly positive: number; readonly negative: number } {
  let positive = 0;
  let negative = 0;

  day.points.forEach((point, index) => {
    const next = day.points[index + 1];
    const endMs = next === undefined ? nowMs : next.time.getTime();
    const durationMs = Math.max(Math.min(endMs - point.time.getTime(), MINUTE_MS), 0);
    const kwh = (toWatts(point.value, day.unit) * day.sign * durationMs) / 3_600_000_000;

    if (kwh > 0) {
      positive += kwh;
    } else {
      negative -= kwh;
    }
  });

  return { positive, negative };
}

/** What the day's readings add up to, in kilowatt-hours. */
export type EnergyToday = {
  /** What the panels made; null without panels. */
  readonly generated: number | null;

  /** What the house used. */
  readonly used: number;

  /** What was bought from the grid. */
  readonly bought: number;

  /** How much of what the house used did not come from the grid, from 0 to 100; null without panels. */
  readonly selfPowered: number | null;
};

/**
 * Adds up the day.
 *
 * The house's use is its own meter's when it has one, and otherwise what the others add up to:
 * made, discharged and bought, less charged and sold.
 *
 * @param meters - The day's readings of each meter the card has.
 * @param meters.solar - The panels'.
 * @param meters.battery - The battery's, discharging positive.
 * @param meters.grid - The grid's, buying positive.
 * @param meters.home - The house's own.
 * @param nowMs - The time now.
 * @returns The day's figures.
 */
export function energyToday(
  meters: {
    readonly solar: DayReadings | null;
    readonly battery: DayReadings | null;
    readonly grid: DayReadings | null;
    readonly home: DayReadings | null;
  },
  nowMs: number,
): EnergyToday {
  const solar = meters.solar === null ? null : energyOf(meters.solar, nowMs).positive;
  const battery = meters.battery === null ? null : energyOf(meters.battery, nowMs);
  const grid = meters.grid === null ? null : energyOf(meters.grid, nowMs);
  const bought = grid?.positive ?? 0;
  const used =
    meters.home === null
      ? Math.max(
          (solar ?? 0) +
            (battery?.positive ?? 0) +
            bought -
            (battery?.negative ?? 0) -
            (grid?.negative ?? 0),
          0,
        )
      : energyOf(meters.home, nowMs).positive;
  const selfPowered =
    solar === null
      ? null
      : used <= 0
        ? 100
        : Math.min(Math.max(Math.round((1 - bought / used) * 100), 0), 100);

  return { generated: solar, used, bought, selfPowered };
}
