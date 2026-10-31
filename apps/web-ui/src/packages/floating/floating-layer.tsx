/**
 * The layer the packages' floating windows are drawn in, over the page beside the rail, and the
 * corners it hands out to them (PACKAGES_DOCS.md 6.7).
 *
 * One window a package, one corner a window. The layer remembers the corner each package's window
 * was last put in, in this browser, and gives it back the next time; when it is taken the window
 * gets the first free one of bottom-right, bottom-left, top-right, top-left. A window put in a
 * corner another holds swaps with it. A fifth window shares the bottom-right.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { CORNER_ORDER, type Corner } from '@/packages/floating/spring';

/** Where the preferred corners are kept: `{ [packageId]: corner }`. */
const STORAGE_KEY = 'nebula.floating';

/** What the layer shares with the windows drawn in it. */
export type FloatingLayerValue = {
  /** The layer's element: the windows are drawn into it, and measured against it. */
  readonly element: HTMLElement | null;

  /** The corner each window shown is in, by package. */
  readonly corners: Readonly<Record<string, Corner>>;

  /** Gives a window shown its corner: the one it prefers when free, else the first free one. */
  readonly claim: (packageId: string) => void;

  /** Gives back the corner of a window that is no longer shown. */
  readonly release: (packageId: string) => void;

  /** Puts a window in a corner, swapping with the one there, and remembers it. */
  readonly moveTo: (packageId: string, corner: Corner) => void;
};

const FloatingLayerContext = createContext<FloatingLayerValue | null>(null);

/**
 * Reads the corners remembered.
 *
 * @returns Them; none when the browser keeps nothing or what it kept is not ours.
 */
function readPreferred(): Record<string, Corner> {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY) ?? '{}');

    if (typeof parsed !== 'object' || parsed === null) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, Corner] =>
        CORNER_ORDER.includes(entry[1] as Corner),
      ),
    );
  } catch {
    return {};
  }
}

/**
 * Remembers corners.
 *
 * @param chosen - The corners of the windows just moved, by package.
 */
function writePreferred(chosen: Readonly<Record<string, Corner>>): void {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readPreferred(), ...chosen }));
  } catch {
    // A browser that keeps nothing puts the window back in its first free corner next time.
  }
}

/**
 * The layer the floating windows are drawn in.
 *
 * @returns Its value; null outside a {@link FloatingLayer}, where no window is drawn.
 */
export function useFloatingLayer(): FloatingLayerValue | null {
  return useContext(FloatingLayerContext);
}

/**
 * Renders the layer, over whatever is beside it in a `relative` box, with its children inside its
 * context: the page, and the packages' backgrounds, whose windows it draws.
 *
 * The layer is `absolute inset-0` and lets the pointer through; only the windows take it. It sits
 * above the page and below the rail's menus, the popovers, the dialogs and the toasts.
 *
 * @param props - What is drawn inside its context.
 * @param props.children - The page, the backgrounds.
 * @returns The layer.
 */
export function FloatingLayer(props: { readonly children?: ReactNode }) {
  const { children } = props;
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [corners, setCorners] = useState<Readonly<Record<string, Corner>>>({});
  // The corners as they are this moment: two windows claiming in one render see each other.
  const latest = useRef(corners);

  const commit = useCallback((next: Readonly<Record<string, Corner>>): void => {
    latest.current = next;
    setCorners(next);
  }, []);

  const claim = useCallback(
    (packageId: string): void => {
      const current = latest.current;

      if (current[packageId] !== undefined) {
        return;
      }

      const taken = new Set(Object.values(current));
      const preferred = readPreferred()[packageId];
      const corner =
        preferred !== undefined && !taken.has(preferred)
          ? preferred
          : (CORNER_ORDER.find((each) => !taken.has(each)) ?? 'bottom-right');

      commit({ ...current, [packageId]: corner });
    },
    [commit],
  );

  const release = useCallback(
    (packageId: string): void => {
      const { [packageId]: gone, ...rest } = latest.current;

      if (gone !== undefined) {
        commit(rest);
      }
    },
    [commit],
  );

  const moveTo = useCallback(
    (packageId: string, corner: Corner): void => {
      const current = latest.current;
      const from = current[packageId];

      if (from === undefined || from === corner) {
        return;
      }

      const moved: Record<string, Corner> = { [packageId]: corner };

      for (const [other, at] of Object.entries(current)) {
        if (other !== packageId && at === corner) {
          moved[other] = from;
        }
      }

      commit({ ...current, ...moved });
      writePreferred(moved);
    },
    [commit],
  );

  const value = useMemo(
    () => ({ element, corners, claim, release, moveTo }),
    [element, corners, claim, release, moveTo],
  );

  return (
    <FloatingLayerContext.Provider value={value}>
      {children}
      <div ref={setElement} className="pointer-events-none absolute inset-0 z-10" />
    </FloatingLayerContext.Provider>
  );
}
