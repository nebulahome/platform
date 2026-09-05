/**
 * The frame the unauthenticated screens share, and the way they arrive.
 *
 * The mark is one element for the whole sequence. While the application is working out which
 * screen to show it sits alone in the middle of the viewport, large and turning; when the answer
 * arrives the card grows underneath it and the mark rises to its place above it. That reads as
 * one thing settling rather than as two screens swapping, and it only works because the same
 * node is on screen throughout - a splash that unmounts and a form that mounts can cross-fade,
 * but they cannot move.
 *
 * The card's height is animated with `grid-template-rows` from `0fr` to `1fr`, which is the one
 * way to transition to a height nobody has measured. The obvious alternative - translating the
 * mark down by half the card's height - needs that number, and the number is different on every
 * one of these screens.
 *
 * The mark's rise is a consequence of that, not a second animation. The column is centred, so as
 * the card takes up height below it the mark is pushed upward - roughly two hundred pixels, over
 * the same nine hundred milliseconds and the same easing curve. Two transitions that nearly
 * agree read as two things happening; the same duration and the same curve read as one.
 */
import type { ReactNode } from 'react';

import { Logo } from '@nebula-home/ui';

import { Aurora } from '@/components/aurora';

/** What the frame needs. */
export type AuthLayoutProps = {
  /**
   * Whether the application is still deciding what to show.
   *
   * The card is collapsed and the mark turns while this is true.
   */
  readonly isLoading?: boolean;

  /** The heading inside the card. */
  readonly title?: string;

  /** The line under it. */
  readonly subtitle?: string;

  /** The form. */
  readonly children?: ReactNode;

  /** Anything below the card, such as a way back. */
  readonly footer?: ReactNode;
};

/**
 * Renders the frame.
 *
 * @param props - See {@link AuthLayoutProps}.
 * @returns The page.
 */
export function AuthLayout(props: AuthLayoutProps) {
  const { isLoading = false, title, subtitle, children, footer } = props;

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-canvas px-4 py-10">
      <Aurora />

      <div className="relative flex w-full max-w-[400px] flex-col items-center">
        <div
          className={`flex items-center transition-transform duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
            isLoading ? 'scale-[2.8]' : 'scale-100'
          }`}
        >
          <Logo size={30} isSpinning={isLoading} />

          {/*
           * The wordmark collapses to nothing rather than merely turning transparent, and the
           * difference is the whole reason the mark looks centred. A transparent word still
           * occupies its width, so the row being centred would put the mark to the left of the
           * middle of an otherwise empty screen - visibly, and for a second and a bit.
           *
           * Collapsing a column from `0fr` is the same technique the card uses below, which also
           * means the word unfolds on the same curve rather than fading in over it - and it is
           * nested the same way, with the clipping element between the grid and the content.
           * Padding on the grid item itself does not collapse with the column: it survives at
           * full width and leaves the mark half a gap left of centre, on an otherwise empty
           * screen, for a second and a bit.
           */}
          <div
            className={`grid transition-[grid-template-columns,opacity] duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
              isLoading ? 'grid-cols-[0fr] opacity-0' : 'grid-cols-[1fr] opacity-100'
            }`}
          >
            <div className="overflow-hidden">
              <span className="pl-3 text-lg font-medium tracking-tight whitespace-nowrap">
                Nebula
              </span>
            </div>
          </div>
        </div>

        <div
          className={`grid w-full transition-[grid-template-rows,opacity] duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
            isLoading ? 'grid-rows-[0fr] opacity-0' : 'mt-7 grid-rows-[1fr] opacity-100'
          }`}
        >
          <div className="overflow-hidden">
            <div className="flex flex-col gap-6 rounded-[18px] border border-border bg-surface/80 p-7 backdrop-blur-xl">
              <div className="flex flex-col gap-1.5">
                <h1 className="text-xl font-medium tracking-tight">{title}</h1>
                <p className="text-[13px] text-foreground-subtle">{subtitle}</p>
              </div>

              {children}
            </div>

            {footer === undefined ? null : (
              <div className="mt-6 text-center text-xs text-foreground-subtle">{footer}</div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
