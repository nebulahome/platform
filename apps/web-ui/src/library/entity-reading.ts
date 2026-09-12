/**
 * What an entity is reading right now, in words a row can show.
 *
 * A state is one entry per capability - `{ on_off: { isOn: true }, level: { level: 60 } }` - and
 * a registry row wants one short string: "On · 60%". The mapping from the first to the second is
 * here, once, and nowhere near a component. So is the question of which of two states is the
 * newer: the one the API answered when the page loaded, or the one the live channel has
 * delivered since. The channel's, whenever it has one.
 *
 * A device's standing is derived from the same readings rather than from a column: a device is
 * reporting when any of its entities is reachable and has ever said something, and it was last
 * seen when the newest of them last spoke. The registry keeps a `lastSeenAt` on the device too,
 * and it is the fallback for a device with nothing to say yet.
 */
import { capabilityStateSchema, type EntityView, type JsonObject } from '@nebula-home/contracts';

import type { LiveReading } from '@/live/live-store';

/** One entity's reading, ready to show. */
export type Reading = {
  /** The reading in words and figures, or a dash when nothing has ever been reported. */
  readonly text: string;

  /** Whether the owning adapter can currently reach the device. */
  readonly isAvailable: boolean;

  /** When the reading arrived. Null when nothing has ever arrived. */
  readonly at: Date | null;

  /** Whether it came over the live channel rather than with the page. */
  readonly isLive: boolean;
};

/** A device's standing, as its readings tell it. */
export type DeviceStanding = {
  /** Whether at least one entity is reachable and has reported. */
  readonly isReporting: boolean;

  /** When the device was last heard from. Null when it never was. */
  readonly lastSeenAt: Date | null;
};

/** What a row shows for an entity that has never reported. */
export const NO_READING = '—';

const numbers = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

/** The words a binary sensor uses, by what kind of thing it senses. */
const BINARY_WORDS: Readonly<Record<string, readonly [on: string, off: string]>> = {
  motion: ['Detected', 'Clear'],
  occupancy: ['Occupied', 'Clear'],
  presence: ['Present', 'Away'],
  door: ['Open', 'Closed'],
  window: ['Open', 'Closed'],
  opening: ['Open', 'Closed'],
  garage_door: ['Open', 'Closed'],
  running: ['Running', 'Idle'],
  connectivity: ['Connected', 'Disconnected'],
  battery: ['Low', 'Normal'],
  moisture: ['Wet', 'Dry'],
  smoke: ['Detected', 'Clear'],
  gas: ['Detected', 'Clear'],
  problem: ['Problem', 'OK'],
  plug: ['Plugged in', 'Unplugged'],
  power: ['Powered', 'Unpowered'],
};

/**
 * A number with its unit, the way a person writes it.
 *
 * @param value - The number.
 * @param unit - Its unit, when it has one.
 * @returns "42 lx", "87%", "215 °C".
 */
function withUnit(value: number, unit: string | null): string {
  const figure = numbers.format(value);

  if (unit === null || unit === '') {
    return figure;
  }

  return unit === '%' ? `${figure}%` : `${figure} ${unit}`;
}

/**
 * Capitalises one word.
 *
 * @param word - As the state carries it, e.g. `heating`.
 * @returns `Heating`.
 */
function capitalised(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).replace(/_/gu, ' ');
}

/**
 * Turns a state into one short string.
 *
 * @param state - The state, one entry per capability.
 * @param entity - The unit and the device class, which are properties of the entity rather
 * than of the reading.
 * @returns The reading in words, or {@link NO_READING} when there is none.
 */
export function describeState(
  state: JsonObject | null,
  entity: Pick<EntityView, 'unitOfMeasurement' | 'deviceClass'>,
): string {
  if (state === null) {
    return NO_READING;
  }

  const parsed = capabilityStateSchema.safeParse(state);

  if (!parsed.success) {
    return NO_READING;
  }

  const value = parsed.data;
  const parts: string[] = [];

  if (value.on_off !== undefined) {
    parts.push(value.on_off.isOn ? 'On' : 'Off');
  }

  if (value.level !== undefined) {
    parts.push(`${numbers.format(value.level.level)}%`);
  }

  if (value.color_temp !== undefined) {
    parts.push(`${numbers.format(value.color_temp.mireds)} mired`);
  }

  if (value.color_hs !== undefined) {
    parts.push(
      `${numbers.format(value.color_hs.hue)}° ${numbers.format(value.color_hs.saturation)}%`,
    );
  }

  if (value.cover !== undefined) {
    const { position, motion } = value.cover;

    parts.push(position === 0 ? 'Closed' : `Open ${numbers.format(position)}%`);

    if (motion !== 'stopped') {
      parts.push(capitalised(motion));
    }
  }

  if (value.lock !== undefined) {
    parts.push(capitalised(value.lock.lockState));
  }

  if (value.thermostat !== undefined) {
    const { currentTemperature, targetTemperature, action } = value.thermostat;

    parts.push(
      `${withUnit(currentTemperature, entity.unitOfMeasurement)} → ${withUnit(targetTemperature, entity.unitOfMeasurement)}`,
      capitalised(action),
    );
  }

  if (value.sensor_numeric !== undefined) {
    parts.push(withUnit(value.sensor_numeric.value, entity.unitOfMeasurement));
  }

  if (value.sensor_binary !== undefined) {
    const words = BINARY_WORDS[entity.deviceClass ?? ''] ?? ['On', 'Off'];

    parts.push(value.sensor_binary.isOn ? words[0] : words[1]);
  }

  if (value.media_player !== undefined) {
    const { playback, volume, isMuted, mediaTitle } = value.media_player;

    parts.push(capitalised(playback), isMuted ? 'Muted' : `${numbers.format(volume)}%`);

    if (mediaTitle !== undefined) {
      parts.push(mediaTitle);
    }
  }

  if (value.camera !== undefined) {
    parts.push(value.camera.isStreamAvailable ? 'Streaming' : 'No stream');

    if (value.camera.isRecording) {
      parts.push('Recording');
    }
  }

  return parts.length === 0 ? NO_READING : parts.join(' · ');
}

/**
 * The newest reading of an entity: the channel's when it has spoken, the page's otherwise.
 *
 * @param entity - The entity as the API served it.
 * @param live - What the channel has said about it since, if anything.
 * @returns The reading to show.
 */
export function readingOf(entity: EntityView, live: LiveReading | undefined): Reading {
  if (live !== undefined) {
    return {
      text: describeState(live.state, entity),
      isAvailable: live.isAvailable,
      at: new Date(live.receivedAt),
      isLive: true,
    };
  }

  return {
    text: describeState(entity.state, entity),
    isAvailable: entity.isAvailable,
    at: entity.lastUpdated,
    isLive: false,
  };
}

/**
 * A device's standing, from the readings of its entities.
 *
 * @param readings - One per entity the device exposes.
 * @param lastSeenAt - What the registry recorded for the device itself, as a fallback.
 * @returns Whether it is reporting, and when it was last heard from.
 */
export function standingOf(readings: readonly Reading[], lastSeenAt: Date | null): DeviceStanding {
  let newest = lastSeenAt;

  for (const reading of readings) {
    if (reading.at !== null && (newest === null || reading.at > newest)) {
      newest = reading.at;
    }
  }

  return {
    isReporting: readings.some((reading) => reading.isAvailable && reading.at !== null),
    lastSeenAt: newest,
  };
}
