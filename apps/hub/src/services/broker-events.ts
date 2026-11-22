/**
 * Telling the Brokers pages that part of what one of them shows changed
 * (`nebula.v1.event.broker.changed`), so that a page reads that part again rather than asking
 * every few seconds.
 *
 * Coalesced per broker and part: the first change of a burst arms a short wait, and the event goes
 * when it ends, once for everything that changed meanwhile - a broker coming up announces dozens
 * of devices in a second. Only the part travels: the page reads it again with the permission it
 * takes.
 */
import type { BrokerEvent } from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

/** How long a burst of changes to one part is gathered before it is told, at most once. */
export const BROKER_EVENT_WINDOW_MS = 500;

/** Says that part of what a broker's page shows changed. */
export type BrokerChanged = (event: BrokerEvent) => void;

/**
 * Hands back what a bus method answers, once it has it, after saying what the method changed: a
 * method that throws tells nothing.
 *
 * @param reply - What the method answers.
 * @param changed - Says what changed.
 * @param events - Which broker's parts.
 * @returns The reply.
 */
export function told<TReply>(
  reply: TReply,
  changed: BrokerChanged,
  ...events: readonly BrokerEvent[]
): TReply {
  for (const event of events) {
    changed(event);
  }

  return reply;
}

/** Gathers broker changes and tells each part once per burst. */
export class BrokerEvents {
  readonly #publish: (event: BrokerEvent) => void;
  readonly #logger: PlatformLogger;
  readonly #windowMs: number;
  readonly #pending = new Map<string, NodeJS.Timeout>();
  #isStopped = false;

  /**
   * Builds it; nothing is told until a part changes.
   *
   * @param publish - Puts one event on the bus.
   * @param logger - Where an event that could not be told is reported.
   * @param windowMs - How long a burst is gathered.
   */
  public constructor(
    publish: (event: BrokerEvent) => void,
    logger: PlatformLogger,
    windowMs = BROKER_EVENT_WINDOW_MS,
  ) {
    this.#publish = publish;
    this.#logger = logger;
    this.#windowMs = windowMs;
  }

  /**
   * Notes that a part changed: told at the end of the burst it opens, or joins.
   *
   * @param event - Which broker, and which part.
   */
  public readonly changed: BrokerChanged = (event) => {
    const key = `${event.broker} ${event.part}`;

    if (this.#isStopped || this.#pending.has(key)) {
      return;
    }

    const timer = setTimeout(() => {
      this.#pending.delete(key);

      try {
        this.#publish(event);
      } catch (error: unknown) {
        // A page that misses one asks again on its own; the hub must not fall over for it.
        this.#logger.debug({ err: error, ...event }, 'Could not tell a broker change');
      }
    }, this.#windowMs);

    timer.unref();
    this.#pending.set(key, timer);
  };

  /** Drops what is still gathering: nothing is told after the hub stops. */
  public stop(): void {
    this.#isStopped = true;

    for (const timer of this.#pending.values()) {
      clearTimeout(timer);
    }

    this.#pending.clear();
  }
}
