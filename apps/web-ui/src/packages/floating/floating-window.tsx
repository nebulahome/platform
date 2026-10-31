/**
 * One package's window floating over the pages (PACKAGES_DOCS.md 6.7): the frame, the close
 * button, and the moving - dragged, thrown from corner to corner or tucked past the right edge,
 * stepped with the arrow keys.
 *
 * At rest the window is pinned to its corner by the stylesheet alone, so a window resized and the
 * rail opening and closing carry it along with no script. Only while it moves is it placed from
 * the layer's top-left with `translate`, written to its element frame by frame rather than through
 * React, so what the package draws inside is not drawn again sixty times a second.
 *
 * The frame has no filter and no transform at rest - its glass is a layer of its own under the
 * content - so a popover the package draws `fixed` in its portal is placed against the page.
 *
 * Where it is - its corner, tucked or not - is the layer's, which remembers it: a reload, or the
 * window shown again, puts it back there. While toasts are shown over the bottom-right corner, a
 * window resting there tucks away for them and comes back out when they have gone - unless the
 * viewer brought it out meanwhile; that tuck is not remembered.
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

import { AppIcon, cn, IconButton, useToastsShown } from '@nebulahome/ui';

import { useReducedMotion } from '@/lib/use-reduced-motion';
import { useFloatingLayer } from '@/packages/floating/floating-layer';
import {
  AT_REST,
  capSpeed,
  clampPosition,
  cornerToward,
  holdInside,
  isSettled,
  pickCorner,
  restingPosition,
  stepSpring,
  throwVelocity,
  THROW_WINDOW_MS,
  type Corner,
  type Placement,
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

/** How each corner pins the window, 24px in: what `cornerPosition` works out. */
const CORNER_CLASSES: Readonly<Record<Corner, string>> = {
  'top-left': 'top-6 left-6',
  'top-right': 'top-6 right-6',
  'bottom-left': 'bottom-6 left-6',
  'bottom-right': 'right-6 bottom-6',
};

/** The corner the toasts are shown over, on a screen wider than a phone's. */
const TOASTS_CORNER: Corner = 'bottom-right';

/**
 * How a window tucked in a right corner is pinned: `PEEK_PX` in from the right edge, as wide as
 * what it holds rather than squeezed into the strip left beside it.
 */
const TUCKED_CLASSES: Readonly<Partial<Record<Corner, string>>> = {
  'top-right': 'top-6 left-[calc(100%-32px)] w-max',
  'bottom-right': 'bottom-6 left-[calc(100%-32px)] w-max',
};

/** How long a window takes to go, the stylesheet's `floating-out`; then it is no longer drawn. */
const LEAVE_MS = 240;

/** How far the window tilts, in degrees, for each pixel the pointer moves across. */
const TILT_PER_PX = 0.45;

/** The most it tilts either way, in degrees. */
const MAX_TILT_DEG = 7;

/** How long the pointer holds still before the window stands up straight again. */
const TILT_SETTLE_MS = 90;

