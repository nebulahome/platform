/**
 * Where the app windows are drawn (docs: app windows, 4.3 and 4.5): a layer over the page's box,
 * beside the sidebar, under the packages' floating windows, which share its right edge.
 *
 * The edge is one rail: the hidden windows' tabs sit in the middle of the stretch nothing else
 * holds - a floating window in a right corner, the toasts - and while anything is on it the spots
 * end short of it. An app window on show over a floating window in a right corner tucks it away.
 *
 * On a phone the window in use covers the whole screen and the others wait, unseen, with no tabs.
 * The windows are drawn in a fixed order (by name) so no iframe is ever moved in the page, which
 * would reload it; which one is in front is their `z-index`.
 */
import { useEffect, useState } from 'react';

import { cn, useToastsTop } from '@nebulahome/ui';

import { AppTab } from '@/app-windows/app-tab';
import { AppWindowFrame, type AppWindowMode } from '@/app-windows/app-window';
import { useAppWindows, type AppWindow } from '@/app-windows/app-windows-store';
import {
  clampRect,
  freeStretch,
  overlaps,
  spotRect,
  tabsLayout,
  type Band,
  type Rect,
  type Spot,
} from '@/app-windows/geometry';
import { LimitDialog } from '@/app-windows/limit-dialog';
import { SnapZone } from '@/app-windows/snap-zone';
import { useElementSize } from '@/lib/use-element-size';
import { useMediaQuery } from '@/lib/use-media-query';
import { useFloatingLayer } from '@/packages/floating/floating-layer';
import { WIDE_QUERY } from '@/packages/floating/floating-window';
import { CORNER_INSET_PX, PEEK_PX } from '@/packages/floating/spring';

/** How wide a tab is drawn to have its window hide into it. */
const TAB_WIDTH_PX = 180;

/**
 * Renders the app windows, their tabs, the zone a dragged one will land in and the dialog a sixth
 * page opens.
 *
 * @returns The layer.
 */
export function AppWindowsLayer() {
  const windows = useAppWindows((state) => state.windows);
  const floating = useFloatingLayer();
  const { ref, size: bounds } = useElementSize<HTMLDivElement>();
  const isWide = useMediaQuery(WIDE_QUERY, true);
  const toastsTop = useToastsTop();
  const [zone, setZone] = useState<{ readonly spot: Spot; readonly from: Rect } | null>(null);
  const edges = Object.entries(floating?.edges ?? {});
  const hidden = windows.filter((each) => each.isHidden);
  const isRailBusy = hidden.length > 0 || edges.some(([, hold]) => hold.isTucked);

  // What holds the right edge: the floating windows in its corners, and the toasts.
  const taken: Band[] = edges.map(([, hold]) =>
    hold.corner === 'top-right'
      ? { top: CORNER_INSET_PX, bottom: CORNER_INSET_PX + hold.height }
      : {
          top: bounds.height - CORNER_INSET_PX - hold.height,
          bottom: bounds.height - CORNER_INSET_PX,
        },
  );

  if (toastsTop !== null) {
    // shortcut: the toasts are placed on the screen and the layer starts at its top, as it does in
    // the shell; a layer placed lower would need its own top taken off.
    taken.push({ top: toastsTop, bottom: bounds.height });
  }

  const stretch = freeStretch(bounds.height, taken);
  const tabs = tabsLayout(hidden.length, stretch);
  const nextTabs = tabsLayout(hidden.length + 1, stretch);

  /**
   * Where a window rests.
   *
   * @param app - The window.
   * @returns Its rectangle.
   */
  const rectOf = (app: AppWindow): Rect =>
    'spot' in app.place
      ? spotRect(app.place.spot, bounds, isRailBusy)
      : clampRect(app.place.free, bounds, isRailBusy);

  /**
   * Where a window's tab is, or would be once it hides: the last place on the edge.
   *
   * @param app - The window.
   * @returns The tab's rectangle.
   */
  const tabOf = (app: AppWindow): Rect => {
    const index = hidden.indexOf(app);
    const layout = index < 0 ? nextTabs : tabs;
    const top = layout.tops[index < 0 ? hidden.length : index] ?? stretch.top;

    return { x: bounds.width - PEEK_PX, y: top, width: TAB_WIDTH_PX, height: layout.height };
  };

  const shown = windows.filter((each) => !each.isHidden);
  const front = shown.at(-1);
  // The floating windows in a right corner an app window on show covers: they tuck away for it.
  const coveredKey = isWide
    ? edges
        .filter(([, hold]) => {
          const held = {
            x: bounds.width - CORNER_INSET_PX - hold.width,
            y:
              hold.corner === 'top-right'
                ? CORNER_INSET_PX
                : bounds.height - CORNER_INSET_PX - hold.height,
            width: hold.width,
            height: hold.height,
          };

          return shown.some((each) => each.isLoaded && overlaps(rectOf(each), held));
        })
        .map(([packageId]) => packageId)
        .join('\n')
    : '';
  const setCovered = floating?.setCovered;

  useEffect(() => {
    setCovered?.(coveredKey === '' ? [] : coveredKey.split('\n'));
  }, [setCovered, coveredKey]);

  // A click inside a page goes to the page, never to this document: the window it went to is
  // brought in front when the focus leaves for its iframe.
  useEffect(() => {
    /** Puts the window whose iframe took the focus in front, once the focus has landed. */
    const onBlur = (): void => {
      setTimeout(() => {
        const active = document.activeElement;
        const name = active instanceof HTMLIFrameElement ? active.dataset['appWindow'] : undefined;

        if (name !== undefined) {
          useAppWindows.getState().focus(name);
        }
      }, 0);
    };

    globalThis.addEventListener('blur', onBlur);

    return (): void => {
      globalThis.removeEventListener('blur', onBlur);
    };
  }, []);

  /**
   * How a window is drawn.
   *
   * @param app - The window.
   * @returns Its mode.
   */
  const modeOf = (app: AppWindow): AppWindowMode => {
    if (app.isHidden) {
      return 'hidden';
    }

    if (isWide) {
      return 'window';
    }

    return app === front ? 'sheet' : 'hidden';
  };

  return (
    <div
      ref={ref}
      // Wide, the layer stacks under the floating windows; on a phone it makes no stack of its own,
      // so the window over the whole screen covers the sidebar too.
      className={cn('pointer-events-none absolute inset-0', isWide && 'isolate z-10')}
    >
      {windows
        .filter((each) => each.isLoaded)
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .map((each) => (
          <AppWindowFrame
            key={each.name}
            window={each}
            rect={rectOf(each)}
            bounds={bounds}
            isRailBusy={isRailBusy}
            layer={(windows.indexOf(each) + 1) * 2}
            isFront={each === front}
            mode={modeOf(each)}
            tab={tabOf(each)}
            onZone={(spot, from) => {
              setZone(spot === null ? null : { spot, from });
            }}
          />
        ))}

      {isWide ? (
        <SnapZone
          zone={zone}
          bounds={bounds}
          isRailBusy={isRailBusy}
          layer={windows.length * 2 - 1}
        />
      ) : null}

      {isWide
        ? hidden.map((each, index) => (
            <AppTab
              key={each.name}
              window={each}
              top={tabs.tops[index] ?? stretch.top}
              height={tabs.height}
            />
          ))
        : null}

      <LimitDialog />
    </div>
  );
}
