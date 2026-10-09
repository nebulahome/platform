/**
 * When a time trigger next fires: a time of day, a cron expression, or the sun.
 *
 * Clock and cron are croner's, in the house's zone, which is what makes "07:00" stay seven in the
 * morning across a change of daylight saving. The sun is suncalc's, at the house's position - the
 * one place the installation's position is kept (ARCHITECTURE.md §6.1). Both are pure
 * computation, so a test drives them with any instant it likes.
 */
import { Cron } from 'croner';
import { getTimes } from 'suncalc';

import type { AutomationTrigger } from '@nebulahome/contracts';

/** Where the house is, and the zone its clock keeps. */
export type House = {
  readonly timeZone: string;

  /** Null when nobody has set it, which leaves sun triggers with nothing to go by. */
  readonly position: { readonly latitude: number; readonly longitude: number } | null;
};

/** What a time trigger says about when. */
export type TimeAt = Extract<AutomationTrigger, { type: 'time' }>['at'];

/** The next moment, or why there is none. */
export type NextFire = { readonly at: Date } | { readonly problem: string };

/** How many days ahead a sun trigger is looked for, past which it is a polar day or night. */
const SOLAR_LOOKAHEAD_DAYS = 7;

/** A day, in milliseconds. */
const DAY_MS = 86_400_000;

/**
 * The croner pattern of a time of day, with seconds.
 *
 * @param clock - `HH:MM` or `HH:MM:SS`.
 * @returns `s m h * * *`.
 */
function clockPattern(clock: string): string {
  const [hours = '0', minutes = '0', seconds = '0'] = clock.split(':');

  return `${String(Number(seconds))} ${String(Number(minutes))} ${String(Number(hours))} * * *`;
}

/**
 * The next run of a croner pattern after an instant.
 *
 * @param pattern - Five or six fields.
 * @param timeZone - The house's zone.
 * @param after - The instant to look past.
 * @returns The next moment, or why there is none.
 */
function nextCron(pattern: string, timeZone: string, after: Date): NextFire {
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
 * The next sunrise or sunset, moved by an offset, after an instant.
 *
 * suncalc answers for the solar day nearest the date it is given, so the days around `after` are
 * asked one by one and the earliest moment past it is kept.
 *
 * @param at - The sun trigger.
 * @param house - Where the house is.
 * @param after - The instant to look past.
 * @returns The next moment, or why there is none.
 */
function nextSolar(at: Extract<TimeAt, { kind: 'solar' }>, house: House, after: Date): NextFire {
  if (house.position === null) {
    return { problem: 'The house has no position, so the sun has no time here' };
  }

  const offsetMs = at.offsetMinutes * 60_000;
  let best: number | undefined;

  for (let day = -1; day <= SOLAR_LOOKAHEAD_DAYS; day += 1) {
    const times = getTimes(
      new Date(after.getTime() + day * DAY_MS),
      house.position.latitude,
      house.position.longitude,
    );
    const event = times[at.event];

    if (event === null || Number.isNaN(event.getTime())) {
      continue;
    }

    const moment = event.getTime() + offsetMs;

    if (moment > after.getTime() && (best === undefined || moment < best)) {
      best = moment;
    }
  }

  return best === undefined
    ? { problem: `There is no ${at.event} where the house is for the next week` }
    : { at: new Date(best) };
}

/**
 * When a time trigger next fires.
 *
 * @param at - What the trigger says.
 * @param house - The house's zone and position.
 * @param after - The instant to look past; the answer is strictly later.
 * @returns The next moment, or why there is none.
 */
export function nextFire(at: TimeAt, house: House, after: Date): NextFire {
  switch (at.kind) {
    case 'clock': {
      return nextCron(clockPattern(at.time), house.timeZone, after);
    }
    case 'cron': {
      return nextCron(at.expression, house.timeZone, after);
    }
    case 'solar': {
      return nextSolar(at, house, after);
    }
  }
}
