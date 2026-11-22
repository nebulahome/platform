/**
 * Whether a day is a working day: what `binary_sensor.working_today` and `working_tomorrow` say.
 *
 * A day off is a weekend day, a holiday the owner has not hidden, or a day an event of a day-off
 * calendar covers (Holidays is one; a calendar of the owner's may be: the house's own closures).
 */
import { DAYS_OF_WEEK } from '../automation-meta.js';

import { weekdayOf, type DayKey } from './zoned-time.js';

/**
 * Whether a day is a working day.
 *
 * @param day - The day.
 * @param weekendDays - The days of the week that are weekend, 0 for Monday to 6 for Sunday
 *   (`calendar.weekend_days`).
 * @param holidayDays - The days of the holidays shown, hidden ones left out.
 * @param dayOffDays - The days events of day-off calendars cover.
 * @returns True when it is none of them.
 */
export function isWorkingDay(
  day: DayKey,
  weekendDays: readonly number[],
  holidayDays: ReadonlySet<DayKey>,
  dayOffDays: ReadonlySet<DayKey>,
): boolean {
  return (
    !weekendDays.includes(DAYS_OF_WEEK.indexOf(weekdayOf(day))) &&
    !holidayDays.has(day) &&
    !dayOffDays.has(day)
  );
}
