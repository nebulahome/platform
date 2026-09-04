/**
 * Reconnection delays.
 *
 * ARCHITECTURE.md 7.4 requires exponential backoff **with jitter** when the broker is
 * unreachable. The jitter is the part that matters: without it, every service that lost the
 * broker at the same moment retries at the same moment, and the broker's first act on coming
 * back is to absorb a synchronised thundering herd from every process on the host.
 */

/** How the delay before attempt N is calculated. */
export type BackoffOptions = {
  /** Delay before the first retry, in milliseconds. */
  readonly baseMs: number;

  /** Ceiling the delay never exceeds, however many attempts have failed. */
  readonly maxMs: number;

  /** Multiplier applied per attempt. Defaults to 2. */
  readonly factor?: number;

  /**
   * Fraction of the delay that is randomised, from 0 (none) to 1 (the full delay).
   *
   * Defaults to 0.5: half the delay is fixed, so backoff still grows, and half is random, so
   * two services that failed together do not retry together.
   */
  readonly jitter?: number;
};

const DEFAULT_FACTOR = 2;
const DEFAULT_JITTER = 0.5;

/**
 * Delays before a retry, growing exponentially and spread by jitter.
 *
 * @param attempt - Which retry this is, counting from 1.
 * @param options - Base delay, ceiling, growth factor and jitter fraction.
 * @param random - Source of randomness in `[0, 1)`. Defaults to `Math.random`; tests pass a
 * constant so the assertion is on the arithmetic rather than on a sample.
 * @returns The number of milliseconds to wait, never negative and never above `maxMs`.
 */
export function backoffDelayMs(
  attempt: number,
  options: BackoffOptions,
  random: () => number = Math.random,
): number {
  const factor = options.factor ?? DEFAULT_FACTOR;
  const jitter = options.jitter ?? DEFAULT_JITTER;

  const exponential = options.baseMs * factor ** Math.max(0, attempt - 1);
  const capped = Math.min(exponential, options.maxMs);

  const fixed = capped * (1 - jitter);
  const spread = capped * jitter * random();

  return Math.round(fixed + spread);
}

/**
 * Waits for a delay, or resolves early when the caller aborts.
 *
 * Resolving early rather than rejecting is deliberate: a shutdown arriving during a reconnect
 * backoff is not a failure of the reconnect, and the caller checks `signal.aborted` on the next
 * line anyway.
 *
 * @param delayMs - How long to wait.
 * @param signal - Cancels the wait. Required, per RULES.md 9.
 * @returns A promise that settles after the delay, or as soon as the signal aborts.
 */
export async function delay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    /** Stops waiting and detaches the abort listener. */
    const settle = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', settle);
      resolve();
    };

    const timer = setTimeout(settle, delayMs);

    signal.addEventListener('abort', settle, { once: true });
  });
}
