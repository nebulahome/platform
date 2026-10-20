/**
 * The top of a page about one thing - an integration, a package, a container, a device, an
 * entity: the way back, its mark, its name in `display`, what it is in a line, the facts that
 * place it as pills, its actions on the right, and its tabs under all of it.
 *
 * The {@link PageHeader} of a list page names a collection; this names one thing, so it carries
 * that thing's face and state. Both are one component for every page of their kind, so that every
 * page of a kind opens the same way.
 *
 * The way back is a router link, so the page renders it, with {@link HERO_BACK} and the chevron;
 * so are the actions. The title wraps rather than truncating, and the actions drop under the name
 * on a narrow window.
 */
import type { ReactNode } from 'react';

import type { UiIconId } from '../icons/ui-set.js';
import { cn } from '../lib/cn.js';

import { AppIcon } from './app-icon.js';

/** The classes of the way back: 13px, `foreground-subtle`, a chevron before it. */
export const HERO_BACK =
  'inline-flex items-center gap-1.5 self-start rounded-chip text-ui-sm text-foreground-subtle ' +
  'transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-primary';

/** What the hero needs. */
export type DetailHeroProps = {
  /** Above everything: the way back, a link with {@link HERO_BACK}. */
  readonly back?: ReactNode;

  /** The thing's face: a {@link HeroMark}. */
  readonly mark?: ReactNode;

  /** Its name: the page's one heading. */
  readonly title: ReactNode;

  /** Beside the name, small: a mark that the page has unsaved changes, say. */
  readonly titleAside?: ReactNode;

  /** What it is, in a line. */
  readonly description?: ReactNode;

  /** The facts that place it: its state as a Pill first, then {@link HeroFact}s. */
  readonly facts?: ReactNode;

  /** On the right: at most one primary button, then ghost ones, then the menu. */
  readonly actions?: ReactNode;

  /** Under it, full width: the page's tabs. */
  readonly tabs?: ReactNode;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * Renders the top of a page about one thing.
 *
 * @param props - See {@link DetailHeroProps}.
 * @returns The header.
 */
export function DetailHero(props: DetailHeroProps) {
  const { back, mark, title, titleAside, description, facts, actions, tabs, className } = props;

  return (
    <header className={cn('flex flex-col gap-5.5', className)}>
      <div className="flex flex-col gap-4.5">
        {back}

        <div className="flex flex-wrap items-start gap-x-4.5 gap-y-4">
          {mark}

          <div className="flex min-w-0 grow basis-80 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-display font-medium break-words text-foreground">{title}</h1>
              {titleAside}
            </div>
            {description === undefined ? null : (
              <p className="text-ui text-foreground-muted">{description}</p>
            )}
            {facts === undefined ? null : (
              <div className="mt-1 flex flex-wrap items-center gap-2">{facts}</div>
            )}
          </div>

          {actions === undefined ? null : (
            <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
          )}
        </div>
      </div>

      {tabs}
    </header>
  );
}

/** What a mark needs. */
export type HeroMarkProps = {
  /** A logo, a glyph, or a monogram's letter. */
  readonly children: ReactNode;

  /** Anything extra: the monogram's colour. */
  readonly className?: string;
};

/**
 * The thing's face in the hero: a 56px square on `surface-raised` with a `border-strong` edge,
 * holding its logo, its glyph, or its monogram in mono.
 *
 * @param props - See {@link HeroMarkProps}.
 * @returns The mark.
 */
export function HeroMark(props: HeroMarkProps) {
  const { children, className } = props;

  return (
    <span
      className={cn(
        'flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-tile border border-border-strong',
        'bg-surface-raised font-mono text-reading-sm text-foreground-muted',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** What a fact needs. */
export type HeroFactProps = {
  /** What it says. */
  readonly children: ReactNode;

  /** A glyph before it. */
  readonly icon?: UiIconId;

  /** Anything extra: a tag's colour. */
  readonly className?: string;
};

/**
 * One fact of the hero, after its state: a version, how it talks, where it is. A 24px pill on
 * `surface-raised` with 12px `foreground-muted` text.
 *
 * @param props - See {@link HeroFactProps}.
 * @returns The fact.
 */
export function HeroFact(props: HeroFactProps) {
  const { children, icon, className } = props;

  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-pill bg-surface-raised px-2.5',
        'text-caption whitespace-nowrap text-foreground-muted',
        className,
      )}
    >
      {icon === undefined ? null : <AppIcon id={icon} size={13} />}
      {children}
    </span>
  );
}
