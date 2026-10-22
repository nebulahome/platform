/**
 * The interface's implementation of `useAreas` (package SDK 1.2) and `useAreaActions` (1.3): the
 * house, its floors and its rooms, as a package reads and changes them.
 *
 * The same read the area pages make, under the same key, so a package's page and the platform's
 * share it. A package names an area by its key - what `EntityView.areaId` holds - so the view a
 * package gets names a parent by its key too, never by the API's ids.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { AreaView as ApiAreaView } from '@nebulahome/contracts';
import type { AreaActions, AreaView } from '@nebulahome/package-sdk/ui';

import { useSession } from '@/auth/session-store';
import { createArea, deleteArea, fetchAreas, LIBRARY_QUERY_KEYS, updateArea } from '@/library/api';

/**
 * The areas as a package sees them.
 *
 * @param areas - As the API answered, in the owner's order.
 * @returns Each with its parent named by key.
 */
export function areaViewsOf(areas: readonly ApiAreaView[]): readonly AreaView[] {
  const keys = new Map(areas.map((area) => [area.id, area.key]));

  return areas.map((area) => ({
    key: area.key,
    name: area.name,
    kind: area.kind,
    parentKey: area.parentId === null ? null : (keys.get(area.parentId) ?? null),
    icon: area.icon,
    sortOrder: area.sortOrder,
    level: area.level,
    latitude: area.latitude,
    longitude: area.longitude,
  }));
}

/**
 * The areas of the house.
 *
 * @returns Them, in the owner's order; empty while they are read.
 */
export function useAreas(): readonly AreaView[] {
  const areas = useAreasQuery();

  return useMemo(() => areaViewsOf(areas.data ?? []), [areas.data]);
}

/**
 * The read both hooks share.
 *
 * @returns The query.
 */
function useAreasQuery() {
  return useQuery({
    queryKey: LIBRARY_QUERY_KEYS.areas,

    /**
     * Reads the areas.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns The areas.
     */
    queryFn: async ({ signal }) => fetchAreas(signal),
  });
}

/**
 * Changes to the areas, with the viewer's permissions; the areas, their devices and entities are
 * read again after each, as the area pages do.
 *
 * @returns What changes them.
 */
export function useAreaActions(): AreaActions {
  const client = useQueryClient();
  const areas = useAreasQuery();
  const canEdit = useSession((state) => state.can('area:write'));

  return useMemo(() => {
    /**
     * The API's id of an area, from the key a package names it by.
     *
     * @param key - Its key.
     * @returns Its id.
     */
    const idOf = async (key: string): Promise<string> => {
      const known = areas.data ?? (await fetchAreas());
      const found = known.find((area) => area.key === key);

      if (found === undefined) {
        throw new Error(`There is no area ${key}`);
      }

      return found.id;
    };

    /** Reads again what an area's change touches. */
    const refresh = async (): Promise<void> => {
      await Promise.all([
        client.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.areas }),
        client.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices }),
        client.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.entities }),
      ]);
    };

    /**
     * Adds a floor or a room.
     *
     * @param draft - Its kind, name, parent and storey.
     * @returns The area.
     */
    const create: AreaActions['create'] = async (draft) => {
      const parentId = await idOf(draft.parentKey);
      const created = await createArea({
        kind: draft.kind,
        name: draft.name,
        parentId,
        ...(draft.kind === 'floor' ? { level: draft.level ?? 0 } : {}),
      });

      await refresh();

      const [view] = areaViewsOf([created]);

      if (view === undefined) {
        throw new Error('The area was not created');
      }

      // Its parent is not in a list of one: named by the key the package gave.
      return { ...view, parentKey: draft.parentKey };
    };

    /**
     * Changes an area.
     *
     * @param key - Which one.
     * @param change - Its new name or storey.
     */
    const update = async (
      key: string,
      change: { name: string } | { level: number },
    ): Promise<void> => {
      await updateArea(await idOf(key), change);
      await refresh();
    };

    /**
     * Removes an area and what is under it.
     *
     * @param key - Which one.
     */
    const remove = async (key: string): Promise<void> => {
      await deleteArea(await idOf(key));
      await refresh();
    };

    return {
      canEdit,
      create,
      /**
       * Renames an area.
       *
       * @param key - Which one.
       * @param name - Its new name.
       * @returns Once renamed.
       */
      rename: async (key, name) => update(key, { name }),

      /**
       * Moves a floor to another storey.
       *
       * @param key - Which one.
       * @param level - Its storey.
       * @returns Once moved.
       */
      setLevel: async (key, level) => update(key, { level }),
      remove,
    };
  }, [areas.data, canEdit, client]);
}
