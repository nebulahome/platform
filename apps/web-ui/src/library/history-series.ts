/**
 * An entity's past, shaped for the chart on its page.
 *
 * Two stores hold it and they answer different questions. Telemetry is every numeric reading a
 * sensor sent, rolled up by the database into minutes, hours and days; state history is every
 * change of state, for anything. A power meter is drawn from the first. A lamp is drawn from the
 * second - its brightness as a line that holds its value until the next change, and whether it
 * was on as a band - because a lamp does not send a reading every second, it changes.
 *
 * The window picks the resolution: an hour of raw readings is a few thousand points at most, a
 * day of them is not, so a day is read in minutes and a week or a month in hours.
 */
import {
  capabilityStateSchema,
  type CapabilityState,
  type EntityView,
  type JsonObject,
  type StateHistoryPoint,
  type TelemetryResolution,
} from '@nebula-home/contracts';

import { miredsToKelvin } from '@/library/entity-control';

/** How far back the chart looks. */
export const HISTORY_RANGES = ['1h', '24h', '7d', '30d'] as const;

/** How far back the chart looks. */
export type HistoryRange = (typeof HISTORY_RANGES)[number];

/** How long each range is. */
const RANGE_MS: Readonly<Record<HistoryRange, number>> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};

/** A window of time, in milliseconds since the epoch. */
export type TimeWindow = {
  readonly from: number;
  readonly to: number;
};

/**
 * The window a range covers, ending now.
 *
 * @param range - How far back.
 * @param now - The end, in milliseconds since the epoch.
 * @returns The window.
 */
export function windowOf(range: HistoryRange, now: number): TimeWindow {
  return { from: now - RANGE_MS[range], to: now };
}

/**
 * Which rolled-up level of telemetry a range is read at.
 *
 * @param range - How far back.
 * @returns Raw readings for an hour, minutes for a day, hours beyond.
 */
export function telemetryResolutionFor(range: HistoryRange): TelemetryResolution {
  switch (range) {
    case '1h':
      return 'raw';
    case '24h':
      return '1m';
    case '7d':
    case '30d':
      return '1h';
  }
}

/**
 * Reads a recorded state.
 *
 * @param state - As history stored it.
 * @returns It parsed, or empty when it does not read.
 */
function parsed(state: JsonObject | null): CapabilityState {
  const result = capabilityStateSchema.safeParse(state ?? {});

  return result.success ? result.data : {};
}

/** A stretch of time during which the entity said one thing. */
export type StateSegment = {
  /** When it began, in milliseconds since the epoch. */
  readonly from: number;

  /** When it ended. */
  readonly to: number;

  /** What it said, in words. */
  readonly label: string;

  /** Whether it was on, open, detected or unlocked - the state the band draws filled. */
  readonly isActive: boolean;

  /** Whether the device could be reached at all. */
  readonly isAvailable: boolean;
};

/**
 * Whether a state is the "active" one of its kind, for the band.
 *
 * @param state - The state.
 * @returns True for on, detected, open and unlocked; false for their opposites; null when the
 * state has nothing that reads as either.
 */
export function isActiveState(state: CapabilityState): boolean | null {
  if (state.on_off !== undefined) {
    return state.on_off.isOn;
  }

  if (state.sensor_binary !== undefined) {
    return state.sensor_binary.isOn;
  }

  if (state.cover !== undefined) {
    return state.cover.position > 0;
  }

  if (state.lock !== undefined) {
    return state.lock.lockState !== 'locked';
  }

  if (state.media_player !== undefined) {
    return state.media_player.playback === 'playing';
  }

  return null;
}

/**
 * Cuts a window of state history into the stretches the band draws.
 *
 * What the entity said before the first change in the window is that change's `previousState`,
 * so the band starts at the window's left edge rather than at the first change; with no change
 * at all, the current state fills the whole window.
 *
 * @param points - The changes, oldest first.
 * @param window - The window.
 * @param current - The state now, and whether it can be reached, for a window with no change.
 * @param current.state - The state now.
 * @param current.isAvailable - Whether the device can be reached now.
 * @param describe - Puts a state into words.
 * @returns The stretches, left to right; empty when nothing reads as on or off.
 */
export function stateSegments(
  points: readonly StateHistoryPoint[],
  window: TimeWindow,
  current: { readonly state: JsonObject | null; readonly isAvailable: boolean },
  describe: (state: JsonObject | null) => string,
): StateSegment[] {
  const stretches: { at: number; state: JsonObject | null; isAvailable: boolean }[] = [];
  const first = points[0];

  stretches.push(
    first === undefined
      ? { at: window.from, state: current.state, isAvailable: current.isAvailable }
      : { at: window.from, state: first.previousState, isAvailable: true },
  );

  for (const point of points) {
    stretches.push({
      at: Math.max(window.from, point.time.getTime()),
      state: point.state,
      isAvailable: point.isAvailable,
    });
  }

  const segments: StateSegment[] = [];

  stretches.forEach((stretch, index) => {
    const end = stretches[index + 1]?.at ?? window.to;
    const isActive = isActiveState(parsed(stretch.state));

    if (end <= stretch.at || isActive === null) {
      return;
    }

    segments.push({
      from: stretch.at,
      to: end,
      label: describe(stretch.state),
      isActive,
      isAvailable: stretch.isAvailable,
    });
  });

  return segments;
}

