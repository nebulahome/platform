/**
 * Reading the configured shape of a home: areas, labels, devices, scenes, automations, aliases
 * and installed packages.
 *
 * All reads. `api` does not write configuration in this release, and API.md says which endpoints
 * are therefore absent and why: the engines that would have to be told about a change - the
 * automation, scene and alias engines in `core` - do not exist yet, and an endpoint that writes
 * a row nothing acts on is worse than no endpoint at all.
 */
import { asc, eq, inArray, sql } from 'drizzle-orm';

import {
  aliasViewSchema,
  areaViewSchema,
  automationViewSchema,
  deviceViewSchema,
  labelViewSchema,
  packageViewSchema,
  sceneViewSchema,
  type AliasView,
  type AreaView,
  type AutomationView,
  type DeviceView,
  type LabelView,
  type PackageView,
  type SceneView,
} from '@nebula-home/contracts';
import { schema, type Database } from '@nebula-home/db';

/**
 * Lists every area, with how many entities are in each.
 *
 * @param db - The database.
 * @returns The areas, in the order the owner arranged them.
 */
export async function listAreas(db: Database): Promise<AreaView[]> {
  const rows = await db
    .select({
      id: schema.registry.areas.id,
      key: schema.registry.areas.key,
      name: schema.registry.areas.name,
      parentId: schema.registry.areas.parentId,
      icon: schema.registry.areas.icon,
      sortOrder: schema.registry.areas.sortOrder,
      entityCount: sql<number>`count(${schema.registry.entities.id})::int`,
    })
    .from(schema.registry.areas)
    .leftJoin(
      schema.registry.entities,
      eq(schema.registry.entities.areaId, schema.registry.areas.id),
    )
    .groupBy(schema.registry.areas.id)
    .orderBy(asc(schema.registry.areas.sortOrder), asc(schema.registry.areas.name));

  return rows.map((row) => areaViewSchema.parse(row));
}

/**
 * Lists every label, with how many entities carry it.
 *
 * @param db - The database.
 * @returns The labels, alphabetically.
 */
export async function listLabels(db: Database): Promise<LabelView[]> {
  const rows = await db
    .select({
      id: schema.registry.labels.id,
      key: schema.registry.labels.key,
      name: schema.registry.labels.name,
      color: schema.registry.labels.color,
      entityCount: sql<number>`count(${schema.registry.entityLabels.entityId})::int`,
    })
    .from(schema.registry.labels)
    .leftJoin(
      schema.registry.entityLabels,
      eq(schema.registry.entityLabels.labelId, schema.registry.labels.id),
    )
    .groupBy(schema.registry.labels.id)
    .orderBy(asc(schema.registry.labels.name));

  return rows.map((row) => labelViewSchema.parse(row));
}

/**
 * Lists devices, each with the entities it exposes.
 *
 * @param db - The database.
 * @returns The devices, alphabetically.
 */
export async function listDevices(db: Database): Promise<DeviceView[]> {
  const rows = await db
    .select({
      id: schema.registry.devices.id,
      packageId: schema.registry.devices.packageId,
      externalId: schema.registry.devices.externalId,
      name: schema.registry.devices.name,
      manufacturer: schema.registry.devices.manufacturer,
      model: schema.registry.devices.model,
      swVersion: schema.registry.devices.swVersion,
      hwVersion: schema.registry.devices.hwVersion,
      areaKey: schema.registry.areas.key,
      areaName: schema.registry.areas.name,
      viaDeviceId: schema.registry.devices.viaDeviceId,
      isEnabled: schema.registry.devices.isEnabled,
      lastSeenAt: schema.registry.devices.lastSeenAt,
    })
    .from(schema.registry.devices)
    .leftJoin(schema.registry.areas, eq(schema.registry.areas.id, schema.registry.devices.areaId))
    .orderBy(asc(schema.registry.devices.name));

  const entityRows =
    rows.length === 0
      ? []
      : await db
          .select({
            deviceId: schema.registry.entities.deviceId,
            entityId: schema.registry.entities.entityId,
          })
          .from(schema.registry.entities)
          .where(
            inArray(
              schema.registry.entities.deviceId,
              rows.map((row) => row.id),
            ),
          );

  const byDevice = new Map<string, string[]>();

  for (const row of entityRows) {
    if (row.deviceId !== null) {
      byDevice.set(row.deviceId, [...(byDevice.get(row.deviceId) ?? []), row.entityId]);
    }
  }

  return rows.map((row) =>
    deviceViewSchema.parse({ ...row, entityIds: byDevice.get(row.id) ?? [] }),
  );
}

/**
 * Lists scenes, each with the entity states it sets.
 *
 * @param db - The database.
 * @returns The scenes, alphabetically.
 */
export async function listScenes(db: Database): Promise<SceneView[]> {
  const rows = await db
    .select({
      id: schema.registry.scenes.id,
      key: schema.registry.scenes.key,
      name: schema.registry.scenes.name,
      icon: schema.registry.scenes.icon,
      areaKey: schema.registry.areas.key,
      transitionMs: schema.registry.scenes.transitionMs,
      rollbackOnPartialFailure: schema.registry.scenes.rollbackOnPartialFailure,
    })
    .from(schema.registry.scenes)
    .leftJoin(schema.registry.areas, eq(schema.registry.areas.id, schema.registry.scenes.areaId))
    .orderBy(asc(schema.registry.scenes.name));

  const memberRows =
    rows.length === 0
      ? []
      : await db
          .select({
            sceneId: schema.registry.sceneEntities.sceneId,
            entityId: schema.registry.entities.entityId,
            entityName: schema.registry.entities.name,
            targetState: schema.registry.sceneEntities.targetState,
            transitionMs: schema.registry.sceneEntities.transitionMs,
          })
          .from(schema.registry.sceneEntities)
          .innerJoin(
            schema.registry.entities,
            eq(schema.registry.entities.id, schema.registry.sceneEntities.entityId),
          )
          .where(
            inArray(
              schema.registry.sceneEntities.sceneId,
              rows.map((row) => row.id),
            ),
          );

  const byScene = new Map<string, unknown[]>();

  for (const row of memberRows) {
    byScene.set(row.sceneId, [
      ...(byScene.get(row.sceneId) ?? []),
      {
        entityId: row.entityId,
        entityName: row.entityName,
        targetState: row.targetState ?? {},
        transitionMs: row.transitionMs,
      },
    ]);
  }

  return rows.map((row) => sceneViewSchema.parse({ ...row, members: byScene.get(row.id) ?? [] }));
}

