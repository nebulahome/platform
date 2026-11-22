import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { createLogger, type PlatformLogger } from '@nebulahome/logging';

import { BatchWriter } from './batch-writer.js';

/**
 * A logger that writes nowhere.
 *
 * @returns A logger bound to a discarding stream.
 */
function silentLogger(): PlatformLogger {
  return createLogger(
    { service: 'test', version: '0.0.0', level: 'fatal' },
    new Writable({
      write(chunk, encoding, callback): void {
        callback();
      },
    }),
  );
}

describe('BatchWriter', () => {
  it('writes as soon as the batch is full', async () => {
    const written: number[][] = [];
    const writer = new BatchWriter<number>({
      name: 'test',
      logger: silentLogger(),
      batchSize: 3,
      write: async (rows) => {
        written.push([...rows]);

        await Promise.resolve();
      },
    });

    writer.add(1);
    writer.add(2);
    expect(written).toStrictEqual([]);

    writer.add(3);
    await vi.waitFor(() => {
      expect(written).toStrictEqual([[1, 2, 3]]);
    });
  });

  it('keeps rows buffered when the write fails', async () => {
    // A database that was briefly unreachable should cost a delay, not a hole in the history.
    let attempts = 0;
    const writer = new BatchWriter<number>({
      name: 'test',
      logger: silentLogger(),
      batchSize: 2,
      write: async (rows) => {
        attempts += 1;

        if (attempts === 1) {
          await Promise.resolve();
          throw new Error('database is down');
        }

        expect([...rows]).toStrictEqual([1, 2]);
      },
    });

    writer.add(1);
    writer.add(2);

    // Wait for the rows to be back in the buffer, not merely for the write to have been
    // attempted: the restore happens after the rejection, one microtask later.
    await vi.waitFor(() => {
      expect(writer.pending).toBe(2);
    });
    expect(attempts).toBe(1);

    await writer.flush();
    expect(attempts).toBe(2);
    expect(writer.pending).toBe(0);
  });

  it('drops the oldest rows rather than the process', () => {
    // An unbounded buffer behind an unreachable database takes the live state of the house down
    // with it, which is a worse failure than losing history rows.
    const writer = new BatchWriter<number>({
      name: 'test',
      logger: silentLogger(),
      batchSize: 1000,
      maxBufferedRows: 3,
      write: async () => {
        await Promise.resolve();
      },
    });

    for (const row of [1, 2, 3, 4, 5]) {
      writer.add(row);
    }

    expect(writer.pending).toBe(3);
    expect(writer.dropped).toBe(2);
  });

  it('says it is dropping rows now and then rather than on every row', () => {
    vi.useFakeTimers();

    try {
      const logger = silentLogger();
      const warn = vi.spyOn(logger, 'warn');
      const writer = new BatchWriter<number>({
        name: 'test',
        logger,
        batchSize: 1000,
        maxBufferedRows: 3,
        write: async () => {
          await Promise.resolve();
        },
      });

      for (let row = 0; row < 8; row += 1) {
        writer.add(row);
      }

      // Five dropped, said once: the first.
      expect(writer.dropped).toBe(5);
      expect(warn).toHaveBeenCalledOnce();

      for (let row = 0; row < 5; row += 1) {
        writer.add(row);
      }

      // The tenth dropped row is said at once.
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenLastCalledWith(
        { writer: 'test', dropped: 10, droppedSinceLastWarning: 9 },
        'Buffer is full, dropping the oldest rows',
      );

      writer.add(0);
      expect(warn).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(30_000);
      writer.add(0);
      expect(warn).toHaveBeenCalledTimes(3);
      expect(writer.dropped).toBe(12);
      expect(writer.pending).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits a moment after a failed write before flushing early again, then resumes', async () => {
    vi.useFakeTimers();

    let isDown = true;
    const written: number[][] = [];
    const write = vi.fn(async (rows: readonly number[]) => {
      await Promise.resolve();

      if (isDown) {
        throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      }

      written.push([...rows]);
    });
    const writer = new BatchWriter<number>({
      name: 'test',
      logger: silentLogger(),
      batchSize: 2,
      flushIntervalMs: 1000,
      write,
    });

    try {
      writer.start();
      writer.add(1);
      writer.add(2);
      await vi.advanceTimersByTimeAsync(0);
      expect(write).toHaveBeenCalledOnce();

      // A full batch right after the failure waits for the timer.
      writer.add(3);
      writer.add(4);
      await vi.advanceTimersByTimeAsync(0);
      expect(write).toHaveBeenCalledOnce();
      expect(writer.pending).toBe(4);

      // The database is back: the timer's flush writes everything, and nothing was lost.
      isDown = false;
      await vi.advanceTimersByTimeAsync(1000);
      expect(written).toStrictEqual([[1, 2, 3, 4]]);
      expect(writer.pending).toBe(0);

      // A full batch flushes at once again.
      writer.add(5);
      writer.add(6);
      await vi.advanceTimersByTimeAsync(0);
      expect(written).toStrictEqual([
        [1, 2, 3, 4],
        [5, 6],
      ]);
    } finally {
      await writer.stop();
      vi.useRealTimers();
    }
  });

  it('drops the rows a caller names, for a target that no longer exists', () => {
    // A row for a deleted entity would fail every flush - the writer keeps a failed batch and
    // tries again - so what is buffered for it has to go with the rows it was for.
    const writer = new BatchWriter<number>({
      name: 'test',
      logger: silentLogger(),
      batchSize: 1000,
      write: async () => {
        await Promise.resolve();
      },
    });

    for (const row of [1, 2, 3, 4]) {
      writer.add(row);
    }

    expect(writer.discard((row) => row % 2 === 0)).toBe(2);
    expect(writer.pending).toBe(2);
    expect(writer.dropped).toBe(0);
  });

  it('writes what is left on shutdown', async () => {
    const written: number[][] = [];
    const writer = new BatchWriter<number>({
      name: 'test',
      logger: silentLogger(),
      batchSize: 1000,
      write: async (rows) => {
        written.push([...rows]);

        await Promise.resolve();
      },
    });

    writer.start();
    writer.add(1);

    await writer.stop();

    expect(written).toStrictEqual([[1]]);
  });

  it('drains a backlog larger than one statement can carry', async () => {
    // postgres.js refuses 65,534 parameters or more; a 9-column history row reaches that at
    // 7,282 rows, and a writer that retried the whole backlog would never write again.
    const written: number[] = [];
    const writer = new BatchWriter<number>({
      name: 'test',
      logger: silentLogger(),
      batchSize: 100_000,
      write: async (rows) => {
        await Promise.resolve();

        if (rows.length * 9 >= 65_534) {
          throw new Error('MAX_PARAMETERS_EXCEEDED');
        }

        written.push(...rows);
      },
    });

    for (let row = 0; row < 8000; row += 1) {
      writer.add(row);
    }

    await writer.flush();

    expect(writer.pending).toBe(0);
    expect(written).toHaveLength(8000);
    expect(written[7999]).toBe(7999);
  });

  it('drops a row the database keeps refusing instead of holding back the rest', async () => {
    const written: number[] = [];
    const refusal = Object.assign(new Error('insert failed'), {
      cause: Object.assign(new Error('unsupported Unicode escape sequence'), { code: '22P05' }),
    });
    const writer = new BatchWriter<number>({
      name: 'test',
      logger: silentLogger(),
      batchSize: 1000,
      write: async (rows) => {
        await Promise.resolve();

        if (rows.includes(2)) {
          throw refusal;
        }

        written.push(...rows);
      },
    });

    for (const row of [1, 2, 3]) {
      writer.add(row);
    }

    await writer.flush();
    await writer.flush();
    expect(writer.pending).toBe(3);

    await writer.flush();
    expect(writer.pending).toBe(0);
    expect(written).toStrictEqual([1, 3]);
    expect(writer.dropped).toBe(1);
  });

  it('never drops rows over a connection failure', async () => {
    const writer = new BatchWriter<number>({
      name: 'test',
      logger: silentLogger(),
      batchSize: 1000,
      write: async () => {
        await Promise.resolve();
        throw Object.assign(new Error('write CONNECTION_CLOSED'), { code: 'CONNECTION_CLOSED' });
      },
    });

    writer.add(1);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await writer.flush();
    }

    expect(writer.pending).toBe(1);
    expect(writer.dropped).toBe(0);
  });

  it('writes on shutdown the rows added while a flush was in flight', async () => {
    const written: number[][] = [];
    let release: () => void = () => undefined;
    const writer = new BatchWriter<number>({
      name: 'test',
      logger: silentLogger(),
      batchSize: 1000,
      write: async (rows) => {
        if (written.length === 0) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }

        written.push([...rows]);
      },
    });

    writer.add(1);
    void writer.flush();
    writer.add(2);

    const stopped = writer.stop();

    release();
    await stopped;

    expect(written).toStrictEqual([[1], [2]]);
  });

  it('does nothing when there is nothing to write', async () => {
    const write = vi.fn(async () => {
      await Promise.resolve();
    });

    const writer = new BatchWriter<number>({ name: 'test', logger: silentLogger(), write });

    await writer.flush();

    expect(write).not.toHaveBeenCalled();
  });

  it('flushes on its own timer', async () => {
    const written: number[][] = [];
    const writer = new BatchWriter<number>({
      name: 'test',
      logger: silentLogger(),
      batchSize: 1000,
      flushIntervalMs: 20,
      write: async (rows) => {
        written.push([...rows]);

        await Promise.resolve();
      },
    });

    writer.start();
    writer.add(7);

    try {
      await vi.waitFor(() => {
        expect(written).toStrictEqual([[7]]);
      });
    } finally {
      await writer.stop();
    }
  });
});
