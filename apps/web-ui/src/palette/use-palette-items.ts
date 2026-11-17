/**
 * Everything the command palette may offer, built from the lists the rest of the app already reads
 * (docs: command palette, 6.2 and 10). Mounted only while the palette is open, so a person who
 * never opens it pays nothing; the cache usually has every list already.
 *
 * Nothing the person may not read is fetched: each list's query waits for its permission, so the
 * names of things they cannot see never reach the browser for the palette. The server enforces
 * all of it anyway.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { useSession } from '@/auth/session-store';
import { DASHBOARD_QUERY_KEYS, fetchDashboards } from '@/dashboard/api';
import { signalled } from '@/lib/signalled';
import {
  fetchAreas,
  fetchAutomations,
  fetchDevices,
  fetchEntities,
  fetchScenes,
  fetchTags,
  fetchVendors,
  LIBRARY_QUERY_KEYS,
} from '@/library/api';
import { useInstalledPackages } from '@/packages/use-packages';
import type { PaletteGroupId, PaletteItem } from '@/palette/palette-types';
import { actionItems } from '@/palette/sources/actions';
import { automationItems } from '@/palette/sources/automations';
import { deviceItems } from '@/palette/sources/devices';
import { entityItems } from '@/palette/sources/entities';
import { integrationItems } from '@/palette/sources/integrations';
import { packageItems } from '@/palette/sources/packages';
import { pageItems } from '@/palette/sources/pages';
import { sceneItems } from '@/palette/sources/scenes';
import { settingItems } from '@/palette/sources/settings';
import { tagItems } from '@/palette/sources/tags';
import { reachableTree } from '@/routes/settings/settings-tree';

/** A list the palette reads, while it is still coming or after it failed. */
export type PaletteSourceState = {
  readonly group: PaletteGroupId;
  readonly isPending: boolean;
  readonly isError: boolean;

  /** Reads it again. */
  readonly retry: () => void;
};

/** What the palette may offer. */
export type PaletteItems = {
  readonly items: readonly PaletteItem[];

  /** The lists still coming or failed, by the group they fill. */
  readonly sources: readonly PaletteSourceState[];
};

/** Nothing yet. */
const NONE: readonly never[] = [];

/**
 * Reads the lists and builds the palette's items.
 *
 * @returns See {@link PaletteItems}.
 */
export function usePaletteItems(): PaletteItems {
  const can = useSession((state) => state.can);
  // One moment per opening, so opening the same setting twice lights its row twice.
  const [openedAt] = useState(() => Date.now());

  const entities = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.entities,
    queryFn: signalled(fetchEntities),
    enabled: can('entity:read'),
  });
  const devices = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.devices,
    queryFn: signalled(fetchDevices),
    enabled: can('device:read'),
  });
  const areas = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.areas,
    queryFn: signalled(fetchAreas),
    enabled: can('area:read'),
  });
  const tags = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.tags,
    queryFn: signalled(fetchTags),
    enabled: can('tag:read'),
  });
  const scenes = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.scenes,
    queryFn: signalled(fetchScenes),
    enabled: can('scene:read'),
  });
  const automations = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.automations,
    queryFn: signalled(fetchAutomations),
    enabled: can('automation:read'),
  });
  const vendors = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.vendors,
    queryFn: signalled(fetchVendors),
    enabled: can('integration:read'),
  });
  const dashboards = useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.dashboards,
    queryFn: signalled(fetchDashboards),
  });
  const packages = useInstalledPackages();

  const items = useMemo(() => {
    const areaList = areas.data ?? NONE;
    const vendorList = vendors.data ?? NONE;
    const settings = reachableTree(can);

    return [
      ...entityItems({
        entities: entities.data ?? NONE,
        devices: devices.data ?? NONE,
        tags: tags.data ?? NONE,
        can,
      }),
      ...sceneItems(
        scenes.data ?? NONE,
        new Map(areaList.map((area) => [area.key, area.name])),
        can('scene:apply'),
      ),
      ...automationItems(automations.data ?? NONE, can('automation:write')),
      ...deviceItems(
        devices.data ?? NONE,
        new Map(vendorList.map((vendor) => [vendor.id, vendor.name])),
      ),
      ...pageItems({ settings, dashboards: dashboards.data ?? NONE, areas: areaList, can }),
      ...settingItems(settings, openedAt),
      ...integrationItems(vendorList, can('device:write')),
      ...packageItems(packages.packages),
      ...tagItems(tags.data ?? NONE),
      ...actionItems(can),
    ];
  }, [
    can,
    openedAt,
    entities.data,
    devices.data,
    areas.data,
    tags.data,
    scenes.data,
    automations.data,
    vendors.data,
    dashboards.data,
    packages.packages,
  ]);

  const watched = [
    ['entities', entities],
    ['devices', devices],
    ['scenes', scenes],
    ['automations', automations],
    ['integrations', vendors],
    ['tags', tags],
  ] as const;

  const sources = watched.flatMap(([group, query]): PaletteSourceState[] =>
    // A list the person may not read is never pending: its query is simply not run.
    (query.isPending && query.fetchStatus !== 'idle') || query.isError
      ? [
          {
            group,
            isPending: query.isPending,
            isError: query.isError,
            /** Reads the list again. */
            retry: () => {
              void query.refetch();
            },
          },
        ]
      : [],
  );

  return { items, sources };
}
