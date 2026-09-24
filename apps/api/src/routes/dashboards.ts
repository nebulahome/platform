/**
 * Dashboards: each person's own pages of cards.
 *
 * None of these needs a permission beyond being signed in, the way reading your own account does
 * not: every route acts on the caller's own dashboards and nobody else's. What a card may show or
 * command is still decided per entity and per scene, by the routes that serve and command them.
 *
 * A dashboard also travels as a file, in the standard `dashboardDocumentSchema` defines: exported
 * from one dashboard, imported as a new one.
 */
import { z } from 'zod';

import {
  dashboardCreateSchema,
  dashboardDocumentSchema,
  dashboardFileName,
  dashboardUpdateSchema,
  dashboardViewSchema,
  toDashboardDocument,
  type DashboardDocument,
  type DashboardView,
} from '@nebula-home/contracts';

import type { ApiContext } from '../context.js';
import { collectionSchema } from '../http/collection.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import {
  createDashboard,
  deleteDashboard,
  listDashboards,
  readDashboard,
  updateDashboard,
} from '../services/dashboards.js';

/** Which dashboard a request is about. */
const dashboardParamsSchema = z.object({ dashboardId: z.uuid() });

/**
 * Registers the dashboard routes.
 *
 * @param environment - Where routes are defined.
 * @param context - The service's collaborators.
 */
export function registerDashboardRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/dashboards',
      summary: 'List your dashboards',
      tag: 'Dashboards',
      permission: null,
      response: collectionSchema(dashboardViewSchema),
    },

    /**
     * Lists the caller's dashboards.
     *
     * @param route - Who is asking.
     * @returns Their dashboards, in the order their tabs are drawn.
     */
    async (route): Promise<{ items: DashboardView[] }> => ({
      items: await listDashboards(context.db, route.identity.userId),
    }),
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/dashboards',
      summary: 'Create a dashboard',
      tag: 'Dashboards',
      permission: null,
      body: dashboardCreateSchema,
      response: dashboardViewSchema,
    },

    /**
     * Creates a dashboard for the caller.
     *
     * @param route - The body and who is asking.
     * @returns The dashboard as it now stands.
     */
    async (route): Promise<DashboardView> => {
      const dashboard = await createDashboard(context.db, route.identity.userId, route.body);

      await context.audit.record({
        action: 'dashboard.create',
        resourceType: 'dashboard',
        resourceId: dashboard.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { name: dashboard.name },
      });

      return dashboard;
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/dashboards/import',
      summary: 'Import a dashboard from its file',
      tag: 'Dashboards',
      permission: null,
      body: dashboardDocumentSchema,
      response: dashboardViewSchema,
    },

    /**
     * Makes a new dashboard for the caller from a dashboard file.
     *
     * Always a new one: a file carries no id, so it can never overwrite a dashboard.
     *
     * @param route - The file's content and who is asking.
     * @returns The dashboard as it now stands.
     */
    async (route): Promise<DashboardView> => {
      const dashboard = await createDashboard(context.db, route.identity.userId, {
        name: route.body.name,
        icon: route.body.icon,
        layout: route.body.layout,
      });

      await context.audit.record({
        action: 'dashboard.import',
        resourceType: 'dashboard',
        resourceId: dashboard.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { name: dashboard.name, cards: dashboard.layout.cards.length },
      });

      return dashboard;
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/dashboards/:dashboardId',
      summary: 'Read one of your dashboards',
      tag: 'Dashboards',
      permission: null,
      params: dashboardParamsSchema,
      response: dashboardViewSchema,
    },

    /**
     * Reads one of the caller's dashboards.
     *
     * @param route - The id and who is asking.
     * @returns The dashboard.
     */
    async (route): Promise<DashboardView> =>
      readDashboard(context.db, route.identity.userId, route.params.dashboardId),
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/dashboards/:dashboardId/export',
      summary: 'Export one of your dashboards as a file',
      tag: 'Dashboards',
      permission: null,
      params: dashboardParamsSchema,
      response: dashboardDocumentSchema,
    },

    /**
     * Writes one of the caller's dashboards out in the file standard, named for saving.
     *
     * @param route - The id, who is asking, and the reply the file name goes on.
     * @returns What the file holds.
     */
    async (route): Promise<DashboardDocument> => {
      const dashboard = await readDashboard(
        context.db,
        route.identity.userId,
        route.params.dashboardId,
      );

      void route.reply.header(
        'content-disposition',
        `attachment; filename="${dashboardFileName(dashboard.name)}"`,
      );

      return toDashboardDocument(dashboard);
    },
  );

  defineRoute(
    environment,
    {
      method: 'PATCH',
      url: '/dashboards/:dashboardId',
      summary: 'Change one of your dashboards',
      tag: 'Dashboards',
      permission: null,
      params: dashboardParamsSchema,
      body: dashboardUpdateSchema,
      response: dashboardViewSchema,
    },

    /**
     * Changes one of the caller's dashboards. A layout replaces the stored one whole.
     *
     * @param route - The body, the id and who is asking.
     * @returns The dashboard as it now stands.
     */
    async (route): Promise<DashboardView> => {
      const dashboard = await updateDashboard(
        context.db,
        route.identity.userId,
        route.params.dashboardId,
        route.body,
      );

      await context.audit.record({
        action: 'dashboard.update',
        resourceType: 'dashboard',
        resourceId: dashboard.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { changed: Object.keys(route.body) },
      });

      return dashboard;
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/dashboards/:dashboardId',
      summary: 'Delete one of your dashboards',
      tag: 'Dashboards',
      permission: null,
      params: dashboardParamsSchema,
      response: dashboardViewSchema,
    },

    /**
     * Deletes one of the caller's dashboards.
     *
     * @param route - The id and who is asking.
     * @returns The dashboard as it was.
     */
    async (route): Promise<DashboardView> => {
      const dashboard = await deleteDashboard(
        context.db,
        route.identity.userId,
        route.params.dashboardId,
      );

      await context.audit.record({
        action: 'dashboard.delete',
        resourceType: 'dashboard',
        resourceId: dashboard.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { name: dashboard.name },
      });

      return dashboard;
    },
  );
}
