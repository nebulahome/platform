/**
 * How a run ended, in a word and a colour: what the list's Last run column and the editor's Last
 * runs card say.
 *
 * `condition_not_met` is not a failure - the automation woke, checked and rightly did nothing -
 * so it reads Skipped, in amber, beside the green of a run that did what it says.
 */
import type { AutomationRunResult } from '@nebulahome/contracts';
import type { StatusDotTone } from '@nebulahome/ui';

import { defineMessage, text, type Message } from '@/i18n/messages';

/** How one ending reads. */
export type RunOutcome = {
  /** The word before the time: "Ran 08:14", "Failed 11:02". */
  readonly word: string;

  /** The dot's colour. */
  readonly tone: StatusDotTone;
};

/** Each ending, as it reads. */
const OUTCOMES: Readonly<
  Record<AutomationRunResult, { readonly word: Message; readonly tone: StatusDotTone }>
> = {
  success: { word: defineMessage('runs.outcome.success', 'Ran'), tone: 'success' },
  condition_not_met: {
    word: defineMessage('runs.outcome.skipped', 'Skipped'),
    tone: 'warning',
  },
  failed: { word: defineMessage('runs.outcome.failed', 'Failed'), tone: 'danger' },
  timeout: { word: defineMessage('runs.outcome.timeout', 'Timed out'), tone: 'danger' },
  cancelled: { word: defineMessage('runs.outcome.cancelled', 'Cancelled'), tone: 'neutral' },
};

/**
 * How a run ended, as it reads.
 *
 * @param result - The ending.
 * @returns Its word and colour.
 */
export function runOutcome(result: AutomationRunResult): RunOutcome {
  const outcome = OUTCOMES[result];

  return { word: text(outcome.word), tone: outcome.tone };
}
