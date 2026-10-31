/**
 * One package's window floating over the pages (PACKAGES_DOCS.md 6.7): the frame, the close
 * button, and the moving - dragged, thrown from corner to corner, stepped with the arrow keys.
 *
 * At rest the window is pinned to its corner by the stylesheet alone, so a window resized and the
 * rail opening and closing carry it along with no script. Only while it moves is it placed from
 * the layer's top-left with a transform, written to its element frame by frame rather than through
 * React, so what the package draws inside is not drawn again sixty times a second.
 *
 * It is hidden while it is not open, on the package's own page - which shows the same thing in
 * full - and on a screen narrower than 640px; a hidden window gives its corner back.
 */
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { AppIcon, cn, IconButton } from '@nebulahome/ui';

import { useReducedMotion } from '@/lib/use-reduced-motion';
import { useFloatingLayer } from '@/packages/floating/floating-layer';
import {
  AT_REST,
  clampPosition,
  cornerPosition,
  cornerToward,
  isSettled,
  pickCorner,
  stepSpring,
  throwVelocity,
  THROW_WINDOW_MS,
  type Corner,
  type PointerSample,
  type Size,
  type SpringState,
  type Vector,
} from '@/packages/floating/spring';
import { packageAppPath } from '@/packages/package-paths';

/** What a floating window needs. */
export type FloatingWindowProps = {
  /** Whose window it is: one a package. */
  readonly packageId: string;

  /** Whether the package shows it. */
  readonly open: boolean;

  /** What a screen reader calls it. */
  readonly label: string;

  /** What closing it does; without it the window has no close button. */
  readonly onClose?: (() => void) | undefined;

  /** Draws the package's content; `portal` is a node inside the window for its popovers. */
  readonly renderContent: (portal: HTMLElement | null) => ReactNode;
};

/** How far the pointer goes before a press is a drag, so a button inside still takes a click. */
const DRAG_THRESHOLD_PX = 4;

/** Narrower than this the window is not shown: a phone has no room beside the page. */
const WIDE_QUERY = '(min-width: 640px)';

/** What a press starts a gesture of its own on, rather than the window's: a slider, a field. */
const OWN_GESTURES = 'input, textarea, select, [contenteditable="true"], [role="slider"]';

/** How each corner pins the window, 24px in: what {@link cornerPosition} works out. */
const CORNER_CLASSES: Readonly<Record<Corner, string>> = {
  'top-left': 'top-6 left-6',
  'top-right': 'top-6 right-6',
  'bottom-left': 'bottom-6 left-6',
  'bottom-right': 'right-6 bottom-6',
};

/**
 * Listens for the screen getting wider or narrower than a phone's.
 *
 * @param onChange - Called when it does.
 * @returns What stops listening.
 */
function subscribeWide(onChange: () => void): () => void {
  const query = globalThis.matchMedia(WIDE_QUERY);

  query.addEventListener('change', onChange);

  return (): void => {
    query.removeEventListener('change', onChange);
  };
}

/**
 * Reads whether the screen is wider than a phone's.
 *
 * @returns True when it is.
 */
function isWide(): boolean {
  return globalThis.matchMedia(WIDE_QUERY).matches;
}

/**
 * Where an element is drawn, from the top-left of another: transforms included.
 *
 * @param element - The element.
 * @param from - What it is measured from.
 * @returns The offset.
 */
function offsetOf(element: HTMLElement, from: HTMLElement): Vector {
  const drawn = element.getBoundingClientRect();
  const origin = from.getBoundingClientRect();

  return { x: drawn.left - origin.left, y: drawn.top - origin.top };
}

/**
 * Renders a package's floating window, in the layer, in its corner.
 *
 * @param props - See {@link FloatingWindowProps}.
 * @returns The window, drawn into the layer; nothing while it is hidden or outside a layer.
 */
