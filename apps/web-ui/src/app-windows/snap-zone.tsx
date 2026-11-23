/**
 * The zone a dragged window will land in (docs: app windows, decision 6b): frosted glass over the
 * spot under the pointer, with the spot's name. It is born on the window's own rectangle and grows
 * out to the spot as it comes in, slides from spot to spot as the pointer moves along the edges,
 * and goes back into the window as it leaves.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { spotRect, transformOver, type Rect, type Spot } from '@/app-windows/geometry';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { type Size } from '@/packages/floating/spring';

/** What the zone needs. */
export type SnapZoneProps = {
  /** The spot under the pointer and the window's rectangle when it showed; null when none. */
  readonly zone: { readonly spot: Spot; readonly from: Rect } | null;

  /** The layer's size. */
  readonly bounds: Size;

  /** Whether the right edge has something on it, which the spots stay clear of. */
  readonly isRailBusy: boolean;

  /** Its place in the stack: under the window being dragged, over the others. */
  readonly layer: number;
};

/** How long the zone takes to grow, to move and to go. */
const GROW_MS = 200;
const LEAVE_MS = 160;

/**
 * Renders the snap zone.
 *
 * @param props - See {@link SnapZoneProps}.
 * @returns The zone; nothing while there is none.
 */
export function SnapZone(props: SnapZoneProps) {
  const { zone, bounds, isRailBusy, layer } = props;
  const { t } = useTranslation();
  const isReduced = useReducedMotion();
  const elementRef = useRef<HTMLDivElement>(null);
  // What is drawn: the zone, or the last one while it goes back into the window.
  const [drawn, setDrawn] = useState(zone);
  const [isLeaving, setLeaving] = useState(false);
  const previousRef = useRef<Spot | null>(null);

  if (zone !== null && (zone.spot !== drawn?.spot || isLeaving)) {
    setDrawn(zone);
    setLeaving(false);
  } else if (zone === null && drawn !== null && !isLeaving) {
    if (isReduced) {
      setDrawn(null);
    } else {
      setLeaving(true);
    }
  }

  const rect = drawn === null ? null : spotRect(drawn.spot, bounds, isRailBusy);
  const names: Readonly<Record<Spot, string>> = {
    large: t('appWindows.spot.large', 'Large'),
    left: t('appWindows.spot.left', 'Left half'),
    right: t('appWindows.spot.right', 'Right half'),
    'top-left': t('appWindows.spot.topLeft', 'Top left'),
    'top-right': t('appWindows.spot.topRight', 'Top right'),
    'bottom-left': t('appWindows.spot.bottomLeft', 'Bottom left'),
    'bottom-right': t('appWindows.spot.bottomRight', 'Bottom right'),
  };

  useLayoutEffect(() => {
    const element = elementRef.current;
    const was = previousRef.current;

    previousRef.current = isLeaving ? null : (drawn?.spot ?? null);

    if (element === null || rect === null || drawn === null || isReduced) {
      return;
    }

    if (isLeaving) {
      const flight = element.animate(
        [
          { transform: 'none', opacity: 1 },
          { transform: transformOver(rect, drawn.from), opacity: 0 },
        ],
        { duration: LEAVE_MS, easing: 'ease-in', fill: 'forwards' },
      );

      /** Gone once it is back in the window. */
      flight.onfinish = (): void => {
        setDrawn(null);
        setLeaving(false);
      };

      return;
    }

    const from = was === null ? drawn.from : spotRect(was, bounds, isRailBusy);

    element.animate(
      [
        { transform: transformOver(rect, from), opacity: was === null ? 0 : 1 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: GROW_MS, easing: 'cubic-bezier(0.34, 1.36, 0.64, 1)' },
    );
    // Only a new spot, or going, animates; the rectangle follows from them.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above.
  }, [drawn?.spot, isLeaving, isReduced]);

  if (drawn === null || rect === null) {
    return null;
  }

  return (
    <div
      ref={elementRef}
      aria-hidden="true"
      className="app-window-zone pointer-events-none absolute flex origin-top-left items-end justify-center rounded-dialog pb-7 backdrop-blur-[18px] backdrop-brightness-110 backdrop-saturate-150"
      /* eslint-disable-next-line react/forbid-dom-props -- the spot's rectangle and its place in the
         stack are runtime values. */
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, zIndex: layer }}
    >
      <span className="inline-flex h-7.5 items-center rounded-pill border border-white/18 bg-surface/55 px-3 text-ui-sm font-medium text-foreground">
        {names[drawn.spot]}
      </span>
    </div>
  );
}
