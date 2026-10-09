/**
 * Where the sun is, and when it gets somewhere, worked out on this machine.
 *
 * The house knows its latitude and longitude and nothing else is needed: the sun's height and
 * bearing at any instant follow from the date with a few lines of spherical astronomy, so there is
 * no service to call and nothing leaves the house. The formulas are the ones the widely used
 * `suncalc` library takes from the astronomy pages of aa.quae.nl, good to about a minute for any
 * date this platform will see.
 *
 * Shared by `core`, which wakes automations on sun events and publishes the sun's elevation and
 * azimuth as two entities of the system device, and by the web interface, which previews the next
 * event under a block and today's sunrise and sunset in the first-run setup. One implementation,
 * so the preview never disagrees with what the engine does.
 *
 * Elevations are geometric (no refraction); the horizon events use the standard -0.833°, which
 * includes refraction and the sun's half-width, so "sunrise" here is the moment almanacs print.
 */

/** A place on Earth, in degrees. */
export type GeoPosition = {
  readonly latitude: number;
  readonly longitude: number;
};

/** Where the sun stands, in degrees. */
export type SunPosition = {
  /** Height above the horizon: negative below it. */
  readonly elevation: number;

  /** Bearing clockwise from north: 90 is east, 180 south. */
  readonly azimuth: number;
};

/** The elevations the named sun events are defined by, in degrees. */
export const SUN_ANGLES = {
  /** Sunrise and sunset: the top of the disc on the horizon, refraction included. */
  horizon: -0.833,

  /** Civil dawn and dusk. */
  civil: -6,

  /** Where the blue hour gives way to the golden hour. */
  blueToGolden: -4,

  /** The upper edge of the golden hour. */
  goldenTop: 6,
} as const;

/** The moments the sun gives an automation. */
export const SUN_EVENTS = [
  'sunrise',
  'sunset',
  'dawn',
  'dusk',
  'solar_noon',
  'solar_midnight',
  'golden_hour_start',
  'golden_hour_end',
  'blue_hour_start',
  'blue_hour_end',
  'midnight_sun_start',
  'midnight_sun_end',
  'polar_night_start',
  'polar_night_end',
  'elevation_crossed',
  'elevation_changed',
] as const;

/** A moment the sun gives an automation. */
export type SunEvent = (typeof SUN_EVENTS)[number];

/** Events that happen twice a day, once in the morning and once in the evening. */
export const TWICE_DAILY_SUN_EVENTS: ReadonlySet<SunEvent> = new Set<SunEvent>([
  'golden_hour_start',
  'golden_hour_end',
  'blue_hour_start',
  'blue_hour_end',
]);

/** Which half of the day a twice-daily event or a phase is wanted in. Absent means either. */
export const SUN_PERIODS = ['morning', 'evening'] as const;

/** Which half of the day. */
export type SunPeriod = (typeof SUN_PERIODS)[number];

/** Which way the sun must be going through an elevation. Absent means either way. */
export const SUN_DIRECTIONS = ['rising', 'setting'] as const;

/** Which way the sun is going. */
export type SunDirection = (typeof SUN_DIRECTIONS)[number];

/** What a sun condition can ask. */
export const SUN_PHASES = [
  'day',
  'twilight',
  'night',
  'golden_hour',
  'blue_hour',
  'midnight_sun',
  'polar_night',
  'above',
  'below',
] as const;

/** What a sun condition can ask. */
export type SunPhase = (typeof SUN_PHASES)[number];

/** The one word a moment is described by, for the sun entity's attributes. */
export type SunPhaseLabel = 'day' | 'golden_hour' | 'blue_hour' | 'night' | 'polar_night';

/** What to look for: a sun trigger, without what only the document needs. */
export type SunEventSpec = {
  readonly event: SunEvent;
  readonly offsetMinutes?: number | undefined;
  readonly period?: SunPeriod | undefined;
  readonly elevation?: number | undefined;
  readonly direction?: SunDirection | undefined;
};

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2_440_588;
const J2000 = 2_451_545;
const J0 = 0.0009;
const OBLIQUITY = RAD * 23.4397;

/** How finely a crossing is pinned down: well under a second. */
const BISECTION_STEPS = 32;

/**
 * Days since the J2000 epoch.
 *
 * @param ms - An instant, in Unix milliseconds.
 * @returns The day number.
 */
