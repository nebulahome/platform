/**
 * A small `i` that explains something when you hover it or focus it.
 *
 * The accessible name of the button *is* the explanation, and the bubble is marked
 * `aria-hidden`. That is the arrangement that works for everyone without saying anything twice:
 * a screen reader reads the sentence from the button, and a sighted person reads it from the
 * bubble. The common alternative - a button labelled "more information" describing a tooltip -
 * announces "more information" and then the same sentence again.
 *
 * It opens on focus as well as on hover, because a control that only reveals itself to a mouse
 * is invisible to a keyboard.
 *
 * A hint is for something worth knowing and not worth a line of permanent copy. Anything a
 * person must read before acting belongs on the page, where it cannot be missed.
 *
 * Which way it opens is measured, not chosen. Upward reads better - the bubble sits over the
 * page rather than pushing the eye down past the control - but a hint near the top of a dialog
 * has nothing above it, and Chrome gives `<dialog>` an `overflow: auto` of its own, so a bubble
 * that ran past the top edge came back with its first line sliced off.
 *
 * What is measured is the room inside the nearest ancestor that clips, not the room in the
 * window. Those are the same thing on a page and quite different inside a dialog, which is
 * exactly where this first went wrong: there were three hundred pixels above the button and none
 * of them were reachable.
 */
import { useRef, useState } from 'react';

import { cn } from '@nebulahome/ui';

import { InfoIcon } from '@/components/icons';

/** Which side the bubble opens towards. */
export type HintSide = 'top' | 'bottom';

/** How much room the bubble needs above the button before it gives up and opens downward. */
const ROOM_NEEDED = 150;

/**
 * Finds the top edge of whatever would clip the bubble.
 *
 * @param element - The button the bubble hangs off.
 * @returns The distance from the top of the window to the first ancestor that clips its
 * overflow, or zero when nothing does and the window is the only limit.
 */
function clippingTop(element: HTMLElement): number {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    if (globalThis.getComputedStyle(node).overflowY !== 'visible') {
      return node.getBoundingClientRect().top;
    }
  }

  return 0;
}

/** What a hint needs. */
export type HintProps = {
  /** The explanation. Becomes both the bubble and the button's accessible name. */
  readonly text: string;

  /** Anything extra for the button. */
  readonly className?: string;
};

/**
 * Renders a hint.
 *
 * @param props - See {@link HintProps}.
 * @returns The hint.
 */
export function Hint(props: HintProps) {
  const { text, className } = props;
  const button = useRef<HTMLButtonElement>(null);
  const [isOpen, setOpen] = useState(false);
  const [side, setSide] = useState<HintSide>('top');

  /**
   * Opens the bubble on whichever side has room for it.
   */
  const open = (): void => {
    const element = button.current;
    const room =
      element === null
        ? Number.POSITIVE_INFINITY
        : element.getBoundingClientRect().top - clippingTop(element);

    setSide(room < ROOM_NEEDED ? 'bottom' : 'top');
    setOpen(true);
  };

  return (
    <span className="relative inline-flex">
      <button
        ref={button}
        type="button"
        aria-label={text}
        onMouseEnter={open}
        onMouseLeave={() => {
          setOpen(false);
        }}
        onFocus={open}
        onBlur={() => {
          setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        className={cn(
          'inline-flex size-4 items-center justify-center rounded-full text-foreground-subtle',
          'transition-colors hover:text-foreground-muted',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          className,
        )}
      >
        <InfoIcon width="15" height="15" />
      </button>

      {isOpen ? (
        <span
          // Hidden from a screen reader on purpose: it would be the second reading of a sentence
          // the button has already announced.
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute left-1/2 z-30 w-56 -translate-x-1/2 rounded-chip',
            'border border-border bg-surface-raised px-3 py-2 text-caption leading-relaxed',
            'text-foreground-muted shadow-lg shadow-black/40',
            side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
          )}
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}
