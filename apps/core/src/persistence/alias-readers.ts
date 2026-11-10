/**
 * Which entities an alias still reads.
 *
 * An alias names what it reads by entity id (`registry.alias_reads`, worked out from its parts and
 * its code on every save), so the platform keeps such an entity, made unavailable, when what
 * produced it goes away - a container removed, the house's position cleared - and deletes the
 * rest; and removing a device whose entities an alias reads is refused, naming them.
 */
import { eq, inArray } from 'drizzle-orm';

import { schema, type Database } from '@nebulahome/db';

/** What reading the alias reads needs: the database, or a transaction on it. */
export type AliasReadsReader = Pick<Database, 'selectDistinct'>;

/**
 * The rows of entities no alias reads, out of those given.
 *
 * @param tx - The database or a transaction on it.
 * @param rowIds - The candidates, by entity row.
 * @returns The ones free to delete.
 */
export async function unreadByAliases(
  tx: AliasReadsReader,
  rowIds: readonly string[],
): Promise<Set<string>> {
  if (rowIds.length === 0) {
    return new Set();
  }

  const { aliasReads, entities } = schema.registry;
  const read = await tx
    .selectDistinct({ rowId: entities.id })
    .from(entities)
    .innerJoin(aliasReads, eq(aliasReads.entityId, entities.entityId))
    .where(inArray(entities.id, [...rowIds]));
  const reading = new Set(read.map((row) => row.rowId));

  return new Set(rowIds.filter((rowId) => !reading.has(rowId)));
}

/**
 * The entity ids an alias reads, out of those given.
 *
 * @param tx - The database or a transaction on it.
 * @param entityIds - The candidates, by entity id.
 * @returns The ones some alias reads.
 */
export async function readByAliases(
  tx: AliasReadsReader,
  entityIds: readonly string[],
): Promise<Set<string>> {
  if (entityIds.length === 0) {
    return new Set();
  }

  const { aliasReads } = schema.registry;
  const read = await tx
    .selectDistinct({ entityId: aliasReads.entityId })
    .from(aliasReads)
    .where(inArray(aliasReads.entityId, [...entityIds]));

  return new Set(read.map((row) => row.entityId));
}