export function FloatingWindow(props: FloatingWindowProps) {
  const { packageId, open, label, onClose, renderContent } = props;
  const { t } = useTranslation();
  const layer = useFloatingLayer();
  const { pathname } = useLocation();
  const isWideEnough = useSyncExternalStore(subscribeWide, isWide, () => true);
  const isReduced = useReducedMotion();
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  // The corner the spring pulls towards: ahead of the layer's for the moment after a drop.
  const cornerRef = useRef<Corner | undefined>(undefined);
  const springRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const isClickSwallowedRef = useRef(false);

  const ownPage = packageAppPath(packageId);
  const isOwnPage = pathname === ownPage || pathname.startsWith(`${ownPage}/`);
  const isShown = open && !isOwnPage && isWideEnough && layer !== null;
  const layerElement = layer?.element ?? null;
  const claim = layer?.claim;
  const release = layer?.release;
  const corner = isShown ? layer.corners[packageId] : undefined;

  useEffect(() => {
    if (!isShown || claim === undefined || release === undefined) {
      return undefined;
    }

    claim(packageId);

    return (): void => {
      release(packageId);
    };
  }, [isShown, packageId, claim, release]);

  /**
   * Measures the layer and the window.
   *
   * @returns Both; null when either is gone.
   */
  const measure = (): { readonly bounds: Size; readonly size: Size } | null => {
    const frame = frameRef.current;

    if (frame === null || layerElement === null) {
      return null;
    }

    return {
      bounds: { width: layerElement.clientWidth, height: layerElement.clientHeight },
      size: { width: frame.offsetWidth, height: frame.offsetHeight },
    };
  };

  /**
   * Takes the window off its corner and draws it at a place, held inside the layer.
   *
   * @param position - Where, from the layer's top-left.
   */
  const place = (position: Vector): void => {
    const frame = frameRef.current;
    const measured = measure();

    if (frame === null || measured === null) {
      return;
    }

    const drawn = clampPosition(position, measured.bounds, measured.size);

    frame.style.inset = '0 auto auto 0';
    frame.style.transform = `translate3d(${String(drawn.x)}px, ${String(drawn.y)}px, 0)`;
  };

  /** Stops the spring where the window is. */
  const hold = (): void => {
    if (springRef.current !== null) {
      cancelAnimationFrame(springRef.current);
      springRef.current = null;
    }
  };

  /** Stops the spring and gives the window back to its corner's classes. */
  const rest = (): void => {
    hold();

    if (frameRef.current !== null) {
      frameRef.current.style.inset = '';
      frameRef.current.style.transform = '';
    }
  };

  /**
   * Carries the window to its corner on the spring, or at once for somebody who asked for less
   * motion.
   *
   * @param from - Where it starts.
   * @param velocity - How fast it is going, in pixels a second.
   */
  const fly = (from: Vector, velocity: Vector): void => {
    hold();

    if (isReduced) {
      rest();

      return;
    }

    let state: SpringState = { position: from, velocity };
    let last = performance.now();

    /**
     * Moves the window on by one frame.
     *
     * @param now - The frame's time.
     */
    const tick = (now: number): void => {
      const measured = measure();
      const at = cornerRef.current;

      if (measured === null || at === undefined) {
        rest();

        return;
      }

      // The corner is worked out again each frame: the rail may be opening while the window flies.
      const target = cornerPosition(at, measured.bounds, measured.size);

      state = stepSpring(state, target, (now - last) / 1000);
      last = now;

      if (isSettled(state, target)) {
        rest();

        return;
      }

      place(state.position);
      springRef.current = requestAnimationFrame(tick);
    };

    place(from);
    springRef.current = requestAnimationFrame(tick);
  };

  // A corner that changed while the window sat in the old one - swapped by another window, or
  // stepped with the keys - is flown to from the old one. The new classes are already on the
  // element, and this runs before the page is painted, so it never shows there first.
  const onCornerChange = useEffectEvent((next: Corner | undefined): void => {
    const previous = cornerRef.current;

    cornerRef.current = next;

    if (
      previous === undefined ||
      next === undefined ||
      previous === next ||
      springRef.current !== null ||
      isDraggingRef.current
    ) {
      return;
    }

    const measured = measure();

    if (measured !== null) {
      fly(cornerPosition(previous, measured.bounds, measured.size), AT_REST);
    }
  });

  useLayoutEffect(() => {
    onCornerChange(corner);
  }, [corner]);

  /**
   * Starts watching a press: past a few pixels it is a drag, and letting go throws the window.
   *
   * @param event - The press.
   */
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    isClickSwallowedRef.current = false;

    const frame = event.currentTarget;
    const pressed = event.target;

    if (
      !event.isPrimary ||
      event.button !== 0 ||
      layer === null ||
      layerElement === null ||
      (pressed instanceof Element && pressed.closest(OWN_GESTURES) !== null)
    ) {
      return;
    }

    const { pointerId, clientX: startX, clientY: startY } = event;
    let origin: Vector | null = null;
    let position = AT_REST;
    let samples: PointerSample[] = [{ time: event.timeStamp, x: startX, y: startY }];

    /**
     * Follows the pointer.
     *
     * @param moved - The pointer event.
     */
    const onMove = (moved: PointerEvent): void => {
      if (moved.pointerId !== pointerId) {
        return;
      }

      if (origin === null) {
        if (Math.hypot(moved.clientX - startX, moved.clientY - startY) < DRAG_THRESHOLD_PX) {
          return;
        }

        frame.setPointerCapture(pointerId);
        hold();
        isDraggingRef.current = true;
        document.body.classList.add('select-none');
        globalThis.getSelection()?.removeAllRanges();
        origin = offsetOf(frame, layerElement);
      }

      samples = [
        ...samples.filter((sample) => moved.timeStamp - sample.time <= THROW_WINDOW_MS),
        { time: moved.timeStamp, x: moved.clientX, y: moved.clientY },
      ];
      position = { x: origin.x + moved.clientX - startX, y: origin.y + moved.clientY - startY };
      place(position);
    };

    /**
     * Lets go: the window goes to the corner it was thrown at, swapping with the one there.
     *
     * @param ended - The pointer event; a cancelled one throws nothing.
     */
    const onEnd = (ended: PointerEvent): void => {
      if (ended.pointerId !== pointerId) {
        return;
      }

      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);

      if (origin === null) {
        return;
      }

      isDraggingRef.current = false;
      isClickSwallowedRef.current = true;
      document.body.classList.remove('select-none');

      const measured = measure();

      if (measured === null) {
        return;
      }

      const from = clampPosition(position, measured.bounds, measured.size);
      const velocity =
        ended.type === 'pointerup'
          ? throwVelocity([
              ...samples,
              { time: ended.timeStamp, x: ended.clientX, y: ended.clientY },
            ])
          : AT_REST;
      const next = pickCorner(from, velocity, measured.bounds, measured.size);

      cornerRef.current = next;
      layer.moveTo(packageId, next);
      fly(from, velocity);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  };

  /**
   * Swallows the click a drag ends with, so letting go over a button does not press it.
   *
   * @param event - The click.
   */
  const onClickCapture = (event: MouseEvent<HTMLDivElement>): void => {
    if (isClickSwallowedRef.current) {
      isClickSwallowedRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  };

  /**
   * Moves the window to the corner an arrow key points at, while the window itself has the focus.
   *
   * @param event - The key.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next =
      corner === undefined || event.target !== event.currentTarget
        ? null
        : cornerToward(corner, event.key);

    if (next === null || layer === null) {
      return;
    }

    event.preventDefault();
    layer.moveTo(packageId, next);
  };

  if (corner === undefined || layerElement === null) {
    return null;
  }

  return createPortal(
    // A region that moves: the arrow keys take it from corner to corner, so it is focusable and
    // listens for them, as a draggable panel does.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- see above.
    <div
      ref={frameRef}
      role="region"
      aria-label={label}
      aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the keys move it.
      tabIndex={0}
      className={cn(
        'pointer-events-auto absolute touch-none rounded-card border border-border bg-surface p-4 shadow-float',
        'focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none',
        CORNER_CLASSES[corner],
      )}
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
      onKeyDown={onKeyDown}
    >
      <div data-nebula-package={packageId} className="relative max-w-90 min-w-0">
        {renderContent(portal)}
        <div ref={setPortal} />
      </div>
      {onClose === undefined ? null : (
        <IconButton
          size="small"
          label={t('floating.close', 'Close')}
          className="absolute top-2 right-2"
          onClick={onClose}
        >
          <AppIcon id="x" size={14} />
        </IconButton>
      )}
    </div>,
    layerElement,
  );
}
