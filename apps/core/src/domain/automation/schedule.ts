/**
 * When a time or sun trigger next fires.
 *
 * Clock and cron are croner's, in the house's zone, which is what makes "07:00" stay seven in the
 * morning across a change of daylight saving; a time of day with weekdays and months is the cron
 * expression it stands for ({@link clockAtToCron}). The sun is worked out where the house stands
 * (`sun.ts` in the contracts, the same maths the editor previews with) - the one place the
 * installation's position is kept (ARCHITECTURE.md §6.1). Both are pure computation, so a test
 * drives them with any instant it likes.
 */
import { Cron } from 'croner';

import {
  clockAtToCron,
  clockTimeSchema,
  nextSunEvent,
  QUIET_TIME_ENTITY_ID,
  type AutomationTrigger,
  type EntityState,
  type GeoPosition,
} from '@nebulahome/contracts';

/** Where the house is, and the zone its clock keeps. */
export type House = {
  readonly timeZone: string;

  /** Null when nobody has set it, which leaves sun triggers with nothing to go by. */
  readonly position: GeoPosition | null;
};

/** A trigger that fires at a moment rather than on a change. */
export type ScheduledTrigger = Extract<AutomationTrigger, { type: 'time' | 'sun' | 'quiet' }>;

/** The next moment, or why there is none. */
export type NextFire = { readonly at: Date } | { readonly problem: string };

/** Sun events, in words, for a problem. */
const SUN_EVENT_WORDS: Readonly<Record<string, string>> = {
  midnight_sun_start: 'midnight sun',
  midnight_sun_end: 'end of the midnight sun',
  polar_night_start: 'polar night',
  polar_night_end: 'end of the polar night',
  elevation_crossed: 'sun at that elevation',
};

/**
 * The next run of a croner pattern after an instant.
 *
 * @param pattern - Five or six fields.
 * @param timeZone - The house's zone.
 * @param after - The instant to look past.
 * @returns The next moment, or why there is none.
 */
export function nextCron(pattern: string, timeZone: string, after: Date): NextFire {
  try {
    const next = new Cron(pattern, { timezone: timeZone, paused: true }).nextRun(after);

    return next === null ? { problem: 'The schedule never comes round again' } : { at: next };
  } catch (error: unknown) {
    return {
      problem: `The schedule cannot be read: ${error instanceof Error ? error.message : 'invalid'}`,
    };
  }
}

/**
 * The next moment of the sun a trigger waits for, its offset applied.
 *
 * @param trigger - The sun trigger.
 * @param house - Where the house is.
 * @param after - The instant to look past.
 * @returns The next moment, or why there is none.
 */
function nextSun(
  trigger: Extract<AutomationTrigger, { type: 'sun' }>,
  house: House,
  after: Date,
): NextFire {
  if (house.position === null) {
    return { problem: 'The house has no position, so the sun has no time here' };
  }

  if (trigger.event === 'elevation_changed') {
    return { problem: 'Fires each time the sun entity reports, not at a moment' };
  }

  const next = nextSunEvent(trigger, house.position, after);
  const words = SUN_EVENT_WORDS[trigger.event] ?? trigger.event.replaceAll('_', ' ');

  return next === null ? { problem: `There is no ${words} where the house is` } : { at: next };
}

/**
 * When a time or sun trigger next fires.
 *
 * @param trigger - The trigger.
 * @param house - The house's zone and position.
 * @param after - The instant to look past; the answer is strictly later.
 * @param stateOf - Where an entity's state is read, for a time an entity holds.
 * @returns The next moment, or why there is none.
 */
export function nextFire(
  trigger: ScheduledTrigger,
  house: House,
  after: Date,
  stateOf: (entityId: string) => EntityState | undefined = () => undefined,
): NextFire {
  if (trigger.type === 'sun') {
    return nextSun(trigger, house, after);
  }

  if (trigger.type === 'quiet') {
    const time = clockOf(stateOf(QUIET_TIME_ENTITY_ID));

    return time === null
      ? { problem: 'The quietest time is not known yet' }
      : nextCron(
          clockAtToCron({ kind: 'clock', time: shifted(time, trigger.offsetMinutes ?? 0) }),
          house.timeZone,
          after,
        );
  }

  const { at } = trigger;

  if (at.kind === 'entity') {
    const time = clockOf(stateOf(at.entityId));

    return time === null
      ? { problem: `${at.entityId} holds no time of day yet` }
      : nextCron(clockAtToCron({ kind: 'clock', time }), house.timeZone, after);
  }

  return nextCron(at.kind === 'clock' ? clockAtToCron(at) : at.expression, house.timeZone, after);
}

/**
 * A time of day moved by some minutes, going round midnight.
 *
 * @param time - `HH:MM` or `HH:MM:SS`.
 * @param minutes - How far, earlier when negative.
 * @returns `HH:MM`.
 */
function shifted(time: string, minutes: number): string {
  const [hours = 0, mins = 0] = time.split(':').map(Number);
  const total = (((hours * 60 + mins + minutes) % 1440) + 1440) % 1440;

  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * The time of day an entity holds: the first value of its state that reads as one.
 *
 * @param state - The entity's state.
 * @returns `HH:MM` or `HH:MM:SS`, or null when it holds none or is unavailable.
 */
function clockOf(state: EntityState | undefined): string | null {
  if (state?.isAvailable !== true) {
    return null;
  }

  for (const value of Object.values(state.state)) {
    const parsed = clockTimeSchema.safeParse((value as { value?: unknown } | null)?.value);

    if (parsed.success) {
      return parsed.data;
    }
  }

  return null;
}
