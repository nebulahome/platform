/**
 * The interface's implementation of `useAreas` (package SDK 1.2): the house, its floors and its
 * rooms, as a package reads them.
 *
 * The same read the area pages make, under the same key, so a package's page and the platform's
 * share it. A package names an area by its key - what `EntityView.areaId` holds - so the view a
 * package gets names a parent by its key too, never by the API's ids.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { AreaView as ApiAreaView } from '@nebulahome/contracts';
import type { AreaView } from '@nebulahome/package-sdk/ui';

import { fetchAreas, LIBRARY_QUERY_KEYS } from '@/library/api';

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
  const areas = useQuery({
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

  return useMemo(() => areaViewsOf(areas.data ?? []), [areas.data]);
}
