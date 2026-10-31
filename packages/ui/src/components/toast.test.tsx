import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearToasts, dismissToast, readToasts, toast, Toaster, useToastsShown } from './toast.js';

describe('toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearToasts();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays for its kind, and 4 s more with an action', () => {
    toast.success({ title: 'Saved' });
    toast.error({ title: 'Failed', action: { label: 'Try again', onSelect: vi.fn() } });

    expect(readToasts().shown.map((entry) => entry.duration)).toEqual([4000, 14_000]);
  });

  it('shows three and queues the rest, letting the first waiting in when one has left', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'].map((title) => toast.info({ title }));

    expect(readToasts().shown.map((entry) => entry.title)).toEqual(['a', 'b', 'c']);
    expect(readToasts().waiting.map((entry) => entry.title)).toEqual(['d', 'e']);

    dismissToast(ids[1] ?? 0);
    // Still there while it leaves.
    expect(readToasts().shown.map((entry) => entry.isOpen)).toEqual([true, false, true]);

    vi.runAllTimers();
    expect(readToasts().shown.map((entry) => entry.title)).toEqual(['a', 'c', 'd']);
    expect(readToasts().waiting.map((entry) => entry.title)).toEqual(['e']);
  });

  it('does not add the same toast twice', () => {
    const first = toast.error({ title: 'Failed', message: 'Timeout' });
    const second = toast.error({ title: 'Failed', message: 'Timeout' });

    expect(second).toBe(first);
    expect(readToasts().shown).toHaveLength(1);
  });

  it('draws the title and the message', () => {
    render(<Toaster />);
    act(() => {
      toast.error({ title: 'Couldn’t adopt it', message: 'It asks for a password.' });
    });

    expect(screen.getAllByText('Couldn’t adopt it').length).toBeGreaterThan(0);
    expect(screen.getAllByText('It asks for a password.').length).toBeGreaterThan(0);
  });

  it('says a toast is on the screen until the last one has left', () => {
    const { result } = renderHook(() => useToastsShown());

    expect(result.current).toBe(false);

    let id = 0;

    act(() => {
      id = toast.info({ title: 'Playing on Downstairs' });
    });
    expect(result.current).toBe(true);

    act(() => {
      dismissToast(id);
    });
    // Still leaving.
    expect(result.current).toBe(true);

    act(() => {
      vi.runAllTimers();
    });
    expect(result.current).toBe(false);
  });
});
