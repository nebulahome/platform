/**
 * Integrations: the vendors the hub offers, and what each was given.
 *
 * Three routes around one form. The vendors list says what each vendor and each of its drivers
 * asks, and how many devices have been added under it; a vendor's settings are saved once for
 * every device of theirs. Devices themselves - added, named, configured - are `/devices`. Both
 * routes need the hub, because the hub holds the bundles - and while the bus is away they say so
 * rather than storing what nothing could check.
 */
import { z } from 'zod';

import {
  integrationVendorConfigUpdateSchema,
  integrationVendorViewSchema,
  type IntegrationVendorView,
} from '@nebula-home/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import {
  listVendors,
  readVendor,
  updateVendorConfig,
  type IntegrationsContext,
} from '../services/integrations.js';

/** Which vendor a request is about. */
const vendorParamsSchema = z.object({ vendorId: z.string().min(1).max(64) });

/**
 * What the write paths need, for one request.
 *
 * @param context - The service's collaborators.
 * @param traceId - The request's trace id.
 * @returns The request-scoped view of them.
 */
function forRequest(context: ApiContext, traceId: string): IntegrationsContext {
  return {
    db: context.db,
    bus: context.bus,
    secretsKey: context.secretsKey,
    logger: context.logger,
    timeoutMs: context.config.API_BUS_TIMEOUT_MS,
    traceId,
  };
}

/**
 * Registers the integration routes.
 *
 * @param environment - Where routes are defined.
 * @param context - The service's collaborators.
 */
export function registerIntegrationRoutes(
  environment: RouteEnvironment,
  context: ApiContext,
): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/integrations/vendors',
      summary: 'List the vendors the hub has loaded, with their drivers and settings',
      tag: 'Integrations',
      permission: 'integration:read',
      response: z.object({ items: z.array(integrationVendorViewSchema) }),
    },

    /**
     * Lists every vendor, with its drivers, what each asks, and what the owner has done about it.
     *
     * @param route - Who is asking.
     * @returns The vendors.
     */
    async (route): Promise<{ items: IntegrationVendorView[] }> => {
      requirePermission(route.identity, 'integration:read');

      return { items: await listVendors(forRequest(context, route.request.traceId)) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/integrations/vendors/:vendorId',
      summary: 'Read one vendor',
      tag: 'Integrations',
      permission: 'integration:read',
      params: vendorParamsSchema,
      response: integrationVendorViewSchema,
    },

    /**
     * Reads one vendor.
     *
     * @param route - The id and who is asking.
     * @returns The vendor.
     */
    async (route): Promise<IntegrationVendorView> => {
      requirePermission(route.identity, 'integration:read');

      return readVendor(forRequest(context, route.request.traceId), route.params.vendorId);
    },
  );

  defineRoute(
    environment,
    {
      method: 'PATCH',
      url: '/integrations/vendors/:vendorId/config',
      summary: "Save a vendor's settings",
      tag: 'Integrations',
      permission: 'integration:configure',
      params: vendorParamsSchema,
      body: integrationVendorConfigUpdateSchema,
      response: integrationVendorViewSchema,
    },

    /**
     * Saves what every device of a vendor shares, and has its instances start again with it.
     *
     * @param route - The body, the id and who is asking.
     * @returns The vendor as it now stands.
     */
    async (route): Promise<IntegrationVendorView> => {
      requirePermission(route.identity, 'integration:configure');

      const vendor = await updateVendorConfig(
        forRequest(context, route.request.traceId),
        route.params.vendorId,
        route.body,
      );

      await context.audit.record({
        action: 'integration.configure',
        resourceType: 'integration',
        resourceId: vendor.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { vendor: vendor.id, changed: Object.keys(route.body) },
      });

      return vendor;
    },
  );
}
