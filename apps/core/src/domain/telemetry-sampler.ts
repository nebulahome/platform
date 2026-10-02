/**
 * Which numeric readings go on to the telemetry stream.
 *
 * Every report a numeric sensor makes passes through the ingest pipeline, and a power meter makes
 * one a second. State history keeps only the changes; telemetry is the series a chart is drawn
 * from, and a series needs a point for a value that held as much as for one that moved - a flat
 * line with no points in it is a chart that says "nothing recorded". So a reading is kept when
 * its value differs from the last one kept, and otherwise once a heartbeat has passed since then:
 * a steady sensor still draws a line, and a chatty one does not write a row a second.
 */
import type { EntityId } from '@nebulahome/contracts';

/** How long an unchanged value waits before it is kept again, in milliseconds. */
export const TELEMETRY_HEARTBEAT_MS = 60_000;

/** The last reading kept for one entity. */
type Kept = {
  readonly value: number;

  /** When it was observed, in milliseconds since the epoch. */
  readonly at: number;
};

/** Decides, reading by reading, what the telemetry stream is sent. */
export class TelemetrySampler {
  readonly #kept = new Map<EntityId, Kept>();
  readonly #heartbeatMs: number;

  /**
   * Builds a sampler that has kept nothing yet.
   *
   * @param heartbeatMs - How long an unchanged value waits before it is kept again.
   */
  public constructor(heartbeatMs: number = TELEMETRY_HEARTBEAT_MS) {
    this.#heartbeatMs = heartbeatMs;
  }

  /**
   * Says whether a reading should be kept, and remembers it when it is.
   *
   * A reading older than the last one kept - an adapter replaying its buffer - is kept when its
   * value differs and dropped when it does not, and never moves the heartbeat backwards.
   *
   * @param entityId - Whose reading.
   * @param value - The measurement.
   * @param observedAt - When it was taken.
   * @returns True when it belongs on the stream.
   */
  public take(entityId: EntityId, value: number, observedAt: Date): boolean {
    if (!Number.isFinite(value)) {
      return false;
    }

    const at = observedAt.getTime();
    const last = this.#kept.get(entityId);

    if (last?.value === value && at - last.at < this.#heartbeatMs) {
      return false;
    }

    if (last === undefined || at >= last.at) {
      this.#kept.set(entityId, { value, at });
    }

    return true;
  }

  /**
   * Forgets an entity, so its next reading is kept whatever it says.
   *
   * @param entityId - Which one.
   */
  public forget(entityId: EntityId): void {
    this.#kept.delete(entityId);
  }
}
