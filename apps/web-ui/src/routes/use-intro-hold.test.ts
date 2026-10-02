/**
 * The opening hold.
 *
 * Two things are being pinned. The first is that the frame stays long enough to be seen at all,
 * which is the whole reason the hook exists - without it the session resolves in ten
 * milliseconds and nobody ever sees the mark.
 *
 * The second is the quantising, and it is the part that would be easy to lose in a later tidy-up
 * without noticing. The mark turns on an infinite CSS animation; removing that animation
 * mid-revolution snaps it back to zero from wherever it had reached. Releasing only on whole
 * turns is what makes it come to rest with its notch where it started.
 *
 * The last case reads the number out of the stylesheet. The period lives in two files by
 * necessity - CSS cannot import a TypeScript constant - and two copies of a number is exactly
 * the arrangement that drifts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ORBIT_PERIOD_MS, useIntroHold } from '@/routes/use-intro-hold';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useIntroHold', () => {
  it('holds from the first render, before anything has resolved', () => {
    const { result } = renderHook(() => useIntroHold(false, () => 0));

    expect(result.current).toBe(true);
  });

  it('keeps holding for as long as the thing it waits for has not finished', () => {
    const { result } = renderHook(() => useIntroHold(false, () => 0));

    act(() => {
      vi.advanceTimersByTime(ORBIT_PERIOD_MS * 5);
    });

    expect(result.current).toBe(true);
  });

  it('waits a whole turn even when the answer was already there', () => {
    let now = 0;
    const { result, rerender } = renderHook(({ done }) => useIntroHold(done, () => now), {
      initialProps: { done: true },
    });

    act(() => {
      now += ORBIT_PERIOD_MS - 1;
      vi.advanceTimersByTime(ORBIT_PERIOD_MS - 1);
    });
    rerender({ done: true });

    expect(result.current).toBe(true);

    act(() => {
      now += 1;
      vi.advanceTimersByTime(1);
    });

    expect(result.current).toBe(false);
  });

  it('finishes the turn it is in rather than stopping part-way through one', () => {
    let now = 0;
    const { result, rerender } = renderHook(({ done }) => useIntroHold(done, () => now), {
      initialProps: { done: false },
    });

    // The session took one and a half turns. Releasing now would stop the mark halfway round.
    act(() => {
      now += ORBIT_PERIOD_MS * 1.5;
      vi.advanceTimersByTime(ORBIT_PERIOD_MS * 1.5);
    });
    rerender({ done: true });

    act(() => {
      vi.advanceTimersByTime(ORBIT_PERIOD_MS * 0.49);
    });

    expect(result.current).toBe(true);

    // It releases at two whole turns, not at one and a half.
    act(() => {
      vi.advanceTimersByTime(ORBIT_PERIOD_MS * 0.51);
    });

    expect(result.current).toBe(false);
  });

  it('uses the same period the stylesheet animates on', () => {
    // Resolved from the working directory rather than from `import.meta.url`: these tests run
    // in jsdom, where a module's own url is the http one Vite served it from and not a file.
    const stylesheet = readFileSync(
      resolve(process.cwd(), '../../packages/ui/src/theme.css'),
      'utf8',
    );
    const declared = /--animate-orbit:\s*orbit\s*([\d.]+)s/.exec(stylesheet);

    expect(declared).not.toBeNull();
    expect(Number(declared?.[1]) * 1000).toBe(ORBIT_PERIOD_MS);
  });
});
