/**
 * One app window (docs: app windows, 4.4 and 4.6): an integration container's page in an iframe,
 * under a bar that reloads it, hides it as a tab on the right edge and closes it. Dragged by its bar
 * it snaps to the spot under the pointer, or stays where it is let go; it is resized from any edge
 * or corner; a double-click on the bar sends it Large and back.
 *
 * The iframe is never moved in the page and never taken out of it while the window is open: a
 * hidden window is only invisible, so the page keeps running, and the windows are drawn in a fixed
 * order with their stacking left to `z-index`, since moving an iframe in the DOM reloads it.
 *
 * While the window moves it is placed by its script, frame by frame, not through React; let go,
 * React places it at rest and it flies there from where it was let go (the FLIP way: drawn at rest,
 * shown moved back to the old place, animated home).
 */
import { useQuery } from '@tanstack/react-query';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { AppIcon, Button, cn, IconButton, toast, type UiIconId } from '@nebulahome/ui';

import { useAppWindows, type AppWindow } from '@/app-windows/app-windows-store';
import {
  clampRect,
  MIN_SIZE,
  rightLimit,
  spotAt,
  transformOver,
  type Rect,
  type Spot,
} from '@/app-windows/geometry';
import { ensureIngressSession } from '@/app-windows/session';
import { useSession } from '@/auth/session-store';
import { controlContainer } from '@/containers/api';
import { toMessage } from '@/lib/error-message';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { fetchVendor, LIBRARY_QUERY_KEYS } from '@/library/api';
import {
  AT_REST,
  throwVelocity,
  THROW_SECONDS,
  THROW_WINDOW_MS,
  type PointerSample,
  type Size,
} from '@/packages/floating/spring';
import { VendorLogo } from '@/routes/library/vendor-card';

/** How the window is drawn: free over the page, over the whole screen on a phone, or hidden. */
export type AppWindowMode = 'window' | 'sheet' | 'hidden';

/** What a window needs. */
export type AppWindowProps = {
  /** The window. */
  readonly window: AppWindow;

  /** Where it rests. */
  readonly rect: Rect;

  /** The layer's size. */
  readonly bounds: Size;

  /** Whether the right edge has something on it, which a window let go stays clear of. */
  readonly isRailBusy: boolean;

  /** Its place in the stack: higher is in front. */
  readonly layer: number;

  /** Whether it is the window in use. */
  readonly isFront: boolean;

  /** How it is drawn. */
  readonly mode: AppWindowMode;

  /** Where its tab is, or would go: it hides into it and comes out of it. */
  readonly tab: Rect;

  /**
   * Hears where a window being dragged would land, for the zone that shows it.
   *
   * @param spot - The spot under the pointer; null away from the edges.
   * @param from - The window's rectangle this moment: the zone grows out of it.
   */
  readonly onZone: (spot: Spot | null, from: Rect) => void;
};

/** How far the pointer goes before a press on the bar is a drag, so its buttons still take a click. */
const DRAG_THRESHOLD_PX = 4;

/** How fast a throw towards the right edge has to be to hide the window rather than snap it. */
const HIDE_SPEED = 900;

/** How far the window tilts for each pixel the pointer moves across, and the most it tilts. */
const TILT_PER_PX = 0.25;
const MAX_TILT_DEG = 3;

/** The motion of landing, hiding and coming back: the floating windows' curve and lengths. */
const LAND_MS = 320;
const HIDE_MS = 240;
const SHOW_MS = 320;
const SETTLE = 'cubic-bezier(0.34, 1.36, 0.64, 1)';

/** The sides a window is resized from: an edge, or a corner (two edges). */
type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Where each handle sits on the frame, and its cursor. Inside the frame, which clips. */
const HANDLES: Readonly<Record<Edge, string>> = {
  n: 'inset-x-4 top-0 h-1.5 cursor-ns-resize',
  s: 'inset-x-4 bottom-0 h-1.5 cursor-ns-resize',
  e: 'inset-y-4 right-0 w-1.5 cursor-ew-resize',
  w: 'inset-y-4 left-0 w-1.5 cursor-ew-resize',
  ne: 'top-0 right-0 size-4 cursor-nesw-resize',
  nw: 'top-0 left-0 size-4 cursor-nwse-resize',
  se: 'right-0 bottom-0 size-4 cursor-nwse-resize',
  sw: 'bottom-0 left-0 size-4 cursor-nesw-resize',
};

