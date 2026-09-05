/**
 * Reading the configured shape of a home.
 *
 * Seven flat collections. None of them paginates: a home has tens of areas and hundreds of
 * entities, not millions, and a cursor on a list that fits in one response is ceremony. The two
 * collections that do grow without bound - history and telemetry - page, and they are in their
 * own file for that reason.
 */
import { z } from 'zod';

import {
  aliasViewSchema,
  areaViewSchema,
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
  listAliases,
  listAreas,
  listAutomations,
  listDevices,
  listLabels,
  listPackages,
  listScenes,
} from '../services/registry.js';

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
