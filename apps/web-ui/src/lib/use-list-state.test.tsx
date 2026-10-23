/**
 * A list's filter through a trip elsewhere: opened again plain, from the menu, the list comes
 * back as it was left - for as long as the page is not reloaded, and never for whoever signs in
 * next.
 */
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider, useLocation, useNavigate } from 'react-router';
import { describe, expect, it } from 'vitest';

import { forgetListStates, useListState, type ListCodec } from '@/lib/use-list-state';

/** A filter of one search. */
const CODEC: ListCodec<{ search: string }> = {
  read: (params) => ({ search: params.get('q') ?? '' }),
  write: (filter) => (filter.search === '' ? {} : { q: filter.search }),
  keys: ['q'],
};

/**
 * The hook, with the router's navigation and address beside it.
 *
 * @returns What the hook and the router give.
 */
function useListAndRouter(): {
  filter: { search: string };
  setFilter: (next: { search: string }) => void;
  navigate: ReturnType<typeof useNavigate>;
  search: string;
} {
  const [filter, setFilter] = useListState(CODEC);

  return { filter, setFilter, navigate: useNavigate(), search: useLocation().search };
}

/**
 * Renders the hook at a path, in a router that can go elsewhere.
 *
 * @param path - Where it starts.
 * @returns The render.
 */
function renderAt(
  path: string,
): ReturnType<typeof renderHook<ReturnType<typeof useListAndRouter>, unknown>> {
  return renderHook(() => useListAndRouter(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <RouterProvider
        router={createMemoryRouter(
          [
            { path: '/devices', element: children },
            { path: '/scenes', element: children },
          ],
          { initialEntries: [path] },
        )}
      />
    ),
  });
}

describe('useListState', () => {
  it('brings a list back as it was left when it is opened again plain', async () => {
    const { result } = renderAt('/devices');

    act(() => {
      result.current.setFilter({ search: 'kitchen' });
    });
    await act(async () => result.current.navigate('/scenes'));
    expect(result.current.filter.search).toBe('');

    await act(async () => result.current.navigate('/devices'));
    expect(result.current.filter.search).toBe('kitchen');
    expect(result.current.search).toBe('?q=kitchen');
  });

  it('lets a filter in the address win over the one left', async () => {
    const { result } = renderAt('/devices');

    act(() => {
      result.current.setFilter({ search: 'kitchen' });
    });
    await act(async () => result.current.navigate('/devices?q=garage'));
    expect(result.current.filter.search).toBe('garage');

    await act(async () => result.current.navigate('/scenes'));
    await act(async () => result.current.navigate('/devices'));
    expect(result.current.filter.search).toBe('garage');
  });

  it('keeps a cleared filter cleared', async () => {
    const { result } = renderAt('/devices');

    act(() => {
      result.current.setFilter({ search: 'kitchen' });
    });
    act(() => {
      result.current.setFilter({ search: '' });
    });
    await act(async () => result.current.navigate('/scenes'));
    await act(async () => result.current.navigate('/devices'));
    expect(result.current.filter.search).toBe('');
  });

  it('forgets every list on sign-out', async () => {
    const { result } = renderAt('/devices');

    act(() => {
      result.current.setFilter({ search: 'kitchen' });
    });
    await act(async () => result.current.navigate('/scenes'));
    forgetListStates();
    await act(async () => result.current.navigate('/devices'));
    expect(result.current.filter.search).toBe('');
  });
});
