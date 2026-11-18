/**
 * What the cards that sum up read from the house (`K-Overview`): which entities are in a place,
 * what of them needs a look - doors and windows open, lights on, batteries low, updates ready,
 * devices out of reach - and what one room has: its climate, its lights, blinds, speaker and
 * heating.
 *
 * Pure arithmetic on the entities and their live states, so the cards stay drawings and this
 * stays tested. An entity switched off in Devices or hidden is in no count; one that cannot be
 * reached is counted only as out of reach, never as open or on by what it last said.
 */
import {
  isUpdateOffered,
  type CapabilityState,
  type EntityView,
  type SummarySubject,
} from '@nebulahome/contracts';

import { capabilityStateOf, hasCapability } from '@/library/entity-control';
import { readingOf } from '@/library/entity-reading';
import type { LiveReading } from '@/live/live-store';

/** A battery under this, in percent, is low. */
export const LOW_BATTERY = 20;

/** The kinds of binary sensor a door-and-window count reads. */
const OPENINGS: ReadonlySet<string> = new Set(['door', 'window', 'garage_door', 'opening']);

/** One entity as a card that sums up reads it. */
export type Seen = {
  /** The entity. */
  readonly entity: EntityView;

  /** Its state now: the live channel's when it has spoken. */
  readonly state: CapabilityState;

  /** Whether it can be reached. */
  readonly isAvailable: boolean;

  /** When its state last changed. */
  readonly changedAt: Date | null;

  /** When it last reported, in milliseconds since the epoch: a new report answers a command. */
  readonly reportedAt: number | null;
};

/** What a summary counts, one thing at a time; the blinds are read by the house at a glance. */
export type CountedSubject = Exclude<SummarySubject, 'glance'> | 'blinds';

/** One count. */
export type Count = {
  /** What needs a look: the lowest battery first, one entity for each device out of reach. */
  readonly found: readonly Seen[];

  /** Every one of the kind in the place: doors and windows, lights, batteries, devices. */
  readonly of: readonly Seen[];

  /** How many of the kind are in the place. */
  readonly total: number;

  /** The latest change among all of the kind: since when all is well. */
  readonly since: Date | null;
};

/**
 * The entities of a place, as the cards that sum up read them.
 *
 * @param entities - Every entity the person may see.
 * @param readings - What the live channel has said since the page was read.
 * @param areaKey - The area, or null for the whole house.
 * @returns The entities in it that are enabled and shown, with their states.
 */
export function seenIn(
  entities: Iterable<EntityView>,
  readings: Readonly<Record<string, LiveReading>>,
  areaKey: string | null,
): Seen[] {
  return [...entities]
    .filter(
      (entity) =>
        entity.isEnabled && !entity.isHidden && (areaKey === null || entity.areaKey === areaKey),
    )
    .map((entity) => {
      const live = readings[entity.entityId];

      return {
        entity,
        state: capabilityStateOf(entity, live),
        isAvailable: readingOf(entity, live).isAvailable,
        changedAt: live?.changedAt ?? entity.lastChanged,
        reportedAt: live?.receivedAt ?? entity.lastUpdated?.getTime() ?? null,
      };
    });
}

/**
 * Whether an entity is a door or a window that reports open and shut.
 *
 * @param entity - The entity.
 * @returns True for a door, window, garage door or opening contact.
 */
function isOpening(entity: EntityView): boolean {
  return hasCapability(entity, 'sensor_binary') && OPENINGS.has(entity.deviceClass ?? '');
}

/**
 * Whether an entity is a light that switches.
 *
 * @param entity - The entity.
 * @returns True for a light.
 */
export function isLight(entity: EntityView): boolean {
  return entity.domain === 'light' && hasCapability(entity, 'on_off');
}

/**
 * The latest change among some entities.
 *
 * @param seen - The entities.
 * @returns The moment, or null when none has changed.
 */
function latestChange(seen: readonly Seen[]): Date | null {
  return seen.reduce<Date | null>(
    (latest, each) =>
      each.changedAt !== null && (latest === null || each.changedAt > latest)
        ? each.changedAt
        : latest,
    null,
  );
}

/**
 * Counts one thing that needs a look in a place.
 *
 * @param subject - What is counted.
 * @param seen - The place's entities, from {@link seenIn}.
 * @returns What needs a look, of how many.
 */
