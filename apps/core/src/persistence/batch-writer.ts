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
import type { PlatformLogger } from '@nebulahome/logging';

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

  /**
   * The most rows one `write` call is given. postgres.js refuses a statement with 65,534
   * parameters or more, so rows times columns has to stay under that; the default leaves room
   * for 32 columns.
   */
  readonly maxRowsPerWrite?: number;
};

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_FLUSH_INTERVAL_MS = 1000;
const DEFAULT_MAX_BUFFERED_ROWS = 50_000;
const DEFAULT_MAX_ROWS_PER_WRITE = 2000;

/** How many times in a row the database may refuse a chunk's data before its rows are tried one by one. */
const REFUSED_ATTEMPTS_BEFORE_ISOLATING = 3;

/** How often a full buffer says it is dropping rows, at most, unless the count grows tenfold. */
const FULL_WARNING_INTERVAL_MS = 30_000;

/**
 * How long after a failed write a full batch waits for the timer instead of flushing at once: a
 * database that is down would otherwise be tried, and logged, on every row added.
 */
const EARLY_FLUSH_PAUSE_MS = 1000;

/**
 * Whether an error is the database refusing the rows themselves rather than failing to take them.
 *
 * Only SQLSTATE classes 22 (data exception, such as a `\u0000` inside jsonb) and 23 (integrity
 * violation, such as a foreign key to a deleted entity) count: those fail the same way on every
 * retry. Anything else - a lost connection, a timeout, a full disk - is worth waiting out, so
 * its rows are never dropped. Drizzle wraps the driver's error, hence the walk down `cause`.
 *
 * @param error - What `write` rejected with.
 * @returns True when retrying the same rows cannot succeed.
 */
export function isRefusedRowsError(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const code: unknown = (current as { readonly code?: unknown }).code;

    if (typeof code === 'string' && /^2[23][0-9A-Z]{3}$/.test(code)) {
      return true;
    }

    current = (current as { readonly cause?: unknown }).cause;
  }

  return false;
}

/** Buffers rows and writes them in batches. */
export class BatchWriter<TRow> {
  readonly #options: Required<BatchWriterOptions<TRow>>;

  #buffer: TRow[] = [];
  #timer: NodeJS.Timeout | undefined;
  #flushing: Promise<void> | undefined;
  #isRunning = false;
  #droppedRows = 0;
  #refusedAttempts = 0;
  #lastFullWarningAt = Number.NEGATIVE_INFINITY;
  #droppedSinceWarning = 0;
  #lastFailureAt = Number.NEGATIVE_INFINITY;

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
      maxRowsPerWrite: options.maxRowsPerWrite ?? DEFAULT_MAX_ROWS_PER_WRITE,
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
   * Buffers one row, flushing early once the batch is full - unless a write failed a moment ago,
   * when the timer's flush is soon enough.
   *
   * @param row - The row to write.
   */
  public add(row: TRow): void {
    this.#buffer.push(row);

    if (this.#buffer.length > this.#options.maxBufferedRows) {
      const overflow = this.#buffer.length - this.#options.maxBufferedRows;
      const droppedBefore = this.#droppedRows;

      this.#buffer.splice(0, overflow);
      this.#droppedRows += overflow;
      this.#droppedSinceWarning += overflow;
      this.#warnFull(droppedBefore);
    }

    if (
      this.#buffer.length >= this.#options.batchSize &&
      Date.now() - this.#lastFailureAt >= EARLY_FLUSH_PAUSE_MS
    ) {
      // Deliberately not awaited: `add` is called from the state ingest path, and making the
      // hottest path in the system wait on a database round trip is the thing this class exists
      // to avoid. Failures are reported inside `flush`.
      void this.flush();
    }
  }

  /**
   * Drops the buffered rows a predicate names.
   *
   * For rows whose target no longer exists: a row for a deleted entity would fail every flush,
   * and a failed batch is kept and tried again, so what was buffered for the entity has to go
   * in the same step as the entity's rows. Not counted as dropped - nothing was lost.
   *
   * @param predicate - Whether a row is one to drop.
   * @returns How many were dropped.
   */
  public discard(predicate: (row: TRow) => boolean): number {
    const kept = this.#buffer.filter((row) => !predicate(row));
    const dropped = this.#buffer.length - kept.length;

    this.#buffer = kept;

    return dropped;
  }

