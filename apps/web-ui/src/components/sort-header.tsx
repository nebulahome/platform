/**
 * A column heading that sorts its table: the heading in the mono label style, and an arrow that
 * says whether the table is sorted by it and which way - up, down, or a faint pair while it is not.
 *
 * A button, so the keyboard reaches it; `aria-sort` on the heading cell is the caller's, which
 * knows the cell.
 */
import { useTranslation } from 'react-i18next';

import { AppIcon, cn } from '@nebulahome/ui';

import type { SortDirection } from '@/lib/use-paging';

/** What the heading needs. */
export type SortHeaderProps = {
  readonly label: string;

  /** Whether the table is sorted by this column. */
  readonly isSorted: boolean;

  /** Which way, when it is. */
  readonly direction: SortDirection;

  /** Sorts by it, or turns the order round. */
  readonly onSort: () => void;

  /** Anything extra for the button. */
  readonly className?: string;
};

/**
 * Renders the heading.
 *
 * @param props - See {@link SortHeaderProps}.
 * @returns The button.
 */
export function SortHeader(props: SortHeaderProps) {
  const { t } = useTranslation();
  const { label, isSorted, direction, onSort, className } = props;

  return (
    <button
      type="button"
      onClick={onSort}
      aria-label={t('sort.by', 'Sort by {{label}}', { label: label.toLowerCase() })}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-chip font-mono text-label uppercase transition-colors',
        isSorted ? 'text-foreground' : 'text-foreground-subtle hover:text-foreground-muted',
        className,
      )}
    >
      {label}
      <AppIcon
        id={isSorted ? (direction === 'asc' ? 'arrow-up' : 'arrow-down') : 'arrow-up-down'}
        size={12}
        className={isSorted ? 'text-primary' : undefined}
      />
    </button>
  );
}
