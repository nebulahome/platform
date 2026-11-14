/**
 * Asking `core` again what it did not hear.
 *
 * After a write the API asks `core` to read the row again: an automation, an alias, a link, the
 * house. A silence was logged and left for `core`'s next start, so a deleted automation kept
 * running and an edit was ignored until then. Every such request is "read this row again", which
 * is harmless twice, so a failed one is asked again in the background a few times, further apart
 * each time. The HTTP answer never waits for that: only the first try is awaited, as before.
 */

/** How long after a failed try each next one comes; one try more than there are waits. */
const RETRY_DELAYS_MS = [2000, 10_000, 30_000] as const;

/** The tries waiting to be made, cleared on shutdown. */
const waiting = new Set<NodeJS.Timeout>();

/** Whether the service is shutting down, after which nothing is asked again. */
let isStopped = false;

/**
 * Asks `core` once, and when that fails, again in the background a few times.
 *
 * @param ask - The request; it must be safe to repeat.
 * @param warn - Logs a failed try.
 */
export async function askCore(
  ask: () => Promise<void>,
  warn: (error: unknown) => void,
): Promise<void> {
  try {
    await ask();
  } catch (error: unknown) {
    warn(error);
    askLater(ask, warn, 0);
  }
}

/**
 * Asks again after the wait of a given try, unless the tries are spent or the service stops.
 *
 * @param ask - The request.
 * @param warn - Logs a failed try.
 * @param attempt - Which retry this is, from 0.
 */
function askLater(ask: () => Promise<void>, warn: (error: unknown) => void, attempt: number): void {
  const delay = RETRY_DELAYS_MS[attempt];

  if (delay === undefined || isStopped) {
    return;
  }

  const timer = setTimeout(() => {
    waiting.delete(timer);
    ask().catch((error: unknown) => {
      warn(error);
      askLater(ask, warn, attempt + 1);
    });
  }, delay);

  // A retry never keeps the process alive on its own.
  timer.unref();
  waiting.add(timer);
}

/** Drops every retry still waiting, and makes none from now on: the bus is about to close. */
export function stopCoreRetries(): void {
  isStopped = true;

  for (const timer of waiting) {
    clearTimeout(timer);
  }

  waiting.clear();
}
