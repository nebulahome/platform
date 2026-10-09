/**
 * Applying a scene: turning each member's target state into ordinary entity commands and
 * sending them.
 *
 * Not the scene engine ARCHITECTURE.md 6.2 describes, which belongs in `core`: there is no
 * transactional device protocol here. Each command takes the same path as
 * `POST /entities/:id/command/:capability`, with the same checks - the caller must hold
 * `entity:control` on the member, and a command the audit log must carry is recorded - and
 * tagged with a scene context so history can say why the light moved. Holding `scene:apply` is
 * permission to press the button, not a way around what each entity allows. Rollback, when
 * asked for, is the same mapper run backwards against the state the members had before, for
 * the capabilities the scene touched and no others.
 */
import { eq, sql } from 'drizzle-orm';

import type { BusClient } from '@nebulahome/bus';
import {
  capabilityStateSchema,
  commandNameOf,
  commandsForTargetState,
  isNebulaError,
  NotFoundError,
  parseEntityId,
  restoreStateFor,
  sceneApplyResultSchema,
  type CapabilityName,
  type ChangeContext,
  type Identity,
  type SceneApplyResult,
  type SceneTargetCommand,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';

import { entityScopes, isPermitted } from '../auth/permissions.js';

import { isAuditedCapability, sendCommand } from './commands.js';
import { readTagKeys } from './entities.js';

/** How many entities are commanded at once. */
const APPLY_CONCURRENCY = 4;

/** What applying a scene needs beyond the database. */
export type ApplySceneOptions = {
  /** The bus client. */
  readonly client: BusClient;

  /** Who asked. */
  readonly identity: Identity;

  /** The request's trace id. */
  readonly traceId: string;

  /** How long to wait for each acknowledgement. */
  readonly timeoutMs: number;

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

/** One member as the apply reads it. */
type MemberRow = {
  readonly rowId: string;
  readonly entityId: string;
  readonly deviceId: string | null;
  readonly areaKey: string | null;
  readonly targetState: unknown;
  readonly transitionMs: number | null;
  readonly currentState: unknown;
};

/** How one member fared, filled in as the apply goes. */
type MemberOutcome = {
  readonly entityId: string;
  ok: boolean;
  error: string | null;
};

/**
 * Reads a scene's members, with what each needs for the permission check and the rollback.
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
      targetState: schema.registry.sceneEntities.targetState,
      transitionMs: schema.registry.sceneEntities.transitionMs,
      currentState: schema.registry.entityStates.state,
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
    .leftJoin(
      schema.registry.entityStates,
      eq(schema.registry.entityStates.entityId, schema.registry.entities.id),
    )
    .where(eq(schema.registry.sceneEntities.sceneId, sceneId));
}

/**
 * Applies a scene: commands each member toward its target, optionally rolling successful ones
 * back when any fail.
 *
 * Does not wait for devices to converge - an acknowledgement means the adapter accepted the
 * command, not that the lamp has finished fading. A member the caller may not control, or
 * whose stored target holds nothing that can be commanded, is reported failed and sent
 * nothing.
 *
 * @param db - The database.
 * @param sceneId - Which scene.
 * @param options - The bus, who asked, how long to wait, and where audited commands go.
 * @returns Per-member outcomes.
 * @throws {NotFoundError} When no scene has that id.
 */
export async function applyScene(
  db: Database,
  sceneId: string,
  options: ApplySceneOptions,
): Promise<SceneApplyResult> {
  const [scene] = await db
    .select({
      transitionMs: schema.registry.scenes.transitionMs,
      rollbackOnPartialFailure: schema.registry.scenes.rollbackOnPartialFailure,
    })
    .from(schema.registry.scenes)
    .where(eq(schema.registry.scenes.id, sceneId))
    .limit(1);

  if (scene === undefined) {
    throw new NotFoundError('No scene has that id', { details: { id: sceneId } });
  }

  const rows = await readMembers(db, sceneId);
  const tags = await readTagKeys(db, rows);
  const context: ChangeContext = { type: 'scene', id: sceneId };
  const outcomes: MemberOutcome[] = rows.map((row) => ({
    entityId: row.entityId,
    ok: false,
    error: null,
  }));
  const targets = rows.map((row) => {
    const parsed = capabilityStateSchema.safeParse(row.targetState);

    return parsed.success ? parsed.data : {};
  });

  /**
   * Sends one member its commands, in order, recording the ones the audit log must carry.
   *
   * @param row - The member.
   * @param commands - What to send it.
   */
  const send = async (row: MemberRow, commands: readonly SceneTargetCommand[]): Promise<void> => {
    for (const entry of commands) {
      // Sequential per entity on purpose: a colour after a level, not both at once.
      // eslint-disable-next-line no-await-in-loop -- see above
      await sendCommand({
        client: options.client,
        entityId: parseEntityId(row.entityId),
        capability: entry.capability,
        command: entry.command,
        identity: options.identity,
        traceId: options.traceId,
        timeoutMs: options.timeoutMs,
        context,
      });

      if (isAuditedCapability(entry.capability)) {
        // eslint-disable-next-line no-await-in-loop -- recorded as each is accepted, as by hand
        await options.recordCommand(row.entityId, entry.capability, commandNameOf(entry.command));
      }
    }
  };

  await forEachConcurrently(rows, APPLY_CONCURRENCY, async (row, index) => {
    const outcome = outcomes[index];
    const target = targets[index] ?? {};

    if (outcome === undefined) {
      return;
    }

    const scopes = entityScopes(row.entityId, row.areaKey, tags.get(row.rowId) ?? []);

    if (!isPermitted(options.identity.permissions, 'entity:control', scopes)) {
      outcome.error = 'You may not control this entity';

      return;
    }

    const commands = commandsForTargetState(target, row.transitionMs ?? scene.transitionMs);

    if (commands.length === 0) {
      outcome.error = 'Nothing in its target state can be commanded';

      return;
    }

    try {
      await send(row, commands);
      outcome.ok = true;
    } catch (error: unknown) {
      outcome.error = shortError(error);
    }
  });

  if (scene.rollbackOnPartialFailure && outcomes.some((outcome) => !outcome.ok)) {
    await forEachConcurrently(rows, APPLY_CONCURRENCY, async (row, index) => {
      const outcome = outcomes[index];

      if (outcome?.ok !== true) {
        return;
      }

      const before = capabilityStateSchema.safeParse(row.currentState);
      const restore = before.success ? restoreStateFor(before.data, targets[index] ?? {}) : {};
      const commands = commandsForTargetState(restore, row.transitionMs ?? scene.transitionMs);

      outcome.ok = false;

      if (commands.length === 0) {
        outcome.error = 'Could not roll back: no earlier state to return to';

        return;
      }

      try {
        await send(row, commands);
        outcome.error = 'Rolled back after partial failure';
      } catch (error: unknown) {
        outcome.error = `Rollback failed: ${shortError(error)}`;
      }
    });
  }

  const applied = outcomes.filter((outcome) => outcome.ok).length;

  return sceneApplyResultSchema.parse({
    sceneId,
    applied,
    failed: outcomes.length - applied,
    members: outcomes,
  });
}

/**
 * A short sentence for a failed command, fit for a result field rather than a log line.
 *
 * @param error - What was thrown.
 * @returns The message.
 */
function shortError(error: unknown): string {
  if (isNebulaError(error) || error instanceof Error) {
    return error.message;
  }

  return 'Command failed';
}

/**
 * Runs a job over every item, a few at a time.
 *
 * @param items - What to work through.
 * @param concurrency - How many at once.
 * @param job - What to do with each, given its index.
 */
async function forEachConcurrently<T>(
  items: readonly T[],
  concurrency: number,
  job: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;

  /** Takes items until there are none left. */
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      const item = items[index];

      next += 1;

      if (item !== undefined) {
        // One after another on purpose: this worker is one lane of a few.
        // eslint-disable-next-line no-await-in-loop -- see above
        await job(item, index);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}
