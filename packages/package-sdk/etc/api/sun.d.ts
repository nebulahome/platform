//#region src/sun.d.ts
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
export declare const SUN_ELEVATION_ENTITY_ID = "sensor.system_sun_elevation";
export declare const SUN_AZIMUTH_ENTITY_ID = "sensor.system_sun_azimuth";
/**
 * Where the sun stands at a moment, seen from a place.
 *
 * @param at - The moment.
 * @param position - The place.
 * @returns Its elevation and azimuth, in degrees.
 */
export declare function sunPosition(at: Date, position: GeoPosition): SunPosition;
/**
 * The sunrise, solar noon and sunset of the day a moment falls in, at a place.
 *
 * @param at - A moment of the day.
 * @param position - The place.
 * @returns Them; no rise or set on a polar day or night.
 */
export declare function sunTimes(at: Date, position: GeoPosition): SunTimes;
/**
 * Where the sun stands at a moment, and whether it rises.
 *
 * @param at - The moment.
 * @param position - The place.
 * @returns Its position, and how its day goes.
 */
export declare function sunState(at: Date, position: GeoPosition): SunState;
/**
 * The light of a moment, in a word: day, golden hour, blue hour, night.
 *
 * @param state - Where the sun stands.
 * @returns The word.
 */
export declare function sunPhaseLabel(state: SunState): SunPhaseLabel;
//#endregion