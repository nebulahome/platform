/**
 * What this browser remembers, and what it does when it cannot remember.
 *
 * Storage is the interesting part. It can be empty, it can hold half a JSON document, it can
 * hold a value an older build wrote and this one does not recognise, and in a private window the
 * accessor itself throws. Every one of those has to end with a usable interface rather than a
 * blank page, which is what the fallback cases below are for.
 *
 * The `system` cases matter for a reason that is not obvious: the stylesheet expresses "follow
 * the operating system" as the *absence* of the attribute, inside a `:not([data-theme='dark'])`
 * media query. Writing `data-theme="system"` would satisfy that selector and appear to work.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_PREFERENCES,
  applyPreferences,
  readPreferences,
  usePreferences,
} from '@/settings/preferences';

/** Where the whole set is filed. Restated rather than exported, so a rename is caught here. */
const STORAGE_KEY = 'nebula.preferences';

beforeEach(() => {
  globalThis.localStorage.clear();
  vi.restoreAllMocks();
});

describe('readPreferences', () => {
  it('falls back to the defaults when nothing has been stored', () => {
    expect(readPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it('reads back what was stored', () => {
    globalThis.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        theme: 'dark',
        motion: 'reduced',
        startPage: '/devices',
        sidebar: 'collapsed',
      }),
    );

    expect(readPreferences()).toEqual({
      theme: 'dark',
      motion: 'reduced',
      startPage: '/devices',
      sidebar: 'collapsed',
    });
  });

  it('keeps the preferences it recognises and defaults only the one it does not', () => {
    // An older build with a fourth theme should cost that one preference, not all of them.
    globalThis.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ theme: 'sepia', startPage: '/scenes' }),
    );

    expect(readPreferences()).toEqual({
      theme: 'system',
      motion: 'system',
      startPage: '/scenes',
      sidebar: 'expanded',
    });
  });

  it('survives a stored value that is not JSON', () => {
    globalThis.localStorage.setItem(STORAGE_KEY, '{"theme":');

    expect(readPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it('survives a stored value that is JSON but not an object', () => {
    globalThis.localStorage.setItem(STORAGE_KEY, '"dark"');

    expect(readPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it('survives storage that throws rather than merely being empty', () => {
    vi.spyOn(globalThis.Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('site data is blocked');
    });

    expect(readPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it('refuses a start page that is not one of the rail destinations', () => {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify({ startPage: '/etc/passwd' }));

    expect(readPreferences().startPage).toBe(DEFAULT_PREFERENCES.startPage);
  });
});

describe('applyPreferences', () => {
  it('marks the root with a chosen theme', () => {
    const root = globalThis.document.createElement('html');

    applyPreferences(
      { theme: 'light', motion: 'reduced', startPage: '/devices', sidebar: 'expanded' },
      root,
    );

    expect(root.getAttribute('data-theme')).toBe('light');
    expect(root.getAttribute('data-motion')).toBe('reduced');
  });

  it('removes the attribute for a preference that follows the system', () => {
    const root = globalThis.document.createElement('html');

    root.setAttribute('data-theme', 'dark');
    root.setAttribute('data-motion', 'full');

    applyPreferences(
      { theme: 'system', motion: 'system', startPage: '/devices', sidebar: 'collapsed' },
      root,
    );

    expect(root.hasAttribute('data-theme')).toBe(false);
    expect(root.hasAttribute('data-motion')).toBe(false);
  });
});

describe('the preferences store', () => {
  it('stores and applies a change in the same breath', () => {
    usePreferences.getState().set({ theme: 'dark' });

    expect(usePreferences.getState().theme).toBe('dark');
    expect(globalThis.localStorage.getItem(STORAGE_KEY)).toContain('"theme":"dark"');
    expect(globalThis.document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('leaves the preferences it was not asked about alone', () => {
    usePreferences.getState().set({ theme: 'light' });
    usePreferences.getState().set({ startPage: '/scenes' });

    expect(usePreferences.getState().theme).toBe('light');
    expect(usePreferences.getState().startPage).toBe('/scenes');
  });

  it('keeps working when storage refuses the write', () => {
    vi.spyOn(globalThis.Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    // The preference applies for this tab and is forgotten on reload, which is a worse
    // experience rather than a broken one.
    expect(() => {
      usePreferences.getState().set({ theme: 'dark' });
    }).not.toThrow();

    expect(usePreferences.getState().theme).toBe('dark');
  });
});
