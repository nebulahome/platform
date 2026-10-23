/**
 * What a call to a webhook address does, decided in a fixed order.
 *
 * 1. No enabled automation has a webhook trigger with the id: 404. A paused automation, or a
 *    webhook trigger turned off, is not there.
 * 2. A call from outside the house's network to a webhook kept on it, or to any while calls from
 *    the internet are off: 404, the same answer as an unknown id, so outside learns nothing.
 * 3. A method the webhook does not take: 405.
 * 4. Over the limit a minute for that id: 429.
 * 5. Otherwise every automation with the id is woken.
 *
 * Pure but for {@link CallCounter}, which is the count it keeps.
 */
import {
  isBlockEnabled,
  type AutomationTrigger,
  type WebhookCallOutcome,
} from '@nebulahome/contracts';

/** A webhook trigger. */
export type WebhookTrigger = Extract<AutomationTrigger, { type: 'webhook' }>;

/** One automation a call can wake, with its webhook trigger and where it is. */
export type WebhookTarget = {
  readonly automationId: string;
  readonly path: string;
  readonly trigger: WebhookTrigger;
};

/** What a call does. */
export type WebhookDecision =
  | { readonly status: 200; readonly targets: readonly WebhookTarget[] }
  | {
      readonly status: 404 | 405 | 429;
      readonly outcome: WebhookCallOutcome;

      /** The automation it would have been, when there is one, for the log. */
      readonly automationId: string | null;
    };

/**
 * The webhook triggers, among some automations, that have an id.
 *
 * @param automations - The automations loaded, by id, with their triggers.
 * @param hookId - The id called.
 * @returns Each trigger that is on and has it.
 */
export function webhookTargets(
  automations: Iterable<{ readonly id: string; readonly triggers: readonly AutomationTrigger[] }>,
  hookId: string,
): WebhookTarget[] {
  const targets: WebhookTarget[] = [];

  for (const automation of automations) {
    for (const [index, trigger] of automation.triggers.entries()) {
      if (trigger.type === 'webhook' && trigger.hookId === hookId && isBlockEnabled(trigger)) {
        targets.push({
          automationId: automation.id,
          path: `triggers.${String(index)}`,
          trigger,
        });
      }
    }
  }

  return targets;
}

/**
 * Decides what a call does.
 *
 * @param targets - The triggers with the id called.
 * @param call - How it was called, and whether from the house's network.
 * @param call.method - The method.
 * @param call.isLocal - Whether it came from the house's network.
 * @param allowInternet - Whether calls from the internet are taken at all.
 * @param admit - Counts the call against the limit; false when it is over.
 * @returns The answer, with what to wake when it is 200.
 */
export function decideWebhook(
  targets: readonly WebhookTarget[],
  call: { readonly method: string; readonly isLocal: boolean },
  allowInternet: boolean,
  admit: () => boolean,
): WebhookDecision {
  const [first] = targets;

  if (first === undefined) {
    return { status: 404, outcome: 'not_found', automationId: null };
  }

  const reachable = call.isLocal
    ? targets
    : targets.filter((target) => allowInternet && target.trigger.reach === 'internet');
  const [reached] = reachable;

  if (reached === undefined) {
    return { status: 404, outcome: 'local_only', automationId: first.automationId };
  }

  const accepting = reachable.filter(
    (target) => target.trigger.method === 'any' || target.trigger.method === call.method,
  );
  const [accepted] = accepting;

  if (accepted === undefined) {
    return { status: 405, outcome: 'wrong_method', automationId: reached.automationId };
  }

  if (!admit()) {
    return { status: 429, outcome: 'rate_limited', automationId: accepted.automationId };
  }

  return { status: 200, targets: accepting };
}

/** How long one count lasts. */
const WINDOW_MS = 60_000;

/**
 * The calls each webhook took in its current minute.
 *
 * shortcut: a fixed minute per id, so a burst across the turn of one can take twice the limit;
 * a sliding window if anybody ever leans on the limit.
 */
export class CallCounter {
  readonly #windows = new Map<string, { start: number; count: number }>();

  /**
   * Counts a call.
   *
   * @param hookId - The webhook.
   * @param nowMs - Now.
   * @param perMinute - The limit.
   * @returns True while the minute's calls are within it.
   */
  public admit(hookId: string, nowMs: number, perMinute: number): boolean {
    const window = this.#windows.get(hookId);

    if (window === undefined || nowMs - window.start >= WINDOW_MS) {
      this.#windows.set(hookId, { start: nowMs, count: 1 });

      return perMinute >= 1;
    }

    window.count += 1;

    return window.count <= perMinute;
  }
}
