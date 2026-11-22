/**
 * A part of a card that opens and closes in place: a run's steps, the change as a device reported
 * it, the settings a form keeps out of the way.
 *
 * It slides rather than appearing, the way the roles and the settings sections do: the box is a
 * one-row grid whose row goes from `0fr` to `1fr`, which a transition can follow where `height:
 * auto` cannot, and it fades as it goes - at once, for somebody whose system asks for less motion.
 * Closed, it is `inert` - nothing in it takes the focus or reaches a screen reader.
 *
 * What it holds is drawn the first time it opens, not before: a section nobody opens costs nothing
 * and asks the server for nothing, as it did when it was drawn only while open. Once drawn it stays,
 * so closing can slide too, and what was typed or fetched in it is still there when it opens again.
 * A part whose contents must be there while it is closed - for a search of the page - says so
 * (`isAlwaysRendered`), and is drawn from the start.
 */
import { useState, type ReactNode } from 'react';

import { cn } from '../lib/cn.js';

/** What a collapsible part needs. */
export type CollapseProps = {
  /** Whether it is open. */
  readonly isOpen: boolean;

  /** The id the button that opens it names in `aria-controls`. */
  readonly id?: string;

  /** Classes for the box what it holds is laid out in: its padding, its gap. */
  readonly className?: string;

  /** Whether what it holds is drawn before it first opens: for contents a search must find. */
  readonly isAlwaysRendered?: boolean;

  /** What it holds. */
  readonly children: ReactNode;
};

/**
 * Renders a part that opens and closes in place.
 *
 * @param props - See {@link CollapseProps}.
 * @returns The part.
 */
export function Collapse(props: CollapseProps) {
  const { isOpen, id, className, isAlwaysRendered = false, children } = props;
  const [hasOpened, setHasOpened] = useState(isOpen);

  // Adjusted while rendering rather than in an effect, so what it holds is there in the very render
  // that opens it - an effect would slide an empty box open and fill it a frame later.
  if (isOpen && !hasOpened) {
    setHasOpened(true);
  }

  return (
    <div
      id={id}
      inert={!isOpen}
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-250 ease-out motion-reduce:transition-none',
        isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
      )}
    >
      <div className="min-h-0 overflow-hidden">
        {hasOpened || isAlwaysRendered ? <div className={className}>{children}</div> : null}
      </div>
    </div>
  );
}