/**
 * Lists automations.
 *
 * @param db - The database.
 * @returns The automations, alphabetically.
 */
export async function listAutomations(db: Database): Promise<AutomationView[]> {
  const rows = await db
    .select({
      id: schema.registry.automations.id,
      key: schema.registry.automations.key,
      name: schema.registry.automations.name,
      description: schema.registry.automations.description,
      definition: schema.registry.automations.definition,
      definitionVersion: schema.registry.automations.definitionVersion,
      mode: schema.registry.automations.mode,
      maxRuntimeMs: schema.registry.automations.maxRuntimeMs,
      isEnabled: schema.registry.automations.isEnabled,
      lastTriggeredAt: schema.registry.automations.lastTriggeredAt,
    })
    .from(schema.registry.automations)
    .orderBy(asc(schema.registry.automations.name));

  return rows.map((row) =>
    automationViewSchema.parse({ ...row, definition: row.definition ?? {} }),
  );
}

/**
 * Lists aliases, each with the entities its formula reads.
 *
 * @param db - The database.
 * @returns The aliases, by the identifier of the entity they produce.
 */
export async function listAliases(db: Database): Promise<AliasView[]> {
  const rows = await db
    .select({
      id: schema.registry.aliases.id,
      rowEntityId: schema.registry.aliases.entityId,
      entityId: schema.registry.entities.entityId,
      name: schema.registry.entities.name,
      capability: schema.registry.aliases.capability,
      expression: schema.registry.aliases.expression,
      debounceMs: schema.registry.aliases.debounceMs,
      fallbackPolicy: schema.registry.aliases.fallbackPolicy,
      isEnabled: schema.registry.aliases.isEnabled,
      lastError: schema.registry.aliases.lastError,
      lastEvaluatedAt: schema.registry.aliases.lastEvaluatedAt,
    })
    .from(schema.registry.aliases)
    .innerJoin(
      schema.registry.entities,
      eq(schema.registry.entities.id, schema.registry.aliases.entityId),
    )
    .orderBy(asc(schema.registry.entities.entityId));

  const sourceRows =
    rows.length === 0
      ? []
      : await db
          .select({
            aliasId: schema.registry.aliasSources.aliasId,
            variableName: schema.registry.aliasSources.variableName,
            entityId: schema.registry.entities.entityId,
            entityName: schema.registry.entities.name,
            areaName: schema.registry.areas.name,
          })
          .from(schema.registry.aliasSources)
          .innerJoin(
            schema.registry.entities,
            eq(schema.registry.entities.id, schema.registry.aliasSources.entityId),
          )
          .leftJoin(
            schema.registry.areas,
            eq(schema.registry.areas.id, schema.registry.entities.areaId),
          )
          .where(
            inArray(
              schema.registry.aliasSources.aliasId,
              rows.map((row) => row.id),
            ),
          );

  const byAlias = new Map<string, unknown[]>();

  for (const row of sourceRows) {
    byAlias.set(row.aliasId, [
      ...(byAlias.get(row.aliasId) ?? []),
      {
        variableName: row.variableName,
        entityId: row.entityId,
        entityName: row.entityName,
        areaName: row.areaName,
      },
    ]);
  }

  return rows.map((row) => aliasViewSchema.parse({ ...row, sources: byAlias.get(row.id) ?? [] }));
}

/**
 * Lists installed packages, with how much of the house each one accounts for.
 *
 * @param db - The database.
 * @returns The packages, by identifier.
 */
export async function listPackages(db: Database): Promise<PackageView[]> {
  const rows = await db
    .select({
      id: schema.system.packages.id,
      version: schema.system.packages.version,
      runtime: schema.system.packages.runtime,
      state: schema.system.packages.state,
      manifest: schema.system.packages.manifest,
      previousVersion: schema.system.packages.previousVersion,
      lastStartedAt: schema.system.packages.lastStartedAt,
      lastError: schema.system.packages.lastError,
      installedAt: schema.system.packages.installedAt,
    })
    .from(schema.system.packages)
    .orderBy(asc(schema.system.packages.id));

  const [entityCounts, deviceCounts] = await Promise.all([
    db
      .select({
        packageId: schema.registry.entities.packageId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.registry.entities)
      .groupBy(schema.registry.entities.packageId),
    db
      .select({
        packageId: schema.registry.devices.packageId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.registry.devices)
      .groupBy(schema.registry.devices.packageId),
  ]);

  const entitiesBy = new Map(entityCounts.map((row) => [row.packageId ?? '', row.count]));
  const devicesBy = new Map(deviceCounts.map((row) => [row.packageId, row.count]));

  return rows.map((row) =>
    packageViewSchema.parse({
      ...row,
      manifest: row.manifest ?? {},
      entityCount: entitiesBy.get(row.id) ?? 0,
      deviceCount: devicesBy.get(row.id) ?? 0,
    }),
  );
}
