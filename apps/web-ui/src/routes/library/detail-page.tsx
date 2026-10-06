/**
 * The frame a page about one thing sits in: a device, an entity.
 *
 * The header names where the thing is the way the navigation does - Devices, then the device,
 * then the entity - each step a link back, the last one the thing itself; its controls sit on the
 * right, the settings button among them. Under it the page scrolls, and while the thing is being
 * read, or cannot be, a dashed outline says so where the content would be.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { cn } from '@nebulahome/ui';

/** One step of the way back. */
export type Crumb = {
  readonly to: string;
  readonly label: string;
};

/** What the header needs. */
export type DetailHeaderProps = {
  /** The pages above this one, outermost first. */
  readonly crumbs: readonly Crumb[];

  /** What this page is about. */
  readonly title: string;

  /** Controls on the right. */
  readonly actions?: ReactNode;
};

/**
 * The page's header: where the thing is, and what can be done to it.
 *
 * @param props - See {@link DetailHeaderProps}.
 * @returns The header.
 */
export function DetailHeader(props: DetailHeaderProps) {
  const { crumbs, title, actions } = props;

  return (
    <header className="flex min-h-17 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-6 py-2.5">
      <h1 className="flex min-w-0 items-center gap-2 text-headline-sm tracking-tight">
        {crumbs.map((crumb) => (
          <span key={crumb.to} className="flex min-w-0 items-center gap-2">
            <Link
              to={crumb.to}
              className="max-w-48 truncate text-foreground-muted transition-colors hover:text-foreground"
            >
              {crumb.label}
            </Link>
            <span aria-hidden="true" className="font-light text-foreground-subtle">
              /
            </span>
          </span>
        ))}
        <span className="truncate font-semibold">{title}</span>
      </h1>

      {actions === undefined ? null : (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

/**
 * A line where the page's content would be, while it is read or when it cannot be.
 *
 * @param props - What to say, and whether it is a failure.
 * @param props.children - The sentence.
 * @param props.isProblem - Whether it reports a failure rather than a wait.
 * @returns The placeholder.
 */
export function DetailPlaceholder(props: {
  readonly children: string;
  readonly isProblem?: boolean;
}) {
  const { children, isProblem = false } = props;

  return (
    <div
      role={isProblem ? 'alert' : 'status'}
      className="rounded-panel border border-dashed border-border-strong px-6 py-8 text-center"
    >
      <p
        className={cn(
          'mx-auto max-w-md text-ui',
          isProblem ? 'text-danger' : 'text-foreground-muted',
        )}
      >
        {children}
      </p>
    </div>
  );
}
