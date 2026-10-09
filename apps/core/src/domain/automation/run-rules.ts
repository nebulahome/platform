/**
 * The rules that decide whether a run may start: the automation's mode, and the loop guard.
 *
 * **Modes** (ARCHITECTURE.md §6.1) - what happens when it is woken while already running:
 * `single` ignores the new wake; `restart` cancels the running one and starts over; `queued` runs
 * them one after another; `parallel` runs them side by side. Queues and parallel runs are capped,
 * so a trigger firing every second cannot pile up work without end.
 *
 * **The loop guard** stops an automation whose actions wake it again. Every run carries the chain
 * of automations that led to it - a change caused by a run of A that wakes B gives B's run the
 * chain [A] - so A turning on a light that wakes A is seen for what it is. A chain that comes
 * back to the same automation three times, or grows past eight, is refused; so is an automation
 * starting more than thirty times in a minute, whatever woke it.
 *
 * Pure: the clock is handed in.
 */
import type { AutomationMode } from '@nebulahome/contracts';

/** How many runs may wait behind a queued one. */
export const MAX_QUEUED_RUNS = 10;

/** How many runs of a parallel one may run at once. */
export const MAX_PARALLEL_RUNS = 10;

/** How many times one automation may appear in the chain that wakes it. */
export const MAX_SELF_CHAIN = 3;

/** How long a chain of automations waking each other may grow. */
export const MAX_CHAIN = 8;

/** How many starts one automation is allowed in {@link RATE_WINDOW_MS}. */
export const MAX_STARTS_PER_WINDOW = 30;

/** The window the start rate is counted over. */
export const RATE_WINDOW_MS = 60_000;

/** What to do with a wake, given the runs already going. */
export type ModeDecision = 'start' | 'restart' | 'queue' | 'drop';

/**
 * What the mode says to do with a wake.
 *
 * @param mode - The automation's mode.
 * @param running - How many of its runs are going.
 * @param queued - How many are waiting.
 * @returns Start it, restart (cancel the running ones first), queue it, or drop it.
 */
export function decideMode(mode: AutomationMode, running: number, queued: number): ModeDecision {
  if (running === 0 && queued === 0) {
    return 'start';
  }

  switch (mode) {
    case 'single': {
      return 'drop';
    }
    case 'restart': {
      return 'restart';
    }
    case 'queued': {
      return queued < MAX_QUEUED_RUNS ? 'queue' : 'drop';
    }
    case 'parallel': {
      return running < MAX_PARALLEL_RUNS ? 'start' : 'drop';
    }
  }
}

/** Whether a run may start, and why not. */
export type GuardDecision = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** Counts starts and judges chains. */
export class LoopGuard {
  readonly #starts = new Map<string, number[]>();

  /**
   * Whether an automation may start a run now, and records the start when it may.
   *
   * @param automationId - The automation.
   * @param chain - The automations whose runs led to this one, oldest first.
   * @param nowMs - Now, in milliseconds.
   * @returns Whether it may.
   */
  public admit(automationId: string, chain: readonly string[], nowMs: number): GuardDecision {
    const selfCount = chain.filter((id) => id === automationId).length;

    if (selfCount >= MAX_SELF_CHAIN) {
      return { ok: false, reason: 'It keeps waking itself: its own actions set off its triggers' };
    }

    if (chain.length >= MAX_CHAIN) {
      return { ok: false, reason: 'Too many automations in a row are waking each other' };
    }

    const recent = (this.#starts.get(automationId) ?? []).filter(
      (at) => at > nowMs - RATE_WINDOW_MS,
    );

    if (recent.length >= MAX_STARTS_PER_WINDOW) {
      this.#starts.set(automationId, recent);

      return { ok: false, reason: 'It started more than thirty times in a minute' };
    }

    recent.push(nowMs);
    this.#starts.set(automationId, recent);

    return { ok: true };
  }

  /**
   * Forgets an automation, when it is removed.
   *
   * @param automationId - The automation.
   */
  public forget(automationId: string): void {
    this.#starts.delete(automationId);
  }
}
