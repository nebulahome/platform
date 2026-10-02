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
  accountSignOutReplySchema,
  accountStepSchema,
  integrationVendorConfigUpdateSchema,
  integrationVendorViewSchema,
  type AccountStep,
  type IntegrationVendorView,
} from '@nebulahome/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import {
  accountAnswerBodySchema,
  accountBeginBodySchema,
  answerSignIn,
  beginSignIn,
  pollSignIn,
  signOutAccount,
} from '../services/accounts.js';
import {
  listVendors,
  readVendor,
  updateVendorConfig,
  type IntegrationsContext,
} from '../services/integrations.js';

/** Which vendor a request is about. */
const vendorParamsSchema = z.object({ vendorId: z.string().min(1).max(64) });

/** Which sign-in of which vendor a request is about. */
const flowParamsSchema = vendorParamsSchema.extend({ flowId: z.uuid() });

/** Which account of which vendor a request is about. */
const accountParamsSchema = vendorParamsSchema.extend({
  accountId: z.string().min(1).max(128),
});

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

  /**
   * Records a sign-in that ended connected in the audit log.
   *
   * @param route - The request.
   * @param route.identity - Who signed in.
   * @param route.request - Where from, and its trace.
   * @param route.request.ip - The address.
   * @param route.request.traceId - The trace.
   * @param vendorId - Which vendor.
   * @param step - What the hub answered.
   * @returns Once it is recorded, when there was anything to record.
   */
  const auditConnected = async (
    route: {
      readonly identity: Parameters<typeof requirePermission>[0];
      readonly request: { readonly ip: string; readonly traceId: string };
    },
    vendorId: string,
    step: AccountStep,
  ): Promise<void> => {
    if (step.kind !== 'connected') {
      return;
    }

    await context.audit.record({
      action: 'integration.account.sign_in',
      resourceType: 'integration',
      resourceId: vendorId,
      result: 'success',
      identity: route.identity,
      ipAddress: route.request.ip,
      traceId: route.request.traceId,
      details: { vendor: vendorId, account: step.account.id },
    });
  };

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/integrations/vendors/:vendorId/accounts',
      summary: "Start signing in to a vendor's account",
      tag: 'Integrations',
      permission: 'integration:configure',
      params: vendorParamsSchema,
      body: accountBeginBodySchema,
      response: accountStepSchema,
      successStatus: 200,
    },

    /**
     * Signs in with what the owner typed.
     *
     * @param route - The values, the vendor and who is asking.
     * @returns The first step: connected, a question, a page to approve on, or why it failed.
     */
    async (route): Promise<AccountStep> => {
      requirePermission(route.identity, 'integration:configure');

      const step = await beginSignIn(
        forRequest(context, route.request.traceId),
        route.params.vendorId,
        route.body.values,
      );

      await auditConnected(route, route.params.vendorId, step);

      return step;
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/integrations/vendors/:vendorId/accounts/flows/:flowId',
      summary: 'Answer what a sign-in asked',
      tag: 'Integrations',
      permission: 'integration:configure',
      params: flowParamsSchema,
      body: accountAnswerBodySchema,
      response: accountStepSchema,
      successStatus: 200,
    },

    /**
     * Carries a sign-in on with the answers to its question.
     *
     * @param route - The answers, the flow and who is asking.
     * @returns The next step.
     */
    async (route): Promise<AccountStep> => {
      requirePermission(route.identity, 'integration:configure');

      const step = await answerSignIn(
        forRequest(context, route.request.traceId),
        route.params.flowId,
        route.body.answers,
      );

      await auditConnected(route, route.params.vendorId, step);

      return step;
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/integrations/vendors/:vendorId/accounts/flows/:flowId/poll',
      summary: 'Ask whether a sign-in was approved',
      tag: 'Integrations',
      permission: 'integration:configure',
      params: flowParamsSchema,
      response: accountStepSchema,
      successStatus: 200,
    },

    /**
     * Asks whether the page a sign-in sent the owner to was approved.
     *
     * @param route - The flow and who is asking.
     * @returns The next step: the same page again while it was not.
     */
    async (route): Promise<AccountStep> => {
      requirePermission(route.identity, 'integration:configure');

      const step = await pollSignIn(
        forRequest(context, route.request.traceId),
        route.params.flowId,
      );

      await auditConnected(route, route.params.vendorId, step);

      return step;
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/integrations/vendors/:vendorId/accounts/:accountId',
      summary: "Sign out of a vendor's account",
      tag: 'Integrations',
      permission: 'integration:configure',
      params: accountParamsSchema,
      response: accountSignOutReplySchema,
    },

    /**
     * Forgets an account; its devices stay until they are removed.
     *
     * @param route - The account and who is asking.
     * @returns Whether it was there.
     */
    async (route): Promise<{ wasSignedIn: boolean }> => {
      requirePermission(route.identity, 'integration:configure');

      const wasSignedIn = await signOutAccount(
        forRequest(context, route.request.traceId),
        route.params.vendorId,
        route.params.accountId,
      );

      await context.audit.record({
        action: 'integration.account.sign_out',
        resourceType: 'integration',
        resourceId: route.params.vendorId,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { vendor: route.params.vendorId, account: route.params.accountId },
      });

      return { wasSignedIn };
    },
  );
}
