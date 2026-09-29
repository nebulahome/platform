/**
 * The configured shape of a home: scenes, automations, aliases and installed packages. Devices
 * have a service of their own, being two halves under one id, and areas theirs, being a tree.
 *
 * Scenes and automations are written here. A definition is a row, and the row is what the engine
 * will read when it exists - saving one is complete in itself: durable, audited, and not waiting
 * on a service to make it true. **Running** an automation is the opposite -
 * `POST /automations/:id/trigger` can only mean something once something is listening - and that
 * is why triggering is still absent while these are not. Applying a scene is different again: it
 * fans out ordinary entity commands from `api` itself (see `scene-apply.ts`), rather than waiting
 * on a scene engine.
 *
 * Aliases are written in `aliases.ts`. Package rows belong to `packet-manager`
 * ([DATABASE.md 12](../../../../DATABASE.md)); `nebula_api` holds `SELECT` on `system.packages`
 * and nothing more.
 */
import { asc, eq, inArray, sql } from 'drizzle-orm';

import {
  CAPABILITIES,
  capabilityStateSchema,
  ConflictError,
  NotFoundError,
  ValidationError,
  automationViewSchema,
  packageViewSchema,
  sceneViewSchema,
  type AutomationCreate,
  type AutomationUpdate,
  type AutomationView,
  type CapabilityName,
  type CapabilityState,
  type PackageView,
  type SceneCreate,
  type SceneMemberInput,
  type SceneUpdate,
  type SceneView,
} from '@nebula-home/contracts';
import { schema, type Database } from '@nebula-home/db';

import { isUniqueViolation } from './keys.js';

/** Capabilities a scene may target: settable, with a stable resting state. */
const SCENE_TARGET_CAPABILITIES = new Set<CapabilityName>([
  'on_off',
  'level',
  'color_hs',
  'color_temp',
  'cover',
  'lock',
  'thermostat',
  'media_player',
]);

/** One member resolved to the row uuid the join table stores. */
type ResolvedSceneMember = {
  readonly entityRowId: string;
  readonly targetState: CapabilityState;
  readonly transitionMs: number | null;
};

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

  const byScene = await loadSceneMembers(
    db,
    rows.map((row) => row.id),
  );

  return rows.map((row) => sceneViewSchema.parse({ ...row, members: byScene.get(row.id) ?? [] }));
}

/**
 * Reads one scene, or says it is not there.
 *
 * @param db - The database.
 * @param id - Which one.
 * @returns The scene.
 * @throws {NotFoundError} When no scene has that id.
 */
export async function readScene(db: Database, id: string): Promise<SceneView> {
  const [row] = await db
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
    .where(eq(schema.registry.scenes.id, id))
    .limit(1);

  if (row === undefined) {
    throw new NotFoundError('No scene has that id', { details: { id } });
  }

  const byScene = await loadSceneMembers(db, [row.id]);

  return sceneViewSchema.parse({ ...row, members: byScene.get(row.id) ?? [] });
}

/**
 * Creates a scene.
 *
 * The key is checked before the insert as well as being unique in the database. Both are needed:
 * the check is what turns a duplicate into a sentence somebody can act on, and the constraint is
 * what makes it true when two people press save at the same moment.
 *
 * @param db - The database.
 * @param body - What to create.
 * @param userId - Who is creating it, recorded on the row.
 * @returns The scene as it now stands.
 * @throws {ConflictError} When that key is already taken.
 * @throws {ValidationError} When a member names no entity, targets a capability it does not
 * declare, or carries a state a scene cannot set.
 */
export async function createScene(
  db: Database,
  body: SceneCreate,
  userId: string,
): Promise<SceneView> {
  const [existing] = await db
    .select({ id: schema.registry.scenes.id })
    .from(schema.registry.scenes)
    .where(eq(schema.registry.scenes.key, body.key))
    .limit(1);

  if (existing !== undefined) {
    throw new ConflictError('A scene already has that key', { details: { key: body.key } });
  }

  if (body.areaId !== null && body.areaId !== undefined) {
    await checkSceneArea(db, body.areaId);
  }

  const members = await resolveSceneMembers(db, body.members);

  let sceneId: string;

  try {
    sceneId = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.registry.scenes)
        .values({
          key: body.key,
          name: body.name,
          icon: body.icon ?? null,
          areaId: body.areaId ?? null,
          transitionMs: body.transitionMs,
          rollbackOnPartialFailure: body.rollbackOnPartialFailure,
          createdBy: userId,
        })
        .returning({ id: schema.registry.scenes.id });

      if (row === undefined) {
        throw new ConflictError('A scene already has that key', { details: { key: body.key } });
      }

      await replaceSceneMembers(tx, row.id, members);

      return row.id;
    });
  } catch (error: unknown) {
    // Two saves racing for one key: the check above let both through, the unique index lets
    // one. The second is the same conflict the check would have reported.
    if (isUniqueViolation(error)) {
      throw new ConflictError('A scene already has that key', {
        cause: error,
        details: { key: body.key },
      });
    }

    throw error;
  }

  return readScene(db, sceneId);
}

