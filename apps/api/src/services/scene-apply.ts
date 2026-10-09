/**
 * Applying a scene from the API: who may command which member is checked here, and `core`'s
 * scene engine does the rest (ARCHITECTURE.md 6.2).
 *
 * Holding `scene:apply` is permission to press the button, not a way around what each entity
 * allows: a member the caller may not control (`entity:control` on it) is handed to `core` as
 * skipped, and `core` sends it nothing. `core` answers with what it sent each member, so a lock
 * moved by a scene is audited as `entity.command` like one moved by hand, with the scene it came
 * from.
 */
import { eq, sql } from 'drizzle-orm';

import type { BusClient } from '@nebulahome/bus';
import {
  applySceneReplySchema,
  busSubjects,
  commandNameOf,
  CORE_APPLY_SCENE_METHOD,
  CORE_SERVICE,
  NotFoundError,
  parseEntityId,
  sceneApplyResultSchema,
  type CapabilityName,
  type Identity,
  type SceneApplyResult,
  type SceneSkip,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';

import { entityScopes, isPermitted } from '../auth/permissions.js';

import { isAuditedCapability } from './commands.js';
import { readTagKeys } from './entities.js';

/** How much longer than the apply's own deadline the API waits for `core`'s answer. */
const ANSWER_MARGIN_MS = 2_000;

/** What applying a scene needs beyond the database. */
export type ApplySceneOptions = {
  /** The bus client. */
  readonly client: BusClient;

  /** Who asked. */
  readonly identity: Identity;

  /** The request's trace id. */
  readonly traceId: string;

  /** How long the whole apply may take. */
  readonly deadlineMs: number;

  /**
   * Records a command the audit log must carry - a lock, today - once it has been accepted,
   * as the entity command route does for the same command sent by hand.
   */
  readonly recordCommand: (
    entityId: string,
    capability: CapabilityName,
    command: string,
  ) => Promise<void>;
};

/** One member as the permission check reads it. */
type MemberRow = {
  readonly rowId: string;
  readonly entityId: string;
  readonly deviceId: string | null;
  readonly areaKey: string | null;
};

/**
 * Reads a scene's members, with what the permission check needs.
 *
 * @param db - The database.
 * @param sceneId - Which scene.
 * @returns The members.
 */
async function readMembers(db: Database, sceneId: string): Promise<MemberRow[]> {
  return db
    .select({
      rowId: schema.registry.entities.id,
      entityId: schema.registry.entities.entityId,
      deviceId: schema.registry.entities.deviceId,
      areaKey: schema.registry.areas.key,
    })
    .from(schema.registry.sceneEntities)
    .innerJoin(
      schema.registry.entities,
      eq(schema.registry.entities.id, schema.registry.sceneEntities.entityId),
    )
    .leftJoin(
      schema.registry.devices,
      eq(schema.registry.devices.id, schema.registry.entities.deviceId),
    )
    .leftJoin(
      schema.registry.areas,
      eq(
        schema.registry.areas.id,
        sql`coalesce(${schema.registry.entities.areaId}, ${schema.registry.devices.areaId})`,
      ),
    )
    .where(eq(schema.registry.sceneEntities.sceneId, sceneId));
}

/**
 * Applies a scene: the members the caller may command, through `core`.
 *
 * Does not wait for devices to converge - an acknowledgement means the adapter accepted the
 * command, not that the lamp has finished fading.
 *
 * @param db - The database.
 * @param sceneId - Which scene.
 * @param options - The bus, who asked, how long it may take, and where audited commands go.
 * @returns Per-member outcomes.
 * @throws {NotFoundError} When no scene has that id.
 * @throws {DeviceUnavailableError} When `core` does not answer in time.
 */
export async function applyScene(
  db: Database,
  sceneId: string,
  options: ApplySceneOptions,
): Promise<SceneApplyResult> {
  const [scene] = await db
    .select({ id: schema.registry.scenes.id })
    .from(schema.registry.scenes)
    .where(eq(schema.registry.scenes.id, sceneId))
    .limit(1);

  if (scene === undefined) {
    throw new NotFoundError('No scene has that id', { details: { id: sceneId } });
  }

  const rows = await readMembers(db, sceneId);
  const tags = await readTagKeys(db, rows);
  const skip: SceneSkip[] = rows
    .filter(
      (row) =>
        !isPermitted(
          options.identity.permissions,
          'entity:control',
          entityScopes(row.entityId, row.areaKey, tags.get(row.rowId) ?? []),
        ),
    )
    .map((row) => ({
      entityId: parseEntityId(row.entityId),
      reason: 'You may not control this entity',
    }));

  const reply = await options.client.request(
    busSubjects.service(CORE_SERVICE, CORE_APPLY_SCENE_METHOD),
    {
      sceneId,
      skip,
      context: { type: 'scene', id: sceneId },
      deadlineMs: options.deadlineMs,
    },
    applySceneReplySchema,
    { traceId: options.traceId, timeoutMs: options.deadlineMs + ANSWER_MARGIN_MS },
  );

  for (const member of reply.members) {
    for (const sent of member.sent) {
      if (isAuditedCapability(sent.capability)) {
        // In order, as each was sent.
        // eslint-disable-next-line no-await-in-loop -- see above
        await options.recordCommand(member.entityId, sent.capability, commandNameOf(sent.command));
      }
    }
  }

  return sceneApplyResultSchema.parse({
    sceneId: reply.sceneId,
    applied: reply.applied,
    failed: reply.failed,
    members: reply.members.map((member) => ({
      entityId: member.entityId,
      ok: member.ok,
      error: member.error,
    })),
  });
}
