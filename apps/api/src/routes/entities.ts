/**
 * Reading entities and commanding them.
 *
 * The command endpoint is the only place in the API where a request reaches a physical device,
 * and it is the reason `Idempotency-Key` exists: RULES.md 14 puts it plainly, pressing a button
 * twice must not open a garage door twice.
 */
import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  DeviceUnavailableError,
  IDEMPOTENCY_KEY_HEADER,
  NotFoundError,
  ValidationError,
  capabilityNameSchema,
  entityCommandRequestSchema,
  entityCommandResponseSchema,
  entityQuerySchema,
  entityUpdateSchema,
  entityViewSchema,
  pageQuerySchema,
  pageSchema,
  parseEntityId,
  type CapabilityName,
  type EntityCommandResponse,
  type EntityView,
  type Page,
} from '@nebulahome/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { IdempotencyStore } from '../http/idempotency.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import { isAuditedCapability, sendCommand } from '../services/commands.js';
import { findEntity, listEntities, updateEntity } from '../services/entities.js';

/** The path parameters of the single-entity routes. */
const entityParamsSchema = z.object({
  /** `<domain>.<object_id>`. */
  entityId: z.string().min(3).max(255),
});

/** The path parameters of the command route. */
const commandParamsSchema = entityParamsSchema.extend({
  /** Which capability the command targets. */
  capability: capabilityNameSchema,
});

/** What a command endpoint answers with. */
const COMMAND_ACCEPTED_STATUS = 202;

/**
 * Digests a command so a repeated idempotency key can be recognised as the same request.
 *
 * @param entityId - The target.
 * @param capability - Which capability.
 * @param command - The command body.
 * @returns A short digest of all three.
 */
function fingerprint(entityId: string, capability: string, command: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify({ entityId, capability, command }))
    .digest('base64url');
}

/**
 * Registers the entity endpoints.
 *
 * @param environment - The server, the registry and the version prefix.
 * @param context - The service context.
 */