function toDays(ms: number): number {
  return ms / DAY_MS - 0.5 + J1970 - J2000;
}

/**
 * An instant from a Julian date.
 *
 * @param julian - The Julian date.
 * @returns Unix milliseconds.
 */
function fromJulian(julian: number): number {
  return (julian + 0.5 - J1970) * DAY_MS;
}

/**
 * The sun's mean anomaly.
 *
 * @param days - Days since J2000.
 * @returns Radians.
 */
function meanAnomaly(days: number): number {
  return RAD * (357.5291 + 0.985_600_28 * days);
}

/**
 * The sun's ecliptic longitude.
 *
 * @param anomaly - Its mean anomaly.
 * @returns Radians.
 */
function eclipticLongitude(anomaly: number): number {
  const centre =
    RAD *
    (1.9148 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly) + 0.0003 * Math.sin(3 * anomaly));

  return anomaly + centre + RAD * 102.9372 + Math.PI;
}

/**
 * The sun's height and bearing at an instant, in radians, with the bearing from the south.
 *
 * @param ms - The instant.
 * @param position - Where.
 * @returns Altitude and azimuth.
 */
function horizontal(ms: number, position: GeoPosition): { altitude: number; azimuth: number } {
  const lw = RAD * -position.longitude;
  const phi = RAD * position.latitude;
  const days = toDays(ms);
  const longitude = eclipticLongitude(meanAnomaly(days));
  const declination = Math.asin(Math.sin(OBLIQUITY) * Math.sin(longitude));
  const ascension = Math.atan2(Math.sin(longitude) * Math.cos(OBLIQUITY), Math.cos(longitude));
  const hourAngle = RAD * (280.16 + 360.985_623_5 * days) - lw - ascension;

  return {
    altitude: Math.asin(
      Math.sin(phi) * Math.sin(declination) +
        Math.cos(phi) * Math.cos(declination) * Math.cos(hourAngle),
    ),
    azimuth: Math.atan2(
      Math.sin(hourAngle),
      Math.cos(hourAngle) * Math.sin(phi) - Math.tan(declination) * Math.cos(phi),
    ),
  };
}

/**
 * The sun's elevation at an instant.
 *
 * @param ms - The instant.
 * @param position - Where.
 * @returns Degrees above the horizon.
 */
function elevationAt(ms: number, position: GeoPosition): number {
  return horizontal(ms, position).altitude / RAD;
}

/**
 * Where the sun stands at an instant.
 *
 * @param at - The instant.
 * @param position - Where.
 * @returns Its elevation and its azimuth from north, in degrees.
 */
export function sunPosition(at: Date, position: GeoPosition): SunPosition {
  const { altitude, azimuth } = horizontal(at.getTime(), position);
  const fromNorth = (azimuth / RAD + 180) % 360;

  return { elevation: altitude / RAD, azimuth: fromNorth < 0 ? fromNorth + 360 : fromNorth };
}

/**
 * Which solar day an instant falls in: the cycle whose noon is nearest.
 *
 * @param ms - The instant.
 * @param position - Where.
 * @returns The cycle number.
 */
function cycleOf(ms: number, position: GeoPosition): number {
  const lw = RAD * -position.longitude;

  return Math.round(toDays(ms) - J0 - lw / (2 * Math.PI));
}

/**
 * When the sun is highest in one solar day.
 *
 * @param cycle - The solar day.
 * @param position - Where.
 * @returns Unix milliseconds.
 */
function noonOf(cycle: number, position: GeoPosition): number {
  const lw = RAD * -position.longitude;
  const days = J0 + lw / (2 * Math.PI) + cycle;
  const anomaly = meanAnomaly(days);
  const longitude = eclipticLongitude(anomaly);

  return fromJulian(J2000 + days + 0.0053 * Math.sin(anomaly) - 0.0069 * Math.sin(2 * longitude));
}

/**
 * Finds where the elevation reaches an angle between two instants it lies on either side of.
 *
 * @param from - One end.
 * @param to - The other end.
 * @param angle - The elevation sought.
 * @param position - Where.
 * @returns The instant, in Unix milliseconds.
 */
function bisect(from: number, to: number, angle: number, position: GeoPosition): number {
  let low = from;
  let high = to;
  const isLowBelow = elevationAt(low, position) < angle;

  for (let step = 0; step < BISECTION_STEPS; step += 1) {
    const middle = (low + high) / 2;

    if (elevationAt(middle, position) < angle === isLowBelow) {
      low = middle;
    } else {
      high = middle;
    }
  }

  return Math.round((low + high) / 2);
}

