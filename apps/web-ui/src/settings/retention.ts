/**
 * The retention ladder, as the interface has to present it.
 *
 * The constraint is checked here as well as on the server, and the duplication is deliberate.
 * The server's check is the one that protects the data; this one exists so the person finds out
 * while looking at the four dropdowns that produced the problem, rather than after pressing save
 * and reading a sentence about a key. Both call the same schema from `@nebulahome/contracts`,
 * so there is one definition of the rule and two places that ask it.
 *
 * What the rule protects against is worth restating, because it is not obvious: each aggregate
 * refreshes by looking a fixed distance back into the level below it, so a level kept for less
 * time than the level above has its rows dropped before the coarser one has read them. Nothing
 * reports it. The coarser level simply ends up with a hole, and there is no way back.
 */
import {
  RETENTION_LADDER_FIELDS,
  RETENTION_MINIMUM_DAYS,
  retentionLadderSchema,
  type JsonValue,
} from '@nebulahome/contracts';

import { defineMessage, translate, type Message } from '@/i18n/messages';

/** One rung, as it reads on screen. */
export type RetentionRung = {
  /** The setting key. */
  readonly key: string;

  /** What the level is called. */
  readonly label: Message;

  /** Where its rows come from. */
  readonly note: Message;

  /** The shortest duration this level may be kept for, from the catalogue. */
  readonly minimumDays: number;
};

/** The four rungs, finest first, which is the order they constrain each other in. */
export const RETENTION_RUNGS: readonly RetentionRung[] = [
  {
    key: 'history.telemetry.raw_retention_days',
    minimumDays: RETENTION_MINIMUM_DAYS.raw,
    label: defineMessage('settings.data.rungs.raw', 'raw'),
    note: defineMessage('settings.data.rungs.rawNote', 'Every reading, as it arrived'),
  },
  {
    key: 'history.telemetry.tier_1m_retention_days',
    minimumDays: RETENTION_MINIMUM_DAYS.tier1m,
    label: defineMessage('settings.data.rungs.minute', '1 minute'),
    note: defineMessage('settings.data.rungs.minuteNote', 'Rolled up from raw'),
  },
  {
    key: 'history.telemetry.tier_1h_retention_days',
    minimumDays: RETENTION_MINIMUM_DAYS.tier1h,
    label: defineMessage('settings.data.rungs.hour', '1 hour'),
    note: defineMessage('settings.data.rungs.hourNote', 'Rolled up from the minute level'),
  },
  {
    key: 'history.telemetry.tier_1d_retention_days',
    minimumDays: RETENTION_MINIMUM_DAYS.tier1d,
    label: defineMessage('settings.data.rungs.day', '1 day'),
    note: defineMessage('settings.data.rungs.dayNote', 'Rolled up from the hour level'),
  },
];

/**
 * Checks a ladder.
 *
 * @param values - Every setting as it would be after the edits on screen, by key.
 * @returns What is wrong with it, or null when nothing is.
 */
export function ladderProblem(values: ReadonlyMap<string, JsonValue>): string | null {
  const ladder = Object.fromEntries(
    Object.entries(RETENTION_LADDER_FIELDS).map(([key, field]) => [field, values.get(key)]),
  );

  const parsed = retentionLadderSchema.safeParse(ladder);

  // The schema's own sentence is the API's, in English; the page says it in the reader's language.
  return parsed.success
    ? null
    : translate(
        'settings.data.ladderProblem',
        'Retention must not decrease as resolution coarsens: raw <= 1m <= 1h <= 1d, null last',
      );
}
