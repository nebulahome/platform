/**
 * A column heading that sorts its table: the heading in the mono label style, and an arrow that
 * says whether the table is sorted by it and which way - up, down, or a faint pair while it is not.
 *
 * The heading cell and its button in one: the cell says the order to a reader (`aria-sort`), the
 * button lets the keyboard reach it. The order itself is the list's `usePaging`.
 */
import { useTranslation } from 'react-i18next';

import { AppIcon, cn } from '@nebulahome/ui';

import type { Paging } from '@/lib/use-paging';

/** What the heading needs. */
export type SortHeaderProps<TSort extends string> = {
  /** The column it sorts by. */
  readonly column: TSort;

  readonly label: string;

  /** The list's order, and the way to change it. */
  readonly paging: Pick<Paging<TSort>, 'sort' | 'direction' | 'toggleSort'>;

  /** Anything extra for the cell: when it shows, where it sits. */
  readonly className?: string | undefined;
};

/**
 * Renders the heading cell.
 *
 * @param props - See {@link SortHeaderProps}.
 * @returns The cell.
 */
export function SortHeader<TSort extends string>(props: SortHeaderProps<TSort>) {
  const { t } = useTranslation();
  const { column, label, paging, className } = props;
  const isSorted = paging.sort === column;
  const isAscending = paging.direction === 'asc';

  return (
    <span
      role="columnheader"
      aria-sort={isSorted ? (isAscending ? 'ascending' : 'descending') : 'none'}
      className={className}
    >
      <button
        type="button"
        onClick={() => {
          paging.toggleSort(column);
        }}
        aria-label={t('sort.by', 'Sort by {{label}}', { label: label.toLowerCase() })}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-chip font-mono text-label uppercase transition-colors',
          isSorted ? 'text-foreground' : 'text-foreground-subtle hover:text-foreground-muted',
        )}
      >
        {label}
        <AppIcon
          id={isSorted ? (isAscending ? 'arrow-up' : 'arrow-down') : 'arrow-up-down'}
          size={12}
          className={isSorted ? 'text-primary' : undefined}
        />
      </button>
    </span>
  );
}
