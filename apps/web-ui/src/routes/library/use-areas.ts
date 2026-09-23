/**
 * The areas, read once and shared by the areas page and the device dialog.
 *
 * Both want the same tree - one to draw it, the other to offer the rooms - so both read the
 * same key, and a room made on the page is in the dialog's dropdown without a reload.
 */
import { useQuery } from '@tanstack/react-query';

import type { AreaView } from '@nebula-home/contracts';

import { buildAreaTree, type HouseTree } from '@/lib/area-tree';
import { fetchAreas, LIBRARY_QUERY_KEYS } from '@/library/api';

/** What a consumer gets. */
export type Areas = {
  /** Every area, flat, in the order the owner arranged; empty until read. */
  readonly areas: readonly AreaView[];

  /** The same as a tree, or null while there is no house. */
  readonly tree: HouseTree | null;

  /** Whether the first read is still in flight. */
  readonly isPending: boolean;

  /** Whether the read failed. */
  readonly isError: boolean;
};

/**
 * Reads the areas.
 *
 * @returns See {@link Areas}.
 */
export function useAreas(): Areas {
  const query = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.areas,
    /**
     * Reads every area.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The areas.
     */
    queryFn: async ({ signal }) => fetchAreas(signal),
  });
  const areas = query.data ?? [];

  return {
    areas,
    tree: buildAreaTree(areas),
    isPending: query.isPending,
    isError: query.isError,
  };
}