/** A number an entity's state carries, which its history can be drawn as a line of. */
export type NumericField = {
  /** What the line is called. */
  readonly label: string;

  /** Its unit, as a person writes it. */
  readonly unit: string;

  /** Reads the number off a state; null when the state does not carry it. */
  readonly read: (state: CapabilityState) => number | null;
};

/**
 * Reads the measured temperature off a thermostat's state.
 *
 * @param state - The state.
 * @returns The temperature, or null.
 */
function measuredTemperature(state: CapabilityState): number | null {
  return state.thermostat?.currentTemperature ?? null;
}

/**
 * Reads the target temperature off a thermostat's state.
 *
 * @param state - The state.
 * @returns The target, or null.
 */
function targetTemperature(state: CapabilityState): number | null {
  return state.thermostat?.targetTemperature ?? null;
}

/**
 * Reads the level off a state.
 *
 * @param state - The state.
 * @returns The level, or null.
 */
function levelOf(state: CapabilityState): number | null {
  return state.level?.level ?? null;
}

/**
 * Reads a cover's position off a state.
 *
 * @param state - The state.
 * @returns The position, or null.
 */
function positionOf(state: CapabilityState): number | null {
  return state.cover?.position ?? null;
}

/**
 * Reads the colour temperature off a state, in kelvin.
 *
 * @param state - The state.
 * @returns The temperature, or null.
 */
function kelvinOf(state: CapabilityState): number | null {
  return state.color_temp === undefined ? null : miredsToKelvin(state.color_temp.mireds);
}

/**
 * Reads a player's volume off a state.
 *
 * @param state - The state.
 * @returns The volume, or null.
 */
function volumeOf(state: CapabilityState): number | null {
  return state.media_player?.volume ?? null;
}

/**
 * The numbers in an entity's state worth drawing, most telling first.
 *
 * @param entity - Its domain and capabilities.
 * @returns The fields; empty for an entity whose state carries no number.
 */
export function numericFieldsOf(
  entity: Pick<EntityView, 'domain' | 'capabilities'>,
): NumericField[] {
  const has = new Set(entity.capabilities.map((entry) => entry.capability));
  const fields: NumericField[] = [];

  if (has.has('thermostat')) {
    fields.push(
      { label: 'Temperature', unit: '°C', read: measuredTemperature },
      { label: 'Target', unit: '°C', read: targetTemperature },
    );
  }

  if (has.has('level')) {
    fields.push({
      label: entity.domain === 'light' ? 'Brightness' : 'Level',
      unit: '%',
      read: levelOf,
    });
  }

  if (has.has('cover')) {
    fields.push({ label: 'Position', unit: '%', read: positionOf });
  }

  if (has.has('color_temp')) {
    fields.push({ label: 'Colour temperature', unit: 'K', read: kelvinOf });
  }

  if (has.has('media_player')) {
    fields.push({ label: 'Volume', unit: '%', read: volumeOf });
  }

  return fields;
}

/** One point of a line drawn from state history. */
export type SeriesPoint = { readonly at: number } & Readonly<Record<string, number | null>>;

/**
 * Turns state history into points for a stepped line, one key per field.
 *
 * The window's left edge carries what the entity was before its first change in the window, and
 * the right edge repeats the last value, so a lamp that was set once this morning draws as a line
 * across the whole day rather than as one dot.
 *
 * @param points - The changes, oldest first.
 * @param fields - The numbers to draw, keyed `f0`, `f1`, … in this order.
 * @param window - The window.
 * @param current - The state now, for a window with no change.
 * @returns The points, left to right.
 */
export function numericSeries(
  points: readonly StateHistoryPoint[],
  fields: readonly NumericField[],
  window: TimeWindow,
  current: JsonObject | null,
): SeriesPoint[] {
  /**
   * Reads every field off one state.
   *
   * @param at - When.
   * @param state - The state.
   * @returns The point.
   */
  const pointOf = (at: number, state: JsonObject | null): SeriesPoint => {
    const read = parsed(state);
    const values: Record<string, number | null> = {};

    fields.forEach((field, index) => {
      values[`f${String(index)}`] = field.read(read);
    });

    return { at, ...values };
  };

  const first = points[0];
  const series = [pointOf(window.from, first === undefined ? current : first.previousState)];

  for (const point of points) {
    series.push(pointOf(Math.max(window.from, point.time.getTime()), point.state));
  }

  const last = points.at(-1);

  series.push(pointOf(window.to, last === undefined ? current : last.state));

  return series;
}
