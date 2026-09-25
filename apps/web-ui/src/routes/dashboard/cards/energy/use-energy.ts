/**
 * What the energy card reads: each meter now, in watts and the card's signs, and the day so far.
 *
 * Now is the live reading of each entity the card names, turned into watts from the entity's own
 * unit and into the card's signs from the switches in its settings - a battery discharging and a
 * house buying are positive. The day is each meter's readings since midnight, kept a minute at a
 * time, read only for the large card that shows it and only from meters this person may read the
 * past of, and read again every few minutes.
 */
import { useQueries } from '@tanstack/react-query';

import type { DashboardEnergyCard, EntityView } from '@nebula-home/contracts';

import {
  energyToday,
  flowsOf,
  headlineOf,
  toWatts,
  type DayReadings,
  type EnergyHeadline,
  type EnergyToday,
  type PowerFlows,
  type PowerReadings,
} from '@/lib/energy-flow';
import { fetchTelemetry, LIBRARY_QUERY_KEYS } from '@/library/api';
import { capabilityStateOf } from '@/library/entity-control';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';

/** How often the day's figures are read again. */
const DAY_REFRESH_MS = 5 * 60_000;

/** The meters a card can name, by the field that names each. */
const METERS = ['solarPower', 'batteryPower', 'gridPower', 'homePower'] as const;

/** One of the meters a card can name. */
type MeterField = (typeof METERS)[number];

/** Everything the card draws. */
export type EnergyModel = {
  /** Each meter now, in watts and the card's signs. */
  readonly readings: PowerReadings;

  /** How full the battery is, from 0 to 100. */
  readonly batteryLevel: number | null;

  /** How the power is shared out. */
  readonly flows: PowerFlows;

  /** What the house is doing. */
  readonly headline: EnergyHeadline;

  /** Which parts the card has. */
  readonly hasSolar: boolean;
  readonly hasBattery: boolean;
  readonly hasGrid: boolean;

  /** Whether the card names no meter at all yet. */
  readonly isEmpty: boolean;

  /** The day so far; undefined until read, or when it is not read. */
  readonly today: EnergyToday | undefined;

  /** Whether any of the card's meters has a past this person may read. */
  readonly canReadDay: boolean;
};

/**
 * The sign a meter's readings are multiplied by to count the card's way.
 *
 * @param card - The card, with its sign switches.
 * @param field - Which meter.
 * @returns 1 or -1.
 */
function signOf(card: DashboardEnergyCard, field: MeterField): 1 | -1 {
  if (field === 'gridPower') {
    return card.isGridImportPositive ? 1 : -1;
  }

  if (field === 'batteryPower') {
    return card.isBatteryDischargePositive ? 1 : -1;
  }

  return 1;
}

/**
 * The start of today, on this browser's clock.
 *
 * @param now - The time now.
 * @returns Midnight.
 */
function midnight(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Reads what an energy card draws.
 *
 * @param card - The card, naming its meters.
 * @param data - What the page read.
 * @param wantsToday - Whether the card shows the day's figures.
 * @returns See {@link EnergyModel}.
 */
export function useEnergy(
  card: DashboardEnergyCard,
  data: DashboardData,
  wantsToday: boolean,
): EnergyModel {
  /**
   * The entity a field names, when the card names one and it is there.
   *
   * @param field - Which meter, or the battery's level.
   * @returns The entity.
   */
  const entityOf = (field: MeterField | 'batteryLevel'): EntityView | undefined => {
    const entityId = card[field];

    return entityId === null ? undefined : data.entityById.get(entityId);
  };

  /**
   * What an entity reads now, when it is reachable and reads a number.
   *
   * @param entity - The entity.
   * @returns The number, in the entity's own unit.
   */
  const valueOf = (entity: EntityView | undefined): number | null => {
    if (entity === undefined) {
      return null;
    }

    const live = data.readings[entity.entityId];

    if (!(live?.isAvailable ?? entity.isAvailable)) {
      return null;
    }

    return capabilityStateOf(entity, live).sensor_numeric?.value ?? null;
  };

  /**
   * A meter now, in watts and the card's signs.
   *
   * @param field - Which meter.
   * @returns The watts, or null.
   */
  const wattsOf = (field: MeterField): number | null => {
    const entity = entityOf(field);
    const value = valueOf(entity);

    return value === null || entity === undefined
      ? null
      : toWatts(value, entity.unitOfMeasurement) * signOf(card, field);
  };

  const readings: PowerReadings = {
    solar: wattsOf('solarPower'),
    battery: wattsOf('batteryPower'),
    grid: wattsOf('gridPower'),
    home: wattsOf('homePower'),
  };

  const now = new Date();
  const dayStart = midnight(now).getTime();
  const readable = METERS.flatMap((field) => {
    const entity = entityOf(field);

    return entity !== undefined && data.canReadHistory(entity) ? [{ field, entity }] : [];
  });

  const days = useQueries({
    queries: readable.map(({ entity }) => ({
      queryKey: [...LIBRARY_QUERY_KEYS.history, entity.entityId, 'telemetry-day', dayStart],
      enabled: wantsToday,
      refetchInterval: DAY_REFRESH_MS,

      /**
       * Reads a meter's readings since midnight, a minute at a time.
       *
       * @param context - What TanStack Query provides, including the cancellation signal.
       * @param context.signal - Cancels the reads when the card goes away.
       * @returns The readings, oldest first.
       */
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        fetchTelemetry(
          { entityId: entity.entityId, from: new Date(dayStart), to: new Date() },
          '1m',
          signal,
        ),
    })),
  });

  const isDayRead =
    wantsToday && readable.length > 0 && days.every((day) => day.data !== undefined);

  /**
   * One meter's day, when the card has it and it was read.
   *
   * @param field - Which meter.
   * @returns Its readings and signs, or null.
   */
  const dayOf = (field: MeterField): DayReadings | null => {
    const index = readable.findIndex((each) => each.field === field);
    const points = index === -1 ? undefined : days[index]?.data;
    const entity = entityOf(field);

    return points === undefined || entity === undefined
      ? null
      : { points, sign: signOf(card, field), unit: entity.unitOfMeasurement };
  };

  const batteryLevel = valueOf(entityOf('batteryLevel'));

  return {
    readings,
    batteryLevel,
    flows: flowsOf(readings),
    headline: headlineOf(readings),
    hasSolar: card.solarPower !== null,
    hasBattery: card.batteryPower !== null || card.batteryLevel !== null,
    hasGrid: card.gridPower !== null,
    isEmpty: METERS.every((field) => card[field] === null) && card.batteryLevel === null,
    today: isDayRead
      ? energyToday(
          {
            solar: dayOf('solarPower'),
            battery: dayOf('batteryPower'),
            grid: dayOf('gridPower'),
            home: dayOf('homePower'),
          },
          now.getTime(),
        )
      : undefined,
    canReadDay: readable.length > 0,
  };
}