/** One solar day: its noon, the midnights either side, and the elevations at all three. */
type SolarDay = {
  readonly noon: number;
  readonly midnightBefore: number;
  readonly midnightAfter: number;
  readonly noonElevation: number;
  readonly beforeElevation: number;
  readonly afterElevation: number;
};

/**
 * Reads one solar day.
 *
 * @param cycle - Which.
 * @param position - Where.
 * @returns Its noon and midnights.
 */
function solarDay(cycle: number, position: GeoPosition): SolarDay {
  const noon = noonOf(cycle, position);
  const midnightBefore = noon - DAY_MS / 2;
  const midnightAfter = noon + DAY_MS / 2;

  return {
    noon,
    midnightBefore,
    midnightAfter,
    noonElevation: elevationAt(noon, position),
    beforeElevation: elevationAt(midnightBefore, position),
    afterElevation: elevationAt(midnightAfter, position),
  };
}

/**
 * When the sun rises through an angle in one solar day.
 *
 * @param day - The day.
 * @param angle - The elevation.
 * @param position - Where.
 * @returns The instant, or null when it does not cross that day.
 */
function risingThrough(day: SolarDay, angle: number, position: GeoPosition): number | null {
  return day.beforeElevation < angle && day.noonElevation >= angle
    ? bisect(day.midnightBefore, day.noon, angle, position)
    : null;
}

/**
 * When the sun sets through an angle in one solar day.
 *
 * @param day - The day.
 * @param angle - The elevation.
 * @param position - Where.
 * @returns The instant, or null when it does not cross that day.
 */
function settingThrough(day: SolarDay, angle: number, position: GeoPosition): number | null {
  return day.noonElevation >= angle && day.afterElevation < angle
    ? bisect(day.noon, day.midnightAfter, angle, position)
    : null;
}

/** A crossing an event is made of: an angle, and which way through it. */
type Crossing = { readonly angle: number; readonly direction: SunDirection };

/**
 * The crossings a crossing-type event stands for.
 *
 * @param spec - The event.
 * @returns The crossings, or null when the event is not a crossing.
 */
function crossingsOf(spec: SunEventSpec): Crossing[] | null {
  const { horizon, civil, blueToGolden, goldenTop } = SUN_ANGLES;

  /**
   * The morning and evening crossings of a twice-daily event, narrowed to its period.
   *
   * @param morning - The elevation the sun rises through in the morning.
   * @param evening - The elevation it sets through in the evening.
   * @returns The crossings wanted.
   */
  const pick = (morning: number, evening: number): Crossing[] => [
    ...(spec.period === 'evening' ? [] : [{ angle: morning, direction: 'rising' as const }]),
    ...(spec.period === 'morning' ? [] : [{ angle: evening, direction: 'setting' as const }]),
  ];

  switch (spec.event) {
    case 'sunrise': {
      return [{ angle: horizon, direction: 'rising' }];
    }
    case 'sunset': {
      return [{ angle: horizon, direction: 'setting' }];
    }
    case 'dawn': {
      return [{ angle: civil, direction: 'rising' }];
    }
    case 'dusk': {
      return [{ angle: civil, direction: 'setting' }];
    }
    case 'golden_hour_start': {
      return pick(blueToGolden, goldenTop);
    }
    case 'golden_hour_end': {
      return pick(goldenTop, blueToGolden);
    }
    case 'blue_hour_start': {
      return pick(civil, blueToGolden);
    }
    case 'blue_hour_end': {
      return pick(blueToGolden, civil);
    }
    case 'elevation_crossed': {
      const angle = spec.elevation ?? 0;

      return [
        ...(spec.direction === 'setting' ? [] : [{ angle, direction: 'rising' as const }]),
        ...(spec.direction === 'rising' ? [] : [{ angle, direction: 'setting' as const }]),
      ];
    }
    default: {
      return null;
    }
  }
}

/**
 * The instants an event happens on in one solar day, earliest first.
 *
 * @param spec - The event.
 * @param cycle - The solar day.
 * @param position - Where.
 * @returns The instants; empty when it does not happen that day.
 */
