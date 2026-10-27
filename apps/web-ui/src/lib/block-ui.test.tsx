/**
 * A block's open state: a block that starts open because it needs something stays open once it
 * has it, rather than shutting under the hand that filled it in.
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useBlockUi } from './block-ui';

describe('useBlockUi', () => {
  it('keeps a block open once it is filled in', () => {
    const { result, rerender } = renderHook(
      ({ isIncomplete }: { isIncomplete: boolean }) => useBlockUi('filled-in', isIncomplete),
      { initialProps: { isIncomplete: true } },
    );

    expect(result.current.isOpen).toBe(true);
    rerender({ isIncomplete: false });
    expect(result.current.isOpen).toBe(true);
  });
});
