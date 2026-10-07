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

import { AppIcon, cn, HERO_BACK, PageHeader } from '@nebulahome/ui';

import { ChevronLeftIcon } from '@/components/icons';
import { toMessage } from '@/lib/error-message';

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
    <div className="shrink-0 px-8 pt-7">
      <PageHeader
        className="mx-auto max-w-7xl"
        title={title}
        crumb={
          crumbs.length === 0 ? undefined : (
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
              <ChevronLeftIcon width={14} height={14} className="shrink-0" />
              {crumbs.map((crumb, index) => (
                <span key={crumb.to} className="flex min-w-0 items-center gap-1.5">
                  {index === 0 ? null : (
                    <span aria-hidden="true" className="text-foreground-subtle">
                      /
                    </span>
                  )}
                  <Link
                    to={crumb.to}
                    className="max-w-48 truncate rounded-chip font-sans text-ui-sm tracking-normal normal-case transition-colors hover:text-foreground"
                  >
                    {crumb.label}
                  </Link>
                </span>
              ))}
            </nav>
          )
        }
        actions={actions}
      />
    </div>
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

/** What the way back needs. */
export type BackLinkProps = {
  /** Where it goes. */
  readonly to: string;

  /** What it is called: the page above. */
  readonly children: ReactNode;
};

/**
 * The way back at the top of a detail page: "‹ Integrations".
 *
 * @param props - See {@link BackLinkProps}.
 * @returns The link.
 */
export function BackLink(props: BackLinkProps) {
  const { to, children } = props;

  return (
    <Link to={to} className={HERO_BACK}>
      <AppIcon id="chevron-left" size={14} />
      {children}
    </Link>
  );
}

/** What the frame needs. */
export type DetailFrameProps = {
  /** The top of the page: a DetailHero, with its tabs. */
  readonly hero: ReactNode;

  /** Whether the thing is still being read. */
  readonly isPending?: boolean;

  /** Why it could not be read. */
  readonly error?: unknown;

  /** What to say instead of the error, when the page knows better: "There is no such device". */
  readonly problem?: string | undefined;

  /** The open tab's panel. */
  readonly children: ReactNode;
};

/**
 * The frame a detail page sits in: the hero, then the open tab's panel - or, while the thing is
 * read or when it cannot be, a line saying so where the panel would be. One column, 32px gutters,
 * the page scrolling under the rail.
 *
 * @param props - See {@link DetailFrameProps}.
 * @returns The page.
 */
export function DetailFrame(props: DetailFrameProps) {
  const { hero, isPending = false, error, problem, children } = props;

  return (
    <div className="min-h-0 grow overflow-y-auto px-8 pt-6 pb-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        {hero}
        {isPending ? (
          <DetailPlaceholder>Reading…</DetailPlaceholder>
        ) : problem !== undefined ? (
          <DetailPlaceholder isProblem>{problem}</DetailPlaceholder>
        ) : error === undefined || error === null ? (
          children
        ) : (
          <DetailPlaceholder isProblem>{toMessage(error)}</DetailPlaceholder>
        )}
      </div>
    </div>
  );
}
