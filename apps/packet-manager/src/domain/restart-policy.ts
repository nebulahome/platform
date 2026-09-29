/**
 * When a package's process that exited is started again, and when it is given up on.
 *
 * A process that exits is started again after a pause that doubles each time - a second, two,
 * four, up to a minute - so a package that crashes at once is not started a thousand times a
 * minute, and one that crashed once after hours is back in a second. Five exits in ten minutes and
 * it is `failed`: whatever it needs is not going to appear by trying again, and the owner should
 * be told. A run that lasted a couple of minutes counts as the package working, and the pause
 * starts again from a second.
 */

/** How the policy is tuned. */
export type RestartPolicyOptions = {
  readonly baseDelayMs: number;
  readonly maximumDelayMs: number;
  readonly maximumExits: number;
  readonly windowMs: number;

  /** How long a run must last for the next pause to start again from the base. */
  readonly stableMs: number;
};

/** The defaults: a second doubling to a minute, five exits in ten minutes. */
export const DEFAULT_RESTART_POLICY: RestartPolicyOptions = {
  baseDelayMs: 1000,
  maximumDelayMs: 60_000,
  maximumExits: 5,
  windowMs: 600_000,
  stableMs: 120_000,
};

/** What to do after an exit. */
export type RestartDecision =
  | { readonly kind: 'restart'; readonly delayMs: number }
  | { readonly kind: 'give-up'; readonly exits: number };

/** The exits of one package's process. */
export class RestartPolicy {
  readonly #options: RestartPolicyOptions;
  readonly #now: () => number;
  #exits: number[] = [];
  #delayMs = 0;

  /**
   * Makes a policy with nothing counted.
   *
   * @param options - How it is tuned.
   * @param now - The clock.
   */
  public constructor(
    options: RestartPolicyOptions = DEFAULT_RESTART_POLICY,
    now: () => number = Date.now,
  ) {
    this.#options = options;
    this.#now = now;
  }

  /**
   * Counts an exit, and says what to do.
   *
   * @param startedAtMs - When the run that ended started.
   * @returns Start it again after a pause, or give up.
   */
  public exited(startedAtMs: number): RestartDecision {
    const nowMs = this.#now();
    const { baseDelayMs, maximumDelayMs, maximumExits, windowMs, stableMs } = this.#options;

    this.#exits = [...this.#exits.filter((atMs) => nowMs - atMs < windowMs), nowMs];

    if (this.#exits.length >= maximumExits) {
      return { kind: 'give-up', exits: this.#exits.length };
    }

    this.#delayMs =
      nowMs - startedAtMs >= stableMs || this.#delayMs === 0
        ? baseDelayMs
        : Math.min(this.#delayMs * 2, maximumDelayMs);

    return { kind: 'restart', delayMs: this.#delayMs };
  }

  /** Forgets every exit: the owner started it again by hand. */
  public reset(): void {
    this.#exits = [];
    this.#delayMs = 0;
  }
}
