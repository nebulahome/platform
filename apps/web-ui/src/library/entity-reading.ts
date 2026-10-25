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
import {
  capabilityStateSchema,
  findSensorUnit,
  getSensorClass,
  isNumericSensorClass,
  isUpdateOffered,
  type EntityView,
  type JsonObject,
  type LawnMowerActivity,
  type VacuumActivity,
} from '@nebulahome/contracts';

import { numberFormat } from '@/i18n/formatters';
import { defineMessage, type Message, text, translate } from '@/i18n/messages';
import { miredsToKelvin } from '@/library/entity-control';
import type { LiveReading } from '@/live/live-store';

/** A catalogue numeric reading, split so a row can draw the figure and the unit apart. */
export type SensorFigure = {
  /** The number, formatted for this locale. */
  readonly figure: string;

  /** The unit symbol, or null when the class is unitless. */
  readonly unit: string | null;

  /** The catalogue label for the class (`Current`, `Temperature`). */
  readonly classLabel: string;
};

/** One entity's reading, ready to show. */
export type Reading = {
  /** The reading in words and figures, or a dash when nothing has ever been reported. */
  readonly text: string;

  /** Whether the owning adapter can currently reach the device. */
  readonly isAvailable: boolean;

  /** Whether its package or integration is being updated: the reading is the last one known. */
  readonly isUpdating: boolean;

  /** When the reading arrived. Null when nothing has ever arrived. */
  readonly at: Date | null;

  /** Whether it came over the live channel rather than with the page. */
  readonly isLive: boolean;

  /**
   * Catalogue numeric sensors only: figure and unit for the devices row. Absent for binaries,
   * classless sensors, and non-sensor capabilities.
   */
  readonly sensorFigure: SensorFigure | null;
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

/**
 * A number formatter.
 *
 * @returns The formatter, in the reader's language.
 */
const numbers = (): Intl.NumberFormat => numberFormat({ maximumFractionDigits: 2 });

/** What a robot mower is doing, in words. */
const MOWER_WORDS: Readonly<Record<LawnMowerActivity, Message>> = {
  mowing: defineMessage('library.entityReading.mowing', 'Mowing'),
  paused: defineMessage('library.entityReading.paused', 'Paused'),
  returning: defineMessage('library.entityReading.goingBackToIts', 'Going back to its station'),
  docked: defineMessage('library.entityReading.inItsStation', 'In its station'),
  idle: defineMessage('library.entityReading.idle', 'Idle'),
  error: defineMessage('library.entityReading.stoppedByAFault', 'Stopped by a fault'),
};

/** What a robot vacuum is doing, in words. */
const VACUUM_WORDS: Readonly<Record<VacuumActivity, Message>> = {
  cleaning: defineMessage('library.entityReading.cleaning', 'Cleaning'),
  paused: defineMessage('library.entityReading.paused', 'Paused'),
  returning: defineMessage('library.entityReading.goingBackToIts', 'Going back to its station'),
  docked: defineMessage('library.entityReading.inItsStation', 'In its station'),
  idle: defineMessage('library.entityReading.idle', 'Idle'),
  error: defineMessage('library.entityReading.stoppedByAFault', 'Stopped by a fault'),
};

/** What a binary sensor says when its kind has no words of its own. */
export const ON_OFF_WORDS: readonly [on: Message, off: Message] = [
  defineMessage('common.on', 'On'),
  defineMessage('common.off', 'Off'),
];

/** The words a binary sensor uses, by what kind of thing it senses. */
export const BINARY_WORDS: Readonly<Record<string, readonly [on: Message, off: Message]>> = {
  motion: [
    defineMessage('library.entityReading.detected', 'Detected'),
    defineMessage('library.entityReading.clear', 'Clear'),
  ],
  occupancy: [
    defineMessage('library.entityReading.occupied', 'Occupied'),
    defineMessage('library.entityReading.clear', 'Clear'),
  ],
  presence: [
    defineMessage('library.entityReading.present', 'Present'),
    defineMessage('library.entityReading.away', 'Away'),
  ],
  door: [
    defineMessage('library.entityReading.open', 'Open'),
    defineMessage('library.entityReading.closed', 'Closed'),
  ],
  window: [
    defineMessage('library.entityReading.open', 'Open'),
    defineMessage('library.entityReading.closed', 'Closed'),
  ],
  opening: [
    defineMessage('library.entityReading.open', 'Open'),
    defineMessage('library.entityReading.closed', 'Closed'),
  ],
  garage_door: [
    defineMessage('library.entityReading.open', 'Open'),
    defineMessage('library.entityReading.closed', 'Closed'),
  ],
  running: [
    defineMessage('library.entityReading.running', 'Running'),
    defineMessage('library.entityReading.idle', 'Idle'),
  ],
  connectivity: [
    defineMessage('library.entityReading.connected', 'Connected'),
    defineMessage('library.entityReading.disconnected', 'Disconnected'),
  ],
  battery: [
    defineMessage('library.entityReading.low', 'Low'),
    defineMessage('library.entityReading.normal', 'Normal'),
  ],
  battery_charging: [
    defineMessage('library.entityReading.charging', 'Charging'),
    defineMessage('library.entityReading.notCharging', 'Not charging'),
  ],
  moisture: [
    defineMessage('library.entityReading.wet', 'Wet'),
    defineMessage('library.entityReading.dry', 'Dry'),
  ],
  smoke: [
    defineMessage('library.entityReading.detected', 'Detected'),
    defineMessage('library.entityReading.clear', 'Clear'),
  ],
  gas: [
    defineMessage('library.entityReading.detected', 'Detected'),
    defineMessage('library.entityReading.clear', 'Clear'),
  ],
  problem: [
    defineMessage('library.entityReading.problem', 'Problem'),
    defineMessage('library.entityReading.ok', 'OK'),
  ],
  plug: [
    defineMessage('library.entityReading.pluggedIn', 'Plugged in'),
    defineMessage('library.entityReading.unplugged', 'Unplugged'),
  ],
  power: [
    defineMessage('library.entityReading.powered', 'Powered'),
    defineMessage('library.entityReading.unpowered', 'Unpowered'),
  ],
  update: [
    defineMessage('library.entityReading.updateAvailable', 'Update available'),
    defineMessage('library.entityReading.upToDate', 'Up to date'),
  ],
};

/**
 * The unit symbol to show for an entity.
 *
 * Catalogue classes use the symbol for the unit stored on the entity (canonical today). A future
 * display preference would convert the number with `fromCanonical` and pick a different symbol
 * here; history stays in the canonical unit either way.
 *
 * @param entity - The unit and device class.
 * @returns The symbol, or null when there is none.
 */
function unitSymbol(entity: Pick<EntityView, 'unitOfMeasurement' | 'deviceClass'>): string | null {
  const entry = getSensorClass(entity.deviceClass);

  if (entry?.valueKind === 'number') {
    if (entry.canonicalUnit === null) {
      if (entity.unitOfMeasurement !== null && entity.unitOfMeasurement !== '') {
        return findSensorUnit(entry, entity.unitOfMeasurement)?.symbol ?? entity.unitOfMeasurement;
      }

      return null;
    }

    const unitId = entity.unitOfMeasurement ?? entry.canonicalUnit;

    return findSensorUnit(entry, unitId)?.symbol ?? unitId;
  }

  return entity.unitOfMeasurement;
}

/**
 * A number with its unit, the way a person writes it.
 *
 * @param value - The number.
 * @param unit - Its unit, when it has one.
 * @returns "42 lx", "87%", "215 °C".
 */
function withUnit(value: number, unit: string | null): string {
  const figure = numbers().format(value);

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
 * A catalogue numeric reading split into figure, unit and class label.
 *
 * @param state - The state, one entry per capability.
 * @param entity - The unit and the device class.
 * @returns The split reading, or null when this is not a catalogue numeric sensor.
 */
export function sensorFigureOf(
  state: JsonObject | null,
  entity: Pick<EntityView, 'unitOfMeasurement' | 'deviceClass'>,
): SensorFigure | null {
  if (state === null || !isNumericSensorClass(entity.deviceClass)) {
    return null;
  }

  const entry = getSensorClass(entity.deviceClass);

  if (entry === undefined) {
    return null;
  }

  const parsed = capabilityStateSchema.safeParse(state);

  if (!parsed.success || parsed.data.sensor_numeric === undefined) {
    return null;
  }

  return {
    figure: numbers().format(parsed.data.sensor_numeric.value),
    unit: unitSymbol(entity),
    classLabel: entry.label,
  };
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
  const unit = unitSymbol(entity);

  if (value.on_off !== undefined) {
    parts.push(value.on_off.isOn ? translate('common.on', 'On') : translate('common.off', 'Off'));
  }

  if (value.level !== undefined) {
    parts.push(`${numbers().format(value.level.level)}%`);
  }

  if (value.color_temp !== undefined) {
    parts.push(`${String(miredsToKelvin(value.color_temp.mireds))} K`);
  }

  if (value.color_hs !== undefined) {
    parts.push(
      `${numbers().format(value.color_hs.hue)}° ${numbers().format(value.color_hs.saturation)}%`,
    );
  }

  if (value.cover !== undefined) {
    const { position, motion } = value.cover;

    parts.push(
      position === 0
        ? translate('library.entityReading.closed', 'Closed')
        : translate('library.entityReading.openPosition', 'Open {{position}}%', {
            position: numbers().format(position),
          }),
    );

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
      `${withUnit(currentTemperature, unit)} → ${withUnit(targetTemperature, unit)}`,
      capitalised(action),
    );
  }

  if (value.sensor_numeric !== undefined) {
    parts.push(withUnit(value.sensor_numeric.value, unit));
  }

  if (value.sensor_binary !== undefined) {
    const words = BINARY_WORDS[entity.deviceClass ?? ''] ?? ON_OFF_WORDS;

    parts.push(text(value.sensor_binary.isOn ? words[0] : words[1]));
  }

  if (value.sensor_text !== undefined) {
    parts.push(value.sensor_text.value);
  }

  if (value.media_player !== undefined) {
    const { playback, volume, isMuted, mediaTitle } = value.media_player;

    parts.push(
      capitalised(playback),
      isMuted
        ? translate('library.entityReading.muted', 'Muted')
        : translate('library.entityReading.volume', '{{volume}}%', {
            volume: numbers().format(volume),
          }),
    );

    if (mediaTitle !== undefined) {
      parts.push(mediaTitle);
    }
  }

  if (value.camera !== undefined) {
    parts.push(
      value.camera.isStreamAvailable
        ? translate('library.entityReading.streaming', 'Streaming')
        : translate('library.entityReading.noStream', 'No stream'),
    );

    if (value.camera.isRecording) {
      parts.push(translate('library.entityReading.recording', 'Recording'));
    }
  }

  if (value.update !== undefined) {
    const { installedVersion, latestVersion, isInstalling, progress } = value.update;

    if (isInstalling) {
      parts.push(
        progress === null
          ? translate('library.entityReading.installing', 'Installing')
          : translate('library.entityReading.installingProgress', 'Installing {{progress}}%', {
              progress: String(Math.round(progress)),
            }),
      );
    } else if (isUpdateOffered(value.update)) {
      parts.push(
        translate(
          'library.entityReading.updateAvailableLatestversion',
          'Update available · {{latestVersion}}',
          { latestVersion: String(latestVersion) },
        ),
      );
    } else {
      parts.push(
        installedVersion === null
          ? translate('library.entityReading.upToDate', 'Up to date')
          : translate(
              'library.entityReading.upToDateInstalledversion',
              'Up to date · {{installedVersion}}',
              { installedVersion },
            ),
      );
    }
  }

  if (value.lawn_mower !== undefined) {
    parts.push(text(MOWER_WORDS[value.lawn_mower.activity]));
  }

  if (value.vacuum !== undefined) {
    parts.push(text(VACUUM_WORDS[value.vacuum.activity]));
  }

  if (value.image !== undefined && parts.length === 0) {
    // Nothing to read on a picture but that it is there: it is looked at, not read.
    parts.push(translate('library.entityReading.picture', 'Picture'));
  }

  if (value.select?.option != null) {
    parts.push(capitalised(value.select.option));
  }

  if (value.number?.value != null) {
    parts.push(withUnit(value.number.value, unit));
  }

  if (value.button !== undefined && parts.length === 0) {
    // Nothing to read on a button but that it can be pressed.
    parts.push(translate('library.entityReading.ready', 'Ready'));
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
      isUpdating: live.isUpdating === true,
      at: new Date(live.receivedAt),
      isLive: true,
      sensorFigure: sensorFigureOf(live.state, entity),
    };
  }

  return {
    text: describeState(entity.state, entity),
    isAvailable: entity.isAvailable,
    isUpdating: false,
    at: entity.lastUpdated,
    isLive: false,
    sensorFigure: sensorFigureOf(entity.state, entity),
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
