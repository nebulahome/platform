/**
 * What a list says when there is nothing in it yet: what the thing is for, the step that makes the
 * first one, and where to read more.
 *
 * Centred in the space the list would fill, with its icon in a soft well of the accent and a faint
 * ring of light around it - the first thing a new installation shows on these pages, so it is
 * drawn as an invitation rather than as an apology. The content rules: sentence case, no
 * exclamation marks, and the next step inside it (design/README.md).
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../lib/cn.js';

import { AppIcon } from './app-icon.js';

/** What an empty state needs. */
export type EmptyStateProps = {
  /** The glyph in the well: an `AppIcon`. */
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
 * Renders an empty state.
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
        'flex grow flex-col items-center justify-center gap-5 px-6 py-16 text-center',
        className,
      )}
    >
      <div className="relative flex items-center justify-center">
        <span
          aria-hidden="true"
          className="absolute size-28 rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--color-primary)_16%,transparent),transparent)]"
        />
        <span className="relative flex size-16 items-center justify-center rounded-panel bg-primary/10 text-primary ring-1 ring-primary/20">
          {icon}
        </span>
      </div>

      <div className="flex max-w-md flex-col items-center gap-2">
        <h2 className="text-headline-sm font-medium text-foreground">{title}</h2>
        <p className="text-ui text-foreground-muted">{description}</p>
      </div>

      {action === undefined && learnMoreHref === undefined ? null : (
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
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
  );
}
