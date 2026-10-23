/**
 * The configured shape of a home.
 *
 * Four flat collections. None of them paginates: a home has tens of scenes and hundreds of
 * entities, not millions, and a cursor on a list that fits in one response is ceremony. The two
 * collections that do grow without bound - history and telemetry - page, and they are in their
 * own file for that reason; devices and areas, being written as well as read, have files of
 * their own.
 *
 * Scenes and automations can also be written; after a write `core` is told, since it is what runs
 * automations and applies scenes. An automation can be run on request, and its runs read back a
 * page at a time.
 */
import { z } from 'zod';

import {
  aliasCreateSchema,
  aliasPreviewRequestSchema,
  aliasPreviewResponseSchema,
  aliasUpdateSchema,
  aliasViewSchema,
  automationCreateSchema,
  automationHouseSchema,
  automationRunSchema,
  automationTestReplySchema,
  automationTestRequestSchema,
  automationUpdateSchema,
  automationViewSchema,
  ConflictError,
  DeviceUnavailableError,
  pageQuerySchema,
  pageSchema,
  triggerAutomationReplySchema,
  sceneApplyResultSchema,
  sceneCreateSchema,
  sceneUpdateSchema,
  sceneViewSchema,
  type AliasPreviewResponse,
  type AliasView,
  type AutomationHouse,
  type AutomationRun,
  type AutomationTestReply,
  type AutomationView,
  type Page,
  type SceneApplyResult,
  type SceneView,
  type TriggerAutomationReply,
} from '@nebulahome/contracts';

import { isPermitted, requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { collectionSchema } from '../http/collection.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import {
  createAlias,
  deleteAlias,
  listAliases,
  previewAlias,
  updateAlias,
  type AliasesContext,
} from '../services/aliases.js';
import { sealSecrets } from '../services/automation-secrets.js';
import {
  cancelTestOnCore,
  removeAutomationOnCore,
  syncAutomationOnCore,
  testBlockOnCore,
  triggerAutomationOnCore,
  type CoreLink,
} from '../services/automations-core.js';
import {
  createAutomation,
  createScene,
  deleteAutomation,
  deleteScene,
  listAutomationRuns,
  listAutomations,
  listScenes,
  readAutomation,
  readAutomationHouse,
  updateAutomation,
  updateScene,
} from '../services/registry.js';
import { applyScene } from '../services/scene-apply.js';

/** Which automation a request is about. */
const automationParamsSchema = z.object({ automationId: z.uuid() });

/** Which scene a request is about. */
const sceneParamsSchema = z.object({ sceneId: z.uuid() });

/**
 * Registers the configuration read endpoints.
 *
 * @param environment - The server, the registry and the version prefix.
 * @param context - The service context.
 */
