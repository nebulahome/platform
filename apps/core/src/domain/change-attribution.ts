/**
 * Who caused a change: the cause a command carried, held until the device reports back.
 *
 * A command and the state change it produces travel apart. The command goes out to an adapter,
 * which accepts it and says nothing more; a while later the device reports its new state on its
 * own subject, carrying no trace of the command. So the cause is written down here when the
 * command is sent, by entity, and read back when that entity next reports - which is how history
 * can say "turned on by the Evening lights automation" and how the automation engine tells a
 * change it caused itself from one somebody else did.
 *
 * Not consumed on read: a light fading over two seconds reports several times, and every one of
 * those changes is the command's. Bounded by time instead. A change arriving after the window is
 * nobody's - most likely a person at the switch - and a newer command replaces an older one.
 * The window is a heuristic, and it errs the way that matters least: a hand on the switch within
 * a few seconds of an automation is credited to the automation.
 *
 * Pure: the clock is injected.
 */
import type { ChangeContext, EntityId } from '@nebulahome/contracts';

/** How long a command's cause is held waiting for its change, by default. */
export const ATTRIBUTION_WINDOW_MS = 5_000;

/** One cause, and until when it holds. */
type Pending = {
  readonly context: ChangeContext;
  readonly expiresAt: number;
};

/** The causes of commands whose changes have not arrived yet. */
export class ChangeAttribution {
  readonly #pending = new Map<EntityId, Pending>();
  readonly #now: () => number;
  readonly #windowMs: number;

  /**
   * Builds an empty set of causes.
   *
   * @param now - The clock, in milliseconds.
   * @param windowMs - How long a cause holds.
   */
  public constructor(now: () => number = Date.now, windowMs = ATTRIBUTION_WINDOW_MS) {
    this.#now = now;
    this.#windowMs = windowMs;
  }

  /**
   * Writes down why an entity is about to change.
   *
   * @param entityId - The entity commanded.
   * @param context - What commanded it.
   */
  public note(entityId: EntityId, context: ChangeContext): void {
    this.#pending.set(entityId, { context, expiresAt: this.#now() + this.#windowMs });

    if (this.#pending.size > 1_000) {
      this.#sweep();
    }
  }

  /**
   * Reads why an entity changed, when a command said so recently enough.
   *
   * @param entityId - The entity that reported.
   * @returns The cause, or undefined when there is none still holding.
   */
  public of(entityId: EntityId): ChangeContext | undefined {
    const pending = this.#pending.get(entityId);

    if (pending === undefined) {
      return undefined;
    }

    if (pending.expiresAt < this.#now()) {
      this.#pending.delete(entityId);

      return undefined;
    }

    return pending.context;
  }

  /** Drops every cause that no longer holds, so a house of silent devices cannot grow the map. */
  #sweep(): void {
    const now = this.#now();

    for (const [entityId, pending] of this.#pending) {
      if (pending.expiresAt < now) {
        this.#pending.delete(entityId);
      }
    }
  }
}
