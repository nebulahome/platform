/**
 * The filters a list has on, as chips under its header: "Status Running ×", "Update ready ×" -
 * then how many of how many it shows, and Clear all.
 *
 * A chip is the filter's key in `foreground-subtle`, its value, and a 24px cross that takes it
 * off; a 30px pill on `surface-raised`. Clear all appears only while something is on, and the
 * count never says more than the list shows.
 */
import type { ReactNode } from 'react';

import { cn } from '../lib/cn.js';

import { AppIcon } from './app-icon.js';

/** One filter that is on. */
export type ActiveFilter = {
  /** Unique among the chips. */
  readonly id: string;

  /** What kind of filter: "Status". Absent for one that says it all: "Update ready". */
  readonly key?: string;

  /** What it is set to. */
  readonly value: string;

  /** Takes it off. */
  readonly onRemove: () => void;
};

/** What the row needs. */
export type FilterChipsProps = {
  /** The filters on. */
  readonly filters: readonly ActiveFilter[];

  /** The count: "4 of 9 shown". */
  readonly summary?: ReactNode;

  /** Takes every filter off. */
  readonly onClearAll?: () => void;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * Renders the chips, or nothing when no filter is on.
 *
 * @param props - See {@link FilterChipsProps}.
 * @returns The row.
 */
export function FilterChips(props: FilterChipsProps) {
  const { filters, summary, onClearAll, className } = props;

  if (filters.length === 0) {
    return null;
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {filters.map((filter) => (
        <span
          key={filter.id}
          className="inline-flex h-control-sm items-center gap-1.5 rounded-pill border border-border-strong bg-surface-raised pr-1 pl-3 text-ui-sm"
        >
          {filter.key === undefined ? null : (
            <span className="text-foreground-subtle">{filter.key}</span>
          )}
          <span className="text-foreground">{filter.value}</span>
          <button
            type="button"
            aria-label={`Remove ${filter.key === undefined ? '' : `${filter.key} `}${filter.value}`}
            onClick={filter.onRemove}
            className="inline-flex size-6 items-center justify-center rounded-full text-foreground-subtle transition-colors hover:bg-surface-high hover:text-foreground"
          >
            <AppIcon id="x" size={13} />
          </button>
        </span>
      ))}

      {summary === undefined ? null : (
        <span className="ml-1 text-ui-sm text-foreground-subtle">{summary}</span>
      )}

      {onClearAll === undefined ? null : (
        <button
          type="button"
          onClick={onClearAll}
          className="ml-1 rounded-chip text-ui-sm text-primary transition-colors hover:text-primary-hover"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
