import { describe, expect, it, vi } from 'vitest';

import { backoffDelayMs, delay } from './backoff.js';

const schedule = { baseMs: 100, maxMs: 1000 };

describe('backoffDelayMs', () => {
  it('doubles per attempt', () => {
    const noJitter = { ...schedule, jitter: 0 };

    expect(backoffDelayMs(1, noJitter)).toBe(100);
    expect(backoffDelayMs(2, noJitter)).toBe(200);
    expect(backoffDelayMs(3, noJitter)).toBe(400);
  });

  it('stops at the ceiling', () => {
    expect(backoffDelayMs(20, { ...schedule, jitter: 0 })).toBe(1000);
  });

  it('spreads retries across a window rather than firing them together', () => {
    // The property that matters when every service on the host lost the broker at once.
    const earliest = backoffDelayMs(3, schedule, () => 0);
    const latest = backoffDelayMs(3, schedule, () => 0.999);

    expect(earliest).toBe(200);
    expect(latest).toBeGreaterThan(earliest);
    expect(latest).toBeLessThanOrEqual(400);
  });

  it('never returns more than the ceiling, jitter included', () => {
    expect(backoffDelayMs(50, schedule, () => 0.999)).toBeLessThanOrEqual(1000);
  });
});

describe('delay', () => {
  it('waits', async () => {
    vi.useFakeTimers();

    try {
      const controller = new AbortController();
      const waited = vi.fn();
      const pending = delay(1000, controller.signal).then(waited);

      await vi.advanceTimersByTimeAsync(999);
      expect(waited).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(waited).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up as soon as the caller aborts', async () => {
    // A shutdown arriving in the middle of a thirty-second reconnect wait must not have to sit
    // out the remaining twenty-nine seconds.
    const controller = new AbortController();
    const pending = delay(30_000, controller.signal);

    controller.abort();

    await expect(pending).resolves.toBeUndefined();
  });

  it('returns immediately when the signal has already aborted', async () => {
    await expect(delay(30_000, AbortSignal.abort())).resolves.toBeUndefined();
  });
});
