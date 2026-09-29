/**
 * The last lines a package's process wrote, as its page reads them.
 *
 * A ring of a few thousand lines, each with the time it arrived and whether it was stderr - the
 * same shape a container's log has, so the one viewer reads both - and a cursor per line, so the
 * page asks only for what came after the last line it has. The cursor is the container log's:
 * seconds and nanoseconds, the nanoseconds carrying a sequence within the millisecond so that two
 * lines of one millisecond are two cursors.
 */
import { CONTAINER_LOG_MAXIMUM_CHARACTERS, type ContainerLogsReply } from '@nebula-home/contracts';

/** How many lines are kept. */
export const LOG_RING_LINES = 2000;

/** The longest line kept; the rest of a longer one is cut. */
const MAXIMUM_LINE_LENGTH = 16_384;

/** One line. */
type Line = {
  readonly at: Date;
  readonly stream: 'stdout' | 'stderr';
  readonly text: string;

  /** The cursor, as a number of nanoseconds since the epoch. */
  readonly nanos: bigint;
};

/**
 * A cursor, as the number it stands for.
 *
 * @param cursor - `seconds.nanoseconds`.
 * @returns Nanoseconds since the epoch.
 */
function nanosOf(cursor: string): bigint {
  const [seconds = '0', fraction = ''] = cursor.split('.');

  return BigInt(seconds) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0').slice(0, 9));
}

/**
 * A number of nanoseconds, as a cursor.
 *
 * @param nanos - Nanoseconds since the epoch.
 * @returns `seconds.nanoseconds`.
 */
function cursorOf(nanos: bigint): string {
  return `${String(nanos / 1_000_000_000n)}.${String(nanos % 1_000_000_000n).padStart(9, '0')}`;
}

/** The last lines one process wrote. */
export class LogRing {
  readonly #lines: Line[] = [];
  readonly #capacity: number;
  #lastNanos = 0n;

  /**
   * Makes an empty ring.
   *
   * @param capacity - How many lines it keeps.
   */
  public constructor(capacity = LOG_RING_LINES) {
    this.#capacity = capacity;
  }

  /**
   * Keeps a line.
   *
   * @param stream - Where it was written.
   * @param text - What, without its line end.
   * @param at - When; now when not said.
   */
  public push(stream: 'stdout' | 'stderr', text: string, at = new Date()): void {
    // Never before the last line, so the cursors keep their order whatever the clock does.
    const nanos = BigInt(at.getTime()) * 1_000_000n;
    const next = nanos > this.#lastNanos ? nanos : this.#lastNanos + 1n;

    this.#lastNanos = next;
    this.#lines.push({ at, stream, text: text.slice(0, MAXIMUM_LINE_LENGTH), nanos: next });

    if (this.#lines.length > this.#capacity) {
      this.#lines.splice(0, this.#lines.length - this.#capacity);
    }
  }

  /**
   * The last lines of a chunk of output, split at line ends; a chunk that does not end with one
   * is kept whole for now, since the rest of the line comes with the next.
   *
   * @param stream - Where it was written.
   * @returns What takes the chunks.
   */
  public writer(stream: 'stdout' | 'stderr'): {
    write: (chunk: string) => void;
    flush: () => void;
  } {
    let pending = '';

    return {
      /**
       * Takes a chunk.
       *
       * @param chunk - The text.
       */
      write: (chunk: string): void => {
        const parts = (pending + chunk).split(/\r?\n/);

        pending = parts.pop() ?? '';

        for (const part of parts) {
          this.push(stream, part);
        }
      },

      /** Keeps what is left when the stream ends. */
      flush: (): void => {
        if (pending !== '') {
          this.push(stream, pending);
          pending = '';
        }
      },
    };
  }

  /**
   * The last line written to stderr, for a failure's reason.
   *
   * @returns Its text, or null.
   */
  public lastError(): string | null {
    for (let index = this.#lines.length - 1; index >= 0; index -= 1) {
      const line = this.#lines[index];

      if (line?.stream === 'stderr' && line.text.trim() !== '') {
        return line.text.trim().slice(0, 512);
      }
    }

    return null;
  }

  /**
   * The newest lines, after a cursor when given, within the weight a reply may have.
   *
   * @param tail - At most how many.
   * @param since - Only after this cursor.
   * @returns The lines, oldest first, and the cursor to ask from next.
   */
  public read(tail: number, since?: string): ContainerLogsReply {
    const after = since === undefined ? undefined : nanosOf(since);
    const wanted = this.#lines.filter((line) => after === undefined || line.nanos > after);
    let kept = wanted.slice(-tail);
    let isTruncated = false;
    let weight = kept.reduce((sum, line) => sum + line.text.length, 0);

    while (weight > CONTAINER_LOG_MAXIMUM_CHARACTERS && kept.length > 1) {
      weight -= kept[0]?.text.length ?? 0;
      kept = kept.slice(1);
      isTruncated = true;
    }

    const last = kept.at(-1);

    return {
      lines: kept.map((line) => ({ at: line.at, stream: line.stream, text: line.text })),
      cursor: last === undefined ? (since ?? null) : cursorOf(last.nanos),
      isTruncated,
    };
  }
}