/**
 * Changes a scene.
 *
 * A partial map. When `members` is present the whole set is replaced in the same transaction as
 * the row update, so a half-applied editor save cannot leave the join table pointing at a mix of
 * old and new entities.
 *
 * @param db - The database.
 * @param id - Which one.
 * @param body - The fields to change.
 * @returns The scene as it now stands.
 * @throws {NotFoundError} When no scene has that id.
 * @throws {ValidationError} When a member is not something a scene can set.
 */
export async function updateScene(db: Database, id: string, body: SceneUpdate): Promise<SceneView> {
  if (body.areaId !== undefined && body.areaId !== null) {
    await checkSceneArea(db, body.areaId);
  }

  const members =
    body.members === undefined ? undefined : await resolveSceneMembers(db, body.members);

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.registry.scenes)
      .set({
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.icon === undefined ? {} : { icon: body.icon }),
        ...(body.areaId === undefined ? {} : { areaId: body.areaId }),
        ...(body.transitionMs === undefined ? {} : { transitionMs: body.transitionMs }),
        ...(body.rollbackOnPartialFailure === undefined
          ? {}
          : { rollbackOnPartialFailure: body.rollbackOnPartialFailure }),
        updatedAt: new Date(),
      })
      .where(eq(schema.registry.scenes.id, id))
      .returning({ id: schema.registry.scenes.id });

    if (row === undefined) {
      return undefined;
    }

    if (members !== undefined) {
      await replaceSceneMembers(tx, id, members);
    }

    return row.id;
  });

  if (updated === undefined) {
    throw new NotFoundError('No scene has that id', { details: { id } });
  }

  return readScene(db, id);
}

/**
 * Deletes a scene.
 *
 * Answers with what was deleted, because the caller has just lost its only copy and the audit
 * entry is written from it.
 *
 * @param db - The database.
 * @param id - Which one.
 * @returns The scene as it was.
 * @throws {NotFoundError} When no scene has that id.
 */
export async function deleteScene(db: Database, id: string): Promise<SceneView> {
  const scene = await readScene(db, id);

  await db.delete(schema.registry.scenes).where(eq(schema.registry.scenes.id, id));

  return scene;
}

/**
 * Loads the members of a set of scenes, keyed by scene id.
 *
 * @param db - The database.
 * @param sceneIds - Which scenes.
 * @returns Members grouped by scene.
 */
async function loadSceneMembers(
  db: Database,
  sceneIds: readonly string[],
): Promise<Map<string, unknown[]>> {
  const byScene = new Map<string, unknown[]>();

  if (sceneIds.length === 0) {
    return byScene;
  }

  const memberRows = await db
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
    .where(inArray(schema.registry.sceneEntities.sceneId, [...sceneIds]));

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

  return byScene;
}

/**
 * Says the area a scene is being hung under actually exists.
 *
 * @param db - The database.
 * @param areaId - Which area.
 * @throws {ValidationError} Naming the field.
 */
async function checkSceneArea(db: Database, areaId: string): Promise<void> {
  const [area] = await db
    .select({ id: schema.registry.areas.id })
    .from(schema.registry.areas)
    .where(eq(schema.registry.areas.id, areaId))
    .limit(1);

  if (area === undefined) {
    throw new ValidationError('The area is not an area', {
      details: { issues: [{ path: 'areaId', message: `No area has the id ${areaId}` }] },
    });
  }
}

/**
 * Resolves member addresses to row ids and checks each target state is something a scene can set
 * on that entity.
 *
 * An entity named twice is refused here rather than by the join table's primary key, which
 * would surface as an internal error instead of a sentence about the member.
 *
 * @param db - The database.
 * @param members - What the caller asked for.
 * @returns Members ready to insert.
 * @throws {ValidationError} Naming the entity or the capability.
 */
