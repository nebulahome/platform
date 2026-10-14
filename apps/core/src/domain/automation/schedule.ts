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
  nextSunEvent,
  type AutomationTrigger,
  type GeoPosition,
} from '@nebulahome/contracts';

/** Where the house is, and the zone its clock keeps. */
export type House = {
  readonly timeZone: string;

  /** Null when nobody has set it, which leaves sun triggers with nothing to go by. */
  readonly position: GeoPosition | null;
};

/** A trigger that fires at a moment rather than on a change. */
export type ScheduledTrigger = Extract<AutomationTrigger, { type: 'time' | 'sun' }>;

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
 * @returns The next moment, or why there is none.
 */
export function nextFire(trigger: ScheduledTrigger, house: House, after: Date): NextFire {
  if (trigger.type === 'sun') {
    return nextSun(trigger, house, after);
  }

  const { at } = trigger;

  return nextCron(at.kind === 'clock' ? clockAtToCron(at) : at.expression, house.timeZone, after);
}