/** What the page inside is doing, as far as the window can tell. */
type PageState = 'loading' | 'ready' | 'no-answer' | 'expired' | 'denied' | 'session-failed';

/** Where the container is, from its integration's view. */
type ContainerState = 'running' | 'restarting' | 'stopped';

/** The Docker states a container is on its way back from: an update recreates it. */
const COMING_BACK: ReadonlySet<string> = new Set(['restarting', 'pulling', 'created']);

/**
 * Reads the error a page answered with, when it answered with the API's JSON rather than a page.
 * The page is on this origin, so its document can be read.
 *
 * @param frame - The iframe.
 * @returns The error's code; null when the page is a page.
 */
function errorOf(frame: HTMLIFrameElement): string | null {
  try {
    const document = frame.contentDocument;

    if (document?.contentType !== 'application/json') {
      return null;
    }

    const body = JSON.parse(document.body.textContent) as {
      readonly error?: { readonly code?: unknown };
    };

    return typeof body.error?.code === 'string' ? body.error.code : 'UNKNOWN';
  } catch {
    return null;
  }
}

/**
 * Writes a rectangle on an element, past React: while it moves.
 *
 * @param element - The element.
 * @param rect - Where.
 */
function writeRect(element: HTMLElement, rect: Rect): void {
  element.style.left = `${String(rect.x)}px`;
  element.style.top = `${String(rect.y)}px`;
  element.style.width = `${String(rect.width)}px`;
  element.style.height = `${String(rect.height)}px`;
}

/**
 * Renders one app window.
 *
 * @param props - See {@link AppWindowProps}.
 * @returns The window.
 */
