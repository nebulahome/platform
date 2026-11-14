/**
 * Draft row ids: removing a row in the middle leaves the rows after it their own keys.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useRowIds } from '@/lib/block-ids';

describe('useRowIds', () => {
  it('keeps the keys of the rows after a removed one', () => {
    const { result } = renderHook(() => useRowIds(3));
    const third = result.current.keyOf(2);

    act(() => {
      result.current.removed(1);
    });

    expect(result.current.keyOf(1)).toBe(third);

    act(() => {
      result.current.added();
    });

    expect(new Set([0, 1, 2].map((index) => result.current.keyOf(index))).size).toBe(3);
  });
});
