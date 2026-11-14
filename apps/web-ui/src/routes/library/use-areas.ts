/**
 * The areas, read once and shared by the areas page and the device dialog.
 *
 * Both want the same tree - one to draw it, the other to offer the rooms - so both read the
 * same key, and a room made on the page is in the dialog's dropdown without a reload.
 */
import { useQuery } from '@tanstack/react-query';

import type { AreaView } from '@nebulahome/contracts';

import { buildAreaTree, type HouseTree } from '@/lib/area-tree';
import { signalled } from '@/lib/signalled';
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

  /** The name of an area, or null for none or one not (yet) read. */
  readonly roomOf: (areaId: string | null) => string | null;
};

/**
 * Reads the areas.
 *
 * @returns See {@link Areas}.
 */
export function useAreas(): Areas {
  const query = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.areas,
    queryFn: signalled(fetchAreas),
  });
  const areas = query.data ?? [];
  const names = new Map(areas.map((area) => [area.id, area.name]));

  /**
   * The name of an area.
   *
   * @param areaId - The area, or null for none.
   * @returns Its name, or null.
   */
  const roomOf = (areaId: string | null): string | null =>
    areaId === null ? null : (names.get(areaId) ?? null);

  return {
    areas,
    tree: buildAreaTree(areas),
    isPending: query.isPending,
    isError: query.isError,
    roomOf,
  };
}
