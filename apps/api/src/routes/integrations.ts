/**
 * Integrations: the vendors, what each was given, and the devices added under them.
 *
 * Seven routes around two forms. The vendors list says what each vendor and each of its drivers
 * asks; a vendor's settings are saved once for every device of theirs; the probe says whether
 * what was typed for a device works; create and change write it and ask the hub to match it;
 * the list shows where each instance ended up. Everything but the instance list needs the hub,
 * because the hub holds the bundles and the bundles hold the shape of what is being written -
 * and while the bus is away those routes say so rather than storing what nothing could check.
 */
import { z } from 'zod';

import {
  integrationCreateSchema,
  integrationProbeReplySchema,
  integrationProbeRequestSchema,
  integrationUpdateSchema,
  integrationVendorConfigUpdateSchema,
  integrationVendorViewSchema,
  integrationViewSchema,
  type IntegrationProbeReply,
  type IntegrationVendorView,
  type IntegrationView,
} from '@nebula-home/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import {
  createIntegration,
  listIntegrations,
  listVendors,
  probeIntegration,
  readVendor,
  updateIntegration,
  updateVendorConfig,
  type IntegrationsContext,
} from '../services/integrations.js';

/** Which integration a request is about. */
const integrationParamsSchema = z.object({ integrationId: z.string().min(1).max(128) });

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

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/integrations',
      summary: 'List configured integrations',
      tag: 'Integrations',
      permission: 'integration:read',
      response: z.object({ items: z.array(integrationViewSchema) }),
    },

    /**
     * Lists every configured integration and where it stands.
     *
     * @param route - Who is asking.
     * @returns The integrations.
     */
    async (route): Promise<{ items: IntegrationView[] }> => {
      requirePermission(route.identity, 'integration:read');

      return { items: await listIntegrations(forRequest(context, route.request.traceId)) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/integrations',
      summary: 'Add an integration',
      tag: 'Integrations',
      permission: 'integration:configure',
      body: integrationCreateSchema,
      response: integrationViewSchema,
    },

    /**
     * Creates an instance and asks the hub to start it.
     *
     * @param route - The body and who is asking.
     * @returns The integration as it now stands.
     */
    async (route): Promise<IntegrationView> => {
      requirePermission(route.identity, 'integration:configure');

      const integration = await createIntegration(
        forRequest(context, route.request.traceId),
        route.body,
      );

      // The field names, not the values: a transport configuration carries credentials, and an
      // audit detail reaches the log stream as well as the table.
      await context.audit.record({
        action: 'integration.create',
        resourceType: 'integration',
        resourceId: integration.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: {
          kind: integration.kind,
          fields: Object.keys(route.body.transportConfig),
          options: Object.keys(route.body.options),
        },
      });

      return integration;
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/integrations/probe',
      summary: 'Try an integration configuration without saving it',
      tag: 'Integrations',
      permission: 'integration:configure',
      body: integrationProbeRequestSchema,
      response: integrationProbeReplySchema,
      successStatus: 200,
    },

    /**
     * Tries a configuration and reports the verdict.
     *
     * A configuration that does not work is a `200` with `isReachable: false`: the owner pressed
     * the button to learn exactly that, and it is not an error in the request.
     *
     * @param route - The body and who is asking.
     * @returns The verdict and the hub's sentence about it.
     */
    async (route): Promise<IntegrationProbeReply> => {
      requirePermission(route.identity, 'integration:configure');

      return probeIntegration(forRequest(context, route.request.traceId), route.body);
    },
  );

  defineRoute(
    environment,
    {
      method: 'PATCH',
      url: '/integrations/:integrationId',
      summary: 'Configure an integration',
      tag: 'Integrations',
      permission: 'integration:configure',
      params: integrationParamsSchema,
      body: integrationUpdateSchema,
      response: integrationViewSchema,
    },

    /**
     * Changes an instance's configuration and asks the hub to match it.
     *
     * @param route - The body, the id and who is asking.
     * @returns The integration as it now stands.
     */
    async (route): Promise<IntegrationView> => {
      requirePermission(route.identity, 'integration:configure');

      const integration = await updateIntegration(
        forRequest(context, route.request.traceId),
        route.params.integrationId,
        route.body,
      );

      await context.audit.record({
        action: 'integration.configure',
        resourceType: 'integration',
        resourceId: integration.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { changed: Object.keys(route.body) },
      });

      return integration;
    },
  );
}
