/**
 * A value set twice in a row stays where it was last set while the first answer comes back: the
 * report that arrives while a command is still on its way answers the earlier one.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { usePendingValue } from '@/routes/library/entity/use-pending-value';

describe('a value being set', () => {
  it('stays at the last value set while a command is still on its way', () => {
    const { result, rerender } = renderHook(
      ({ reported, at, isBusy }: { reported: number; at: number; isBusy: boolean }) =>
        usePendingValue(reported, at, isBusy),
      { initialProps: { reported: 10, at: 0, isBusy: false } },
    );

    act(() => {
      result.current.sent(70);
    });

    // The first command's answer lands while the second is still on its way.
    rerender({ reported: 40, at: Date.now() + 1, isBusy: true });
    expect(result.current.shown).toBe(70);

    // The last answer lands, and nothing is on its way any more: the device has the last word.
    rerender({ reported: 70, at: Date.now() + 2, isBusy: false });
    expect(result.current.shown).toBe(70);

    rerender({ reported: 65, at: Date.now() + 3, isBusy: false });
    expect(result.current.shown).toBe(65);
  });
});
