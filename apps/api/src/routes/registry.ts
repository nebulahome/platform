/**
 * The configured shape of a home.
 *
 * Six flat collections. None of them paginates: a home has tens of areas and hundreds of
 * entities, not millions, and a cursor on a list that fits in one response is ceremony. The two
 * collections that do grow without bound - history and telemetry - page, and they are in their
 * own file for that reason.
 *
 * Automations can also be written. What that covers and what it deliberately does not - a
 * definition is saved, a run is not started - is set out on the service beside it.
 */
import { z } from 'zod';

import {
  aliasViewSchema,
  areaViewSchema,
  automationCreateSchema,
  automationUpdateSchema,
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

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import {
  createAutomation,
  deleteAutomation,
  listAliases,
  listAreas,
  listAutomations,
  listDevices,
  listLabels,
  listPackages,
  listScenes,
  updateAutomation,
} from '../services/registry.js';

/** Which automation a request is about. */
const automationParamsSchema = z.object({ automationId: z.uuid() });

/**
 * A collection response. Not the paged envelope: these lists are bounded by the house.
 *
 * @param item - What one entry looks like.
 * @returns The schema of a whole collection of them.
 */
const collectionSchema = <TItem extends z.ZodType>(
  item: TItem,
): z.ZodObject<{ items: z.ZodArray<TItem> }> => z.object({ items: z.array(item) });

/**
 * Registers the configuration read endpoints.
 *
 * @param environment - The server, the registry and the version prefix.
 * @param context - The service context.
 */
export function registerRegistryRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/areas',
      summary: 'List areas',
      tag: 'Registry',
      permission: 'area:read',
      response: collectionSchema(areaViewSchema),
    },

    /**
     * Lists areas.
     *
     * @param route - Who is asking.
     * @returns Every area, with how many entities are in each.
     */
    async (route): Promise<{ items: AreaView[] }> => {
      requirePermission(route.identity, 'area:read');

      return { items: await listAreas(context.db) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/labels',
      summary: 'List labels',
      tag: 'Registry',
      permission: 'label:read',
      response: collectionSchema(labelViewSchema),
    },

    /**
     * Lists labels.
     *
     * @param route - Who is asking.
     * @returns Every label, with how many entities carry it.
     */
    async (route): Promise<{ items: LabelView[] }> => {
      requirePermission(route.identity, 'label:read');

      return { items: await listLabels(context.db) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/devices',
      summary: 'List devices',
      tag: 'Registry',
      permission: 'device:read',
      response: collectionSchema(deviceViewSchema),
    },

    /**
     * Lists devices.
     *
     * @param route - Who is asking.
     * @returns Every device, each with the entities it exposes.
     */
    async (route): Promise<{ items: DeviceView[] }> => {
      requirePermission(route.identity, 'device:read');

      return { items: await listDevices(context.db) };
    },
  );

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
      method: 'GET',
      url: '/packages',
      summary: 'List installed packages',
      tag: 'Packages',
      permission: 'package:read',
      response: collectionSchema(packageViewSchema),
    },

    /**
     * Lists packages.
     *
     * @param route - Who is asking.
     * @returns Every installed package and how it is faring.
     */
    async (route): Promise<{ items: PackageView[] }> => {
      requirePermission(route.identity, 'package:read');

      return { items: await listPackages(context.db) };
    },
  );
}
