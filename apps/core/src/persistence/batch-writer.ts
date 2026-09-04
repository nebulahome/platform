/**
 * Writing to a hypertable without one transaction per reading.
 *
 * A power meter publishing every second produces 86,400 rows a day on its own; a house full of
 * them, one transaction each, spends the whole day on commit overhead. So rows are buffered and
 * flushed together, on a timer or when the buffer fills, whichever comes first
 * (ARCHITECTURE.md 4.1).
 *
 * The buffer is **bounded**. If the database is unreachable, the honest failure is to drop the
 * oldest rows and say so, rather than to hold every unwritten row until the process runs out of
 * memory and takes the live state of the house down with it.
 */
import type { PlatformLogger } from '@nebula-home/logging';

/** How a batch writer is sized and paced. */
export type BatchWriterOptions<TRow> = {
  /** Names the writer in its log lines. */
  readonly name: string;

  /** Where flush failures are reported. */
  readonly logger: PlatformLogger;

  /**
   * Writes one batch.
   *
   * @param rows - The buffered rows, oldest first.
   * @returns A promise that settles once they are written.
   */
  readonly write: (rows: readonly TRow[]) => Promise<void>;

  /** Rows that trigger an immediate flush rather than waiting for the timer. */
  readonly batchSize?: number;

  /** How long a partial batch waits before being written anyway. */
  readonly flushIntervalMs?: number;

  /** Hard ceiling on the buffer, past which the oldest rows are dropped. */
  readonly maxBufferedRows?: number;
};

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_FLUSH_INTERVAL_MS = 1000;
const DEFAULT_MAX_BUFFERED_ROWS = 50_000;

/** Buffers rows and writes them in batches. */
export class BatchWriter<TRow> {
  readonly #options: Required<BatchWriterOptions<TRow>>;

  #buffer: TRow[] = [];
  #timer: NodeJS.Timeout | undefined;
  #isFlushing = false;
  #isRunning = false;
  #droppedRows = 0;

  /**
   * Builds a writer.
   *
   * @param options - Sizing, pacing and where the rows actually go.
   */
  public constructor(options: BatchWriterOptions<TRow>) {
    this.#options = {
      ...options,
      batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
      flushIntervalMs: options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
      maxBufferedRows: options.maxBufferedRows ?? DEFAULT_MAX_BUFFERED_ROWS,
    };
  }

  /**
   * How many rows are waiting to be written.
   *
   * @returns The size of the buffer.
   */
  public get pending(): number {
    return this.#buffer.length;
  }

  /**
   * How many rows have been dropped because the buffer was full.
   *
   * @returns The running total of dropped rows.
   */
  public get dropped(): number {
    return this.#droppedRows;
  }

  /** Starts the flush timer. */
  public start(): void {
    this.#isRunning = true;
    this.#schedule();
  }

  /**
   * Buffers one row, flushing early once the batch is full.
   *
   * @param row - The row to write.
   */
  public add(row: TRow): void {
    this.#buffer.push(row);

    if (this.#buffer.length > this.#options.maxBufferedRows) {
      const overflow = this.#buffer.length - this.#options.maxBufferedRows;

      this.#buffer.splice(0, overflow);
      this.#droppedRows += overflow;

      this.#options.logger.warn(
        { writer: this.#options.name, dropped: this.#droppedRows },
        'Buffer is full, dropping the oldest rows',
      );
    }

    if (this.#buffer.length >= this.#options.batchSize) {
      // Deliberately not awaited: `add` is called from the state ingest path, and making the
      // hottest path in the system wait on a database round trip is the thing this class exists
      // to avoid. Failures are reported inside `flush`.
      void this.flush();
    }
  }

  /**
   * Writes whatever is buffered.
   *
   * Rows are returned to the front of the buffer if the write fails, so a database that was
   * briefly unreachable costs a delay rather than a hole in the history.
   *
   * @returns A promise that settles once the attempt is over, successful or not.
   */
  public async flush(): Promise<void> {
    if (this.#isFlushing || this.#buffer.length === 0) {
      return;
    }

    this.#isFlushing = true;

    const batch = this.#buffer;

    this.#buffer = [];

    try {
      await this.#options.write(batch);
    } catch (error: unknown) {
      this.#buffer = [...batch, ...this.#buffer];

      this.#options.logger.error(
        { writer: this.#options.name, rows: batch.length, err: error },
        'Could not write a batch, keeping it buffered',
      );
    } finally {
      this.#isFlushing = false;
    }
  }

  /**
   * Stops the timer and writes what is left.
   *
   * @returns A promise that settles once the final flush is done.
   */
  public async stop(): Promise<void> {
    this.#isRunning = false;

    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }

    await this.flush();
  }

  /** Arms the next flush. */
  #schedule(): void {
    if (!this.#isRunning) {
      return;
    }

    this.#timer = setTimeout(() => {
      // Deliberately not awaited: the timer callback cannot be async without turning every
      // flush failure into an unhandled rejection.
      void this.flush().finally(() => {
        this.#schedule();
      });
    }, this.#options.flushIntervalMs);

    // Nothing should be kept alive by a flush timer; a process with no other work to do should
    // be free to exit.
    this.#timer.unref();
  }
}
