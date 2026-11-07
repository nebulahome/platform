/**
 * Where an entity opens: in a dialog over whatever page is open, named in the address.
 *
 * `?entity=light.kitchen` on any page opens that entity's dialog over it (the shell's
 * `EntityDialogHost` reads it), so a row, a card, a package or a bookmark opens it the same way,
 * and Back or a reload keep it. The address is the entity's, which is stable across renames.
 * `&entity-view=settings` or `history` opens it with that sheet raised - where the spanner on an
 * entity's row leads.
 */

/** The query parameter that opens an entity's dialog. */
export const ENTITY_PARAM = 'entity';

/** The query parameter that opens the dialog with a sheet raised. */
export const ENTITY_VIEW_PARAM = 'entity-view';

/** A sheet the dialog may open with. */
export type EntitySheetView = 'settings' | 'history';

/**
 * The address that opens an entity's dialog over the page that is open: a query alone, which a
 * link or a navigation resolves against the current page.
 *
 * @param entityId - The entity, by its address.
 * @param view - The sheet to open it with, if any.
 * @returns The query, `?entity=…`.
 */
export function entityPath(entityId: string, view?: EntitySheetView): string {
  const query = new URLSearchParams({ [ENTITY_PARAM]: entityId });

  if (view !== undefined) {
    query.set(ENTITY_VIEW_PARAM, view);
  }

  return `?${query.toString()}`;
}
