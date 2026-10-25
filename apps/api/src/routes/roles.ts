/**
 * Roles: what each role grants, and the custom roles the owner makes.
 *
 * Reading needs `user:read`, because the people pages show it; making, changing and deleting
 * need `role:manage`. The rules - built-in roles are read-only, nobody grants what they do not
 * hold, a role with people needs somewhere to send them - live in the service.
 */
import { z } from 'zod';

import {
  roleCreateSchema,
  roleDeleteQuerySchema,
  roleUpdateSchema,
  roleViewSchema,
  type RoleView,
} from '@nebulahome/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { collectionSchema } from '../http/collection.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import { createRole, deleteRole, listRoles, updateRole } from '../services/roles.js';

/** Which role a request is about. */
const roleParamsSchema = z.object({ roleId: z.uuid() });

/**
 * Registers the role routes.
 *
 * @param environment - Where routes are defined.
 * @param context - The service's collaborators.
 */
export function registerRoleRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/roles',
      summary: 'List roles and what they grant',
      tag: 'People',
      permission: 'user:read',
      response: collectionSchema(roleViewSchema),
    },

    /**
     * Lists roles.
     *
     * @param route - Who is asking.
     * @returns Every role, its grants and how many people hold it.
     */
    async (route): Promise<{ items: RoleView[] }> => {
      requirePermission(route.identity, 'user:read');

      return { items: await listRoles(context.db) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/roles',
      summary: 'Create a custom role',
      tag: 'People',
      permission: 'role:manage',
      body: roleCreateSchema,
      response: roleViewSchema,
    },

    /**
     * Creates a custom role, perhaps from another one's permissions.
     *
     * @param route - The body and who is asking.
     * @returns The role.
     */
    async (route): Promise<RoleView> => {
      requirePermission(route.identity, 'role:manage');

      const role = await createRole(context.db, context.icons, route.identity, route.body);

      await context.audit.record({
        action: 'role.create',
        resourceType: 'role',
        resourceId: role.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { key: role.key, name: role.name, from: route.body.from ?? null },
      });

      return role;
    },
  );

  defineRoute(
    environment,
    {
      method: 'PATCH',
      url: '/roles/:roleId',
      summary: 'Change a custom role',
      tag: 'People',
      permission: 'role:manage',
      params: roleParamsSchema,
      body: roleUpdateSchema,
      response: roleViewSchema,
    },

    /**
     * Changes a custom role's details or permissions.
     *
     * @param route - The body, the id and who is asking.
     * @returns The role as it now stands.
     */
    async (route): Promise<RoleView> => {
      requirePermission(route.identity, 'role:manage');

      const role = await updateRole(
        context.db,
        context.icons,
        route.identity,
        route.params.roleId,
        route.body,
      );

      await context.audit.record({
        action: 'role.update',
        resourceType: 'role',
        resourceId: role.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: {
          changed: Object.keys(route.body),
          ...(route.body.permissions === undefined ? {} : { permissions: route.body.permissions }),
        },
      });

      return role;
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/roles/:roleId',
      summary: 'Delete a custom role, moving its people to another',
      tag: 'People',
      permission: 'role:manage',
      params: roleParamsSchema,
      query: roleDeleteQuerySchema,
      successStatus: 204,
    },

    /**
     * Deletes a custom role.
     *
     * @param route - The id, where its people go and who is asking.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'role:manage');

      const role = await deleteRole(context.db, route.params.roleId, route.query.moveTo);

      await context.audit.record({
        action: 'role.delete',
        resourceType: 'role',
        resourceId: role.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { key: role.key, movedTo: route.query.moveTo ?? null, people: role.userCount },
      });
    },
  );
}