/** The keys that bring a tucked window back to its corner, beside a click. */
const UNTUCK_KEYS: ReadonlySet<string> = new Set(['ArrowLeft', 'Enter', ' ']);

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
  const areToastsShown = useToastsShown();
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  // Brought out, or picked up, by the viewer while toasts are shown: it stays out until they go.
  const [isOutForToasts, setOutForToasts] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  // Where the spring pulls the window: ahead of the layer's for the moment after a drop.
  const aimRef = useRef<Placement | undefined>(undefined);
  const springRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const isClickSwallowedRef = useRef(false);

  const ownPage = packageAppPath(packageId);
  const isOwnPage = pathname === ownPage || pathname.startsWith(`${ownPage}/`);
  const isShown = open && !isOwnPage && isWideEnough && layer !== null;
  const layerElement = layer?.element ?? null;
  const claim = layer?.claim;
  const release = layer?.release;
  const placement = isShown ? layer.placements[packageId] : undefined;
  const corner = placement?.corner;

  if (!areToastsShown && isOutForToasts) {
    setOutForToasts(false);
  }

  // Tucked where the layer has it tucked, and while toasts are shown over its corner.
  const isTuckedThere =
    placement !== undefined &&
    (placement.isTucked ||
      (areToastsShown && placement.corner === TOASTS_CORNER && !isOutForToasts));

  // Where the window is drawn: where it is while it is shown, where it was while it goes.
  const [drawn, setDrawn] = useState<Placement | undefined>(undefined);
  const [isLeaving, setLeaving] = useState(false);

  if (
    corner !== undefined &&
    (corner !== drawn?.corner || isTuckedThere !== drawn.isTucked || isLeaving)
  ) {
    setDrawn({ corner, isTucked: isTuckedThere });
    setLeaving(false);
  } else if (corner === undefined && drawn !== undefined && !isLeaving) {
    if (isReduced) {
      setDrawn(undefined);
    } else {
      setLeaving(true);
    }
  }

  const isTucked = drawn?.isTucked ?? false;

  useEffect(() => {
    if (!isLeaving) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setDrawn(undefined);
      setLeaving(false);
    }, LEAVE_MS);

    return (): void => {
      clearTimeout(timer);
    };
  }, [isLeaving]);

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
   * @param canTuck - Whether it may be drawn past the right edge, as far as its tucked place.
   */
  const place = (position: Vector, canTuck = false): void => {
    const frame = frameRef.current;
    const measured = measure();

    if (frame === null || measured === null) {
      return;
    }

    const at = clampPosition(position, measured.bounds, measured.size, canTuck);

    frame.style.inset = '0 auto auto 0';
    frame.style.translate = `${String(at.x)}px ${String(at.y)}px`;
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
      frameRef.current.style.translate = '';
    }
  };

  /**
   * Carries the window to where it is aimed - its corner, or tucked past the right edge there -
   * on the spring, or at once for somebody who asked for less motion. The aim is read each frame,
   * so a window aimed elsewhere on the way turns towards it.
   *
   * @param from - Where it starts.
   * @param velocity - How fast it is going, in pixels a second; capped.
   */
  const fly = (from: Vector, velocity: Vector): void => {
    hold();

    if (isReduced) {
      rest();

      return;
    }

    const start = measure();
    // Coming out of its tucked place, the window is drawn past the right edge on the way.
    const isFromPastEdge = start !== null && from.x > start.bounds.width - start.size.width;
    let state: SpringState = { position: from, velocity: capSpeed(velocity) };
    let last = performance.now();

    /**
     * Moves the window on by one frame.
     *
     * @param now - The frame's time.
     */
    const tick = (now: number): void => {
      const measured = measure();
      const aim = aimRef.current;

      if (measured === null || aim === undefined) {
        rest();

        return;
      }

      const canTuck = aim.isTucked || isFromPastEdge;
      // Worked out again each frame: the rail may be opening while the window flies.
      const target = restingPosition(aim, measured.bounds, measured.size);

      state = holdInside(
        stepSpring(state, target, (now - last) / 1000),
        measured.bounds,
        measured.size,
        canTuck,
      );
      last = now;

      if (isSettled(state, target)) {
        rest();

        return;
      }

      place(state.position, canTuck);
      springRef.current = requestAnimationFrame(tick);
    };

    place(from, (aimRef.current?.isTucked ?? false) || isFromPastEdge);
    springRef.current = requestAnimationFrame(tick);
  };

  /**
   * Tucks the window past the right edge, or brings it back out to its corner.
   *
   * @param isTuck - Which.
   */
  const tuck = (isTuck: boolean): void => {
    if (corner === undefined || layer === null) {
      return;
    }

    if (!isTuck && areToastsShown) {
      setOutForToasts(true);
    }

    layer.moveTo(packageId, corner, isTuck);
  };

  // A place that changed while the window sat in the old one - swapped by another window, stepped
  // with the keys, tucked or brought out, making room for toasts - is flown to from the old one.
  // The new classes are already on the element, and this runs before the page is painted, so it
  // never shows there first. A window already flying turns towards it on its own.
  const onPlaceChange = useEffectEvent((next: Placement | undefined): void => {
    const previous = aimRef.current;

    aimRef.current = next;

    if (
      previous === undefined ||
      next === undefined ||
      (previous.corner === next.corner && previous.isTucked === next.isTucked) ||
      springRef.current !== null ||
      isDraggingRef.current
    ) {
      return;
    }

    const measured = measure();

    if (measured !== null) {
      fly(restingPosition(previous, measured.bounds, measured.size), AT_REST);
    }
  });

  useLayoutEffect(() => {
    onPlaceChange(corner === undefined ? undefined : { corner, isTucked: isTuckedThere });
  }, [corner, isTuckedThere]);

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
    let lastX = startX;
    let tiltTimer: ReturnType<typeof setTimeout> | undefined;

    /**
     * Follows the pointer, tilting the window the way it is pulled.
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
        // Measured before it is lifted, which grows it.
        origin = offsetOf(frame, layerElement);
        frame.dataset['lifted'] = '';
        // Picked up, it is out of any tuck.
        tuck(false);
      }

      samples = [
        ...samples.filter((sample) => moved.timeStamp - sample.time <= THROW_WINDOW_MS),
        { time: moved.timeStamp, x: moved.clientX, y: moved.clientY },
      ];
      position = { x: origin.x + moved.clientX - startX, y: origin.y + moved.clientY - startY };
      place(position, true);

      if (!isReduced) {
        const tilt = (moved.clientX - lastX) * TILT_PER_PX;

        frame.style.rotate = `${String(Math.min(Math.max(tilt, -MAX_TILT_DEG), MAX_TILT_DEG))}deg`;
        clearTimeout(tiltTimer);
        tiltTimer = setTimeout(() => {
          frame.style.rotate = '';
        }, TILT_SETTLE_MS);
      }

      lastX = moved.clientX;
    };

    /**
     * Lets go: the window goes to the corner it was thrown at, swapping with the one there, or
     * tucks away past the right edge.
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
      clearTimeout(tiltTimer);
      frame.style.rotate = '';
      delete frame.dataset['lifted'];

      const measured = measure();

      if (measured === null) {
        return;
      }

      const from = clampPosition(position, measured.bounds, measured.size, true);
      const velocity =
        ended.type === 'pointerup'
          ? throwVelocity([
              ...samples,
              { time: ended.timeStamp, x: ended.clientX, y: ended.clientY },
            ])
          : AT_REST;
      const landing = pickCorner(from, velocity, measured.bounds, measured.size);

      aimRef.current = landing;
      layer.moveTo(packageId, landing.corner, landing.isTucked);
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
   * The keys, while the window itself has the focus: an arrow moves it to the corner it points at,
   * the right one past a right corner tucks it, and the left one, Enter or Space bring it back.
   *
   * @param event - The key.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (corner === undefined || layer === null || event.target !== event.currentTarget) {
      return;
    }

    if (isTucked) {
      if (UNTUCK_KEYS.has(event.key)) {
        event.preventDefault();
        tuck(false);
      }

      return;
    }

    if (event.key === 'ArrowRight' && corner.endsWith('right')) {
      event.preventDefault();
      tuck(true);

      return;
    }

    const next = cornerToward(corner, event.key);

    if (next === null) {
      return;
    }

    event.preventDefault();
    layer.moveTo(packageId, next);
  };

  if (drawn === undefined || layerElement === null) {
    return null;
  }

  return createPortal(
    // A region that moves: the arrow keys take it from corner to corner, so it is focusable and
    // listens for them, as a draggable panel does; tucked, a click brings it back.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- see above.
    <div
      ref={frameRef}
      role="region"
      aria-label={isTucked ? t('floating.show', 'Show {{label}}', { label }) : label}
      aria-keyshortcuts={
        isTucked ? 'ArrowLeft Enter Space' : 'ArrowLeft ArrowRight ArrowUp ArrowDown'
      }
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the keys move it.
      tabIndex={0}
      inert={isLeaving}
      className={cn(
        'floating-frame pointer-events-auto absolute isolate max-w-100 touch-none rounded-[18px] border border-border',
        'focus-visible:outline-3 focus-visible:outline-primary/25',
        (isTucked ? TUCKED_CLASSES[drawn.corner] : undefined) ?? CORNER_CLASSES[drawn.corner],
        !isReduced && (isLeaving ? 'floating-leave' : 'floating-enter'),
      )}
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
      onClick={
        isTucked
          ? (): void => {
              tuck(false);
            }
          : undefined
      }
      onKeyDown={onKeyDown}
    >
      {/* The glass, under the content rather than on the frame: see the top of the file. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 rounded-[inherit] bg-surface/90 backdrop-blur-[20px] backdrop-saturate-140"
      />
      <div data-nebula-package={packageId} inert={isTucked} className="relative min-w-0">
        {renderContent(portal)}
        <div ref={setPortal} />
      </div>
      {isTucked ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 flex w-8 items-center justify-center rounded-l-[inherit] bg-surface/50 text-foreground"
        >
          <AppIcon id="chevron-left" size={18} />
        </span>
      ) : null}
      {onClose === undefined || isTucked ? null : (
        <IconButton
          label={t('floating.close', 'Close')}
          className="absolute top-2.5 right-2.5 size-7.5"
          onClick={onClose}
        >
          <AppIcon id="x" size={16} />
        </IconButton>
      )}
    </div>,
    layerElement,
  );
}