function eventsOnDay(spec: SunEventSpec, cycle: number, position: GeoPosition): number[] {
  const day = solarDay(cycle, position);
  const { horizon } = SUN_ANGLES;
  const crossings = crossingsOf(spec);

  if (crossings !== null) {
    return crossings
      .map((crossing) =>
        crossing.direction === 'rising'
          ? risingThrough(day, crossing.angle, position)
          : settingThrough(day, crossing.angle, position),
      )
      .filter((moment): moment is number => moment !== null)
      .toSorted((left, right) => left - right);
  }

  switch (spec.event) {
    case 'solar_noon': {
      return [day.noon];
    }
    case 'solar_midnight': {
      return [day.midnightAfter];
    }
    case 'midnight_sun_start': {
      // The first midnight the sun stays up, after one it did not.
      const previous = solarDay(cycle - 1, position);

      return day.beforeElevation >= horizon && previous.beforeElevation < horizon
        ? [day.midnightBefore]
        : [];
    }
    case 'midnight_sun_end': {
      // The first sunset after a midnight the sun stayed up for.
      const sunset = settingThrough(day, horizon, position);

      return sunset !== null && day.beforeElevation >= horizon ? [sunset] : [];
    }
    case 'polar_night_start': {
      // The first noon the sun stays down, after one it rose for.
      const previous = solarDay(cycle - 1, position);

      return day.noonElevation < horizon && previous.noonElevation >= horizon ? [day.noon] : [];
    }
    case 'polar_night_end': {
      // The first sunrise after a noon the sun stayed down for.
      const previous = solarDay(cycle - 1, position);
      const sunrise = risingThrough(day, horizon, position);

      return sunrise !== null && previous.noonElevation < horizon ? [sunrise] : [];
    }
    default: {
      return [];
    }
  }
}

/**
 * When a sun event next happens, its offset applied.
 *
 * Walks forward one solar day at a time. A year and a few days is enough for every event that
 * happens at all where the house is; one that does not (the midnight sun in Milan, a crossing of
 * an elevation the sun never reaches) gives null rather than walking for ever.
 *
 * @param spec - The event, with its offset.
 * @param position - Where the house is.
 * @param after - The instant to look past; the answer is strictly later.
 * @param options - How far to look.
 * @param options.maxDays - Solar days to try, 370 unless said.
 * @returns The next instant, or null when it does not happen within that.
 */
export function nextSunEvent(
  spec: SunEventSpec,
  position: GeoPosition,
  after: Date,
  options: { readonly maxDays?: number } = {},
): Date | null {
  if (spec.event === 'elevation_changed') {
    return null;
  }

  const offsetMs = (spec.offsetMinutes ?? 0) * 60_000;
  const threshold = after.getTime() - offsetMs;
  const first = cycleOf(threshold, position) - 1;
  const maxDays = options.maxDays ?? 370;

  for (let cycle = first; cycle <= first + maxDays; cycle += 1) {
    const moment = eventsOnDay(spec, cycle, position).find((instant) => instant > threshold);

    if (moment !== undefined) {
      return new Date(moment + offsetMs);
    }
  }

  return null;
}

/** Sunrise, noon and sunset of one day, for a preview. */
export type SunTimes = {
  readonly sunrise: Date | null;
  readonly solarNoon: Date;
  readonly sunset: Date | null;
};

/**
 * The sunrise, noon and sunset of the solar day an instant falls in.
 *
 * @param at - Any instant of the day.
 * @param position - Where.
 * @returns The three moments; sunrise or sunset is null on a day the sun does not cross the
 *   horizon.
 */
export function sunTimes(at: Date, position: GeoPosition): SunTimes {
  const day = solarDay(cycleOf(at.getTime(), position), position);
  const sunrise = risingThrough(day, SUN_ANGLES.horizon, position);
  const sunset = settingThrough(day, SUN_ANGLES.horizon, position);

  return {
    sunrise: sunrise === null ? null : new Date(sunrise),
    solarNoon: new Date(day.noon),
    sunset: sunset === null ? null : new Date(sunset),
  };
}

/** What the sun is doing at an instant, as a condition asks it. */
export type SunState = SunPosition & {
  /** Whether it is climbing: before solar noon. */
  readonly isRising: boolean;

  /** Whether today it never sets. */
  readonly isMidnightSun: boolean;

  /** Whether today it never rises. */
  readonly isPolarNight: boolean;
};

