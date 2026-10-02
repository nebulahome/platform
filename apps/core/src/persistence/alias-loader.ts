/**
 * The alias rows `core` reads and deletes: every definition at startup, one again when the API
 * has written it, and one erased when the owner removes it.
 *
 * The API writes a definition's rows and then asks `core` to take them in; deleting goes the
 * other way, through `core`, because the entity must leave the directory, the live states and
 * the buffered writes in the same step as its rows (see `services/alias-engine.ts`).
 */
import { asc, eq, inArray, type SQL } from 'drizzle-orm';

import {
  ConflictError,
  NotFoundError,
  parseEntityId,
  type AliasDependent,
  type AliasFallbackPolicy,
  type CapabilityName,
  type EntityId,
  type JsonObject,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';

import type { AliasDefinition, AliasSourceBinding } from '../domain/alias-catalog.js';

/**
 * Whether a JSON value is an object, as opposed to an array, a scalar or null.
 *
 * @param value - What a `jsonb` column held.
 * @returns True for an object.
 */
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the helper limits an alias keeps on its entity row.
 *
 * @param config - The entity row's `config`.
 * @returns The `alias` object inside it, or an empty one.
 */
function aliasConfigOf(config: JsonObject): JsonObject {
  const alias = config['alias'];

  return isJsonObject(alias) ? alias : {};
}

/**
 * Reads a number from the helper limits, when it is one.
 *
 * @param config - The `alias` object on the entity row.
 * @param key - Which limit.
 * @returns The number, or null.
 */
function limitOf(config: JsonObject, key: 'min' | 'max' | 'step'): number | null {
  const value = config[key];

  return typeof value === 'number' ? value : null;
}

/**
 * Reads alias definitions and their sources, all of them or those a condition names.
 *
 * @param db - The database.
 * @param where - Which aliases, by a condition on the alias or its entity; all when absent.
 * @returns The definitions, ready for the catalogue.
 */
async function selectAliases(db: Database, where?: SQL): Promise<AliasDefinition[]> {
  const rows = await db
    .select({
      id: schema.registry.aliases.id,
      entityId: schema.registry.entities.entityId,
      capability: schema.registry.aliases.capability,
      expression: schema.registry.aliases.expression,
      debounceMs: schema.registry.aliases.debounceMs,
      fallbackPolicy: schema.registry.aliases.fallbackPolicy,
      isEnabled: schema.registry.aliases.isEnabled,
      config: schema.registry.entities.config,
    })
    .from(schema.registry.aliases)
    .innerJoin(
      schema.registry.entities,
      eq(schema.registry.entities.id, schema.registry.aliases.entityId),
    )
    .where(where);

  if (rows.length === 0) {
    return [];
  }

  const sourceRows = await db
    .select({
      aliasId: schema.registry.aliasSources.aliasId,
      variableName: schema.registry.aliasSources.variableName,
      entityId: schema.registry.entities.entityId,
    })
    .from(schema.registry.aliasSources)
    .innerJoin(
      schema.registry.entities,
      eq(schema.registry.entities.id, schema.registry.aliasSources.entityId),
    )
    .where(
      inArray(
        schema.registry.aliasSources.aliasId,
        rows.map((row) => row.id),
      ),
    );

  const sourcesByAlias = new Map<string, AliasSourceBinding[]>();

  for (const row of sourceRows) {
    sourcesByAlias.set(row.aliasId, [
      ...(sourcesByAlias.get(row.aliasId) ?? []),
      { variableName: row.variableName, entityId: parseEntityId(row.entityId) },
    ]);
  }

  return rows.map((row): AliasDefinition => {
    const config = isJsonObject(row.config) ? row.config : {};
    const limits = aliasConfigOf(config);

    return {
      id: row.id,
      entityId: parseEntityId(row.entityId),

      // The API writes both columns from the contract's names, and `aliases_fallback_policy`
      // checks the second, so the casts record what was written rather than assume it.
      capability: row.capability as CapabilityName,
      expression: row.expression,
      debounceMs: row.debounceMs,
      fallbackPolicy: row.fallbackPolicy as AliasFallbackPolicy,
      isEnabled: row.isEnabled,
      sources: sourcesByAlias.get(row.id) ?? [],
      config,
      min: limitOf(limits, 'min'),
      max: limitOf(limits, 'max'),
      step: limitOf(limits, 'step'),
    };
  });
}

/**
 * Loads every alias definition and its sources.
 *
 * @param db - The database.
 * @returns The definitions, ready for the catalogue.
 */
export async function loadAliases(db: Database): Promise<AliasDefinition[]> {
  return selectAliases(db);
}

/**
 * Loads one alias definition, by the entity it produces.
 *
 * @param db - The database.
 * @param entityId - The alias entity.
 * @returns The definition, or undefined when there is no such alias.
 */
export async function loadAlias(
  db: Database,
  entityId: EntityId,
): Promise<AliasDefinition | undefined> {
  const [alias] = await selectAliases(db, eq(schema.registry.entities.entityId, entityId));

  return alias;
}

/**
 * Deletes an alias: its entity row, which takes the definition, the sources, the capabilities,
 * the cached state, the tags and any place in a scene with it.
 *
 * Refused while another alias reads it. `alias_sources` restricts the delete on purpose, and
 * checking first turns the foreign key into a sentence naming what to edit.
 *
 * @param db - The database.
 * @param entityId - The alias entity.
 * @returns The entity's row id, which buffered writes are keyed by.
 * @throws {NotFoundError} When no alias produces that entity.
 * @throws {ConflictError} When another alias reads it; the details name those aliases.
 */
export async function eraseAlias(db: Database, entityId: EntityId): Promise<string> {
  return db.transaction(async (tx) => {
    const { aliases, aliasSources, entities } = schema.registry;

    const [alias] = await tx
      .select({ rowId: entities.id })
      .from(aliases)
      .innerJoin(entities, eq(entities.id, aliases.entityId))
      .where(eq(entities.entityId, entityId));

    if (alias === undefined) {
      throw new NotFoundError('No alias produces that entity', { details: { entityId } });
    }

    const readers = await tx
      .selectDistinct({ entityId: entities.entityId, name: entities.name })
      .from(aliasSources)
      .innerJoin(aliases, eq(aliases.id, aliasSources.aliasId))
      .innerJoin(entities, eq(entities.id, aliases.entityId))
      .where(eq(aliasSources.entityId, alias.rowId))
      .orderBy(asc(entities.entityId));

    if (readers.length > 0) {
      const dependents: AliasDependent[] = readers.map((reader) => ({
        entityId: parseEntityId(reader.entityId),
        name: reader.name,
      }));

      throw new ConflictError('Other aliases still read this one', {
        details: { entityId, dependents },
      });
    }

    await tx.delete(entities).where(eq(entities.id, alias.rowId));

    return alias.rowId;
  });
}
