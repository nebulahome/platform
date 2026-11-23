/**
 * A panel that hangs off a control: the settings search's results, the icon picker.
 *
 * Bigger than a dropdown's list and holding more than options - a search field, groups, a footer
 * - so it is its own surface: `surface-raised`, `border-strong`, the `card` radius and the
 * `popover` shadow. It sits under its control (over it when there is no room below), or beside it
 * - an event's details next to the event, too small to hang anything under - is portalled into
 * the enclosing `<dialog>` for the reason `anchored-list.ts` gives, and follows the control while
 * anything scrolls.
 *
 * It closes on a press outside it and its control - a select's options and a popover opened from
 * inside it (an icon picker), portalled out of it, count as in it - and on Escape wherever the
 * focus is. An Escape inside it is kept from reaching the document, where a dialog underneath
 * listens for it too, so one press closes the popover alone. Where the focus goes is the
 * content's business: a picker moves it into its own search,
 * the settings search keeps it in the field that opened it.
 */
import {
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import { hostFor, placeBeside, placeUnder, type Placement } from '../lib/anchored-list.js';
import { cn } from '../lib/cn.js';

/** The tallest a popover gets before its content scrolls. */
const MAX_POPOVER_HEIGHT = 520;

/** The space kept between a popover and the edge of the window. */
const EDGE = 8;

/**
 * Each open panel's control, so a popover can tell a press in one opened from inside it - the
 * icon picker of a model's popover - from a press outside: both are portalled to the page.
 */
const ANCHORS = new WeakMap<Element, RefObject<HTMLElement | null>>();

/** What a popover needs. */
export type PopoverProps = {
  /** The control it hangs off; a press on it is not a press outside. */
  readonly anchor: RefObject<HTMLElement | null>;

  /** Whether it is showing. */
  readonly isOpen: boolean;

  /** Called on a press outside, or Escape. */
  readonly onClose: () => void;

  /** What a screen reader calls it. */
  readonly label: string;

  /** Its width in pixels; the control's width when left out. */
  readonly width?: number;

  /**
   * Where it sits: under the control (over it without room below), or beside it - on its right,
   * on its left without room there - level with its top and kept inside the window.
   */
  readonly side?: 'below' | 'beside';

  /** Under the control, which of its edges it lines up with: the left, or the right. */
  readonly align?: 'start' | 'end';

  /** What is in it. */
  readonly children: ReactNode;

  /** Extra classes for the panel. */
  readonly className?: string;
};

/**
 * Renders a popover.
 *
 * @param props - See {@link PopoverProps}.
 * @returns The panel, portalled, or nothing while shut.
 */
export function Popover(props: PopoverProps) {
  const {
    anchor,
    isOpen,
    onClose,
    label,
    width,
    side = 'below',
    align = 'start',
    children,
    className,
  } = props;
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ at: Placement; host: HTMLElement } | null>(null);

  // Beside the control, how tall the panel came out: what keeps its foot inside the window.
  const [height, setHeight] = useState(0);

  // The caller's latest onClose, without measuring again whenever a render makes a new one.
  const close = useEffectEvent(onClose);

  // A layout effect, so a popover opened again is measured before it is painted where it was.
  useLayoutEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    /** Measures against the control again. */
    const follow = (): void => {
      const element = anchor.current;

      if (element !== null) {
        setPlace({
          at:
            side === 'beside'
              ? placeBeside(element, width ?? element.offsetWidth, MAX_POPOVER_HEIGHT)
              : placeUnder(element, MAX_POPOVER_HEIGHT),
          host: hostFor(element),
        });
      }
    };

    /**
     * Whether a press is in a list a control of the panel opened: a select's options are portalled
     * out of it, to the page or the dialog, and named by the select's `aria-controls`.
     *
     * @param target - What was pressed.
     * @returns True inside such a list.
     */
    const isInOwnedList = (target: Node): boolean => {
      for (
        let node = target instanceof Element ? target : target.parentElement;
        node !== null;
        node = node.parentElement
      ) {
        if (
          node.id !== '' &&
          panel.current?.querySelector(`[aria-controls="${CSS.escape(node.id)}"]`) != null
        ) {
          return true;
        }
      }

      return false;
    };

    /**
     * Whether a press is in a popover opened from inside this one, however deep: its control is
     * in this panel, or in a popover that is.
     *
     * @param target - What was pressed.
     * @returns True inside such a popover.
     */
    const isInNestedPopover = (target: Node): boolean => {
      let other = (target instanceof Element ? target : target.parentElement)?.closest(
        '[data-popover]',
      );

      while (other !== null && other !== undefined && other !== panel.current) {
        const control = ANCHORS.get(other)?.current ?? null;

        if (control === null) {
          return false;
        }

        if (panel.current?.contains(control) ?? false) {
          return true;
        }

        other = control.closest('[data-popover]');
      }

      return false;
    };

    /**
     * Closes on a press outside the panel, the control and the lists the panel opened.
     *
     * @param event - The press.
     */
    const onPress = (event: PointerEvent): void => {
      const target = event.target as Node;

      if (
        !(panel.current?.contains(target) ?? false) &&
        !(anchor.current?.contains(target) ?? false) &&
        !isInOwnedList(target) &&
        !isInNestedPopover(target)
      ) {
        close();
      }
    };

    /**
     * Closes on Escape wherever the focus is: a popover opened by a press keeps no focus of its
     * own. One the panel took is stopped there (`onKeyDown`), so it closes once.
     *
     * @param event - The key press.
     */
    const onEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        close();
      }
    };

    follow();
    globalThis.addEventListener('scroll', follow, true);
    globalThis.addEventListener('resize', follow);
    // Captured, so a press whose handler stops it - a calendar block starting a drag - still
    // closes the popover it lands outside.
    globalThis.document.addEventListener('pointerdown', onPress, true);
    globalThis.document.addEventListener('keydown', onEscape);

    return () => {
      globalThis.removeEventListener('scroll', follow, true);
      globalThis.removeEventListener('resize', follow);
      globalThis.document.removeEventListener('pointerdown', onPress, true);
      globalThis.document.removeEventListener('keydown', onEscape);
    };
  }, [anchor, isOpen, side, width]);

  // Measured once drawn and before it is painted, so it never shows past the window's foot.
  useLayoutEffect(() => {
    if (side === 'beside' && place !== null) {
      setHeight(panel.current?.offsetHeight ?? 0);
    }
  }, [side, place]);

  if (!isOpen || place === null) {
    return null;
  }

  const placement = place.at;

  const panelWidth = Math.min(width ?? placement.width, globalThis.innerWidth - EDGE * 2);
  const wanted =
    side === 'below' && align === 'end'
      ? placement.left + placement.width - panelWidth
      : placement.left;
  const left = Math.max(EDGE, Math.min(wanted, globalThis.innerWidth - panelWidth - EDGE));
  const top =
    side === 'beside' && placement.top !== undefined
      ? Math.max(EDGE, Math.min(placement.top, globalThis.innerHeight - EDGE - height))
      : placement.top;

  /**
   * Keeps Escape to the popover.
   *
   * @param event - The key press.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };

  return createPortal(
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape is caught here for whatever inside has the focus.
    <div
      ref={(element) => {
        panel.current = element;

        if (element !== null) {
          ANCHORS.set(element, anchor);
        }
      }}
      data-popover=""
      role="dialog"
      aria-label={label}
      onKeyDown={onKeyDown}
      /* eslint-disable-next-line react/forbid-dom-props -- a position measured from the control
         when the popover opens and again whenever anything under it scrolls: a value no class can
         carry (RULES.md 15.3). */
      style={{
        position: 'fixed',
        left,
        width: panelWidth,
        maxHeight: placement.maxHeight,
        ...(top === undefined ? {} : { top }),
        ...(placement.bottom === undefined ? {} : { bottom: placement.bottom }),
      }}
      className={cn(
        'z-50 flex animate-rise flex-col overflow-hidden rounded-card border border-border-strong',
        'bg-surface-raised text-foreground shadow-popover',
        className,
      )}
    >
      {children}
    </div>,
    place.host,
  );
}
