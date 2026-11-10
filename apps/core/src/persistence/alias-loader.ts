/**
 * The alias rows `core` reads and deletes: every definition at startup, one again when the API
 * has written it, and one erased when the owner removes it.
 *
 * The API writes a definition's rows and then asks `core` to take them in; deleting goes the
 * other way, through `core`, because the entity must leave the directory, the live states and
 * the buffered writes in the same step as its rows (see `services/alias-engine.ts`).
 */
import { eq, inArray, sql, type SQL } from 'drizzle-orm';

import {
  ALIAS_FALLBACK_POLICIES,
  ALIAS_TYPE_IDS,
  aliasCustomTypeSchema,
  aliasDisplaySchema,
  aliasPartsSchema,
  aliasType,
  aliasTypeParts,
  jsonObjectSchema,
  NotFoundError,
  parseEntityId,
  type AliasCustomField,
  type AliasFallbackPolicy,
  type AliasTypeId,
  type EntityId,
  type JsonValue,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';

import type { AliasDefinition } from '../domain/alias-catalog.js';

/** Looks up the fields of a package entity type, for a custom alias's parts. */
export type CustomFieldsLookup = (
  packageId: string,
  type: string,
) => readonly AliasCustomField[] | undefined;

/**
 * Reads alias definitions and what they read, all of them or those a condition names.
 *
 * A row whose stored setup no longer reads as one (a type this version does not know, parts that
 * do not parse) is left out and said, rather than taking the rest down with it.
 *
 * @param db - The database.
 * @param customFields - The fields of package entity types, for custom aliases.
 * @param where - Which aliases, by a condition on the alias or its entity; all when absent.
 * @returns The definitions, ready for the catalogue.
 */
async function selectAliases(
  db: Database,
  customFields: CustomFieldsLookup,
  where?: SQL,
): Promise<AliasDefinition[]> {
  const { aliases, aliasReads, entities } = schema.registry;
  const rows = await db
    .select({
      id: aliases.id,
      entityId: entities.entityId,
      behavesAs: aliases.behavesAs,
      customType: aliases.customType,
      parts: aliases.parts,
      code: aliases.code,
      memory: aliases.memory,
      display: aliases.display,
      debounceMs: aliases.debounceMs,
      fallbackPolicy: aliases.fallbackPolicy,
      isEnabled: aliases.isEnabled,
    })
    .from(aliases)
    .innerJoin(entities, eq(entities.id, aliases.entityId))
    .where(where);

  if (rows.length === 0) {
    return [];
  }

  const readRows = await db
    .select({ aliasId: aliasReads.aliasId, entityId: aliasReads.entityId })
    .from(aliasReads)
    .where(
      inArray(
        aliasReads.aliasId,
        rows.map((row) => row.id),
      ),
    );
  const reads = new Map<string, EntityId[]>();

  for (const row of readRows) {
    reads.set(row.aliasId, [...(reads.get(row.aliasId) ?? []), parseEntityId(row.entityId)]);
  }

  return rows.flatMap((row): AliasDefinition[] => {
    if (!(ALIAS_TYPE_IDS as readonly string[]).includes(row.behavesAs)) {
      return [];
    }

    const type = aliasType(row.behavesAs as AliasTypeId);
    const parts = aliasPartsSchema.safeParse(row.parts);
    const custom = aliasCustomTypeSchema.nullable().safeParse(row.customType ?? null);
    const memory = jsonObjectSchema.safeParse(row.memory);
    const display = aliasDisplaySchema.safeParse(row.display);

    if (!parts.success || !custom.success) {
      return [];
    }

    const fields =
      custom.data === null ? undefined : customFields(custom.data.packageId, custom.data.type);

    return [
      {
        id: row.id,
        entityId: parseEntityId(row.entityId),
        type,
        defs: aliasTypeParts(type, fields),
        customType: custom.data,
        parts: parts.data,
        code: row.code,
        memory: memory.success ? memory.data : {},
        display: display.success
          ? display.data
          : { deviceClass: null, unit: null, precision: null },
        debounceMs: row.debounceMs,
        fallbackPolicy: (ALIAS_FALLBACK_POLICIES as readonly string[]).includes(row.fallbackPolicy)
          ? (row.fallbackPolicy as AliasFallbackPolicy)
          : 'unavailable',
        isEnabled: row.isEnabled,
        reads: reads.get(row.id) ?? [],
      },
    ];
  });
}

/**
 * Loads every alias definition.
 *
 * @param db - The database.
 * @param customFields - The fields of package entity types, for custom aliases.
 * @returns The definitions, ready for the catalogue.
 */
export async function loadAliases(
  db: Database,
  customFields: CustomFieldsLookup,
): Promise<AliasDefinition[]> {
  return selectAliases(db, customFields);
}

/**
 * Loads one alias definition, by the entity it is.
 *
 * @param db - The database.
 * @param entityId - The alias entity.
 * @param customFields - The fields of package entity types, for custom aliases.
 * @returns The definition, or undefined when there is no such alias.
 */
export async function loadAlias(
  db: Database,
  entityId: EntityId,
  customFields: CustomFieldsLookup,
): Promise<AliasDefinition | undefined> {
  const [alias] = await selectAliases(
    db,
    customFields,
    eq(schema.registry.entities.entityId, entityId),
  );

  return alias;
}

/**
 * Deletes an alias: its entity row, which takes the definition, what it reads, its
 * capabilities, its cached state, its tags and any place in a scene with it.
 *
 * Another alias reading this one is no reason to refuse: the delete dialog has listed what stops
 * working, and the reader turns Failing, saying the entity is not in the house.
 *
 * @param db - The database.
 * @param entityId - The alias entity.
 * @returns The entity's row id, which buffered writes are keyed by.
 * @throws {NotFoundError} When no alias is that entity.
 */
export async function eraseAlias(db: Database, entityId: EntityId): Promise<string> {
  return db.transaction(async (tx) => {
    const { aliases, entities } = schema.registry;

    const [alias] = await tx
      .select({ rowId: entities.id })
      .from(aliases)
      .innerJoin(entities, eq(entities.id, aliases.entityId))
      .where(eq(entities.entityId, entityId));

    if (alias === undefined) {
      throw new NotFoundError('No alias is that entity', { details: { entityId } });
    }

    await tx.delete(entities).where(eq(entities.id, alias.rowId));

    return alias.rowId;
  });
}

/**
 * Writes a part's stored value back into the alias's setup, after a command changed it, so the
 * setup the page and the file show holds the value the alias has.
 *
 * @param db - The database.
 * @param aliasId - The aliases row.
 * @param values - The new stored values, by part key.
 */
export async function storePartValues(
  db: Database,
  aliasId: string,
  values: ReadonlyMap<string, JsonValue>,
): Promise<void> {
  if (values.size === 0) {
    return;
  }

  let parts = sql`${schema.registry.aliases.parts}`;

  for (const [key, value] of values) {
    parts = sql`jsonb_set(${parts}, ${`{${key},value}`}::text[], ${JSON.stringify(value)}::jsonb, true)`;
  }

  await db
    .update(schema.registry.aliases)
    .set({ parts })
    .where(eq(schema.registry.aliases.id, aliasId));
}

/**
 * Writes what an alias's code keeps between runs.
 *
 * @param db - The database.
 * @param aliasId - The aliases row.
 * @param memory - The memory.
 */
export async function storeMemory(
  db: Database,
  aliasId: string,
  memory: Readonly<Record<string, JsonValue>>,
): Promise<void> {
  await db
    .update(schema.registry.aliases)
    .set({ memory })
    .where(eq(schema.registry.aliases.id, aliasId));
}