/**
 * What the sun is doing at an instant.
 *
 * @param at - The instant.
 * @param position - Where.
 * @returns Its position, whether it is rising, and whether today is a polar day or night.
 */
export function sunState(at: Date, position: GeoPosition): SunState {
  const ms = at.getTime();
  const day = solarDay(cycleOf(ms, position), position);
  const { horizon } = SUN_ANGLES;

  return {
    ...sunPosition(at, position),
    isRising: ms < day.noon,
    isMidnightSun: Math.min(day.beforeElevation, day.afterElevation) >= horizon,
    isPolarNight: day.noonElevation < horizon,
  };
}

/** What a sun condition asks. */
export type SunPhaseQuestion = {
  readonly phase: SunPhase;
  readonly elevation?: number | undefined;
  readonly period?: SunPeriod | undefined;
};

/**
 * Whether the sun is in a phase.
 *
 * Day, twilight and night split the elevation at the horizon and at civil dusk; the golden and
 * blue hours overlap them, as they do in the sky. A period narrows a phase to the morning or the
 * evening half of the day.
 *
 * @param question - The phase, with its elevation for above and below.
 * @param state - What the sun is doing, from {@link sunState}.
 * @returns Whether it holds.
 */
export function isSunPhase(question: SunPhaseQuestion, state: SunState): boolean {
  const { horizon, civil, blueToGolden, goldenTop } = SUN_ANGLES;
  const { elevation } = state;
  const isInPeriod =
    question.period === undefined || (question.period === 'morning') === state.isRising;

  switch (question.phase) {
    case 'day': {
      return elevation > horizon && isInPeriod;
    }
    case 'twilight': {
      return elevation > civil && elevation <= horizon && isInPeriod;
    }
    case 'night': {
      return elevation <= civil && isInPeriod;
    }
    case 'golden_hour': {
      return elevation > blueToGolden && elevation < goldenTop && isInPeriod;
    }
    case 'blue_hour': {
      return elevation > civil && elevation <= blueToGolden && isInPeriod;
    }
    case 'midnight_sun': {
      return state.isMidnightSun;
    }
    case 'polar_night': {
      return state.isPolarNight;
    }
    case 'above': {
      return elevation > (question.elevation ?? 0) && isInPeriod;
    }
    case 'below': {
      return elevation < (question.elevation ?? 0) && isInPeriod;
    }
  }
}

/**
 * The one word for what the sun is doing, for the sun entity's attributes.
 *
 * @param state - What the sun is doing.
 * @returns Day, golden hour, blue hour, night or polar night.
 */
export function sunPhaseLabel(state: SunState): SunPhaseLabel {
  const { civil, blueToGolden, goldenTop } = SUN_ANGLES;

  if (state.isPolarNight) {
    return 'polar_night';
  }

  if (state.elevation >= goldenTop) {
    return 'day';
  }

  if (state.elevation > blueToGolden) {
    return 'golden_hour';
  }

  return state.elevation > civil ? 'blue_hour' : 'night';
}

/** The entity of the sun's elevation, on the system device. */
export const SUN_ELEVATION_ENTITY_ID = 'sensor.system_sun_elevation';

/** The entity of the sun's azimuth, on the system device. */
export const SUN_AZIMUTH_ENTITY_ID = 'sensor.system_sun_azimuth';

/** Which reading a sun entity carries. */
export type SunReading = 'elevation' | 'azimuth';

/**
 * The sun's two entities: what they register as, and which reading is their state.
 *
 * Typed loosely here and checked against the registration schema where they are registered, so
 * this file stays free of the registration contract.
 */
export const SUN_ENTITIES = [
  {
    reading: 'elevation',
    entityId: SUN_ELEVATION_ENTITY_ID,
    name: 'Sun elevation',
    icon: 'sun',
    unitOfMeasurement: '°',
    stateClass: 'measurement',
    displayPrecision: 1,
    capabilities: { sensor_numeric: {} },
  },
  {
    reading: 'azimuth',
    entityId: SUN_AZIMUTH_ENTITY_ID,
    name: 'Sun azimuth',
    icon: 'compass',
    unitOfMeasurement: '°',
    stateClass: 'measurement',
    displayPrecision: 1,
    capabilities: { sensor_numeric: {} },
  },
] as const;

/** Every sun entity id. */
export const SUN_ENTITY_IDS: readonly string[] = SUN_ENTITIES.map((entity) => entity.entityId);