export function AppWindowFrame(props: AppWindowProps) {
  const { window: app, rect, bounds, isRailBusy, layer, isFront, mode, tab, onZone } = props;
  const { name, vendorId, title, path } = app;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isReduced = useReducedMotion();
  const can = useSession((state) => state.can);
  const { place, hide, close, focus } = useAppWindows.getState();
  const frameRef = useRef<HTMLElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Where the window was let go; the next rest flies from there.
  const landFromRef = useRef<Rect | null>(null);
  const retriedRef = useRef(false);
  const shownModeRef = useRef<AppWindowMode | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [page, setPage] = useState<PageState>('loading');
  const [gesture, setGesture] = useState<'drag' | 'resize' | null>(null);
  const [sizeShown, setSizeShown] = useState<string | null>(null);
  const [landings, setLandings] = useState(0);
  const [generation, setGeneration] = useState(0);

  const vendor = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.vendors, vendorId],

    /**
     * Reads the integration: its logo, and where its container stands.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the window goes.
     * @returns The integration.
     */
    queryFn: async ({ signal }) => fetchVendor(vendorId, signal),
  });
  const containerIndex =
    vendor.data?.containers.findIndex((each) => each.ingressPath === path) ?? -1;
  const status = containerIndex < 0 ? undefined : vendor.data?.containerStatuses[containerIndex];
  const container: ContainerState | null =
    status === undefined || status === null
      ? null
      : status.state === 'running'
        ? 'running'
        : COMING_BACK.has(status.state)
          ? 'restarting'
          : 'stopped';

  // Back to running after a stop or a restart: the page is read afresh.
  const [seenContainer, setSeenContainer] = useState(container);

  if (container !== seenContainer) {
    setSeenContainer(container);

    if (container === 'running' && seenContainer !== null) {
      setGeneration((count) => count + 1);
      setPage('loading');
    }
  }

  // The cookie first: the page's own requests carry nothing else.
  useEffect(() => {
    let isCurrent = true;

    ensureIngressSession().then(
      () => {
        if (isCurrent) {
          setSrc(path);
        }
      },
      () => {
        if (isCurrent) {
          setPage('session-failed');
        }
      },
    );

    return (): void => {
      isCurrent = false;
    };
  }, [path]);

  // At rest after a drop, a resize or a double-click: flown home from where it was.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const from = landFromRef.current;

    landFromRef.current = null;

    if (frame === null || from === null) {
      return;
    }

    // Back at rest past React too: let go in the spot it already had, React has nothing to change.
    writeRect(frame, rect);

    if (isReduced) {
      return;
    }

    frame.animate([{ transform: transformOver(rect, from) }, { transform: 'none' }], {
      duration: LAND_MS,
      easing: SETTLE,
    });
    // `rect` is read at the landing only: a window resized by the page's box is not flown.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above.
  }, [landings, isReduced]);

  // Coming out of its tab: grown from it. Coming in for the first time: risen into place.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const was = shownModeRef.current;

    shownModeRef.current = mode;

    if (frame === null || isReduced || mode !== 'window' || was === 'window') {
      return;
    }

    frame.animate(
      was === 'hidden'
        ? [
            { transform: transformOver(rect, tab), opacity: 0 },
            { transform: 'none', opacity: 1 },
          ]
        : [
            { transform: 'translateY(16px) scale(0.97)', opacity: 0 },
            { transform: 'none', opacity: 1 },
          ],
      { duration: SHOW_MS, easing: SETTLE },
    );
    // Only a change of mode animates.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above.
  }, [mode, isReduced]);

  /**
   * Lets the window land where React now rests it, flown from a rectangle.
   *
   * @param from - Where it was let go.
   */
  const landFrom = (from: Rect): void => {
    landFromRef.current = from;
    setLandings((count) => count + 1);
  };

  /**
   * Hides the window into its tab, then hands it to the store as hidden, back at its place.
   *
   * @param from - Where it is drawn now: its place, or where a throw left it.
   */
  const hideIntoTab = (from: Rect = rect): void => {
    const frame = frameRef.current;
    /** Puts it back at its place, hidden. */
    const done = (): void => {
      if (frame !== null) {
        writeRect(frame, rect);
      }

      hide(name);
    };

    if (frame === null || isReduced) {
      done();

      return;
    }

    const flight = frame.animate(
      [
        { transform: 'none', opacity: 1 },
        { transform: transformOver(from, tab), opacity: 0 },
      ],
      { duration: HIDE_MS, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
    );

    /** Hidden once it reaches the tab. */
    flight.onfinish = (): void => {
      done();
      flight.cancel();
    };
  };

  /** Reloads the page, as the browser's own button does, the cookie laid again first if stale. */
  const reload = (): void => {
    retriedRef.current = false;
    setPage('loading');
    ensureIngressSession().then(
      () => {
        try {
          iframeRef.current?.contentWindow?.location.reload();
        } catch {
          // A page that went to another origin cannot be reloaded from here: it is read afresh.
          setGeneration((count) => count + 1);
        }
      },
      () => {
        setPage('session-failed');
      },
    );
  };

  /** Reads what the page answered once it has loaded. */
  const onLoad = (): void => {
    const frame = iframeRef.current;
    const error = frame === null ? null : errorOf(frame);

    if (error === null) {
      setPage('ready');
    } else if (error === 'AUTHENTICATION' && !retriedRef.current) {
      // The cookie ran out while nobody renewed it: laid again, the page read once more.
      retriedRef.current = true;
      ensureIngressSession(true).then(
        () => {
          setGeneration((count) => count + 1);
        },
        () => {
          setPage('expired');
        },
      );
    } else {
      setPage(
        error === 'AUTHENTICATION' ? 'expired' : error === 'PERMISSION' ? 'denied' : 'no-answer',
      );
    }
  };

  /**
   * Starts a drag from the bar: past a few pixels the window lifts and follows the pointer, the
   * spot under it shows, and letting go lands it there, or hides it when thrown at the right edge.
   *
   * @param event - The press.
   */
  const onBarPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    const frame = frameRef.current;
    const host = frame?.offsetParent;

    if (
      mode !== 'window' ||
      frame === null ||
      !(host instanceof HTMLElement) ||
      !event.isPrimary ||
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest('button') !== null)
    ) {
      return;
    }

    const origin = host.getBoundingClientRect();
    const { pointerId, clientX: startX, clientY: startY } = event;
    let current = rect;
    let spot: Spot | null = null;
    let isDragging = false;
    let lastX = startX;
    let samples: PointerSample[] = [{ time: event.timeStamp, x: startX, y: startY }];

    /**
     * Follows the pointer, past the threshold.
     *
     * @param moved - The pointer event.
     */
    const onMove = (moved: PointerEvent): void => {
      if (moved.pointerId !== pointerId) {
        return;
      }

      if (!isDragging) {
        if (Math.hypot(moved.clientX - startX, moved.clientY - startY) < DRAG_THRESHOLD_PX) {
          return;
        }

        isDragging = true;
        setGesture('drag');
        frame.dataset['lifted'] = '';
        document.body.classList.add('select-none');
      }

      samples = [
        ...samples.filter((sample) => moved.timeStamp - sample.time <= THROW_WINDOW_MS),
        { time: moved.timeStamp, x: moved.clientX, y: moved.clientY },
      ];
      current = { ...rect, x: rect.x + moved.clientX - startX, y: rect.y + moved.clientY - startY };
      writeRect(frame, current);

      if (!isReduced) {
        const tilt = Math.min(
          Math.max((moved.clientX - lastX) * TILT_PER_PX, -MAX_TILT_DEG),
          MAX_TILT_DEG,
        );

        frame.style.rotate = `${String(tilt)}deg`;
      }

      lastX = moved.clientX;

      const next = spotAt(
        { x: moved.clientX - origin.left, y: moved.clientY - origin.top },
        bounds,
      );

      if (next !== spot) {
        spot = next;
        onZone(next, current);
      }
    };

    /**
     * Lets go: landed in the spot, left where it is, or hidden when thrown at the right edge.
     *
     * @param ended - The pointer event; a cancelled one throws nothing.
     */
    const onEnd = (ended: PointerEvent): void => {
      if (ended.pointerId !== pointerId) {
        return;
      }

      globalThis.removeEventListener('pointermove', onMove);
      globalThis.removeEventListener('pointerup', onEnd);
      globalThis.removeEventListener('pointercancel', onEnd);

      if (!isDragging) {
        return;
      }

      setGesture(null);
      delete frame.dataset['lifted'];
      frame.style.rotate = '';
      document.body.classList.remove('select-none');
      onZone(null, current);

      const velocity =
        ended.type === 'pointerup'
          ? throwVelocity([
              ...samples,
              { time: ended.timeStamp, x: ended.clientX, y: ended.clientY },
            ])
          : AT_REST;
      const aimX = ended.clientX - origin.left + velocity.x * THROW_SECONDS;

      if (velocity.x > HIDE_SPEED && aimX > bounds.width) {
        // Thrown at the right edge: hidden from where it is, back to its old place when it returns.
        hideIntoTab(current);

        return;
      }

      place(name, spot === null ? { free: clampRect(current, bounds, isRailBusy) } : { spot });
      landFrom(current);
    };

    globalThis.addEventListener('pointermove', onMove);
    globalThis.addEventListener('pointerup', onEnd);
    globalThis.addEventListener('pointercancel', onEnd);
  };

  /**
   * Starts a resize from an edge or a corner: the opposite side stays put, the least size holds,
   * and the window stays inside the layer; let go, it is free at its new size.
   *
   * @param event - The press, on the handle of the side, which names it.
   */
  const onHandlePointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    const frame = frameRef.current;
    const edge = event.currentTarget.dataset['edge'] as Edge | undefined;

    if (frame === null || edge === undefined || !event.isPrimary || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const { pointerId, clientX: startX, clientY: startY } = event;
    const right = isRailBusy ? rightLimit(bounds.width, true) : bounds.width;
    let current = rect;

    setGesture('resize');
    document.body.classList.add('select-none');

    /**
     * Moves the side, or the two sides, being pulled.
     *
     * @param moved - The pointer event.
     */
    const onMove = (moved: PointerEvent): void => {
      if (moved.pointerId !== pointerId) {
        return;
      }

      const dx = moved.clientX - startX;
      const dy = moved.clientY - startY;
      let { x, y, width, height } = rect;

      if (edge.includes('e')) {
        width = Math.min(Math.max(rect.width + dx, MIN_SIZE.width), right - rect.x);
      }

      if (edge.includes('s')) {
        height = Math.min(Math.max(rect.height + dy, MIN_SIZE.height), bounds.height - rect.y);
      }

      if (edge.includes('w')) {
        x = Math.min(Math.max(rect.x + dx, 0), rect.x + rect.width - MIN_SIZE.width);
        width = rect.x + rect.width - x;
      }

      if (edge.includes('n')) {
        y = Math.min(Math.max(rect.y + dy, 0), rect.y + rect.height - MIN_SIZE.height);
        height = rect.y + rect.height - y;
      }

      current = { x, y, width, height };
      writeRect(frame, current);
      setSizeShown(`${String(Math.round(width))} × ${String(Math.round(height))}`);
    };

    /**
     * Lets go: free at its new size.
     *
     * @param ended - The pointer event.
     */
    const onEnd = (ended: PointerEvent): void => {
      if (ended.pointerId !== pointerId) {
        return;
      }

      globalThis.removeEventListener('pointermove', onMove);
      globalThis.removeEventListener('pointerup', onEnd);
      globalThis.removeEventListener('pointercancel', onEnd);
      document.body.classList.remove('select-none');
      setGesture(null);
      setSizeShown(null);
      place(name, { free: clampRect(current, bounds, isRailBusy) });
    };

    globalThis.addEventListener('pointermove', onMove);
    globalThis.addEventListener('pointerup', onEnd);
    globalThis.addEventListener('pointercancel', onEnd);
  };

  /** Sends the window Large, or back to where it was before. */
  const toggleLarge = (): void => {
    const isLarge = 'spot' in app.place && app.place.spot === 'large';
    const middle = clampRect(
      {
        x: bounds.width * 0.15,
        y: bounds.height * 0.08,
        width: bounds.width * 0.7,
        height: bounds.height * 0.84,
      },
      bounds,
      isRailBusy,
    );

    place(
      name,
      isLarge ? (app.previous ?? { free: middle }) : { spot: 'large' },
      isLarge ? null : app.place,
    );
    landFrom(rect);
  };

  /**
   * Opens the container's page in the interface, the window hidden to show it.
   *
   * @param tabName - The page's tab to open; its first when absent.
   */
  const openContainer = (tabName?: string): void => {
    hide(name);
    void navigate(
      `/containers/${encodeURIComponent(name)}${tabName === undefined ? '' : `?tab=${tabName}`}`,
    );
  };

  /** Starts the container. */
  const start = (): void => {
    controlContainer(name, 'start').catch((error: unknown) => {
      toast.error({
        title: t('appWindows.startFailed', '{{name}} did not start', { name: title }),
        message: toMessage(error),
      });
    });
  };

  const isSheet = mode === 'sheet';
  const isLoading = src === null || page === 'loading';
  const label = { name: title };

  return (
    <section
      ref={frameRef}
      aria-label={title}
      inert={mode === 'hidden'}
      data-app-window={name}
      className={cn(
        'app-window pointer-events-auto flex flex-col overflow-hidden bg-surface',
        isSheet ? 'fixed inset-0 z-40' : 'absolute rounded-dialog border',
        !isSheet && (isFront ? 'border-border-strong' : 'border-border'),
        mode === 'hidden' && 'invisible',
      )}
      /* eslint-disable-next-line react/forbid-dom-props -- where it rests and its place in the
         stack are runtime values; while it moves its script writes them past React. */
      style={
        isSheet
          ? undefined
          : { left: rect.x, top: rect.y, width: rect.width, height: rect.height, zIndex: layer }
      }
      onPointerDownCapture={() => {
        focus(name);
      }}
    >
      {/* The bar is the handle the window is dragged by; its buttons are reached by Tab. */}
      {}
      <header
        className={cn(
          'flex shrink-0 items-center gap-2.5 border-b border-border pr-2.5 pl-[11px] select-none',
          isSheet ? 'h-14' : 'h-13 cursor-grab',
          gesture === 'drag' && 'cursor-grabbing',
          isFront || isSheet ? 'bg-surface' : 'bg-well',
        )}
        onPointerDown={onBarPointerDown}
        onDoubleClick={(event) => {
          if (
            mode === 'window' &&
            !(event.target instanceof Element && event.target.closest('button') !== null)
          ) {
            toggleLarge();
          }
        }}
      >
        {isLoading ? (
          <span className="flex size-7.5 shrink-0 items-center justify-center text-primary">
            <AppIcon id="loader-circle" size={18} className="animate-spin" />
          </span>
        ) : (
          <VendorLogo
            vendor={
              vendor.data ?? { name: title, logo: undefined, color: undefined, logoPadding: 0 }
            }
            size={30}
          />
        )}
        <span className="flex min-w-0 grow items-center gap-2">
          <span
            className={cn(
              'truncate text-ui font-medium',
              isFront || isSheet ? 'text-foreground' : 'text-foreground-muted',
            )}
          >
            {title}
          </span>
          <span className="text-caption whitespace-nowrap text-foreground-subtle">
            {t('appWindows.source', 'Integration')}
          </span>
          {container === 'stopped' ? (
            <StateChip tone="idle">{t('appWindows.chip.stopped', 'Stopped')}</StateChip>
          ) : null}
          {container === 'restarting' ? (
            <StateChip tone="warning">{t('appWindows.chip.restarting', 'Restarting')}</StateChip>
          ) : null}
        </span>
        <IconButton
          label={t('appWindows.reload', 'Reload {{name}}', label)}
          size={isSheet ? 'large' : 'medium'}
          onClick={reload}
        >
          <AppIcon id="rotate-cw" size={16} />
        </IconButton>
        {isSheet ? null : (
          <IconButton
            label={t('appWindows.hide', 'Hide {{name}}', label)}
            onClick={() => {
              hideIntoTab();
            }}
          >
            <AppIcon id="arrow-right-to-line" size={16} />
          </IconButton>
        )}
        <IconButton
          label={t('appWindows.close', 'Close {{name}}', label)}
          size={isSheet ? 'large' : 'medium'}
          onClick={() => {
            close(name);
          }}
        >
          <AppIcon id="x" size={isSheet ? 20 : 16} />
        </IconButton>
      </header>

      <div className="relative min-h-0 grow bg-well">
        {src === null ? null : (
          <iframe
            key={generation}
            ref={iframeRef}
            src={src}
            title={title}
            data-app-window={name}
            className="block size-full border-0 bg-white"
            onLoad={onLoad}
          />
        )}

        {isLoading ? (
          <span aria-hidden="true" className="app-window-progress absolute top-0 left-0 h-0.5" />
        ) : null}

        {container === 'stopped' ? (
          <PageNote
            icon="container"
            title={t('appWindows.stopped.title', '{{name}} is not running', label)}
            text={t(
              'appWindows.stopped.text',
              'Its container is stopped, so there is no page to show.',
            )}
          >
            {can('container:control') ? (
              <Button onClick={start}>
                <AppIcon id="play" size={16} />
                {t('appWindows.stopped.start', 'Start')}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              onClick={() => {
                openContainer();
              }}
            >
              {t('appWindows.stopped.open', 'Open container')}
            </Button>
          </PageNote>
        ) : container === 'restarting' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-scrim px-12 text-center backdrop-blur-[2px]">
            <AppIcon id="loader-circle" size={22} className="animate-spin text-primary" />
            <p className="text-ui font-medium text-foreground">
              {t('appWindows.restarting.title', 'Reconnecting')}
            </p>
            <p className="max-w-sm text-ui-sm text-foreground-muted">
              {t(
                'appWindows.restarting.text',
                '{{name}} is restarting. The page comes back on its own.',
                label,
              )}
            </p>
          </div>
        ) : page === 'no-answer' ? (
          <PageNote
            icon="triangle-alert"
            tone="warning"
            title={t('appWindows.noAnswer.title', 'The page did not answer')}
            text={t(
              'appWindows.noAnswer.text',
              '{{name}} is running, but its page did not reply.',
              label,
            )}
          >
            <Button variant="ghost" onClick={reload}>
              <AppIcon id="rotate-cw" size={16} />
              {t('appWindows.noAnswer.retry', 'Try again')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                openContainer('log');
              }}
            >
              <AppIcon id="file-text" size={16} />
              {t('appWindows.noAnswer.log', 'Open log')}
            </Button>
          </PageNote>
        ) : page === 'expired' || page === 'session-failed' ? (
          <PageNote
            icon="lock"
            title={t('appWindows.expired.title', 'The page could not be opened')}
            text={t(
              'appWindows.expired.text',
              'Your session for this page has ended. Sign in again, then reload it.',
            )}
          >
            <Button variant="ghost" onClick={reload}>
              <AppIcon id="rotate-cw" size={16} />
              {t('appWindows.noAnswer.retry', 'Try again')}
            </Button>
          </PageNote>
        ) : page === 'denied' ? (
          <PageNote
            icon="lock"
            title={t('appWindows.denied.title', 'You can no longer open this page')}
            text={t(
              'appWindows.denied.text',
              'Opening it needs permission to configure {{name}}.',
              label,
            )}
          />
        ) : null}

        {/* While the window moves, the page would take the pointer and the gesture would stop. */}
        {gesture === null ? null : <div className="absolute inset-0" />}
      </div>

      {mode === 'window'
        ? (Object.keys(HANDLES) as Edge[]).map((edge) => (
            <span
              key={edge}
              aria-hidden="true"
              className={cn('absolute z-10', HANDLES[edge])}
              data-edge={edge}
              onPointerDown={onHandlePointerDown}
            />
          ))
        : null}

      {sizeShown === null ? null : (
        <span className="pointer-events-none absolute right-3 bottom-3 z-10 rounded-tile border border-border-strong bg-surface-raised px-2.5 py-1 font-mono text-caption text-foreground">
          {sizeShown}
        </span>
      )}
    </section>
  );
}

