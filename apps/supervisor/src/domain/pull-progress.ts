/**
 * How far a pull has got, out of the lines Docker streams while it pulls.
 *
 * Each layer reports on its own - `Downloading` with the bytes so far and its size, then
 * `Extracting`, then `Pull complete` - so the whole is the bytes of every layer seen so far over
 * their sizes. A layer already on the machine never reports a size and is not counted. Docker
 * names every layer at the start but says a layer's size only once it starts downloading it, so a
 * layer still waiting counts as one of average size, and the figure never goes back: a large layer
 * starting late would otherwise pull the bar down. It stays below a hundred until the pull has
 * ended.
 */
import type { PullProgress } from '../docker/engine-schemas.js';

/** One layer's bytes. */
type Layer = { current: number; total: number; isDone: boolean };

/** Follows one pull. */
export class PullProgressTracker {
  readonly #layers = new Map<string, Layer>();
  #highest: number | null = null;

  /**
   * Takes in one line of progress.
   *
   * @param progress - The line.
   */
  public add(progress: PullProgress): void {
    // `Pulling from <repository>` carries the tag as its id: it is no layer.
    if (progress.id === undefined || progress.status?.startsWith('Pulling from') === true) {
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
    let sized = 0;
    let waiting = 0;

    for (const layer of this.#layers.values()) {
      if (layer.total > 0) {
        current += layer.current;
        total += layer.total;
        sized += 1;
      } else if (!layer.isDone) {
        waiting += 1;
      }
    }

    if (total === 0) {
      return this.#highest;
    }

    const whole = total + (waiting * total) / sized;

    this.#highest = Math.max(this.#highest ?? 0, Math.min(99, Math.floor((current / whole) * 100)));

    return this.#highest;
  }

  /**
   * How big the layers that said their size are.
   *
   * @returns Their bytes, or null before any did.
   */
  public bytes(): number | null {
    let total = 0;

    for (const layer of this.#layers.values()) {
      total += layer.total;
    }

    return total === 0 ? null : total;
  }
}
