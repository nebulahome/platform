/**
 * A day of something that is on or off - a switch, a light that only switches, a door - as the
 * tall cards draw it: 24 blocks, one an hour, lit when it was on in that hour, and how long it was
 * on in all.
 */
import type { EntityView, StateHistoryPoint } from '@nebulahome/contracts';

import { activityShares } from '@/dashboard/activity';
import { translate } from '@/i18n/messages';
import { stateSegments } from '@/library/history-series';
import type { CardHistory } from '@/routes/dashboard/cards/use-card-history';

/** How many blocks a day is drawn as. */
const HOURS = 24;

/** A day, as the card draws it. */
export type OnOffDay = {
  /** Whether each hour, oldest first, had it on at all. */
  readonly hours: readonly boolean[];

  /** How long it was on in the day, in milliseconds. */
  readonly onMs: number;
};

/**
 * A day of an entity that is on or off.
 *
 * @param history - Its changes over the day.
 * @param entity - The entity, for its state before the first change.
 * @param isAvailable - Whether it can be reached now.
 * @returns The day.
 */
export function onOffDay(
  history: CardHistory<StateHistoryPoint>,
  entity: Pick<EntityView, 'state'>,
  isAvailable: boolean,
): OnOffDay {
  const segments = stateSegments(
    history.points,
    history.window,
    { state: entity.state, isAvailable },
    () => '',
  );
  const shares = activityShares(segments, history.window, HOURS);

  return {
    hours: shares.map((share) => share > 0),
    onMs: segments
      .filter((segment) => segment.isActive)
      .reduce((sum, segment) => sum + (segment.to - segment.from), 0),
  };
}

/**
 * Writes a length of time in hours and minutes.
 *
 * @param ms - The length.
 * @returns "5 h 10 min", "40 min".
 */
export function hoursAndMinutes(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) {
    return translate('dashboard.cards.kit.minutes', '{{count}} min', { count: rest });
  }

  return rest === 0
    ? translate('dashboard.cards.kit.hours', '{{count}} h', { count: hours })
    : translate('dashboard.cards.onOffDay.hoursMinutes', '{{hours}} h {{minutes}} min', {
        hours,
        minutes: rest,
      });
}