/**
 * A small chip after the window's name: the container's state when it is not running.
 *
 * @param props - What it says.
 * @param props.tone - Its colour.
 * @param props.children - The words.
 * @returns The chip.
 */
function StateChip(props: { readonly tone: 'idle' | 'warning'; readonly children: ReactNode }) {
  const { tone, children } = props;

  return (
    <span
      className={cn(
        'inline-flex h-5.5 shrink-0 items-center gap-1.5 rounded-pill border border-border-strong px-2.5 text-caption font-medium whitespace-nowrap',
        tone === 'warning' ? 'text-warning' : 'text-foreground-muted',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 rounded-full',
          tone === 'warning' ? 'bg-warning' : 'bg-foreground-muted',
        )}
      />
      {children}
    </span>
  );
}

/**
 * What the window shows in place of the page: why it is not there, and what to do.
 *
 * @param props - What it says.
 * @param props.icon - Its glyph.
 * @param props.tone - Its glyph's colour.
 * @param props.title - What happened.
 * @param props.text - Why.
 * @param props.children - The actions.
 * @returns The note.
 */
function PageNote(props: {
  readonly icon: UiIconId;
  readonly tone?: 'warning';
  readonly title: string;
  readonly text: string;
  readonly children?: ReactNode;
}) {
  const { icon, tone, title, text, children } = props;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-well px-12 text-center">
      <span
        className={cn(
          'flex size-11 items-center justify-center rounded-tile border border-border-strong bg-surface-raised',
          tone === 'warning' ? 'text-warning' : 'text-foreground-muted',
        )}
      >
        <AppIcon id={icon} size={20} />
      </span>
      <p className="text-title font-medium text-foreground">{title}</p>
      <p className="max-w-md text-ui-sm text-foreground-muted">{text}</p>
      {children === undefined ? null : (
        <div className="flex flex-wrap justify-center gap-2 pt-1.5">{children}</div>
      )}
    </div>
  );
}
