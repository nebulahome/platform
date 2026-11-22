/**
 * The clock lent to every surface: it ticks, it stops when asked, and it catches up at once when
 * asked to tick again.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useNow } from './hooks.js';

describe('useNow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-21T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the time again at its interval', () => {
    const { result } = renderHook(() => useNow(1000));
    const start = result.current;

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current - start).toBe(3000);
  });

  it('stays still while stopped, and reads at once when it ticks again', () => {
    const { result, rerender } = renderHook(({ isTicking }) => useNow(1000, isTicking), {
      initialProps: { isTicking: false },
    });
    const start = result.current;

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(start);

    rerender({ isTicking: true });
    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(result.current - start).toBe(5000);
  });
});
