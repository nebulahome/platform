/**
 * A long list shown a page at a time, sorted by a column: the page, its size and the order, kept
 * in the address beside the list's filter.
 *
 * The lists are read whole - the API pages none of them - so the paging is the page's: it slices
 * what the filter let through. The page lives in the address so a link and the back button carry
 * it; any change of the filter drops it (`useListState`), so a narrowed list starts from its first
 * page; a page past the end - the last row of the last page deleted - reads as the last page. The
 * size is remembered for each list, in this browser only.
 */
import { useSearchParams } from 'react-router';

import { PAGE_PARAM } from '@/lib/use-list-state';

/** The sizes a page can be. */
export const PAGE_SIZES = [20, 50, 100] as const;

/** One page size. */
export type PageSize = (typeof PAGE_SIZES)[number];

/** Which way a column sorts. */
export type SortDirection = 'asc' | 'desc';

/** What a paged list knows about itself. */
export type Paging<TSort extends string> = {
  /** The page shown, from 1, already within the list. */
  readonly page: number;
  readonly size: PageSize;
  readonly sort: TSort;
  readonly direction: SortDirection;

  /** How many rows there are, after the filter. */
  readonly total: number;

  /** The rows of the page shown. */
  readonly rows: <TRow>(sorted: readonly TRow[]) => readonly TRow[];

  readonly setPage: (page: number) => void;
  readonly setSize: (size: number) => void;

  /** Sorts by a column: ascending first, the other way when it already sorts by it. */
  readonly toggleSort: (sort: TSort) => void;
};

/**
 * Where a list's size is remembered.
 *
 * @param list - The list.
 * @returns The storage key.
 */
function sizeKey(list: string): string {
  return `nebula.page-size.${list}`;
}

/**
 * The size remembered for a list.
 *
 * @param list - The list.
 * @returns The size, or the smallest when nothing is remembered or storage is unavailable.
 */
function rememberedSize(list: string): PageSize {
  try {
    const saved = Number(globalThis.localStorage.getItem(sizeKey(list)));

    return PAGE_SIZES.find((size) => size === saved) ?? PAGE_SIZES[0];
  } catch {
    return PAGE_SIZES[0];
  }
}

/**
 * Reads and sets a list's paging.
 *
 * @param list - The list, for the size remembered.
 * @param sorts - The columns it sorts by; the first is the order it opens in.
 * @param total - How many rows there are, after the filter.
 * @returns See {@link Paging}.
 */
export function usePaging<TSort extends string>(
  list: string,
  sorts: readonly [TSort, ...TSort[]],
  total: number,
): Paging<TSort> {
  const [params, setParams] = useSearchParams();
  const size =
    PAGE_SIZES.find((each) => String(each) === params.get('size')) ?? rememberedSize(list);
  const pageCount = Math.max(1, Math.ceil(total / size));
  const asked = Number(params.get(PAGE_PARAM) ?? '1');
  const page = Number.isInteger(asked) && asked >= 1 ? Math.min(asked, pageCount) : 1;
  const sort = sorts.find((each) => each === params.get('sort')) ?? sorts[0];
  const direction: SortDirection = params.get('dir') === 'desc' ? 'desc' : 'asc';

  /**
   * Writes entries to the address, leaving the rest of the query as it is.
   *
   * @param entries - What to set; null removes the entry.
   */
  const write = (entries: Readonly<Record<string, string | null>>): void => {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);

        for (const [key, value] of Object.entries(entries)) {
          if (value === null) {
            updated.delete(key);
          } else {
            updated.set(key, value);
          }
        }

        return updated;
      },
      { replace: true },
    );
  };

  return {
    page,
    size,
    sort,
    direction,
    total,

    /**
     * The rows of the page shown.
     *
     * @param sorted - Every row, in order.
     * @returns The page's.
     */
    rows: (sorted) => sorted.slice((page - 1) * size, page * size),

    /**
     * Goes to a page.
     *
     * @param next - The page, from 1.
     */
    setPage: (next) => {
      write({ [PAGE_PARAM]: next <= 1 ? null : String(next) });
    },

    /**
     * Shows so many rows to a page, from the first page, and remembers it for the list.
     *
     * @param next - The size.
     */
    setSize: (next) => {
      const chosen = PAGE_SIZES.find((each) => each === next) ?? PAGE_SIZES[0];

      try {
        globalThis.localStorage.setItem(sizeKey(list), String(chosen));
      } catch {
        // A browser that keeps nothing keeps the size for this visit, in the address.
      }

      write({ size: chosen === PAGE_SIZES[0] ? null : String(chosen), [PAGE_PARAM]: null });
    },

    /**
     * Sorts by a column, from the first page.
     *
     * @param next - The column.
     */
    toggleSort: (next) => {
      const nextDirection = next === sort && direction === 'asc' ? 'desc' : 'asc';

      write({
        sort: next === sorts[0] ? null : next,
        dir: nextDirection === 'asc' ? null : 'desc',
        [PAGE_PARAM]: null,
      });
    },
  };
}
