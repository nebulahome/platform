/**
 * The app windows that are open (docs: app windows, 4.1): an integration container's page
 * (ingress) in a window over the pages. At most five, hidden ones included; a sixth waits in
 * `pending` while the person picks the one to close. One window a container: opening a page that
 * is already open brings it back instead.
 *
 * Where each page last sat is remembered in this browser, so it opens there again; the first time
 * it opens Large. The windows open in this tab are remembered for the tab, so a reload brings them
 * back hidden, as tabs, their pages loaded only when brought out.
 */
import { create } from 'zustand';

import { SPOTS, type Rect, type Spot } from '@/app-windows/geometry';

/** The most pages open at once, hidden ones included. */
export const MAX_WINDOWS = 5;

/** Where the places are kept: `{ [container name]: Place }`. */
const PLACES_KEY = 'nebula.appWindows.places';

/** Where the open windows of this tab are kept, for a reload. */
const OPEN_KEY = 'nebula.appWindows.open';

/** A container's page to open. */
export type AppPage = {
  /** The container's name: the window's id. */
  readonly name: string;

  /** The integration it belongs to. */
  readonly vendorId: string;

  /** The integration's name, for the tab and the dialog. */
  readonly title: string;

  /** The page's address, `/api/ingress/<name>/`. */
  readonly path: string;
};

/** Where a window sits: in a spot, or free at a rectangle of its own. */
export type Place = { readonly spot: Spot } | { readonly free: Rect };

/** An open window. */
export type AppWindow = AppPage & {
  /** Where it sits. */
  readonly place: Place;

  /** Where it sat before a double-click sent it Large; the next one puts it back. */
  readonly previous: Place | null;

  /** Whether it is hidden, as a tab on the right edge. */
  readonly isHidden: boolean;

  /** Whether its page has been loaded: not yet for a window brought back hidden by a reload. */
  readonly isLoaded: boolean;

  /** When it was last used, for the dialog's order. */
  readonly usedAt: number;
};

/** The windows, and what changes them. */
type AppWindowsState = {
  /** The open windows in drawing order: the last one is in front. */
  readonly windows: readonly AppWindow[];

  /** A page waiting for the person to close one, when five are open. */
  readonly pending: AppPage | null;

  /** Opens a page: brings it back when it is open, asks for room when five are. */
  readonly open: (page: AppPage) => void;

  /** Closes a window to make room, and opens the page waiting. */
  readonly replace: (name: string) => void;

  /** Gives up the page waiting. */
  readonly cancel: () => void;

  /** Closes a window: its page goes. */
  readonly close: (name: string) => void;

  /** Hides a window as a tab; its page keeps running. */
  readonly hide: (name: string) => void;

  /** Brings a window back, in front. */
  readonly show: (name: string) => void;

  /** Puts a window in front. */
  readonly focus: (name: string) => void;

  /** Moves a window, and remembers where. */
  readonly place: (name: string, place: Place, previous?: Place | null) => void;

  /** Closes every window: on sign-out. */
  readonly clear: () => void;
};

/**
 * Reads a remembered place.
 *
 * @param value - What was stored.
 * @returns The place, or null when it is not one.
 */
export function readPlace(value: unknown): Place | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  if ('spot' in value && SPOTS.includes(value.spot as Spot)) {
    return { spot: value.spot as Spot };
  }

  if ('free' in value && typeof value.free === 'object' && value.free !== null) {
    const { x, y, width, height } = value.free as Record<string, unknown>;
    const numbers = [x, y, width, height];

    if (numbers.every((each) => typeof each === 'number' && Number.isFinite(each))) {
      return {
        free: { x: x as number, y: y as number, width: width as number, height: height as number },
      };
    }
  }

  return null;
}

/**
 * Reads a JSON value from a storage, without failing.
 *
 * @param storage - Which storage.
 * @param key - Its key.
 * @returns The value; undefined when there is none or it cannot be read.
 */
function readJson(storage: () => Storage, key: string): unknown {
  try {
    return JSON.parse(storage().getItem(key) ?? 'null') as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Writes a JSON value to a storage, without failing.
 *
 * @param storage - Which storage.
 * @param key - Its key.
 * @param value - The value.
 */
function writeJson(storage: () => Storage, key: string, value: unknown): void {
  try {
    storage().setItem(key, JSON.stringify(value));
  } catch {
    // A browser that keeps nothing opens every page Large and forgets the windows on a reload.
  }
}

/**
 * Reads the places remembered.
 *
 * @returns Them, by container name.
 */
function readPlaces(): Record<string, Place> {
  const stored = readJson(() => globalThis.localStorage, PLACES_KEY);
  const places: Record<string, Place> = {};

  if (typeof stored === 'object' && stored !== null) {
    for (const [name, value] of Object.entries(stored)) {
      const place = readPlace(value);

      if (place !== null) {
        places[name] = place;
      }
    }
  }

  return places;
}

/**
 * Reads the windows this tab had open before a reload: hidden, not loaded.
 *
 * @param stored - What was stored.
 * @param now - The time to mark them used at.
 * @returns The windows; none when what was stored is not ours.
 */
export function readOpen(stored: unknown, now: number): AppWindow[] {
  if (!Array.isArray(stored)) {
    return [];
  }

  const windows: AppWindow[] = [];

  for (const entry of stored.slice(0, MAX_WINDOWS) as unknown[]) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }

    const { name, vendorId, title, path, place } = entry as Record<string, unknown>;
    const read = readPlace(place);

    if (
      typeof name === 'string' &&
      typeof vendorId === 'string' &&
      typeof title === 'string' &&
      typeof path === 'string' &&
      path.startsWith('/api/ingress/') &&
      read !== null &&
      !windows.some((each) => each.name === name)
    ) {
      windows.push({
        name,
        vendorId,
        title,
        path,
        place: read,
        previous: null,
        isHidden: true,
        isLoaded: false,
        usedAt: now,
      });
    }
  }

  return windows;
}

