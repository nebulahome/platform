/**
 * The step-by-step record of a run, which is what the interface draws as its timeline.
 *
 * Capped: a loop that goes round a thousand times would otherwise write a thousand steps into one
 * row. Past the cap one last step says how many more were not recorded, so the trace never
 * pretends to be complete when it is not.
 */
import type { TraceStep } from '@nebulahome/contracts';

/** How many steps one run records. */
export const MAX_TRACE_STEPS = 1_000;

/** Records a run's steps. */
export class TraceRecorder {
  readonly #steps: TraceStep[] = [];
  #dropped = 0;

  /**
   * Records one step, or counts it when the trace is full.
   *
   * @param step - The step.
   */
  public add(step: TraceStep): void {
    if (this.#steps.length < MAX_TRACE_STEPS) {
      this.#steps.push(step);
    } else {
      this.#dropped += 1;
    }
  }

  /**
   * The steps, with a closing note when some were not recorded.
   *
   * @param at - When the run ended, for the note.
   * @returns The trace.
   */
  public steps(at: Date): TraceStep[] {
    if (this.#dropped === 0) {
      return [...this.#steps];
    }

    return [
      ...this.#steps,
      {
        path: 'then',
        kind: 'action',
        type: 'trace',
        at,
        durationMs: 0,
        result: 'skipped',
        detail: `${String(this.#dropped)} more steps were not recorded`,
      },
    ];
  }
}
