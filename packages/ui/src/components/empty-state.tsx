/**
 * What a list says when there is nothing in it yet: what the thing is for, the step that makes the
 * first one, and where to read more.
 *
 * Drawn under a small sky: the page's icon floats in a lit tile at the centre of rings that turn
 * each way, each carrying a planet, with stars twinkling around and a light sweeping round the
 * middle ring (styles.css, `.intro-*`). It is the first thing a new installation shows on these
 * pages, so it is drawn as an invitation rather than as an apology. The content rules: sentence
 * case, no exclamation marks, and the next step inside it (design/README.md).
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../lib/cn.js';

import { AppIcon } from './app-icon.js';

/** What an empty state needs. */
export type EmptyStateProps = {
  /** The glyph in the tile: an `AppIcon`, 32 pixels. */
  readonly icon: ReactNode;

  /** "Create your first automation". */
  readonly title: string;

  /** What the thing is for and what it can do, in a sentence or two. */
  readonly description: ReactNode;

  /** The step that makes the first one: a primary button. Absent for somebody who may not. */
  readonly action?: ReactNode;

  /** Where to read more. Absent when there is nothing to read. */
  readonly learnMoreHref?: string;

  /** What the link says. */
  readonly learnMoreLabel?: string;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * The stars, in pixels of the 920 by 720 sky, each with its own twinkle. Written out in full so
 * Tailwind sees every class, and fixed so the sky is the same on every visit.
 */
const STARS = [
  'left-[268px] top-[171px] size-px [--delay:3.4s] [--twinkle:5.3s]',
  'left-[461px] top-[417px] size-[1.5px] [--delay:0.5s] [--twinkle:4.4s]',
  'left-[377px] top-[295px] size-[1.5px] [--delay:1.6s] [--twinkle:3.5s]',
  'left-[583px] top-[215px] size-px [--delay:0.6s] [--twinkle:4.9s]',
  'left-[523px] top-[385px] size-px [--delay:0.8s] [--twinkle:3.6s]',
  'left-[758px] top-[302px] size-[1.5px] [--delay:1.3s] [--twinkle:3.6s]',
  'left-[631px] top-[187px] size-[1.5px] [--delay:3.8s] [--twinkle:5.1s]',
  'left-[758px] top-[276px] size-[1.5px] [--delay:0.1s] [--twinkle:4.2s]',
  'left-[601px] top-[279px] size-[1.5px] [--delay:1.2s] [--twinkle:4.8s]',
  'left-[713px] top-[335px] size-[1.5px] [--delay:0.3s] [--twinkle:4.1s]',
  'left-[755px] top-[229px] size-[1.5px] [--delay:3.4s] [--twinkle:3.1s]',
  'left-[502px] top-[183px] size-px [--delay:1.8s] [--twinkle:5.1s]',
  'left-[233px] top-[140px] size-px [--delay:3s] [--twinkle:5.8s]',
  'left-[621px] top-[278px] size-[1.5px] [--delay:3.6s] [--twinkle:3.8s]',
  'left-[235px] top-[376px] size-[1.5px] [--delay:3.4s] [--twinkle:3.1s]',
  'left-[565px] top-[298px] size-[1.5px] [--delay:2.1s] [--twinkle:4.1s]',
  'left-[553px] top-[436px] size-px [--delay:1.2s] [--twinkle:4s]',
  'left-[508px] top-[413px] size-[1.5px] [--delay:2.9s] [--twinkle:3.9s]',
  'left-[199px] top-[353px] size-px [--delay:3.9s] [--twinkle:4.6s]',
  'left-[338px] top-[400px] size-[1.5px] [--delay:3.3s] [--twinkle:4.4s]',
  'left-[369px] top-[371px] size-px [--delay:3.2s] [--twinkle:4s]',
  'left-[348px] top-[289px] size-0.5 [--delay:0.4s] [--twinkle:4.3s]',
  'left-[755px] top-[329px] size-0.5 [--delay:3.8s] [--twinkle:5.1s]',
  'left-[159px] top-[379px] size-px [--delay:1.5s] [--twinkle:6s]',
  'left-[693px] top-[279px] size-0.5 [--delay:3.5s] [--twinkle:3.5s]',
  'left-[247px] top-[339px] size-[1.5px] [--delay:0.3s] [--twinkle:5.4s]',
] as const;

/** A planet's own classes: centred on its spot of the ring, popping onto it once it is there. */
const PLANET = 'intro-planet absolute -translate-1/2 rounded-full';

/**
 * Renders the sky above the words: glow, stars, four rings with their planets, the sweep and the
 * tile with the icon, as the mockup draws them (Automations, the first one).
 *
 * @param props - The icon.
 * @param props.icon - What floats in the tile.
 * @returns The sky.
 */
function Sky({ icon }: { readonly icon: ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className="intro-sky pointer-events-none absolute top-0 left-1/2 -ml-[460px] h-[720px] w-[920px]"
    >
      <span className="intro-breathe intro-glow absolute top-[130px] left-[200px] h-[400px] w-[520px] rounded-full" />

      {STARS.map((star) => (
        <span
          key={star}
          className={cn('intro-twinkle absolute rounded-full bg-foreground', star)}
        />
      ))}

      <span className="intro-spin absolute top-[255px] left-[385px] size-[150px] rounded-full border border-dashed border-border-strong [--turn:40s]">
        <span
          className={cn(
            PLANET,
            'top-[17.86%] left-[88.3%] size-1.5 bg-primary shadow-[0_0_12px_3px_color-mix(in_srgb,var(--color-primary)_45%,transparent)] [--pop:0.35s]',
          )}
        />
      </span>

      <span className="intro-spin-back absolute top-[190px] left-[320px] size-[280px] rounded-full border border-primary/14 [--enter:0.08s] [--turn:70s]">
        <span
          className={cn(
            PLANET,
            'top-[75%] left-[6.7%] size-[5px] bg-violet shadow-[0_0_10px_2px_color-mix(in_srgb,var(--color-violet)_45%,transparent)] [--pop:0.45s]',
          )}
        />
        <span
          className={cn(PLANET, 'top-[82.14%] left-[88.3%] size-[3px] bg-cyan [--pop:0.55s]')}
        />
      </span>

      <span className="intro-spin absolute top-[110px] left-[240px] size-[440px] rounded-full border border-dashed border-border [--enter:0.16s] [--turn:120s]">
        <span className={cn(PLANET, 'top-[3.02%] left-[32.9%] size-1 bg-lamp [--pop:0.65s]')} />
      </span>

      <span className="intro-spin-back absolute top-[20px] left-[150px] size-[620px] rounded-full border border-foreground-muted/50 [--enter:0.24s] [--turn:180s]">
        <span className={cn(PLANET, 'top-[32.9%] left-[3.02%] size-1 bg-cyan [--pop:0.75s]')} />
      </span>

      <span className="intro-spin intro-sweep absolute top-[190px] left-[320px] size-[280px] rounded-full [--enter:0.3s] [--turn:10s]" />

      <span className="intro-float intro-mark absolute top-[292px] left-[422px] flex size-[76px] items-center justify-center rounded-[22px] text-primary">
        {icon}
      </span>
    </div>
  );
}

/**
 * Renders an empty state.
 *
 * It runs 32 pixels out on each side, under the gutter the pages give their body (`px-8`), so the
 * sky reaches the edges of the page rather than stopping in a hard line at the gutter.
 *
 * @param props - See {@link EmptyStateProps}.
 * @returns The empty state.
 */
export function EmptyState(props: EmptyStateProps) {
  const { t } = useTranslation();
  const {
    icon,
    title,
    description,
    action,
    learnMoreHref,
    learnMoreLabel = t('ui.emptyState.learnMore', 'Learn more'),
    className,
  } = props;

  return (
    <div
      role="status"
      className={cn(
        'relative -mx-8 flex min-h-[760px] grow flex-col items-center overflow-hidden',
        className,
      )}
    >
      <Sky icon={icon} />

      <div className="relative isolate mt-[480px] flex w-full max-w-[584px] flex-col items-center px-12 text-center">
        <span
          aria-hidden="true"
          className="intro-veil absolute -inset-x-[90px] -inset-y-14 -z-10"
        />
        <h2 className="text-[22px] font-medium tracking-[-0.02em] text-foreground">{title}</h2>
        <p className="mt-3 max-w-[470px] text-ui leading-[22px] text-foreground-muted">
          {description}
        </p>

        {action === undefined && learnMoreHref === undefined ? null : (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-[18px] gap-y-3">
            {action}
            {learnMoreHref === undefined ? null : (
              <a
                href={learnMoreHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-field text-ui font-medium text-primary transition-colors hover:text-primary-hover focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none"
              >
                {learnMoreLabel}
                <AppIcon id="external-link" size={14} />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