/**
 * A new window for a page, where the page last sat, or Large.
 *
 * @param page - The page.
 * @returns The window, in use now.
 */
function windowFor(page: AppPage): AppWindow {
  return {
    ...page,
    place: readPlaces()[page.name] ?? { spot: 'large' },
    previous: null,
    isHidden: false,
    isLoaded: true,
    usedAt: Date.now(),
  };
}

/**
 * Changes one window, leaving the others as they are.
 *
 * @param windows - The windows.
 * @param name - Which one.
 * @param change - What changes.
 * @returns The windows.
 */
function update(
  windows: readonly AppWindow[],
  name: string,
  change: Partial<AppWindow>,
): readonly AppWindow[] {
  return windows.map((each) => (each.name === name ? { ...each, ...change } : each));
}

/**
 * Moves a window to the front, marked used now.
 *
 * @param windows - The windows.
 * @param name - Which one.
 * @param change - Anything else that changes with it.
 * @returns The windows.
 */
function toFront(
  windows: readonly AppWindow[],
  name: string,
  change: Partial<AppWindow> = {},
): readonly AppWindow[] {
  const found = windows.find((each) => each.name === name);

  return found === undefined
    ? windows
    : [...windows.filter((each) => each !== found), { ...found, ...change, usedAt: Date.now() }];
}

export const useAppWindows = create<AppWindowsState>((set, get) => ({
  windows: readOpen(
    readJson(() => globalThis.sessionStorage, OPEN_KEY),
    Date.now(),
  ),
  pending: null,

  /**
   * Opens a page, or brings it back.
   *
   * @param page - The page.
   */
  open: (page) => {
    const { windows } = get();

    if (windows.some((each) => each.name === page.name)) {
      set({ windows: toFront(windows, page.name, { isHidden: false, isLoaded: true }) });
    } else if (windows.length >= MAX_WINDOWS) {
      set({ pending: page });
    } else {
      set({ windows: [...windows, windowFor(page)] });
    }
  },

  /**
   * Closes a window and opens the page waiting.
   *
   * @param name - The window's container name.
   */
  replace: (name) => {
    const { windows, pending } = get();

    if (pending !== null) {
      set({
        windows: [...windows.filter((each) => each.name !== name), windowFor(pending)],
        pending: null,
      });
    }
  },

  /** Gives up the page waiting. */
  cancel: () => {
    set({ pending: null });
  },

  /**
   * Closes a window.
   *
   * @param name - The window's container name.
   */
  close: (name) => {
    set({ windows: get().windows.filter((each) => each.name !== name) });
  },

  /**
   * Hides a window as a tab.
   *
   * @param name - The window's container name.
   */
  hide: (name) => {
    set({ windows: update(get().windows, name, { isHidden: true }) });
  },

  /**
   * Brings a window back, in front.
   *
   * @param name - The window's container name.
   */
  show: (name) => {
    set({ windows: toFront(get().windows, name, { isHidden: false, isLoaded: true }) });
  },

  /**
   * Puts a window in front.
   *
   * @param name - The window's container name.
   */
  focus: (name) => {
    const { windows } = get();

    if (windows.at(-1)?.name !== name) {
      set({ windows: toFront(windows, name) });
    }
  },

  /**
   * Moves a window, and remembers where.
   *
   * @param name - The window's container name.
   * @param place - Where it goes.
   * @param previous - Where it was, for a double-click to put it back; kept when absent.
   */
  place: (name, place, previous) => {
    set({
      windows: update(
        get().windows,
        name,
        previous === undefined ? { place } : { place, previous },
      ),
    });
    writeJson(() => globalThis.localStorage, PLACES_KEY, { ...readPlaces(), [name]: place });
  },

  /** Closes every window. */
  clear: () => {
    set({ windows: [], pending: null });
  },
}));

// The windows open in this tab, for a reload: what each page is and where it sits.
useAppWindows.subscribe((state, previous) => {
  if (state.windows !== previous.windows) {
    writeJson(
      () => globalThis.sessionStorage,
      OPEN_KEY,
      state.windows.map(({ name, vendorId, title, path, place }) => ({
        name,
        vendorId,
        title,
        path,
        place,
      })),
    );
  }
});
