import { beforeEach, describe, expect, it } from 'vitest';

import {
  MAX_WINDOWS,
  readOpen,
  readPlace,
  useAppWindows,
  type AppPage,
} from '@/app-windows/app-windows-store';

/**
 * A container's page.
 *
 * @param index - Which.
 * @returns The page.
 */
function page(index: number): AppPage {
  return {
    name: `app-${String(index)}`,
    vendorId: `vendor-${String(index)}`,
    title: `App ${String(index)}`,
    path: `/api/ingress/app-${String(index)}/`,
  };
}

/**
 * The names of the open windows, back to front.
 *
 * @returns Them.
 */
function names(): string[] {
  return useAppWindows.getState().windows.map((each) => each.name);
}

beforeEach(() => {
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();
  useAppWindows.getState().clear();
});

describe('the app windows', () => {
  it('opens a page Large, then where it was last put', () => {
    const { open, place, close } = useAppWindows.getState();

    open(page(1));
    expect(useAppWindows.getState().windows[0]?.place).toEqual({ spot: 'large' });

    place('app-1', { spot: 'left' });
    close('app-1');
    open(page(1));
    expect(useAppWindows.getState().windows[0]?.place).toEqual({ spot: 'left' });
  });

  it('brings back a page already open instead of opening it twice', () => {
    const { open, hide } = useAppWindows.getState();

    open(page(1));
    open(page(2));
    hide('app-1');
    open(page(1));

    expect(names()).toEqual(['app-2', 'app-1']);
    expect(useAppWindows.getState().windows[1]?.isHidden).toBe(false);
  });

  it('asks for room at the sixth page, and swaps the one picked for it', () => {
    const { open } = useAppWindows.getState();

    for (let index = 1; index <= MAX_WINDOWS + 1; index += 1) {
      open(page(index));
    }

    expect(names()).toHaveLength(MAX_WINDOWS);
    expect(useAppWindows.getState().pending?.name).toBe('app-6');

    useAppWindows.getState().replace('app-2');

    expect(names()).toEqual(['app-1', 'app-3', 'app-4', 'app-5', 'app-6']);
    expect(useAppWindows.getState().pending).toBeNull();
  });

  it('puts a window in front when it is used', () => {
    const { open, focus } = useAppWindows.getState();

    open(page(1));
    open(page(2));
    focus('app-1');

    expect(names()).toEqual(['app-2', 'app-1']);
  });

  it('remembers the open windows for the tab', () => {
    useAppWindows.getState().open(page(1));

    const restored = readOpen(
      JSON.parse(globalThis.sessionStorage.getItem('nebula.appWindows.open') ?? '[]'),
      5,
    );

    expect(restored).toEqual([
      {
        ...page(1),
        place: { spot: 'large' },
        previous: null,
        isHidden: true,
        isLoaded: false,
        usedAt: 5,
      },
    ]);
  });
});

describe('reading what was stored', () => {
  it('keeps places that are places and drops the rest', () => {
    expect(readPlace({ spot: 'right' })).toEqual({ spot: 'right' });
    expect(readPlace({ free: { x: 1, y: 2, width: 3, height: 4 } })).toEqual({
      free: { x: 1, y: 2, width: 3, height: 4 },
    });
    expect(readPlace({ spot: 'middle' })).toBeNull();
    expect(readPlace({ free: { x: 'a' } })).toBeNull();
    expect(readPlace('large')).toBeNull();
  });

  it('drops windows that are not ours, twice the same, or past the limit', () => {
    const good = { ...page(1), place: { spot: 'large' } };

    expect(
      readOpen([good, good, { ...page(2), path: 'https://elsewhere/' }, 'x'], 0).map(
        (each) => each.name,
      ),
    ).toEqual(['app-1']);
    expect(
      readOpen(
        [...Array.from({ length: 8 }).keys()].map((index) => ({
          ...page(index),
          place: { spot: 'large' },
        })),
        0,
      ),
    ).toHaveLength(MAX_WINDOWS);
    expect(readOpen({ not: 'a list' }, 0)).toEqual([]);
  });
});
