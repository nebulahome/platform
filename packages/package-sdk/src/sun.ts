/**
 * `@nebulahome/package-sdk/sun`: where the sun is, for a package that draws or decides by it
 * (PACKAGES_DOCS.md 6.7). Since 1.2.
 *
 * The same formulas the platform runs for its sun entities and its sun triggers, so a package that
 * works out a past or a future day agrees with what the house said live: `sensor.system_sun_*`
 * for now, these for any other moment. The house's position is the house area's
 * (`useAreas()` on the interface).
 */
import {
  sunPhaseLabel as platformSunPhaseLabel,
  sunPosition as platformSunPosition,
  sunState as platformSunState,
  sunTimes as platformSunTimes,
} from '@nebulahome/contracts';

/** A place on Earth, in degrees: north and east positive. */
export type GeoPosition = {
  readonly latitude: number;
  readonly longitude: number;
};

/** Where the sun stands, in degrees. */
export type SunPosition = {
  /** Above the horizon, positive; below it, negative. */
  readonly elevation: number;

  /** Clockwise from true north: 90 east, 180 south. */
  readonly azimuth: number;
};

/** A day's sunrise, solar noon and sunset; no rise or set on a polar day or night. */
export type SunTimes = {
  readonly sunrise: Date | null;
  readonly solarNoon: Date;
  readonly sunset: Date | null;
};

/** Where the sun stands, and which way it goes. */
export type SunState = SunPosition & {
  readonly isRising: boolean;
  readonly isMidnightSun: boolean;
  readonly isPolarNight: boolean;
};

/** The light the sun gives, in a word. */
export type SunPhaseLabel = 'day' | 'golden_hour' | 'blue_hour' | 'night' | 'polar_night';

/** The platform's sun entities, reported every minute while the house has a position. */
export const SUN_ELEVATION_ENTITY_ID = 'sensor.system_sun_elevation';
export const SUN_AZIMUTH_ENTITY_ID = 'sensor.system_sun_azimuth';

/**
 * Where the sun stands at a moment, seen from a place.
 *
 * @param at - The moment.
 * @param position - The place.
 * @returns Its elevation and azimuth, in degrees.
 */
export function sunPosition(at: Date, position: GeoPosition): SunPosition {
  return platformSunPosition(at, position);
}

/**
 * The sunrise, solar noon and sunset of the day a moment falls in, at a place.
 *
 * @param at - A moment of the day.
 * @param position - The place.
 * @returns Them; no rise or set on a polar day or night.
 */
export function sunTimes(at: Date, position: GeoPosition): SunTimes {
  return platformSunTimes(at, position);
}

/**
 * Where the sun stands at a moment, and whether it rises.
 *
 * @param at - The moment.
 * @param position - The place.
 * @returns Its position, and how its day goes.
 */
export function sunState(at: Date, position: GeoPosition): SunState {
  return platformSunState(at, position);
}

/**
 * The light of a moment, in a word: day, golden hour, blue hour, night.
 *
 * @param state - Where the sun stands.
 * @returns The word.
 */
export function sunPhaseLabel(state: SunState): SunPhaseLabel {
  return platformSunPhaseLabel(state);
}