export function registerEntityRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/entities',
      summary: 'List entities the caller may see',
      tag: 'Entities',
      permission: 'entity:read',
      query: entityQuerySchema.extend(pageQuerySchema.shape),
      response: pageSchema(entityViewSchema),
    },

    /**
     * Lists entities.
     *
     * The permission is not checked up front with an unscoped `requirePermission`: a member with
     * `entity:read` for one area holds the permission, just not everywhere, and refusing the
     * whole request would be wrong. The filtering happens per row instead, so the answer is the
     * subset they may see.
     *
     * @param route - The parsed query and who is asking.
     * @returns A page of entities.
     */
    async (route): Promise<Page<EntityView>> => {
      const result = await listEntities(context.db, route.identity, route.query, {
        limit: route.query.limit,
        ...(route.query.cursor === undefined ? {} : { cursor: route.query.cursor }),
      });

      return result.nextCursor === undefined
        ? { items: result.items }
        : { items: result.items, nextCursor: result.nextCursor };
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/entities/:entityId',
      summary: 'Read one entity',
      tag: 'Entities',
      permission: 'entity:read',
      params: entityParamsSchema,
      response: entityViewSchema,
    },

    /**
     * Reads one entity.
     *
     * @param route - The path parameters and who is asking.
     * @returns The entity.
     * @throws {NotFoundError} When no entity is registered under that identifier, and also when
     * one is but the caller may not see it. Answering `403` there would confirm the entity
     * exists, which is exactly what a caller without `entity:read` for it must not learn.
     */
    async (route): Promise<EntityView> => {
      const found = await findEntity(context.db, route.params.entityId);

      if (found === undefined) {
        throw new NotFoundError(`No entity ${route.params.entityId}`, {
          details: { entityId: route.params.entityId },
        });
      }

      try {
        requirePermission(route.identity, 'entity:read', found.scopes);
      } catch {
        throw new NotFoundError(`No entity ${route.params.entityId}`, {
          details: { entityId: route.params.entityId },
        });
      }

      return found.view;
    },
  );

  defineRoute(
    environment,
    {
      method: 'PATCH',
      url: '/entities/:entityId',
      summary: 'Rename an entity, change its icon, or change the tags on it',
      tag: 'Entities',
      permission: 'entity:write',
      params: entityParamsSchema,
      body: entityUpdateSchema,
      response: entityViewSchema,
    },

    /**
     * Changes an entity's name, icon or tags.
     *
     * @param route - The body, the path parameters and who is asking.
     * @returns The entity as it now stands.
     * @throws {NotFoundError} When no entity is registered under that identifier, or the caller
     * may not see it - for the reason the read route gives.
     */
    async (route): Promise<EntityView> => {
      const found = await findEntity(context.db, route.params.entityId);

      if (found === undefined) {
        throw new NotFoundError(`No entity ${route.params.entityId}`, {
          details: { entityId: route.params.entityId },
        });
      }

      try {
        requirePermission(route.identity, 'entity:read', found.scopes);
      } catch {
        throw new NotFoundError(`No entity ${route.params.entityId}`, {
          details: { entityId: route.params.entityId },
        });
      }

      requirePermission(route.identity, 'entity:write', found.scopes);

      const view = await updateEntity(context.db, context.icons, found, route.body);

      await context.audit.record({
        action: 'entity.update',
        resourceType: 'entity',
        resourceId: view.entityId,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { changed: Object.keys(route.body) },
      });

      return view;
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/entities/:entityId/capabilities/:capability/commands',
      summary: 'Command one capability of one entity',
      tag: 'Entities',
      permission: 'entity:control',
      params: commandParamsSchema,
      body: entityCommandRequestSchema,
      response: entityCommandResponseSchema,
      successStatus: COMMAND_ACCEPTED_STATUS,
    },

    /**
     * Sends a command and waits for the owning adapter to accept it.
     *
     * `202`, not `200`: the adapter has taken the command, the device has not necessarily done
     * it yet. The resulting state arrives over the WebSocket or on the next read.
     *
     * @param route - The path parameters, the body and who is asking.
     * @returns The acknowledgement.
     * @throws {NotFoundError} When the entity is not registered, or the caller may not see it.
     * @throws {ValidationError} When the entity does not declare the capability being commanded.
     * @throws {DeviceUnavailableError} When the bus is unreachable, or the adapter did not
     * answer in time.
     */
    async (route): Promise<EntityCommandResponse> => {
      const found = await findEntity(context.db, route.params.entityId);

      if (found === undefined) {
        throw new NotFoundError(`No entity ${route.params.entityId}`, {
          details: { entityId: route.params.entityId },
        });
      }

      try {
        requirePermission(route.identity, 'entity:read', found.scopes);
      } catch {
        throw new NotFoundError(`No entity ${route.params.entityId}`, {
          details: { entityId: route.params.entityId },
        });
      }

      requirePermission(route.identity, 'entity:control', found.scopes);

      const capability: CapabilityName = route.params.capability;

      // Checked here as well as in `core` so the caller gets a 400 naming the entity rather than
      // a bus round-trip that fails with less context. `core` remains the authority: it holds the
      // capability's command schema, which this service deliberately does not.
      if (!found.view.capabilities.some((entry) => entry.capability === capability)) {
        throw new ValidationError(
          `Entity ${route.params.entityId} has no ${capability} capability`,
          {
            details: {
              entityId: route.params.entityId,
              capability,
              declared: found.view.capabilities.map((entry) => entry.capability),
            },
          },
        );
      }

      if (context.bus === undefined) {
        throw new DeviceUnavailableError('The message bus is not reachable', {
          details: { entityId: route.params.entityId },
        });
      }

      const header = route.request.headers[IDEMPOTENCY_KEY_HEADER];
      const idempotencyKey = (Array.isArray(header) ? header[0] : header) ?? null;
      const digest = fingerprint(route.params.entityId, capability, route.body.command);
      const storeKey =
        idempotencyKey === null
          ? null
          : IdempotencyStore.keyFor(route.identity.userId, 'entities.command', idempotencyKey);

      if (storeKey !== null) {
        const replayed = context.idempotency.lookup(storeKey, digest);

        if (replayed !== undefined) {
          void route.reply.status(replayed.status);

          return replayed.body as EntityCommandResponse;
        }
      }

      const ack = await sendCommand({
        client: context.bus,
        entityId: parseEntityId(route.params.entityId),
        capability,
        command: route.body.command,
        identity: route.identity,
        traceId: route.request.traceId,
        timeoutMs: context.config.API_BUS_TIMEOUT_MS,
      });

      const body = entityCommandResponseSchema.parse({
        entityId: ack.entityId,
        capability: ack.capability,
        acceptedAt: ack.acceptedAt,
        idempotencyKey,
      });

      if (storeKey !== null) {
        context.idempotency.record(storeKey, digest, COMMAND_ACCEPTED_STATUS, body);
      }

      if (isAuditedCapability(capability)) {
        await context.audit.record({
          action: 'entity.command',
          resourceType: 'entity',
          resourceId: route.params.entityId,
          result: 'success',
          identity: route.identity,
          ipAddress: route.request.ip,
          userAgent: route.request.headers['user-agent'] ?? null,
          traceId: route.request.traceId,
          details: { capability, command: route.body.command },
        });
      }

      void route.reply.status(COMMAND_ACCEPTED_STATUS);

      return body;
    },
  );
}
