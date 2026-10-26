/**
 * A panel that hangs off a control: the settings search's results, the icon picker.
 *
 * Bigger than a dropdown's list and holding more than options - a search field, groups, a footer
 * - so it is its own surface: `surface-raised`, `border-strong`, the `card` radius and the
 * `popover` shadow. It sits under its control (over it when there is no room below), is portalled
 * into the enclosing `<dialog>` for the reason `anchored-list.ts` gives, and follows the control
 * while anything scrolls.
 *
 * It closes on a press outside it and its control, and on Escape - which it keeps from reaching
 * the document, where a dialog underneath listens for it too, so one press closes the popover
 * alone. Where the focus goes is the content's business: a picker moves it into its own search,
 * the settings search keeps it in the field that opened it.
 */
import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import { hostFor, placeUnder, type Placement } from '../lib/anchored-list.js';
import { cn } from '../lib/cn.js';

/** The tallest a popover gets before its content scrolls. */
const MAX_POPOVER_HEIGHT = 520;

/** The space kept between a popover and the edge of the window. */
const EDGE = 8;

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
  const { anchor, isOpen, onClose, label, width, children, className } = props;
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ at: Placement; host: HTMLElement } | null>(null);

  // A layout effect, so a popover opened again is measured before it is painted where it was.
  useLayoutEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    /** Measures against the control again. */
    const follow = (): void => {
      const element = anchor.current;

      if (element !== null) {
        setPlace({ at: placeUnder(element, MAX_POPOVER_HEIGHT), host: hostFor(element) });
      }
    };

    /**
     * Closes on a press outside the panel and the control.
     *
     * @param event - The press.
     */
    const onPress = (event: PointerEvent): void => {
      const target = event.target as Node;

      if (
        !(panel.current?.contains(target) ?? false) &&
        !(anchor.current?.contains(target) ?? false)
      ) {
        onClose();
      }
    };

    follow();
    globalThis.addEventListener('scroll', follow, true);
    globalThis.addEventListener('resize', follow);
    globalThis.document.addEventListener('pointerdown', onPress);

    return () => {
      globalThis.removeEventListener('scroll', follow, true);
      globalThis.removeEventListener('resize', follow);
      globalThis.document.removeEventListener('pointerdown', onPress);
    };
  }, [anchor, isOpen, onClose]);

  if (!isOpen || place === null) {
    return null;
  }

  const placement = place.at;

  const panelWidth = Math.min(width ?? placement.width, globalThis.innerWidth - EDGE * 2);
  // Whole pixels: at a fraction, the panel's content snaps half a pixel when anything in it starts
  // a transition, and the whole panel seems to jump.
  const left = Math.round(
    Math.max(EDGE, Math.min(placement.left, globalThis.innerWidth - panelWidth - EDGE)),
  );

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
      ref={panel}
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
        ...(placement.top === undefined ? {} : { top: Math.round(placement.top) }),
        ...(placement.bottom === undefined ? {} : { bottom: Math.round(placement.bottom) }),
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
