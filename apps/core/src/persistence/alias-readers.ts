/**
 * Which entities a derived entity still reads.
 *
 * An alias names its sources by row (`registry.alias_sources`, `ON DELETE RESTRICT`), so an
 * entity an alias reads cannot be deleted under it: the platform keeps such an entity, made
 * unavailable, when what produced it goes away - a container removed, the house's position
 * cleared - and deletes the rest.
 */
import { inArray } from 'drizzle-orm';

import { schema, type Database } from '@nebulahome/db';

/** What reading the alias sources needs: the database, or a transaction on it. */
export type AliasSourceReader = Pick<Database, 'selectDistinct'>;

/**
 * The rows of entities no derived entity reads, out of those given.
 *
 * @param tx - The database or a transaction on it.
 * @param rowIds - The candidates.
 * @returns The ones free to delete.
 */
export async function unreadByAliases(
  tx: AliasSourceReader,
  rowIds: readonly string[],
): Promise<Set<string>> {
  if (rowIds.length === 0) {
    return new Set();
  }

  const read = await tx
    .selectDistinct({ rowId: schema.registry.aliasSources.entityId })
    .from(schema.registry.aliasSources)
    .where(inArray(schema.registry.aliasSources.entityId, [...rowIds]));
  const reading = new Set(read.map((row) => row.rowId));

  return new Set(rowIds.filter((rowId) => !reading.has(rowId)));
}