export function registerRegistryRoutes(environment: RouteEnvironment, context: ApiContext): void {
  /**
   * What an alias write needs for one request: the database, and the bus to `core` it syncs
   * the alias over.
   *
   * @param traceId - The request's trace id.
   * @returns The context the alias service takes.
   */
  const aliasesContext = (traceId: string): AliasesContext => ({
    db: context.db,
    bus: context.bus,
    traceId,
    timeoutMs: context.config.API_BUS_TIMEOUT_MS,
    logger: context.logger,
  });

  /**
   * What a request to `core` about an automation needs.
   *
   * @param traceId - The request's trace id.
   * @returns The link.
   */
  const coreLink = (traceId: string): CoreLink => ({
    bus: context.bus,
    traceId,
    timeoutMs: context.config.API_BUS_TIMEOUT_MS,
    logger: context.logger,
  });

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/scenes',
      summary: 'List scenes',
      tag: 'Library',
      permission: 'scene:read',
      response: collectionSchema(sceneViewSchema),
    },

    /**
     * Lists scenes.
     *
     * @param route - Who is asking.
     * @returns Every scene, with the states it sets.
     */
    async (route): Promise<{ items: SceneView[] }> => {
      requirePermission(route.identity, 'scene:read');

      return { items: await listScenes(context.db) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/scenes',
      summary: 'Create a scene',
      tag: 'Library',
      permission: 'scene:write',
      body: sceneCreateSchema,
      response: sceneViewSchema,
    },

    /**
     * Creates a scene.
     *
     * Members are stored as target states; applying them is a separate request that fans out
     * ordinary entity commands.
     *
     * @param route - The body and who is asking.
     * @returns The scene as it now stands.
     */
    async (route): Promise<SceneView> => {
      requirePermission(route.identity, 'scene:write');

      const scene = await createScene(context.db, route.body, route.identity.userId);

      await context.audit.record({
        action: 'scene.create',
        resourceType: 'scene',
        resourceId: scene.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { key: scene.key, name: scene.name },
      });

      return scene;
    },
  );

  defineRoute(
    environment,
    {
      method: 'PATCH',
      url: '/scenes/:sceneId',
      summary: 'Change a scene',
      tag: 'Library',
      permission: 'scene:write',
      params: sceneParamsSchema,
      body: sceneUpdateSchema,
      response: sceneViewSchema,
    },

    /**
     * Changes a scene.
     *
     * When `members` is present it replaces the whole set. Clearing `areaId` or `icon` with null
     * removes them.
     *
     * @param route - The body, the id and who is asking.
     * @returns The scene as it now stands.
     */
    async (route): Promise<SceneView> => {
      requirePermission(route.identity, 'scene:write');

      const scene = await updateScene(context.db, route.params.sceneId, route.body);

      await context.audit.record({
        action: 'scene.update',
        resourceType: 'scene',
        resourceId: scene.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { key: scene.key, changed: Object.keys(route.body) },
      });

      return scene;
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/scenes/:sceneId',
      summary: 'Delete a scene',
      tag: 'Library',
      permission: 'scene:write',
      params: sceneParamsSchema,
      response: sceneViewSchema,
    },

    /**
     * Deletes a scene.
     *
     * Answers with what was deleted rather than with nothing, so the caller can say what it was
     * and offer to put it back.
     *
     * @param route - The id and who is asking.
     * @returns The scene as it was.
     */
    async (route): Promise<SceneView> => {
      requirePermission(route.identity, 'scene:write');

      const scene = await deleteScene(context.db, route.params.sceneId);

      await context.audit.record({
        action: 'scene.delete',
        resourceType: 'scene',
        resourceId: scene.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { key: scene.key, name: scene.name },
      });

      return scene;
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/scenes/:sceneId/apply',
      summary: 'Apply a scene',
      tag: 'Library',
      permission: 'scene:apply',
      params: sceneParamsSchema,
      response: sceneApplyResultSchema,

      // An action, not a creation: nothing is made that a `Location` could name.
      successStatus: 200,
    },

    /**
     * Applies a scene.
     *
     * `core` sends the commands; the members the caller may not control are left alone.
     * Acknowledgements mean the adapter accepted each command; this does not wait for the
     * device to converge.
     *
     * @param route - The id and who is asking.
     * @returns How each member fared.
     */
    async (route): Promise<SceneApplyResult> => {
      requirePermission(route.identity, 'scene:apply');

      if (context.bus === undefined) {
        throw new DeviceUnavailableError('The message bus is not reachable', {
          details: { sceneId: route.params.sceneId },
        });
      }

      const result = await applyScene(context.db, route.params.sceneId, {
        client: context.bus,
        identity: route.identity,
        traceId: route.request.traceId,
        deadlineMs: context.config.API_SCENE_APPLY_TIMEOUT_MS,

        /**
         * Records a lock or an unlock the scene sent, as the command route records one sent
         * by hand, with the scene it came from.
         *
         * @param entityId - Which entity.
         * @param capability - Which capability.
         * @param command - Which command.
         */
        recordCommand: async (entityId, capability, command): Promise<void> => {
          await context.audit.record({
            action: 'entity.command',
            resourceType: 'entity',
            resourceId: entityId,
            result: 'success',
            identity: route.identity,
            ipAddress: route.request.ip,
            userAgent: route.request.headers['user-agent'] ?? null,
            traceId: route.request.traceId,
            details: { capability, command, sceneId: route.params.sceneId },
          });
        },
      });

      await context.audit.record({
        action: 'scene.apply',
        resourceType: 'scene',
        resourceId: route.params.sceneId,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { applied: result.applied, failed: result.failed },
      });

      return result;
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/automations',
      summary: 'List automations',
      tag: 'Library',
      permission: 'automation:read',
      response: collectionSchema(automationViewSchema),
    },

    /**
     * Lists automations.
     *
     * @param route - Who is asking.
     * @returns Every automation, with its definition.
     */
    async (route): Promise<{ items: AutomationView[] }> => {
      requirePermission(route.identity, 'automation:read');

      return { items: await listAutomations(context.db) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/automations/house',
      summary: "The house's time zone and position, as the automation editor reads them",
      tag: 'Library',
      permission: 'automation:read',
      response: automationHouseSchema,
    },

    /**
     * Reads what the editor needs to show the next runs of a schedule and the times of the sun.
     * Its own route because the setting and the house row sit behind permissions somebody who
     * writes automations need not have.
     *
     * @param route - Who is asking.
     * @returns The zone and the position.
     */
    async (route): Promise<AutomationHouse> => {
      requirePermission(route.identity, 'automation:read');

      return readAutomationHouse(context.db);
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/automations/test',
      summary: 'Try one block of an automation being edited',
      tag: 'Library',
      permission: 'automation:write',
      body: automationTestRequestSchema,
      response: automationTestReplySchema,

      // A question answered, not something made.
      successStatus: 200,
    },

    /**
     * Tries one block as the editor holds it, saved or not. An action really runs - its commands
     * go to the devices on behalf of who asked - so it also takes the right to run automations,
     * and is audited; a condition or a trigger only reads the house.
     *
     * @param route - The block, the test's id and who is asking.
     * @returns What the test found.
     */
    async (route): Promise<AutomationTestReply> => {
      requirePermission(route.identity, 'automation:write');

      const { target } = route.body;

      if (target.kind === 'action') {
        requirePermission(route.identity, 'automation:trigger');
      }

      const reply = await testBlockOnCore(
        coreLink(route.request.traceId),
        await sealSecrets(context.db, route.body, context.secretsKey),
        route.identity.userId,
      );

      if (target.kind === 'action') {
        await context.audit.record({
          action: 'automation.test',
          resourceType: 'automation',
          resourceId: null,
          result: reply.kind === 'action' && reply.result === 'failed' ? 'failure' : 'success',
          identity: route.identity,
          ipAddress: route.request.ip,
          traceId: route.request.traceId,
          details: {
            testId: route.body.testId,
            type: target.action.type,
            ...(reply.kind === 'action' ? { outcome: reply.result } : {}),
          },
        });
      }

      return reply;
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/automations/test/:testId/cancel',
      summary: 'Stop a test still going',
      tag: 'Library',
      permission: 'automation:write',
      params: z.object({ testId: z.uuid() }),
      response: z.object({ wasRunning: z.boolean() }),
      successStatus: 200,
    },

    /**
     * Stops a test of a block that is still going: a wait, a loop.
     *
     * @param route - The test's id and who is asking.
     * @returns Whether there was one to stop.
     */
    async (route): Promise<{ wasRunning: boolean }> => {
      requirePermission(route.identity, 'automation:write');

      return {
        wasRunning: await cancelTestOnCore(coreLink(route.request.traceId), route.params.testId),
      };
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/automations/:automationId',
      summary: 'Read one automation',
      tag: 'Library',
      permission: 'automation:read',
      params: automationParamsSchema,
      response: automationViewSchema,
    },

    /**
     * Reads one automation, with its latest run.
     *
     * @param route - The id and who is asking.
     * @returns The automation.
     */
    async (route): Promise<AutomationView> => {
      requirePermission(route.identity, 'automation:read');

      return readAutomation(context.db, route.params.automationId);
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/automations/:automationId/runs',
      summary: "Read an automation's runs, newest first",
      tag: 'Library',
      permission: 'automation:read',
      params: automationParamsSchema,
      query: pageQuerySchema,
      response: pageSchema(automationRunSchema),
    },

    /**
     * Reads one page of an automation's runs, each with its trace.
     *
     * @param route - The id, the page and who is asking.
     * @returns The page, newest first.
     */
    async (route): Promise<Page<AutomationRun>> => {
      requirePermission(route.identity, 'automation:read');

      return listAutomationRuns(context.db, route.params.automationId, {
        limit: route.query.limit,
        ...(route.query.cursor === undefined ? {} : { cursor: route.query.cursor }),
      });
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/automations/:automationId/trigger',
      summary: 'Run an automation now',
      tag: 'Library',
      permission: 'automation:trigger',
      params: automationParamsSchema,
      response: triggerAutomationReplySchema,

      // Accepted, not done: the run goes on in `core` after the answer.
      successStatus: 202,
    },

    /**
     * Runs an automation now, through its mode and its checks, as a trigger would. The saved
     * version runs, not whatever an editor has open.
     *
     * @param route - The id and who is asking.
     * @returns The run's id, and whether it started, queued or was turned away.
     * @throws {ConflictError} When the automation is turned off.
     */
    async (route): Promise<TriggerAutomationReply> => {
      requirePermission(route.identity, 'automation:trigger');

      const automation = await readAutomation(context.db, route.params.automationId);

      if (!automation.isEnabled) {
        throw new ConflictError('The automation is turned off', {
          details: { id: automation.id },
        });
      }

      const reply = await triggerAutomationOnCore(
        coreLink(route.request.traceId),
        automation.id,
        route.identity.userId,
      );

      await context.audit.record({
        action: 'automation.trigger',
        resourceType: 'automation',
        resourceId: automation.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { key: automation.key, outcome: reply.outcome, runId: reply.runId },
      });

      return reply;
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/automations',
      summary: 'Create an automation',
      tag: 'Library',
      permission: 'automation:write',
      body: automationCreateSchema,
      response: automationViewSchema,
    },

    /**
     * Creates an automation, and tells `core`, which runs it from then on when it is enabled.
     *
     * @param route - The body and who is asking.
     * @returns The automation as it now stands.
     */
    async (route): Promise<AutomationView> => {
      requirePermission(route.identity, 'automation:write');

      const automation = await createAutomation(
        context.db,
        await sealSecrets(context.db, route.body, context.secretsKey),
        route.identity.userId,
      );

      await syncAutomationOnCore(coreLink(route.request.traceId), automation.id);

      await context.audit.record({
        action: 'automation.create',
        resourceType: 'automation',
        resourceId: automation.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { key: automation.key, name: automation.name },
      });

      return automation;
    },
  );

  defineRoute(
    environment,
    {
      method: 'PATCH',
      url: '/automations/:automationId',
      summary: 'Change an automation',
      tag: 'Library',
      permission: 'automation:write',
      params: automationParamsSchema,
      body: automationUpdateSchema,
      response: automationViewSchema,
    },

    /**
     * Changes an automation.
     *
     * Turning one on and rewriting its actions are the same request, because both are the same
     * row and a person doing the second usually wants the first in the same breath.
     *
     * @param route - The body, the id and who is asking.
     * @returns The automation as it now stands.
     */
    async (route): Promise<AutomationView> => {
      requirePermission(route.identity, 'automation:write');

      const automation = await updateAutomation(
        context.db,
        route.params.automationId,
        await sealSecrets(context.db, route.body, context.secretsKey),
      );

      // An edit to what it does or how it runs cancels its running runs in `core`; one to its
      // name or description does not.
      await syncAutomationOnCore(coreLink(route.request.traceId), automation.id);

      // The field names rather than the values. A definition is a whole document and the audit
      // log is not a version history; what it has to answer is who touched this, and when.
      await context.audit.record({
        action: 'automation.update',
        resourceType: 'automation',
        resourceId: automation.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { key: automation.key, changed: Object.keys(route.body) },
      });

      return automation;
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/automations/:automationId',
      summary: 'Delete an automation',
      tag: 'Library',
      permission: 'automation:write',
      params: automationParamsSchema,
      response: automationViewSchema,
    },

    /**
     * Deletes an automation.
     *
     * Answers with what was deleted rather than with nothing, so the caller can say what it was
     * and offer to put it back.
     *
     * @param route - The id and who is asking.
     * @returns The automation as it was.
     */
    async (route): Promise<AutomationView> => {
      requirePermission(route.identity, 'automation:write');

      const automation = await deleteAutomation(context.db, route.params.automationId);

      await removeAutomationOnCore(coreLink(route.request.traceId), automation.id);

      await context.audit.record({
        action: 'automation.delete',
        resourceType: 'automation',
        resourceId: automation.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { key: automation.key, name: automation.name },
      });

      return automation;
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/aliases',
      summary: 'List derived entities',
      tag: 'Library',
      permission: 'alias:read',
      response: collectionSchema(aliasViewSchema),
    },

    /**
     * Lists aliases.
     *
     * @param route - Who is asking.
     * @returns Every alias, with the entities its formula reads.
     */
    async (route): Promise<{ items: AliasView[] }> => {
      requirePermission(route.identity, 'alias:read');

      return { items: await listAliases(context.db) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/aliases/preview',
      summary: 'Preview a calculated alias formula',
      tag: 'Library',
      permission: 'alias:write',
      body: aliasPreviewRequestSchema,
      response: aliasPreviewResponseSchema,

      // Nothing is saved: a `201` would say otherwise.
      successStatus: 200,
    },

    /**
     * Evaluates a formula without saving it.
     *
     * @param route - Who is asking, and the formula.
     * @returns The scalar result, or an error that never includes source values.
     */
    async (route): Promise<AliasPreviewResponse> => {
      requirePermission(route.identity, 'alias:write');

      return previewAlias(context.db, route.body, route.identity);
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/aliases',
      summary: 'Create a derived entity',
      tag: 'Library',
      permission: 'alias:write',
      body: aliasCreateSchema,
      response: aliasViewSchema,
    },

    /**
     * Creates an alias.
     *
     * @param route - Who is creating it, and what to create.
     * @returns The alias as stored.
     */
    async (route): Promise<AliasView> => {
      requirePermission(route.identity, 'alias:write');

      const alias = await createAlias(
        aliasesContext(route.request.traceId),
        route.body,
        route.identity,
      );

      await context.audit.record({
        action: 'alias.create',
        resourceType: 'alias',
        resourceId: alias.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { entityId: alias.entityId, kind: alias.kind, name: alias.name },
      });

      return alias;
    },
  );

  defineRoute(
    environment,
    {
      method: 'PATCH',
      url: '/aliases/:aliasId',
      summary: 'Update a derived entity',
      tag: 'Library',
      permission: 'alias:write',
      params: z.object({ aliasId: z.uuid() }),
      body: aliasUpdateSchema,
      response: aliasViewSchema,
    },

    /**
     * Updates an alias. The entity id is immutable.
     *
     * @param route - Who is changing it.
     * @returns The alias as stored.
     */
    async (route): Promise<AliasView> => {
      requirePermission(route.identity, 'alias:write');

      const alias = await updateAlias(
        aliasesContext(route.request.traceId),
        route.params.aliasId,
        route.body,
        route.identity,
      );

      await context.audit.record({
        action: 'alias.update',
        resourceType: 'alias',
        resourceId: alias.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { entityId: alias.entityId, name: alias.name },
      });

      return alias;
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/aliases/:aliasId',
      summary: 'Delete a derived entity',
      tag: 'Library',
      permission: 'alias:write',
      params: z.object({ aliasId: z.uuid() }),
      response: aliasViewSchema,
    },

    /**
     * Deletes an alias, through `core`.
     *
     * A deletion another alias blocks is a `CONFLICT`, like every refusal of a write that would
     * leave something dangling; its details name the aliases that read this one when the
     * caller may see aliases.
     *
     * @param route - Who is deleting it.
     * @returns The alias as it was.
     */
    async (route): Promise<AliasView> => {
      requirePermission(route.identity, 'alias:write');

      const deleted = await deleteAlias(
        aliasesContext(route.request.traceId),
        route.params.aliasId,
        isPermitted(route.identity.permissions, 'alias:read'),
      );

      await context.audit.record({
        action: 'alias.delete',
        resourceType: 'alias',
        resourceId: deleted.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { entityId: deleted.entityId, name: deleted.name },
      });

      return deleted;
    },
  );
}