async function resolveSceneMembers(
  db: Database,
  members: readonly SceneMemberInput[],
): Promise<ResolvedSceneMember[]> {
  if (members.length === 0) {
    return [];
  }

  const addresses = members.map((member) => member.entityId);
  const repeated = addresses.find((address, index) => addresses.indexOf(address) !== index);

  if (repeated !== undefined) {
    throw new ValidationError(`Entity ${repeated} is in the scene twice`, {
      details: {
        entityId: repeated,
        issues: [{ path: 'members.entityId', message: `${repeated} is listed more than once` }],
      },
    });
  }
  const entityRows = await db
    .select({
      id: schema.registry.entities.id,
      entityId: schema.registry.entities.entityId,
    })
    .from(schema.registry.entities)
    .where(inArray(schema.registry.entities.entityId, [...addresses]));

  const byAddress = new Map(entityRows.map((row) => [row.entityId, row.id]));
  const capabilityRows =
    entityRows.length === 0
      ? []
      : await db
          .select({
            entityRowId: schema.registry.entityCapabilities.entityId,
            capability: schema.registry.entityCapabilities.capability,
          })
          .from(schema.registry.entityCapabilities)
          .where(
            inArray(
              schema.registry.entityCapabilities.entityId,
              entityRows.map((row) => row.id),
            ),
          );

  const capabilitiesByRow = new Map<string, Set<string>>();

  for (const row of capabilityRows) {
    const set = capabilitiesByRow.get(row.entityRowId) ?? new Set<string>();

    set.add(row.capability);
    capabilitiesByRow.set(row.entityRowId, set);
  }

  const resolved: ResolvedSceneMember[] = [];

  for (const member of members) {
    const entityRowId = byAddress.get(member.entityId);

    if (entityRowId === undefined) {
      throw new ValidationError(`No entity ${member.entityId}`, {
        details: {
          entityId: member.entityId,
          issues: [{ path: 'members.entityId', message: `No entity ${member.entityId}` }],
        },
      });
    }

    const targetState = assertSceneTargetState(member.entityId, member.targetState);
    const declared = capabilitiesByRow.get(entityRowId) ?? new Set<string>();

    for (const capability of CAPABILITIES) {
      if (targetState[capability] === undefined) {
        continue;
      }

      if (!declared.has(capability)) {
        throw new ValidationError(`Entity ${member.entityId} has no ${capability} capability`, {
          details: {
            entityId: member.entityId,
            capability,
            declared: [...declared],
          },
        });
      }
    }

    resolved.push({
      entityRowId,
      targetState,
      transitionMs: member.transitionMs ?? null,
    });
  }

  return resolved;
}

/**
 * Checks a member's target state is a scene target: schema-valid, writable, and not a
 * sensor, camera, button, jammed lock or idle media player.
 *
 * @param entityId - The address, for the error sentence.
 * @param state - What was asked for.
 * @returns The parsed state.
 * @throws {ValidationError} When it is not something a scene can set.
 */
function assertSceneTargetState(entityId: string, state: CapabilityState): CapabilityState {
  const parsed = capabilityStateSchema.safeParse(state);

  if (!parsed.success) {
    throw new ValidationError(`Entity ${entityId} target state is not valid`, {
      details: { entityId, issues: parsed.error.issues },
    });
  }

  const target = parsed.data;
  let writableCount = 0;

  for (const capability of CAPABILITIES) {
    if (target[capability] === undefined) {
      continue;
    }

    if (
      capability === 'sensor_numeric' ||
      capability === 'sensor_binary' ||
      capability === 'sensor_text' ||
      capability === 'camera' ||
      capability === 'button' ||
      capability === 'update' ||
      capability === 'lawn_mower' ||
      capability === 'select' ||
      capability === 'number' ||
      capability === 'vacuum' ||
      capability === 'image'
    ) {
      throw new ValidationError(`Entity ${entityId} target cannot include ${capability}`, {
        details: { entityId, capability },
      });
    }

    if (capability === 'lock' && target.lock?.lockState === 'jammed') {
      throw new ValidationError(`Entity ${entityId} target cannot set a lock to jammed`, {
        details: { entityId, capability },
      });
    }

    if (
      capability === 'media_player' &&
      (target.media_player?.playback === 'idle' || target.media_player?.playback === 'buffering')
    ) {
      throw new ValidationError(
        `Entity ${entityId} target cannot set media playback to ${target.media_player.playback}`,
        { details: { entityId, capability } },
      );
    }

    if (SCENE_TARGET_CAPABILITIES.has(capability)) {
      writableCount += 1;
    }
  }

  if (writableCount === 0) {
    throw new ValidationError(`Entity ${entityId} target must include a writable capability`, {
      details: { entityId },
    });
  }

  return target;
}

/**
 * Replaces every member of a scene with the given set.
 *
 * @param db - The transaction or connection.
 * @param sceneId - Which scene.
 * @param members - What to store.
 */
async function replaceSceneMembers(
  db: Database,
  sceneId: string,
  members: readonly ResolvedSceneMember[],
): Promise<void> {
  await db
    .delete(schema.registry.sceneEntities)
    .where(eq(schema.registry.sceneEntities.sceneId, sceneId));

  if (members.length === 0) {
    return;
  }

  await db.insert(schema.registry.sceneEntities).values(
    members.map((member) => ({
      sceneId,
      entityId: member.entityRowId,
      targetState: member.targetState,
      transitionMs: member.transitionMs,
    })),
  );
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
