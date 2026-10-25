/**
 * The packages and integrations being updated now (docs/releases-and-updates.md 4), as the
 * packet-manager and `hub` announce them on `nebula.v1.event.update`.
 *
 * While a source updates, its entities say so and a command to one of them waits for the update
 * to end instead of failing in the gap (`command-dispatch.ts`). A source whose end never comes is
 * let go after a cap, so a stuck update cannot hold every command for good.
 */

/** What it needs. */
export type UpdatingSourcesOptions = {
  /** Told when a source starts or stops updating, to mark its entities. */
  readonly onChange: (source: string, isUpdating: boolean) => void;

  /** How long a source may update before it is let go. */
  readonly capMs?: number;
};

/** Does nothing: a resolver until the promise that replaces it is made. */
function noop(): void {
  // Replaced before anything calls it.
}

/** Ten minutes: an integration restarts its instances one after another. */
const CAP_MS = 10 * 60_000;

/** One source updating. */
type Updating = {
  readonly ended: Promise<void>;
  readonly end: () => void;
  timer: NodeJS.Timeout;
};

/** The sources being updated. */
export class UpdatingSources {
  readonly #options: UpdatingSourcesOptions;
  readonly #sources = new Map<string, Updating>();

  /**
   * Builds the set, empty.
   *
   * @param options - Who is told, and the cap.
   */
  public constructor(options: UpdatingSourcesOptions) {
    this.#options = options;
  }

  /**
   * A source's update started.
   *
   * @param source - The package id or the integration instance id.
   */
  public start(source: string): void {
    const known = this.#sources.get(source);
    const capMs = this.#options.capMs ?? CAP_MS;

    if (known !== undefined) {
      clearTimeout(known.timer);
      known.timer = this.#capped(source, capMs);

      return;
    }

    let end: () => void = noop;
    const ended = new Promise<void>((resolve) => {
      end = resolve;
    });

    this.#sources.set(source, { ended, end, timer: this.#capped(source, capMs) });
    this.#options.onChange(source, true);
  }

  /**
   * A source's update ended, however it went.
   *
   * @param source - The package id or the integration instance id.
   */
  public end(source: string): void {
    const known = this.#sources.get(source);

    if (known === undefined) {
      return;
    }

    clearTimeout(known.timer);
    this.#sources.delete(source);
    known.end();
    this.#options.onChange(source, false);
  }

  /**
   * Whether a source is updating now.
   *
   * @param source - The source.
   * @returns True while it is.
   */
  public isUpdating(source: string): boolean {
    return this.#sources.has(source);
  }

  /**
   * Waits for a source's update to end.
   *
   * @param source - The source.
   * @param maxMs - How long at most.
   * @param signal - Ends the wait early, as a cancelled run does.
   * @returns True when it ended (or was not updating), false when the wait ran out.
   */
  public async wait(source: string, maxMs: number, signal?: AbortSignal): Promise<boolean> {
    const known = this.#sources.get(source);

    if (known === undefined) {
      return true;
    }

    let timer: NodeJS.Timeout | undefined;
    let onAbort: () => void = noop;

    try {
      return await Promise.race([
        known.ended.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => {
            resolve(false);
          }, maxMs);
          onAbort = resolve.bind(null, false);
          signal?.addEventListener('abort', onAbort, { once: true });
        }),
      ]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Lets every source go, as at shutdown. */
  public clear(): void {
    for (const source of [...this.#sources.keys()]) {
      this.end(source);
    }
  }

  /**
   * The timer that lets a source go after the cap.
   *
   * @param source - The source.
   * @param capMs - The cap.
   * @returns The timer.
   */
  #capped(source: string, capMs: number): NodeJS.Timeout {
    const timer = setTimeout(() => {
      this.end(source);
    }, capMs);

    timer.unref();

    return timer;
  }
}
