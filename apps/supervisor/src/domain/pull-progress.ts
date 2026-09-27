/**
 * How far a pull has got, out of the lines Docker streams while it pulls.
 *
 * Each layer reports on its own - `Downloading` with the bytes so far and its size, then
 * `Extracting`, then `Pull complete` - so the whole is the bytes of every layer seen so far over
 * their sizes. A layer already on the machine never reports a size and is not counted. The
 * figure stays below a hundred until the pull has ended, since a layer not yet announced could
 * still be large.
 */
import type { PullProgress } from '../docker/engine-schemas.js';

/** One layer's bytes. */
type Layer = { current: number; total: number; isDone: boolean };

/** Follows one pull. */
export class PullProgressTracker {
  readonly #layers = new Map<string, Layer>();

  /**
   * Takes in one line of progress.
   *
   * @param progress - The line.
   */
  public add(progress: PullProgress): void {
    if (progress.id === undefined) {
      return;
    }

    const layer = this.#layers.get(progress.id) ?? { current: 0, total: 0, isDone: false };
    const total = progress.progressDetail?.total;
    const current = progress.progressDetail?.current;

    if (progress.status === 'Downloading' && total !== undefined && total > 0) {
      layer.total = total;
      layer.current = Math.min(current ?? 0, total);
    }

    if (
      progress.status === 'Download complete' ||
      progress.status === 'Pull complete' ||
      progress.status === 'Already exists'
    ) {
      layer.current = layer.total;
      layer.isDone = true;
    }

    this.#layers.set(progress.id, layer);
  }

  /**
   * How far the pull has got.
   *
   * @returns A whole percentage below a hundred, or null before any layer has said its size.
   */
  public percent(): number | null {
    let current = 0;
    let total = 0;

    for (const layer of this.#layers.values()) {
      current += layer.current;
      total += layer.total;
    }

    return total === 0 ? null : Math.min(99, Math.floor((current / total) * 100));
  }
}
