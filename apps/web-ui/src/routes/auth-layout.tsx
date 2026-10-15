/**
 * The frame the unauthenticated screens share, and the way they arrive.
 *
 * The lockup - the mark and the word together - is one element for the whole sequence. While the
 * application is working out which screen to show it sits alone in the middle of the viewport at
 * twice its size with the mark turning; when the answer arrives it travels up to its place, and
 * the form opens underneath it. That reads as one thing settling rather than as two screens
 * swapping, and it only works because the same node is on screen throughout - a splash that
 * unmounts and a form that mounts can cross-fade, but they cannot move.
 *
 * The three parts are staggered, and the order is the point:
 *
 * 1. The card's height opens from `0fr` to `1fr`. That is what pushes the lockup upward, because
 *    the column is centred - the rise is a consequence of the layout rather than a second
 *    animation that has to be kept in step with it.
 * 2. The lockup shrinks to its resting size, on the same curve and over the same time, so the
 *    two halves of the movement read as one.
 * 3. Only then, three hundred milliseconds in, does the form itself appear - widening from seven
 *    eighths of its width as it fades. By that point the space it appears into already exists,
 *    so nothing it does moves anything else.
 *
 * `grid-template-rows` is the mechanism for the first because it is the one way to transition to
 * a height nobody has measured, and this frame is used by three screens of different heights.
 */
import type { ReactNode } from 'react';

import { Logo } from '@nebulahome/ui';

import { Sky } from '@/components/sky';

/** How much larger the lockup is while the mark is turning. */
const INTRO_SCALE = 'scale-[2.1]';

/** The curve every part of the settle shares. A firm deceleration, nothing springy. */
const SETTLE = 'ease-[cubic-bezier(0.22,1,0.36,1)]';

/** What the frame needs. */
export type AuthLayoutProps = {
  /**
   * Whether the application is still deciding what to show.
   *
   * The card is collapsed and the mark turns while this is true.
   */
  readonly isLoading?: boolean;

  /** A line above the heading: `STEP 2 OF 2`. */
  readonly eyebrow?: string | undefined;

  /** The heading inside the card. */
  readonly title?: string;

  /** The line under it. */
  readonly subtitle?: string;

  /** The form. */
  readonly children?: ReactNode;

  /** Anything below the card, such as a way back. */
  readonly footer?: ReactNode;

  /** Something between the lockup and the card: the first run's steps. */
  readonly steps?: ReactNode;

  /** Whether the card is the first run's wide one (640px) rather than sign-in's. */
  readonly isWide?: boolean;

  /**
   * A line under the lockup while it is still loading.
   *
   * For the one thing a spinning mark cannot say on its own: why it is still spinning. Nothing
   * is shown for the ordinary second or two; this is for a wait that has an explanation.
   */
  readonly loadingNote?: string | undefined;
};

/**
 * Renders the frame.
 *
 * @param props - See {@link AuthLayoutProps}.
 * @returns The page.
 */
export function AuthLayout(props: AuthLayoutProps) {
  const {
    isLoading = false,
    eyebrow,
    title,
    subtitle,
    children,
    footer,
    steps,
    isWide = false,
    loadingNote,
  } = props;

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-canvas px-4 py-10">
      <Sky />

      <div
        className={`relative flex w-full flex-col items-center transition-[max-width] duration-[600ms] ${SETTLE} ${
          isWide ? 'max-w-160' : 'max-w-100'
        }`}
      >
        {/*
         * The word travels with the mark rather than arriving after it. The two are one lockup,
         * and a brand mark that assembles itself on screen draws attention to the assembling
         * instead of to the brand.
         */}
        <div
          className={`flex items-center gap-3.5 transition-transform duration-[900ms] ${SETTLE} ${
            isLoading ? INTRO_SCALE : 'scale-100'
          }`}
        >
          <Logo size={34} isSpinning={isLoading} />
          <span className="text-headline font-semibold tracking-tight">Nebula Home</span>
        </div>

        {/*
         * Kept out of the lockup so it does not scale with it, and given `aria-live` so a screen
         * reader hears the wait explained rather than sitting in silence with a spinner.
         */}
        <p
          aria-live="polite"
          className={`mt-10 text-center text-caption text-foreground-subtle transition-opacity duration-500 ${
            isLoading && loadingNote !== undefined ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {isLoading ? loadingNote : undefined}
        </p>

        <div
          className={`grid w-full transition-[grid-template-rows] duration-[900ms] ${SETTLE} ${
            isLoading ? 'grid-rows-[0fr]' : 'mt-8 grid-rows-[1fr]'
          }`}
        >
          <div className="overflow-hidden">
            <div
              className={`transition-[opacity,transform] duration-[600ms] ${SETTLE} ${
                isLoading ? 'scale-x-[0.86] opacity-0' : 'scale-x-100 opacity-100 delay-300'
              }`}
            >
              {steps === undefined ? null : <div className="mb-7">{steps}</div>}
              <div className="flex flex-col gap-5.5 rounded-dialog border border-border-strong bg-glass p-7 backdrop-blur-xl">
                <div className="flex flex-col gap-1.5">
                  {eyebrow === undefined ? null : (
                    <span className="font-mono text-mono-caption tracking-[0.18em] text-primary uppercase">
                      {eyebrow}
                    </span>
                  )}
                  <h1 className="text-headline font-medium">{title}</h1>
                  <p className="text-ui text-foreground-muted">{subtitle}</p>
                </div>

                {children}
              </div>

              {footer === undefined ? null : (
                <div className="mt-6 text-center text-caption text-foreground-subtle">{footer}</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
