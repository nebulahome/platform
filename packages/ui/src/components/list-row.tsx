/**
 * The rows of a detail page's panels: its devices, what it provides, its ports, a device's
 * controls and sensors.
 *
 * A row is a 36px glyph well, a name with a line under it, a mono figure on the right, a status
 * or a control, and a chevron when the row opens something. The rows sit in a {@link RowList}:
 * `surface`, a 1px `border`, 16px round, each row drawing the line above it but the first.
 *
 * A row that opens a page is the router's link, so the caller renders it: {@link ListRow} takes
 * `wrap` and hands it the classes and the parts, the way a tile is put inside its link.
 */
import type { ReactNode } from 'react';

import { cn } from '../lib/cn.js';

import { AppIcon } from './app-icon.js';

/** The classes of the line at the foot of a list that opens all of it: "All devices ›". */
export const ROW_LIST_MORE =
  'flex items-center gap-1.5 border-t border-border py-3 text-ui-sm text-primary ' +
  'transition-colors hover:text-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-primary';

/** What the list needs. */
export type RowListProps = {
  /** The rows: {@link ListRow}s, then a {@link ROW_LIST_MORE} line when there are more. */
  readonly children: ReactNode;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * Renders the panel the rows sit in.
 *
 * @param props - See {@link RowListProps}.
 * @returns The panel.
 */
export function RowList(props: RowListProps) {
  const { children, className } = props;

  return (
    <div
      className={cn(
        'flex flex-col rounded-card border border-border bg-surface px-5 py-0.5',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** What a row needs. */
export type ListRowProps = {
  /** Before the well: the line a row behind a bridge hangs from. */
  readonly lead?: ReactNode;

  /** The glyph in its well, coloured by the caller. */
  readonly icon?: ReactNode;

  /** Its name. */
  readonly title: ReactNode;

  /** A line under it: what it is, where it is. */
  readonly subtitle?: ReactNode;

  /** On the right, in mono: a count, a reading. */
  readonly meta?: ReactNode;

  /** At the right edge: a Pill, a Switch, a value. */
  readonly trailing?: ReactNode;

  /** Whether the row opens something, and says so with a chevron. */
  readonly hasChevron?: boolean;

  /**
   * Puts the parts inside the element that opens them: a router link.
   *
   * @param className - The row's classes, for the element.
   * @param parts - What the row shows.
   * @returns The row.
   */
  readonly wrap?: (className: string, parts: ReactNode) => ReactNode;
};

/** The classes every row shares, whether it is a link or not. */
const ROW =
  'flex min-w-0 items-center gap-4.5 border-t border-border py-3.5 first:border-t-0 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * Renders one row.
 *
 * @param props - See {@link ListRowProps}.
 * @returns The row.
 */
export function ListRow(props: ListRowProps) {
  const { lead, icon, title, subtitle, meta, trailing, hasChevron = false, wrap } = props;

  const parts = (
    <>
      <span className="flex min-w-0 grow items-center gap-3.5">
        {lead}
        {icon === undefined ? null : (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-field bg-surface-raised text-foreground-muted">
            {icon}
          </span>
        )}
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-ui font-medium text-foreground">{title}</span>
          {subtitle === undefined ? null : (
            <span className="truncate text-ui-sm text-foreground-subtle">{subtitle}</span>
          )}
        </span>
      </span>
      {meta === undefined ? null : (
        <span className="shrink-0 font-mono text-mono-ui text-foreground-subtle tabular">
          {meta}
        </span>
      )}
      {trailing === undefined && !hasChevron ? null : (
        <span className="flex shrink-0 items-center gap-2.5">
          {trailing}
          {hasChevron ? (
            <AppIcon id="chevron-right" size={16} className="text-foreground-subtle" />
          ) : null}
        </span>
      )}
    </>
  );

  if (wrap !== undefined) {
    return wrap(cn(ROW, 'transition-colors hover:text-foreground'), parts);
  }

  return <div className={ROW}>{parts}</div>;
}
