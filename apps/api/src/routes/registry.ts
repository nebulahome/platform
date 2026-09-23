/**
 * The configured shape of a home.
 *
 * Four flat collections. None of them paginates: a home has tens of scenes and hundreds of
 * entities, not millions, and a cursor on a list that fits in one response is ceremony. The two
 * collections that do grow without bound - history and telemetry - page, and they are in their
 * own file for that reason; devices and areas, being written as well as read, have files of
 * their own.
 *
 * Scenes and automations can also be written. What that covers and what it deliberately does not
 * - a definition is saved; an automation run is not started - is set out on the service beside
 * it. Applying a scene fans out entity commands from here.
 */
import { z } from 'zod';

import {
  aliasCreateSchema,
  aliasPreviewRequestSchema,
  aliasPreviewResponseSchema,
  aliasUpdateSchema,
  aliasViewSchema,
  automationCreateSchema,
  automationUpdateSchema,
  automationViewSchema,
  DeviceUnavailableError,
  packageViewSchema,
  sceneApplyResultSchema,
  sceneCreateSchema,
  sceneUpdateSchema,
  sceneViewSchema,
  type AliasPreviewResponse,
  type AliasView,
  type AutomationView,
  type PackageView,
  type SceneApplyResult,
  type SceneView,
} from '@nebula-home/contracts';

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
import {
  createAutomation,
  createScene,
  deleteAutomation,
  deleteScene,
  listAutomations,
  listPackages,
  listScenes,
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
     * Fans out the same entity commands a person would send one by one. Acknowledgements mean
     * the adapter accepted each command; this does not wait for the device to converge.
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
        timeoutMs: context.config.API_BUS_TIMEOUT_MS,

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
      method: 'POST',
      url: '/automations',
      summary: 'Create an automation',
      tag: 'Library',
      permission: 'automation:write',
      body: automationCreateSchema,
      response: automationViewSchema,
    },

    /**
     * Creates an automation.
     *
     * It is saved disabled or enabled as asked, and either way nothing runs it yet: the engine
     * that will is ARCHITECTURE.md 6.1. What this endpoint promises is that the definition is
     * valid and stored, which is the whole of what it does.
     *
     * @param route - The body and who is asking.
     * @returns The automation as it now stands.
     */
    async (route): Promise<AutomationView> => {
      requirePermission(route.identity, 'automation:write');

      const automation = await createAutomation(context.db, route.body, route.identity.userId);

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

      const automation = await updateAutomation(context.db, route.params.automationId, route.body);

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

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/packages',
      summary: 'List installed packages',
      tag: 'System',
      permission: 'package:read',
      response: collectionSchema(packageViewSchema),
    },

    /**
     * Lists installed packages.
     *
     * @param route - Who is asking.
     * @returns Every package, with how much of the house it accounts for.
     */
    async (route): Promise<{ items: PackageView[] }> => {
      requirePermission(route.identity, 'package:read');

      return { items: await listPackages(context.db) };
    },
  );
}