  /**
   * Writes whatever is buffered, in chunks of at most `maxRowsPerWrite` rows.
   *
   * Rows are returned to the front of the buffer if the write fails, so a database that was
   * briefly unreachable costs a delay rather than a hole in the history. A flush already under
   * way is joined rather than doubled.
   *
   * @returns A promise that settles once the attempt is over, successful or not.
   */
  public flush(): Promise<void> {
    if (this.#flushing !== undefined) {
      return this.#flushing;
    }

    if (this.#buffer.length === 0) {
      return Promise.resolve();
    }

    this.#flushing = this.#drain().finally(() => {
      this.#flushing = undefined;
    });

    return this.#flushing;
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

    // The first call may only join a flush that took its rows before the latest were added.
    await this.flush();
    await this.flush();
  }

  /**
   * Writes the rows buffered when it starts, chunk by chunk, stopping at the first failure.
   *
   * @returns A promise that settles once every chunk is written or one is put back.
   */
  async #drain(): Promise<void> {
    let remaining = this.#buffer.length;

    while (remaining > 0 && this.#buffer.length > 0) {
      const chunk = this.#buffer.splice(0, Math.min(remaining, this.#options.maxRowsPerWrite));

      remaining -= chunk.length;

      // eslint-disable-next-line no-await-in-loop -- in order: a failed chunk stops the ones after it
      const unwritten = await this.#writeChunk(chunk);

      if (unwritten.length > 0) {
        this.#buffer.unshift(...unwritten);

        return;
      }
    }
  }

  /**
   * Writes one chunk, falling back to one row at a time once the database has refused its data
   * a few times in a row, so one bad row cannot hold back every row after it.
   *
   * @param chunk - The rows, oldest first.
   * @returns The rows still to write, empty when the chunk is done.
   */
  async #writeChunk(chunk: readonly TRow[]): Promise<readonly TRow[]> {
    try {
      await this.#options.write(chunk);
      this.#refusedAttempts = 0;
      this.#lastFailureAt = Number.NEGATIVE_INFINITY;

      return [];
    } catch (error: unknown) {
      this.#refusedAttempts = isRefusedRowsError(error) ? this.#refusedAttempts + 1 : 0;

      if (this.#refusedAttempts < REFUSED_ATTEMPTS_BEFORE_ISOLATING) {
        this.#lastFailureAt = Date.now();
        this.#options.logger.error(
          { writer: this.#options.name, rows: chunk.length, err: error },
          'Could not write a batch, keeping it buffered',
        );

        return chunk;
      }

      this.#refusedAttempts = 0;

      return this.#writeOneByOne(chunk);
    }
  }

  /**
   * Writes a refused chunk row by row and drops the rows the database still refuses.
   *
   * @param chunk - The rows, oldest first.
   * @returns The rows still to write when the database stopped answering part way, else empty.
   */
  async #writeOneByOne(chunk: readonly TRow[]): Promise<readonly TRow[]> {
    let refused = 0;
    let unwritten: readonly TRow[] = [];

    for (const [index, row] of chunk.entries()) {
      try {
        // eslint-disable-next-line no-await-in-loop -- one at a time, so a lost connection stops it
        await this.#options.write([row]);
      } catch (error: unknown) {
        if (!isRefusedRowsError(error)) {
          unwritten = chunk.slice(index);
          this.#lastFailureAt = Date.now();
          this.#options.logger.error(
            { writer: this.#options.name, rows: unwritten.length, err: error },
            'Could not write a batch, keeping it buffered',
          );
          break;
        }

        refused += 1;
        this.#options.logger.debug({ writer: this.#options.name, err: error }, 'Row refused');
      }
    }

    if (refused > 0) {
      this.#droppedRows += refused;
      this.#options.logger.error(
        { writer: this.#options.name, refused, dropped: this.#droppedRows },
        'The database refused some rows, dropping them',
      );
    }

    return unwritten;
  }

  /**
   * Says the buffer is full and dropping rows: the first time, then once every
   * {@link FULL_WARNING_INTERVAL_MS} or when the count passes 10, 100, 1000 rows, so a database
   * that is down for hours does not log a line per row.
   *
   * @param droppedBefore - The rows dropped before this row's overflow.
   */
  #warnFull(droppedBefore: number): void {
    const now = Date.now();
    // One digit more is ten times as many.
    const hasGrownTenfold = String(this.#droppedRows).length > String(droppedBefore).length;

    if (!hasGrownTenfold && now - this.#lastFullWarningAt < FULL_WARNING_INTERVAL_MS) {
      return;
    }

    this.#options.logger.warn(
      {
        writer: this.#options.name,
        dropped: this.#droppedRows,
        droppedSinceLastWarning: this.#droppedSinceWarning,
      },
      'Buffer is full, dropping the oldest rows',
    );
    this.#lastFullWarningAt = now;
    this.#droppedSinceWarning = 0;
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
