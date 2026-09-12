/**
 * The configured shape of a home: areas, labels, devices, scenes, automations, aliases and
 * installed packages.
 *
 * Mostly reads. The one thing written here is an automation's **definition** - its name, its
 * document, whether it is enabled - and the line between that and the rest is worth stating,
 * because API.md 10 is right that an endpoint writing a row nothing acts on is worse than no
 * endpoint at all.
 *
 * A definition is a row, and the row is what the engine will read when it exists. Saving one is
 * complete in itself: it is durable, it is audited, and nothing about it is waiting on a service
 * to make it true. **Running** one is the opposite - `POST /automations/:id/trigger` can only
 * mean something once something is listening - and that is why triggering is still absent while
 * these are not.
 *
 * The same holds for scenes and aliases, whose writes are the next of these to be built. Package
 * lifecycle is different again and cannot be done here at all: `nebula_api` holds `SELECT` on
 * `system.packages` and nothing more, because those rows belong to `packet-manager`
 * ([DATABASE.md 12](../../../../DATABASE.md)).
 */
import { asc, eq, inArray, sql } from 'drizzle-orm';

import {
  aliasViewSchema,
  areaViewSchema,
  automationViewSchema,
  ConflictError,
  deviceViewSchema,
  labelViewSchema,
  NotFoundError,
  packageViewSchema,
  sceneViewSchema,
  type AliasView,
  type AreaView,
  type AutomationCreate,
  type AutomationUpdate,
  type AutomationView,
  type DeviceOwner,
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

/** One row of the devices query, before its entities are attached. */
export type DeviceRow = {
  id: string;
  packageId: string | null;
  integrationId: string | null;
  externalId: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  swVersion: string | null;
  hwVersion: string | null;
  areaKey: string | null;
  areaName: string | null;
  viaDeviceId: string | null;
  isEnabled: boolean;
  lastSeenAt: Date | null;
};

/**
 * Reads the two owner columns as the one owner the contract names.
 *
 * The table's `devices_owner_exclusive` constraint has exactly one of them set. A row with
 * neither cannot exist, so no case is made for it here: the view's own schema refuses it, and
 * loudly is right for a row that breaks a constraint.
 *
 * @param row - The device row.
 * @returns Who owns it, or null for a row that says nobody does.
 */
function ownerOf(row: DeviceRow): DeviceOwner | null {
  if (row.integrationId !== null) {
    return { kind: 'integration', id: row.integrationId };
  }

  return row.packageId === null ? null : { kind: 'package', id: row.packageId };
}

/**
 * Assembles one device view from its row and the entities it exposes.
 *
 * @param row - The device row.
 * @param entityIds - The addresses of its entities.
 * @returns The device as the API presents it.
 */
export function toDeviceView(row: DeviceRow, entityIds: readonly string[]): DeviceView {
  // The view schema keeps only what it declares, so the two owner columns fall away here.
  return deviceViewSchema.parse({ ...row, owner: ownerOf(row), entityIds });
}

/**
 * Lists devices, each with the entities it exposes.
 *
 * @param db - The database.
 * @returns The devices, alphabetically.
 */
export async function listDevices(db: Database): Promise<DeviceView[]> {
  const rows: DeviceRow[] = await db
    .select({
      id: schema.registry.devices.id,
      packageId: schema.registry.devices.packageId,
      integrationId: schema.registry.devices.integrationId,
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

  return rows.map((row) => toDeviceView(row, byDevice.get(row.id) ?? []));
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

/**
 * Reads one automation, or says it is not there.
 *
 * Separate from {@link listAutomations} because every write needs it: a change has to answer with
 * what now stands, and a missing row has to be a `404` rather than an update that quietly
 * affected nothing.
 *
 * @param db - The database.
 * @param id - Which one.
 * @returns The automation.
 * @throws {NotFoundError} When no automation has that id.
 */
export async function readAutomation(db: Database, id: string): Promise<AutomationView> {
  const [row] = await db
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
    .where(eq(schema.registry.automations.id, id))
    .limit(1);

  if (row === undefined) {
    throw new NotFoundError('No automation has that id', { details: { id } });
  }

  return automationViewSchema.parse({ ...row, definition: row.definition ?? {} });
}

/**
 * Creates an automation.
 *
 * The key is checked before the insert as well as being unique in the database. Both are needed:
 * the check is what turns a duplicate into a sentence somebody can act on, and the constraint is
 * what makes it true when two people press save at the same moment.
 *
 * @param db - The database.
 * @param body - What to create.
 * @param userId - Who is creating it, recorded on the row.
 * @returns The automation as it now stands.
 * @throws {ConflictError} When that key is already taken.
 */
export async function createAutomation(
  db: Database,
  body: AutomationCreate,
  userId: string,
): Promise<AutomationView> {
  const [existing] = await db
    .select({ id: schema.registry.automations.id })
    .from(schema.registry.automations)
    .where(eq(schema.registry.automations.key, body.key))
    .limit(1);

  if (existing !== undefined) {
    throw new ConflictError('An automation already has that key', { details: { key: body.key } });
  }

  const [row] = await db
    .insert(schema.registry.automations)
    .values({
      key: body.key,
      name: body.name,
      description: body.description,
      definition: body.definition,
      mode: body.mode,
      maxRuntimeMs: body.maxRuntimeMs,
      isEnabled: body.isEnabled,
      createdBy: userId,
    })
    .returning({ id: schema.registry.automations.id });

  if (row === undefined) {
    throw new ConflictError('An automation already has that key', { details: { key: body.key } });
  }

  return readAutomation(db, row.id);
}

/**
 * Changes an automation.
 *
 * A partial map, applied as one statement. `updatedAt` is set here rather than left to a trigger
 * so that a row changed by this service and a row changed by a future engine cannot disagree
 * about what "changed" means.
 *
 * @param db - The database.
 * @param id - Which one.
 * @param body - The fields to change.
 * @returns The automation as it now stands.
 * @throws {NotFoundError} When no automation has that id.
 */
export async function updateAutomation(
  db: Database,
  id: string,
  body: AutomationUpdate,
): Promise<AutomationView> {
  const [row] = await db
    .update(schema.registry.automations)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(schema.registry.automations.id, id))
    .returning({ id: schema.registry.automations.id });

  if (row === undefined) {
    throw new NotFoundError('No automation has that id', { details: { id } });
  }

  return readAutomation(db, id);
}

/**
 * Deletes an automation.
 *
 * Answers with what was deleted, because the caller has just lost its only copy and the audit
 * entry is written from it.
 *
 * @param db - The database.
 * @param id - Which one.
 * @returns The automation as it was.
 * @throws {NotFoundError} When no automation has that id.
 */
export async function deleteAutomation(db: Database, id: string): Promise<AutomationView> {
  const automation = await readAutomation(db, id);

  await db.delete(schema.registry.automations).where(eq(schema.registry.automations.id, id));

  return automation;
}
