/**
 * The layer the packages' floating windows are drawn in, over the page beside the rail, and the
 * places it hands out to them (PACKAGES_DOCS.md 6.7).
 *
 * One window a package, one corner a window. The layer remembers where each package's window was
 * last put, in this browser - its corner, and whether it was tucked away there - and gives it back
 * the next time, after a reload too; when the corner is taken the window gets the first free one
 * of bottom-right, bottom-left, top-right, top-left. A window put in a corner another holds swaps
 * with it, which comes out of its tuck. A fifth window shares the bottom-right.
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

import {
  CORNER_ORDER,
  readPlacements,
  type Corner,
  type Placement,
} from '@/packages/floating/spring';

/** Where the places are kept: `{ [packageId]: { corner, isTucked } }`. */
const STORAGE_KEY = 'nebula.floating';

/** What the layer shares with the windows drawn in it. */
export type FloatingLayerValue = {
  /** The layer's element: the windows are drawn into it, and measured against it. */
  readonly element: HTMLElement | null;

  /** Where each window shown is, by package. */
  readonly placements: Readonly<Record<string, Placement>>;

  /** Gives a window shown its place: the one it was last in when free, else the first free corner. */
  readonly claim: (packageId: string) => void;

  /** Gives back the corner of a window that is no longer shown. */
  readonly release: (packageId: string) => void;

  /**
   * Puts a window in a corner, tucked or not, swapping with the one there, and remembers it.
   *
   * @param packageId - Whose window.
   * @param corner - Where.
   * @param isTucked - Whether it is tucked away past the right edge there; only a right corner's is.
   */
  readonly moveTo: (packageId: string, corner: Corner, isTucked?: boolean) => void;
};

const FloatingLayerContext = createContext<FloatingLayerValue | null>(null);

/**
 * Reads the places remembered.
 *
 * @returns Them; none when the browser keeps nothing or what it kept is not ours.
 */
function readPreferred(): Record<string, Placement> {
  try {
    return readPlacements(JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return {};
  }
}

/**
 * Remembers places.
 *
 * @param chosen - The places of the windows just moved, by package.
 */
function writePreferred(chosen: Readonly<Record<string, Placement>>): void {
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
  const [placements, setPlacements] = useState<Readonly<Record<string, Placement>>>({});
  // The places as they are this moment: two windows claiming in one render see each other.
  const latest = useRef(placements);

  const commit = useCallback((next: Readonly<Record<string, Placement>>): void => {
    latest.current = next;
    setPlacements(next);
  }, []);

  const claim = useCallback(
    (packageId: string): void => {
      const current = latest.current;

      if (current[packageId] !== undefined) {
        return;
      }

      const taken = new Set(Object.values(current).map((placement) => placement.corner));
      const preferred = readPreferred()[packageId];
      const placement =
        preferred !== undefined && !taken.has(preferred.corner)
          ? preferred
          : {
              corner: CORNER_ORDER.find((each) => !taken.has(each)) ?? 'bottom-right',
              isTucked: false,
            };

      commit({ ...current, [packageId]: placement });
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
    (packageId: string, corner: Corner, isTucked = false): void => {
      const current = latest.current;
      const from = current[packageId];

      if (from === undefined || (from.corner === corner && from.isTucked === isTucked)) {
        return;
      }

      const moved: Record<string, Placement> = {
        [packageId]: { corner, isTucked: isTucked && corner.endsWith('right') },
      };

      for (const [other, at] of Object.entries(current)) {
        if (other !== packageId && at.corner === corner && from.corner !== corner) {
          moved[other] = { corner: from.corner, isTucked: false };
        }
      }

      commit({ ...current, ...moved });
      writePreferred(moved);
    },
    [commit],
  );

  const value = useMemo(
    () => ({ element, placements, claim, release, moveTo }),
    [element, placements, claim, release, moveTo],
  );

  return (
    <FloatingLayerContext.Provider value={value}>
      {children}
      <div ref={setElement} className="pointer-events-none absolute inset-0 z-10" />
    </FloatingLayerContext.Provider>
  );
}
