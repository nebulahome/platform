/**
 * Where an entity's own page is.
 *
 * Under `/devices`, because that is the page it is reached from and the one the navigation keeps
 * lit while it is open; the address in it is the entity's, which is stable across renames, so a
 * bookmark to a lamp's page survives the lamp being called something else.
 *
 * The settings are a dialog on the page rather than a view of their own, and `?settings` opens
 * the page with it open - which is where the spanner on an entity's row leads.
 */

/** The query parameter that opens the page with its settings dialog open. */
export const ENTITY_SETTINGS_PARAM = 'settings';

/**
 * The address of an entity's page.
 *
 * @param entityId - The entity, by its address.
 * @param isSettingsOpen - Whether the page opens with its settings dialog open.
 * @returns The path.
 */
export function entityPath(entityId: string, isSettingsOpen = false): string {
  const path = `/devices/entities/${encodeURIComponent(entityId)}`;

  return isSettingsOpen ? `${path}?${ENTITY_SETTINGS_PARAM}=1` : path;
}
