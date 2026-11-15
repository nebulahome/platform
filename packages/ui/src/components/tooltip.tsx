/**
 * A line of words that shows over a control while it is hovered or focused: what an icon button
 * does, what a truncated name says in full.
 *
 * Where a {@link Hint} is its own small `i`, a tooltip hangs off a control that is already there.
 * The control is handed `aria-describedby` while the bubble shows, so a screen reader hears the
 * words after the control's own name - which the control must still have: a tooltip adds to a
 * name, it is never the name.
 *
 * It opens on focus as well as on hover, and Escape shuts it. Which way it opens is measured as a
 * hint's is, unless the caller asks for under.
 */
import { cloneElement, useId, useRef, useState, type ReactElement } from 'react';

import { cn } from '../lib/cn.js';

import { hintSide, type HintSide } from './hint.js';

/** What a tooltip needs. */
export type TooltipProps = {
  /** What it says: a few words, one line or two. */
  readonly text: string;

  /** Which side it opens towards; over the control when not said, under it without room above. */
  readonly side?: HintSide;

  /** The control it hangs off: one element that takes `aria-describedby`. */
  readonly children: ReactElement<{ 'aria-describedby'?: string | undefined }>;

  /** Anything extra for the bubble. */
  readonly className?: string;
};

/**
 * Renders a control with its tooltip.
 *
 * @param props - See {@link TooltipProps}.
 * @returns The control, and the bubble while it shows.
 */
export function Tooltip(props: TooltipProps) {
  const { text, side = 'top', children, className } = props;
  const id = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState<HintSide | null>(null);

  /** Shows the bubble on the side asked for, or the one with room. */
  const open = (): void => {
    setShown(side === 'bottom' ? 'bottom' : hintSide(wrap.current));
  };

  /** Hides it. */
  const close = (): void => {
    setShown(null);
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the control inside is what is hovered and focused; the wrapper only hears it.
    <span
      ref={wrap}
      className="relative inline-flex"
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          close();
        }
      }}
    >
      {cloneElement(children, { 'aria-describedby': shown === null ? undefined : id })}

      {shown === null ? null : (
        // shortcut: centred on the control and not kept inside the window, so a control at the
        // very edge of a page clips it; portal it like Popover when one needs to sit there.
        <span
          id={id}
          role="tooltip"
          className={cn(
            'pointer-events-none absolute left-1/2 z-30 w-max max-w-56 -translate-x-1/2 rounded-chip',
            'border border-border-strong bg-surface px-2.5 py-1.5 text-caption text-foreground-muted',
            'shadow-float',
            shown === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
            className,
          )}
        >
          {text}
        </span>
      )}
    </span>
  );
}