export function countOf(subject: CountedSubject, seen: readonly Seen[]): Count {
  if (subject === 'offline') {
    // A device is out of reach when none of its entities answers: counted once, by its first.
    const devices = new Map<string, Seen[]>();

    seen.forEach((each) => {
      const key = each.entity.deviceId ?? each.entity.entityId;

      devices.set(key, [...(devices.get(key) ?? []), each]);
    });

    const found = [...devices.values()].flatMap((members) =>
      members.some((each) => each.isAvailable) ? [] : members.slice(0, 1),
    );

    return {
      found,
      of: [...devices.values()].flatMap((members) => members.slice(0, 1)),
      total: devices.size,
      since: latestChange(found),
    };
  }

  const of = seen.filter((each) => {
    switch (subject) {
      case 'openings':
        return isOpening(each.entity);
      case 'lights':
        return isLight(each.entity);
      case 'blinds':
        return hasCapability(each.entity, 'cover');
      case 'batteries':
        return (
          each.entity.deviceClass === 'battery' && hasCapability(each.entity, 'sensor_numeric')
        );
      case 'updates':
        return hasCapability(each.entity, 'update');
    }
  });
  const found = of.filter((each) => {
    const { state } = each;

    if (!each.isAvailable) {
      return false;
    }

    switch (subject) {
      case 'openings':
        return state.sensor_binary?.isOn === true;
      case 'lights':
        return state.on_off?.isOn === true;
      case 'blinds':
        return (state.cover?.position ?? 0) > 0;
      case 'batteries':
        return state.sensor_numeric !== undefined && state.sensor_numeric.value < LOW_BATTERY;
      case 'updates':
        return state.update !== undefined && isUpdateOffered(state.update);
    }
  });

  return {
    found:
      subject === 'batteries'
        ? found.toSorted(
            (a, b) => (a.state.sensor_numeric?.value ?? 0) - (b.state.sensor_numeric?.value ?? 0),
          )
        : found,
    of,
    total: of.length,
    since: latestChange(of),
  };
}

/** What one room has, as its card draws it. */
export type Room = {
  /** Its temperature now: a thermometer's, or its thermostat's own; undefined without one. */
  readonly temperature: number | undefined;

  /** The thermometer, for its past; none when the temperature is the thermostat's. */
  readonly thermometer: Seen | undefined;

  /** Its humidity now: a hygrometer's, or its thermostat's. */
  readonly humidity: number | undefined;

  /** Its thermostat, the first when it has several. */
  readonly thermostat: Seen | undefined;

  /** Its lights. */
  readonly lights: readonly Seen[];

  /** Its blinds and other covers. */
  readonly blinds: readonly Seen[];

  /** Its speaker, the first when it has several. */
  readonly speaker: Seen | undefined;

  /** How many devices are in it; an entity of no device counts as its own. */
  readonly devices: number;
};

/**
 * What a room has.
 *
 * @param seen - The room's entities, from {@link seenIn}.
 * @returns Its climate and its groups.
 */
export function roomOf(seen: readonly Seen[]): Room {
  /**
   * The first sensor of a class with a reading.
   *
   * @param deviceClass - The class.
   * @returns The sensor.
   */
  const sensor = (deviceClass: string): Seen | undefined =>
    seen.find(
      (each) => each.entity.deviceClass === deviceClass && each.state.sensor_numeric !== undefined,
    );
  const thermometer = sensor('temperature');
  const hygrometer = sensor('humidity');
  const thermostat = seen.find((each) => hasCapability(each.entity, 'thermostat'));

  return {
    temperature:
      thermometer?.state.sensor_numeric?.value ?? thermostat?.state.thermostat?.currentTemperature,
    thermometer,
    humidity: hygrometer?.state.sensor_numeric?.value ?? thermostat?.state.thermostat?.humidity,
    thermostat,
    lights: seen.filter((each) => isLight(each.entity)),
    blinds: seen.filter((each) => hasCapability(each.entity, 'cover')),
    speaker: seen.find((each) => hasCapability(each.entity, 'media_player')),
    devices: new Set(seen.map((each) => each.entity.deviceId ?? each.entity.entityId)).size,
  };
}

/**
 * The average opening of some covers, in percent.
 *
 * @param blinds - The covers.
 * @returns The average, rounded; undefined when none has a position.
 */
export function averagePosition(blinds: readonly Seen[]): number | undefined {
  const positions = blinds.flatMap((each) =>
    each.state.cover === undefined ? [] : [each.state.cover.position],
  );

  return positions.length === 0
    ? undefined
    : Math.round(positions.reduce((sum, each) => sum + each, 0) / positions.length);
}

/**
 * Whether an entity is on, open, playing or at work, for its chip; null for a reading.
 *
 * @param state - Its state.
 * @returns True when lit, false when at rest, null when it is neither.
 */
export function isActiveOf(state: CapabilityState): boolean | null {
  if (state.on_off !== undefined) {
    return state.on_off.isOn;
  }

  if (state.cover !== undefined) {
    return state.cover.position > 0;
  }

  if (state.media_player !== undefined) {
    return state.media_player.playback === 'playing';
  }

  if (state.lock !== undefined) {
    return state.lock.lockState === 'locked';
  }

  if (state.thermostat !== undefined) {
    return state.thermostat.action !== 'idle' && state.thermostat.action !== 'off';
  }

  return state.sensor_binary === undefined ? null : state.sensor_binary.isOn;
}
