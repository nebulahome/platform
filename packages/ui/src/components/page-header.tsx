/**
 * The top of every page: a mono breadcrumb or the way back, the page's title in `display` with its
 * meta beside it, and the page's own controls on the right.
 *
 * One component for every page, so that every page names itself the same way. The title wraps
 * rather than truncating: the controls drop under it on a narrow window. No rule under it - the
 * page's blocks start 20px below.
 *
 * The breadcrumb and the controls are slots rather than data: a back link is a router link, a
 * search is a field, and the header does not need to know which.
 */
import type { ReactNode } from 'react';

import { cn } from '../lib/cn.js';

/** What a page header needs. */
export type PageHeaderProps = {
  /** The page's title: one per screen. */
  readonly title: ReactNode;

  /** Above the title: a crumb in the label style, or a back link. */
  readonly crumb?: ReactNode;

  /** Beside the title, in mono: a count and the facts after it. */
  readonly meta?: ReactNode;

  /** On the right: a search, a filter, and at most one primary button. */
  readonly actions?: ReactNode;

  /** Under the title row, full width: the page's tabs. */
  readonly tabs?: ReactNode;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * Renders a page's header.
 *
 * @param props - See {@link PageHeaderProps}.
 * @returns The header.
 */
export function PageHeader(props: PageHeaderProps) {
  const { title, crumb, meta, actions, tabs, className } = props;

  return (
    <header className={cn('flex flex-col gap-5', className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-col gap-2">
          {crumb === undefined ? null : (
            <div className="flex items-center gap-1.5 font-mono text-label text-foreground-subtle uppercase">
              {crumb}
            </div>
          )}
          <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
            <h1 className="text-display font-medium break-words text-foreground">{title}</h1>
            {meta === undefined ? null : (
              <span className="font-mono text-mono-ui text-foreground-subtle tabular">{meta}</span>
            )}
          </div>
        </div>

        {actions === undefined ? null : (
          <div className="flex flex-wrap items-center gap-2.5">{actions}</div>
        )}
      </div>

      {tabs}
    </header>
  );
}
