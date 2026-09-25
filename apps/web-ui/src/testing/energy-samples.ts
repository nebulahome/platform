/**
 * Energy cards with the meters they read, for the gallery to draw without a house behind it.
 *
 * Each sample is a card and the page data it reads: its meters as entities with a reading, and a
 * query cache holding a day of their readings, so the large card's day figures show too.
 */
import { QueryClient } from '@tanstack/react-query';

import type { DashboardEnergyCard, EntityView, TelemetryPoint } from '@nebula-home/contracts';

import { LIBRARY_QUERY_KEYS } from '@/library/api';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';
import { anEntity } from '@/testing/fixtures';

/** What a sample's meters read now; null for a meter it does not have. */
export type SampleMeters = {
  readonly solar: number | null;
  readonly battery: number | null;
  readonly level: number | null;
  readonly grid: number | null;
};

/** A card, what it reads, and the cache its day comes from. */
export type EnergySample = {
  readonly card: DashboardEnergyCard;
  readonly data: DashboardData;
};

/**
 * A meter.
 *
 * @param entityId - Its address.
 * @param name - What it is called.
 * @param value - What it reads now.
 * @param unit - Its unit.
 * @returns The entity.
 */
function meter(entityId: string, name: string, value: number, unit: string): EntityView {
  return anEntity({
    entityId,
    name,
    unitOfMeasurement: unit,
    deviceClass: unit === '%' ? 'battery' : 'power',
    capabilities: [{ capability: 'sensor_numeric', params: {} }],
    state: { sensor_numeric: { value } },
  });
}

/**
 * A day of minute readings for a meter, shaped like a sunny day for the panels and a flat use
 * for the rest.
 *
 * @param kind - Which meter.
 * @param now - The time now.
 * @returns The readings since midnight.
 */
function dayOf(kind: 'solar' | 'battery' | 'grid', now: Date): TelemetryPoint[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const minutes = Math.floor((now.getTime() - start) / 60_000);

  return [...Array(minutes).keys()].map((minute) => {
    const hour = minute / 60;
    const sun = Math.max(Math.sin(((hour - 6) / 14) * Math.PI), 0);
    const value =
      kind === 'solar' ? sun * 9000 : kind === 'battery' ? -sun * 3500 + 300 : 700 - sun * 900;

    return { time: new Date(start + minute * 60_000), value };
  });
}

/**
 * Builds one sample.
 *
 * @param key - What sets its entities apart from the other samples'.
 * @param meters - What its meters read.
 * @param client - The cache its day is laid into.
 * @param size - Tall, large, or square.
 * @returns The card and what it reads.
 */
export function energySample(
  key: string,
  meters: SampleMeters,
  client: QueryClient,
  size: 'tall' | 'large' | 'square' = 'large',
): EnergySample {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const entities: EntityView[] = [];
  /**
   * The address of one of the sample's meters.
   *
   * @param name - Which meter.
   * @returns Its address.
   */
  const idOf = (name: string): string => `sensor.${key}_${name}`;

  /**
   * Adds a meter when the sample has it.
   *
   * @param name - Which one.
   * @param value - What it reads.
   * @param unit - Its unit.
   * @param day - Which day shape it has, when it has one.
   * @returns Its address, or null.
   */
  const add = (
    name: string,
    value: number | null,
    unit: string,
    day?: 'solar' | 'battery' | 'grid',
  ) => {
    if (value === null) {
      return null;
    }

    const entity = meter(idOf(name), name, value, unit);

    entities.push(entity);

    if (day !== undefined) {
      client.setQueryData(
        [...LIBRARY_QUERY_KEYS.history, entity.entityId, 'telemetry-day', midnight],
        dayOf(day, now),
      );
    }

    return entity.entityId;
  };

  const card: DashboardEnergyCard = {
    id: `energy${key}`.slice(0, 32).padEnd(8, '0'),
    type: 'energy',
    x: 0,
    y: 0,
    w: 2,
    h: size === 'tall' ? 4 : size === 'large' ? 3 : 2,
    title: null,
    solarPower: add('solar', meters.solar, 'W', 'solar'),
    batteryPower: add('battery', meters.battery, 'W', 'battery'),
    batteryLevel: add('battery_level', meters.level, '%'),
    gridPower: add('grid', meters.grid, 'W', 'grid'),
    homePower: null,
    isGridImportPositive: true,
    isBatteryDischargePositive: true,
  };

  return {
    card,
    data: {
      entityById: new Map(entities.map((entity) => [entity.entityId, entity])),
      sceneById: new Map(),
      icons: new Map(),
      readings: {},
      /**
       * Nothing on a sample is commanded.
       *
       * @returns False.
       */
      canControl: () => false,

      /**
       * Every sample's past is laid into the cache, so it may be read.
       *
       * @returns True.
       */
      canReadHistory: () => true,
      canApplyScenes: false,

      /**
       * A sample is not resized.
       *
       * @returns No sizes.
       */
      sizesOf: () => [],
      isPending: false,
    },
  };
}

/**
 * The cache the samples' days are laid into: nothing in it goes stale, so the gallery never asks
 * a server that is not there.
 *
 * @returns The cache.
 */
export function energySampleCache(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchInterval: false } },
  });
}
