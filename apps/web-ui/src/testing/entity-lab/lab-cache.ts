/**
 * What the developer pages read in place of an API (`pnpm preview:entity`, `pnpm preview:sdk`): a
 * house to pick from and the icons the chrome draws with, laid into a query cache.
 */
import type { QueryClient } from '@tanstack/react-query';

import type { IconView } from '@nebulahome/contracts';
import { BUILTIN_UI_FRAME, BUILTIN_UI_NODES } from '@nebulahome/ui';

import { LIBRARY_QUERY_KEYS } from '@/library/api';
import { anArea, aTag } from '@/testing/fixtures';
import { linkedSampleCache } from '@/testing/linked-samples';

/** The chrome's own icons, as the catalogue would serve them. */
export const LAB_ICONS: readonly IconView[] = Object.entries(BUILTIN_UI_NODES).map(
  ([id, node]) => ({
    id,
    name: id,
    keywords: [],
    origin: 'builtin',
    isOverridden: false,
    node,
    frame: BUILTIN_UI_FRAME,
  }),
);

/**
 * The cache the dialog's settings read from: rooms, tags, the icon catalogue and the vendors of
 * the linked sample.
 *
 * @returns The cache.
 */
export function labCache(): QueryClient {
  const client = linkedSampleCache();

  client.setDefaultOptions({ queries: { staleTime: Infinity, retry: false } });
  client.setQueryData(LIBRARY_QUERY_KEYS.areas, [
    anArea('home', 'house', null, { name: 'Home' }),
    anArea('ground', 'floor', 'home', { name: 'Ground floor' }),
    anArea('living_room', 'room', 'ground'),
  ]);
  client.setQueryData(LIBRARY_QUERY_KEYS.tags, [aTag('evening'), aTag('cooking')]);
  client.setQueryData([...LIBRARY_QUERY_KEYS.icons, 'search', ''], LAB_ICONS);

  return client;
}
