/**
 * Dashboards: the house's pages of cards, and who each is shown to.
 *
 * Two audiences. Anyone signed in reads the dashboards assigned to them - `GET /dashboards` and
 * one of those by id - with no permission beyond being signed in, the way reading your own account
 * needs none; a dashboard not assigned to them is answered as missing. Everything else - listing
 * every dashboard, making one, laying it out, assigning it, exporting and removing it - is
 * `dashboard:manage`. What a card may show or command is still decided per entity and per scene,
 * by the routes that serve and command them.
 *
 * A dashboard also travels as a file, in the standard `dashboardDocumentSchema` defines: exported
 * from one dashboard, imported as a new one.
 */
import { z } from 'zod';

import {
  dashboardAssigneeSchema,
  dashboardCreateSchema,
  dashboardDocumentSchema,
  dashboardFileName,
  dashboardUpdateSchema,
  dashboardViewSchema,
  toDashboardDocument,
  type DashboardAssignee,
  type DashboardDocument,
  type DashboardView,
} from '@nebula-home/contracts';

import { isPermitted, requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { collectionSchema } from '../http/collection.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import {
  createDashboard,
  deleteDashboard,
  listAllDashboards,
  listAssignedDashboards,
  listAssignees,
  readDashboard,
  readVisibleDashboard,
  updateDashboard,
} from '../services/dashboards.js';

/** The permission every change needs. */
const MANAGE = 'dashboard:manage';

/** Which dashboard a request is about. */
const dashboardParamsSchema = z.object({ dashboardId: z.uuid() });

/**
 * Registers the dashboard routes.
 *
 * The two fixed paths under `/dashboards/` are declared before the one that takes an id, and
 * Fastify prefers a static segment over a parameter anyway, so `manage` is never read as an id.
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
      summary: 'List the dashboards assigned to you',
      tag: 'Dashboards',
      permission: null,
      response: collectionSchema(dashboardViewSchema),
    },

    /**
     * Lists what the caller is shown.
     *
     * @param route - Who is asking.
     * @returns Their dashboards, in the order their tabs are drawn.
     */
    async (route): Promise<{ items: DashboardView[] }> => ({
      items: await listAssignedDashboards(context.db, route.identity.userId),
    }),
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/dashboards/manage',
      summary: 'List every dashboard, with who each is assigned to',
      tag: 'Dashboards',
      permission: MANAGE,
      response: collectionSchema(dashboardViewSchema),
    },

    /**
     * Lists every dashboard in the house.
     *
     * @param route - Who is asking.
     * @returns The dashboards, oldest first.
     */
    async (route): Promise<{ items: DashboardView[] }> => {
      requirePermission(route.identity, MANAGE);

      return { items: await listAllDashboards(context.db) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/dashboards/assignees',
      summary: 'List the people a dashboard can be assigned to',
      tag: 'Dashboards',
      permission: MANAGE,
      response: collectionSchema(dashboardAssigneeSchema),
    },

    /**
     * Lists every active account, named, for the assignment picker.
     *
     * Served here rather than asking for `user:read`: deciding who sees a page needs to know who
     * lives in the house, not their email addresses and sign-in history.
     *
     * @param route - Who is asking.
     * @returns The people.
     */
    async (route): Promise<{ items: DashboardAssignee[] }> => {
      requirePermission(route.identity, MANAGE);

      return { items: await listAssignees(context.db) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/dashboards',
      summary: 'Create a dashboard',
      tag: 'Dashboards',
      permission: MANAGE,
      body: dashboardCreateSchema,
      response: dashboardViewSchema,
    },

    /**
     * Creates a dashboard.
     *
     * @param route - The body and who is asking.
     * @returns The dashboard as it now stands.
     */
    async (route): Promise<DashboardView> => {
      requirePermission(route.identity, MANAGE);

      const dashboard = await createDashboard(context.db, route.identity.userId, route.body);

      await context.audit.record({
        action: 'dashboard.create',
        resourceType: 'dashboard',
        resourceId: dashboard.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { name: dashboard.name, userIds: dashboard.userIds },
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
      permission: MANAGE,
      body: dashboardDocumentSchema,
      response: dashboardViewSchema,
    },

    /**
     * Makes a new dashboard from a dashboard file, assigned to nobody yet.
     *
     * Always a new one: a file carries no id, so it can never overwrite a dashboard.
     *
     * @param route - The file's content and who is asking.
     * @returns The dashboard as it now stands.
     */
    async (route): Promise<DashboardView> => {
      requirePermission(route.identity, MANAGE);

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
      summary: 'Read a dashboard assigned to you',
      tag: 'Dashboards',
      permission: null,
      params: dashboardParamsSchema,
      response: dashboardViewSchema,
    },

    /**
     * Reads one dashboard: one assigned to the caller, or any for someone who manages them.
     *
     * @param route - The id and who is asking.
     * @returns The dashboard.
     */
    async (route): Promise<DashboardView> =>
      readVisibleDashboard(
        context.db,
        route.params.dashboardId,
        route.identity.userId,
        isPermitted(route.identity.permissions, MANAGE),
      ),
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/dashboards/:dashboardId/export',
      summary: 'Export a dashboard as a file',
      tag: 'Dashboards',
      permission: MANAGE,
      params: dashboardParamsSchema,
      response: dashboardDocumentSchema,
    },

    /**
     * Writes a dashboard out in the file standard, named for saving.
     *
     * @param route - The id, who is asking, and the reply the file name goes on.
     * @returns What the file holds.
     */
    async (route): Promise<DashboardDocument> => {
      requirePermission(route.identity, MANAGE);

      const dashboard = await readDashboard(context.db, route.params.dashboardId);

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
      summary: 'Change a dashboard, its layout or who it is assigned to',
      tag: 'Dashboards',
      permission: MANAGE,
      params: dashboardParamsSchema,
      body: dashboardUpdateSchema,
      response: dashboardViewSchema,
    },

    /**
     * Changes a dashboard. A layout replaces the stored one whole, and so does an assignment.
     *
     * @param route - The body, the id and who is asking.
     * @returns The dashboard as it now stands.
     */
    async (route): Promise<DashboardView> => {
      requirePermission(route.identity, MANAGE);

      const dashboard = await updateDashboard(context.db, route.params.dashboardId, route.body);

      await context.audit.record({
        action: 'dashboard.update',
        resourceType: 'dashboard',
        resourceId: dashboard.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: {
          changed: Object.keys(route.body),
          ...(route.body.userIds === undefined ? {} : { userIds: dashboard.userIds }),
        },
      });

      return dashboard;
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/dashboards/:dashboardId',
      summary: 'Delete a dashboard',
      tag: 'Dashboards',
      permission: MANAGE,
      params: dashboardParamsSchema,
      response: dashboardViewSchema,
    },

    /**
     * Deletes a dashboard, for everyone it was assigned to.
     *
     * @param route - The id and who is asking.
     * @returns The dashboard as it was.
     */
    async (route): Promise<DashboardView> => {
      requirePermission(route.identity, MANAGE);

      const dashboard = await deleteDashboard(context.db, route.params.dashboardId);

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
