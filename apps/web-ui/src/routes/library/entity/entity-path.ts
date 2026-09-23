/**
 * Where an entity's own page is.
 *
 * Under `/devices`, because that is the page it is reached from and the one the navigation keeps
 * lit while it is open; the address in it is the entity's, which is stable across renames, so a
 * bookmark to a lamp's page survives the lamp being called something else.
 */

/** The two views of an entity's page. */
export type EntityTab = 'overview' | 'settings';

/** The query parameter the view is kept in. */
export const ENTITY_TAB_PARAM = 'tab';

/**
 * The address of an entity's page.
 *
 * @param entityId - The entity, by its address.
 * @param tab - Which view to open on; the overview unless said otherwise.
 * @returns The path, with the view when it is not the overview.
 */
export function entityPath(entityId: string, tab: EntityTab = 'overview'): string {
  const path = `/devices/entities/${encodeURIComponent(entityId)}`;

  return tab === 'overview' ? path : `${path}?${ENTITY_TAB_PARAM}=${tab}`;
}
