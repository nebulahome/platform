/**
 * The foot of a long table: which rows these are - "41–60 of 148" - how many to a page, and the
 * pager.
 *
 * The pager shows every page up to seven, and past that the first, the last and the two around
 * the current one with a gap between; under 640px it is "3 / 8" between the arrows. The current
 * page is outlined; the arrow that leads nowhere is disabled rather than hidden, so the pager does
 * not move under the pointer. A table with one page shows the count and no pager.
 */
import { Trans, useTranslation } from 'react-i18next';

import { cn } from '../lib/cn.js';

import { AppIcon } from './app-icon.js';
import { SelectField } from './select-field.js';

/** A slot of the pager: a page, or the gap between two runs of them. */
export type PageSlot = number | 'gap';

/**
 * Which pages the pager shows.
 *
 * @param page - The current page, from 1.
 * @param pageCount - How many there are.
 * @returns The pages and gaps, in order.
 */
export function pageSlots(page: number, pageCount: number): readonly PageSlot[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (unused, index) => index + 1);
  }

  const around = [page - 1, page, page + 1].filter((each) => each > 1 && each < pageCount);
  const slots: PageSlot[] = [1];

  // A gap of exactly one page is that page: "1 … 3" says less than "1 2 3".
  const first = around[0] ?? pageCount;
  if (first === 3) {
    slots.push(2);
  } else if (first > 3) {
    slots.push('gap');
  }
  slots.push(...around);
  const last = around.at(-1) ?? 1;
  if (last === pageCount - 2) {
    slots.push(pageCount - 1);
  } else if (last < pageCount - 2) {
    slots.push('gap');
  }
  slots.push(pageCount);

  return slots;
}

/** What the pager needs. */
export type PaginationProps = {
  /** The current page, from 1. */
  readonly page: number;

  /** How many pages there are. */
  readonly pageCount: number;

  /** Called with the page to go to. */
  readonly onPage: (page: number) => void;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/** The classes of one round button of the pager. */
const SLOT =
  'press inline-flex size-8.5 shrink-0 items-center justify-center rounded-full border font-mono text-mono-ui tabular ' +
  'transition-colors disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * Renders the pager.
 *
 * @param props - See {@link PaginationProps}.
 * @returns The pager, or nothing for a single page.
 */
export function Pagination(props: PaginationProps) {
  const { t } = useTranslation();
  const { page, pageCount, onPage, className } = props;

  if (pageCount <= 1) {
    return null;
  }

  return (
    <nav
      aria-label={t('ui.pagination.pages', 'Pages')}
      className={cn('flex items-center gap-1.5', className)}
    >
      <button
        type="button"
        aria-label={t('ui.pagination.previous', 'Previous page')}
        disabled={page <= 1}
        onClick={() => {
          onPage(page - 1);
        }}
        className={cn(SLOT, 'border-border text-foreground-muted enabled:hover:bg-surface-raised')}
      >
        <AppIcon id="chevron-left" size={16} />
      </button>

      <span className="font-mono text-mono-ui text-foreground-muted tabular sm:hidden">
        {page} / {pageCount}
      </span>

      <span className="hidden items-center gap-1.5 sm:flex">
        {pageSlots(page, pageCount).map((slot, index) =>
          slot === 'gap' ? (
            <span
              // Two gaps can stand in one pager; their place tells them apart.
              key={`gap-${String(index)}`}
              aria-hidden="true"
              className="w-6 text-center text-foreground-subtle"
            >
              …
            </span>
          ) : (
            <button
              key={slot}
              type="button"
              aria-label={t('ui.pagination.page', 'Page {{page}}', { page: slot })}
              aria-current={slot === page ? 'page' : undefined}
              onClick={() => {
                onPage(slot);
              }}
              className={cn(
                SLOT,
                slot === page
                  ? 'border-border-strong bg-surface-raised text-foreground'
                  : 'border-transparent text-foreground-muted hover:bg-surface-raised hover:text-foreground',
              )}
            >
              {slot}
            </button>
          ),
        )}
      </span>

      <button
        type="button"
        aria-label={t('ui.pagination.next', 'Next page')}
        disabled={page >= pageCount}
        onClick={() => {
          onPage(page + 1);
        }}
        className={cn(SLOT, 'border-border text-foreground-muted enabled:hover:bg-surface-raised')}
      >
        <AppIcon id="chevron-right" size={16} />
      </button>
    </nav>
  );
}

/** What the table's foot needs. */
export type TableFooterProps = {
  /** The current page, from 1. */
  readonly page: number;

  /** How many rows a page holds. */
  readonly size: number;

  /** How many rows there are in all, after any search or filter. */
  readonly total: number;

  /** Called with the page to go to. */
  readonly onPage: (page: number) => void;

  /** The sizes a page can be. */
  readonly sizes?: readonly number[];

  /** Called with the size chosen; the list goes back to its first page. */
  readonly onSize?: (size: number) => void;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * Renders the foot of a paged table.
 *
 * @param props - See {@link TableFooterProps}.
 * @returns The foot, or nothing for an empty table.
 */
export function TableFooter(props: TableFooterProps) {
  const { t } = useTranslation();
  const { page, size, total, onPage, sizes = [20, 50, 100], onSize, className } = props;

  if (total === 0) {
    return null;
  }

  const pageCount = Math.max(1, Math.ceil(total / size));
  const from = (page - 1) * size + 1;
  const to = Math.min(total, page * size);

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-border px-5 py-3',
        className,
      )}
    >
      <p className="text-ui-sm text-foreground-subtle">
        <Trans
          i18nKey="ui.pagination.range"
          defaults="<0>{{from}}–{{to}}</0> of <1>{{total}}</1>"
          values={{ from, to, total }}
          components={[
            <span key="range" className="font-mono text-mono-ui text-foreground tabular" />,
            <span key="total" className="font-mono text-mono-ui tabular" />,
          ]}
        />
      </p>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {onSize === undefined || total <= (sizes[0] ?? size) ? null : (
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-ui-sm text-foreground-subtle">
              {t('ui.pagination.perPage', 'Per page')}
            </span>
            <SelectField
              label={t('ui.pagination.perPage', 'Per page')}
              isLabelHidden
              className="w-22"
              options={sizes.map((each) => ({ value: String(each), label: String(each) }))}
              value={String(size)}
              onChange={(value) => {
                onSize(Number(value));
              }}
            />
          </div>
        )}
        <Pagination page={page} pageCount={pageCount} onPage={onPage} />
      </div>
    </div>
  );
}
