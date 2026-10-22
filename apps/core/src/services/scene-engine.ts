/**
 * The scene engine: applying a scene from `core`, for the API's Apply button and for an
 * automation's "Apply a scene" block alike.
 *
 * Reads the scene fresh, snapshots its members from the in-memory registry - the single writer's
 * own view, newer than any cache - and runs the procedure in `domain/scene-apply.ts`, sending each
 * command through the same dispatcher as every other command in `core`, carrying the cause the
 * caller gave so history can say why the light moved.
 */
import {
  NotFoundError,
  assertSceneResolved,
  type ApplySceneReply,
  type ChangeContext,
  type SceneSkip,
} from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import type { EntityRegistry } from '../domain/entity-registry.js';
import { applyScenePlan } from '../domain/scene-apply.js';
import { loadScene, type SceneRef } from '../persistence/scene-loader.js';

import type { CommandDispatcher } from './command-dispatch.js';

/** What the scene engine needs. */
export type SceneEngineOptions = {
  readonly db: Database;

  /** The live states, snapshotted before an apply for its rollback. */
  readonly registry: EntityRegistry;

  /** How commands go out. */
  readonly dispatcher: CommandDispatcher;

  readonly logger: PlatformLogger;
};

/** One apply. */
export type SceneApplyRequest = {
  /** Members to leave alone, and why. */
  readonly skip?: readonly SceneSkip[];

  /** What is applying it: a person's press, an automation's run. */
  readonly context: ChangeContext;

  readonly traceId: string;

  /** How long the whole apply may take, rollback included. */
  readonly deadlineMs: number;

  /** Abandons the apply between commands: a run cancelled or out of time. */
  readonly signal?: AbortSignal;
};

/** Applies scenes. */
export class SceneEngine {
  readonly #options: SceneEngineOptions;

  /**
   * Builds the engine.
   *
   * @param options - The database, the registry, the dispatcher and the logger.
   */
  public constructor(options: SceneEngineOptions) {
    this.#options = options;
  }

  /**
   * Applies one scene.
   *
   * @param ref - Which scene, by id or key.
   * @param request - Who is applying it, what to skip, and how long it may take.
   * @returns Per-member outcomes, with what was sent to each.
   * @throws {NotFoundError} When there is no such scene.
   * @throws {ConflictError} When it still has members waiting for an entity.
   */
  public async apply(ref: SceneRef, request: SceneApplyRequest): Promise<ApplySceneReply> {
    const scene = await loadScene(this.#options.db, ref);

    if (scene === undefined) {
      throw new NotFoundError('No scene has that id', { details: { ...ref } });
    }

    assertSceneResolved(scene.unresolvedMembers);

    const deadline = Date.now() + request.deadlineMs;
    const logger = this.#options.logger;

    const reply = await applyScenePlan(
      {
        sceneId: scene.id,
        transitionMs: scene.transitionMs,
        rollbackOnPartialFailure: scene.rollbackOnPartialFailure,
        members: scene.members.map((member) => ({
          ...member,
          before: this.#options.registry.get(member.entityId)?.state,
        })),
      },
      request.skip ?? [],
      {
        /**
         * Sends one command through the dispatcher, carrying the apply's cause.
         *
         * @param entityId - The member.
         * @param capability - Which of its capabilities.
         * @param command - The command body.
         */
        send: async (entityId, capability, command) => {
          await this.#options.dispatcher.dispatch({
            entityId,
            capability,
            command,
            context: request.context,
            traceId: request.traceId,
            logger,
          });
        },
        /**
         * Whether the apply is past its deadline or was abandoned.
         *
         * @returns True when no more commands should go out.
         */
        isOver: () => Date.now() > deadline || request.signal?.aborted === true,
      },
    );

    logger.info(
      {
        scene: scene.key,
        applied: reply.applied,
        failed: reply.failed,
        cause: request.context.type,
      },
      'Applied a scene',
    );

    return reply;
  }
}
