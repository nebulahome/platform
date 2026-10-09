/**
 * Reading a scene to apply it: its settings and every member's target, by id or by key.
 *
 * Read each time a scene is applied rather than held: a scene is applied a few times a day, and
 * reading it fresh means an edit in the interface is what the next apply does, with nothing to
 * keep in step.
 */
import { asc, eq } from 'drizzle-orm';

import {
  capabilityStateSchema,
  parseEntityId,
  type CapabilityState,
  type EntityId,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';

/** One member: the entity and what it is to become. */
export type SceneMemberRecord = {
  readonly entityId: EntityId;
  readonly targetState: CapabilityState;

  /** Its own fade, or null to use the scene's. */
  readonly transitionMs: number | null;
};

/** A scene, ready to apply. */
export type SceneRecord = {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly transitionMs: number;
  readonly rollbackOnPartialFailure: boolean;
  readonly members: readonly SceneMemberRecord[];
};

/** Which scene: by its row id, as the API asks, or by its key, as an automation names it. */
export type SceneRef = { readonly id: string } | { readonly key: string };

/**
 * Reads one scene and its members.
 *
 * A member whose stored target no longer parses is kept with an empty target, which the apply
 * reports as having nothing to command rather than dropping it unseen.
 *
 * @param db - The database.
 * @param ref - Which scene.
 * @returns The scene, or undefined when there is none.
 */
export async function loadScene(db: Database, ref: SceneRef): Promise<SceneRecord | undefined> {
  const scenes = schema.registry.scenes;
  const [scene] = await db
    .select({
      id: scenes.id,
      key: scenes.key,
      name: scenes.name,
      transitionMs: scenes.transitionMs,
      rollbackOnPartialFailure: scenes.rollbackOnPartialFailure,
    })
    .from(scenes)
    .where('id' in ref ? eq(scenes.id, ref.id) : eq(scenes.key, ref.key))
    .limit(1);

  if (scene === undefined) {
    return undefined;
  }

  const rows = await db
    .select({
      entityId: schema.registry.entities.entityId,
      targetState: schema.registry.sceneEntities.targetState,
      transitionMs: schema.registry.sceneEntities.transitionMs,
    })
    .from(schema.registry.sceneEntities)
    .innerJoin(
      schema.registry.entities,
      eq(schema.registry.entities.id, schema.registry.sceneEntities.entityId),
    )
    .where(eq(schema.registry.sceneEntities.sceneId, scene.id))
    .orderBy(asc(schema.registry.entities.entityId));

  return {
    ...scene,
    members: rows.map((row) => {
      const target = capabilityStateSchema.safeParse(row.targetState);

      return {
        entityId: parseEntityId(row.entityId),
        targetState: target.success ? target.data : {},
        transitionMs: row.transitionMs,
      };
    }),
  };
}
