/**
 * A search of the Community Hub, as an install dialog asks it: debounced as the owner types,
 * paged by the Hub's cursor, trusted for a minute, and not asked at all while the dialog is shut.
 */
import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';

import { useDebounced } from '@/lib/use-debounced';

/** How long a search is trusted while the dialog is open: the Hub changes by the hour. */
const SEARCH_STALE_MS = 60_000;

/** How long typing has to pause before the Hub is asked. */
const DEBOUNCE_MS = 350;

/** One page of a search, as the API answers it. */
export type CatalogueSearchPage<TItem> = {
  readonly items: readonly TItem[];
  readonly nextCursor: string | null;
  readonly hubError: string | null;
};

/** What the search needs. */
export type CatalogueSearchOptions<TItem> = {
  /** What is typed. */
  readonly text: string;

  /** Whether the dialog is open: shut, the Hub is asked nothing. */
  readonly isOpen: boolean;

  /** Where a search is cached. */
  readonly keyOf: (q: string) => readonly unknown[];

  /** Asks the API for one page. */
  readonly search: (
    q: string,
    cursor: string | undefined,
    signal: AbortSignal,
  ) => Promise<CatalogueSearchPage<TItem>>;
};

/**
 * Searches the Community Hub as the owner types.
 *
 * @param options - What is typed, and how to ask.
 * @returns What was found, page after page, and why the Hub could not be asked.
 */
export function useCatalogueSearch<TItem>(options: CatalogueSearchOptions<TItem>) {
  const { text, isOpen, keyOf, search } = options;
  const query = useDebounced(text.trim(), DEBOUNCE_MS);
  const results = useInfiniteQuery<
    CatalogueSearchPage<TItem>,
    Error,
    InfiniteData<CatalogueSearchPage<TItem>>,
    readonly unknown[],
    string | undefined
  >({
    queryKey: keyOf(query),
    enabled: isOpen,
    initialPageParam: undefined,
    staleTime: SEARCH_STALE_MS,

    /**
     * Asks the Hub, through the packet-manager.
     *
     * @param context - The page's cursor and the abort signal.
     * @param context.pageParam - The page; undefined for the first.
     * @param context.signal - Cancels the request.
     * @returns The page.
     */
    queryFn: async ({ pageParam, signal }) => search(query, pageParam, signal),

    /**
     * The next page's cursor.
     *
     * @param last - The last page read.
     * @returns Its cursor, or undefined on the last.
     */
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const pages = results.data?.pages ?? [];

  return {
    /** What was asked, once the typing paused. */
    query,
    items: pages.flatMap((page) => page.items),
    hubError: pages[0]?.hubError ?? null,
    isPending: results.isPending,
    isFetching: results.isFetching,
    error: results.error,
    hasMore: results.hasNextPage,
    isLoadingMore: results.isFetchingNextPage,

    /** Reads the next page. */
    loadMore: (): void => {
      void results.fetchNextPage();
    },
  };
}
