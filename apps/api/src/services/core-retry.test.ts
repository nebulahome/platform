/**
 * Asking `core` again: the first try awaited, the rest in the background, none after shutdown.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { askCore, stopCoreRetries } from './core-retry.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('askCore', () => {
  it('answers after the first try and asks again in the background until core hears', async () => {
    vi.useFakeTimers();

    const ask = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue(undefined);
    const warn = vi.fn();

    await askCore(ask, warn);
    expect(ask).toHaveBeenCalledTimes(1);

    await vi.runAllTimersAsync();
    expect(ask).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(2);

    // Shutdown drops what is waiting, and nothing is asked again after it.
    const failing = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('closed'));

    await askCore(failing, warn);
    stopCoreRetries();
    await vi.runAllTimersAsync();
    expect(failing).toHaveBeenCalledTimes(1);
  });
});
