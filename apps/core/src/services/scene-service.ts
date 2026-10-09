/**
 * The subject the API applies a scene on.
 *
 * The API checks who pressed Apply and which members they may command; `core` applies the rest.
 * Served a few at a time: an apply waits on every member's acknowledgement, and one scene of
 * slow lamps must not hold another scene's apply behind it.
 */
import type { BusClient, BusSubscription, MessageContext } from '@nebulahome/bus';
import {
  applySceneRequestSchema,
  busSubjects,
  CORE_APPLY_SCENE_METHOD,
  CORE_SERVICE,
  type ApplySceneReply,
  type ApplySceneRequest,
} from '@nebulahome/contracts';

import type { SceneEngine } from './scene-engine.js';

/** How many scenes may be applying at once. */
const APPLY_CONCURRENCY = 4;

/** What the scene service needs. */
export type SceneServiceOptions = {
  readonly client: BusClient;
  readonly engine: SceneEngine;
};

/**
 * Serves the subject the API applies scenes on.
 *
 * @param options - The bus client and the engine.
 * @returns The subscription, to unsubscribe on shutdown.
 */
export function startSceneService(options: SceneServiceOptions): BusSubscription {
  return options.client.serve(
    busSubjects.service(CORE_SERVICE, CORE_APPLY_SCENE_METHOD),
    applySceneRequestSchema,

    /**
     * Applies one scene.
     *
     * @param request - Which scene, what to skip, the cause and the deadline.
     * @param context - The request's envelope, for its trace id.
     * @returns How each member fared.
     */
    async (request: ApplySceneRequest, context: MessageContext): Promise<ApplySceneReply> =>
      options.engine.apply(
        { id: request.sceneId },
        {
          skip: request.skip,
          context: request.context,
          traceId: context.header.traceId,
          deadlineMs: request.deadlineMs,
        },
      ),
    { concurrency: APPLY_CONCURRENCY },
  );
}
