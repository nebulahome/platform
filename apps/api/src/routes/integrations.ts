/**
 * Integrations: the vendors the hub offers, what each was given, and installing them.
 *
 * Three routes around one form. The vendors list says what each vendor and each of its drivers
 * asks, and how many devices have been added under it; a vendor's settings are saved once for
 * every device of theirs. Devices themselves - added, named, configured - are `/devices`. Both
 * routes need the hub, because the hub holds the bundles - and while the bus is away they say so
 * rather than storing what nothing could check.
 *
 * Beside them, the store: the Community Hub's integrations searched (`integration:read`, as the
 * packages' catalogue is `package:read`), and a vendor's bundle installed, updated or removed
 * (`integration:install`). Removing takes everything that came in through the vendor with it -
 * its devices, its accounts, its settings - and each install and removal is audited.
 */
import { z } from 'zod';

import {
  accountSignOutReplySchema,
  accountStepSchema,
  hubDetailSchema,
  integrationCatalogueQuerySchema,
  integrationInstallBodySchema,
  integrationInstallReplySchema,
  integrationRemovedSchema,
  integrationSearchReplySchema,
  integrationVendorConfigUpdateSchema,
  integrationVendorViewSchema,
  isNebulaError,
  VENDOR_ID_PATTERN,
  type AccountStep,
  type HubDetail,
  type IntegrationInstallReply,
  type IntegrationRemoved,
  type IntegrationSearchReply,
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
import type { DevicesContext } from '../services/devices.js';
import {
  installIntegration,
  readHubDetail,
  removeIntegration,
  searchIntegrations,
} from '../services/integration-install.js';
import {
  listVendors,
  readVendor,
  updateVendorConfig,
  type IntegrationsContext,
} from '../services/integrations.js';

/** Which vendor a request is about. */
const vendorParamsSchema = z.object({ vendorId: z.string().min(1).max(64) });

/** Which integration of the Hub a request is about: a vendor's id, as the Hub's paths take it. */
const catalogueParamsSchema = z.object({ vendorId: z.string().regex(VENDOR_ID_PATTERN) });

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
 * What removing an integration needs, for one request: the device paths', since its devices go.
 *
 * @param context - The service's collaborators.
 * @param traceId - The request's trace id.
 * @returns The request-scoped view of them.
 */
function forRemoval(context: ApiContext, traceId: string): DevicesContext {
  return { ...forRequest(context, traceId), icons: context.icons };
}

/**
 * Records an install or a removal in the audit log, refused or not.
 *
 * @param context - The service's collaborators.
 * @param route - Who asked, and from where.
 * @param route.identity - Who.
 * @param route.request - The request.
 * @param route.request.ip - From where.
 * @param route.request.traceId - Its trace.
 * @param action - What: `install`, `remove`.
 * @param vendorId - Which vendor.
 * @param work - The action.
 * @param detailsOf - What of its result the entry keeps.
 * @returns What the action gave.
 */
async function audited<TResult>(
  context: ApiContext,
  route: {
    readonly identity: Parameters<ApiContext['audit']['record']>[0]['identity'];
    readonly request: { readonly ip: string; readonly traceId: string };
  },
  action: 'install' | 'remove',
  vendorId: string,
  work: () => Promise<TResult>,
  detailsOf: (result: TResult) => Record<string, unknown>,
): Promise<TResult> {
  /**
   * Writes the entry.
   *
   * @param result - How it went.
   * @param details - What it did.
   */
  const record = async (
    result: 'success' | 'failure' | 'denied',
    details?: Record<string, unknown>,
  ): Promise<void> => {
    await context.audit.record({
      action: `integration.${action}`,
      resourceType: 'integration',
      resourceId: vendorId,
      result,
      identity: route.identity,
      ipAddress: route.request.ip,
      traceId: route.request.traceId,
      ...(details === undefined ? {} : { details }),
    });
  };

  try {
    const result = await work();

    await record('success', detailsOf(result));

    return result;
  } catch (error: unknown) {
    await record(isNebulaError(error) && error.code === 'CONFLICT' ? 'denied' : 'failure');

    throw error;
  }
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
      method: 'GET',
      url: '/integrations/catalogue',
      summary: 'Search the Community Hub, each integration with what installing it here would take',
      tag: 'Integrations',
      permission: 'integration:read',
      query: integrationCatalogueQuerySchema,
      response: integrationSearchReplySchema,
    },

    /**
     * Searches the Hub's integrations, and the local integrations folder's.
     *
     * @param route - Who is asking, and what for.
     * @returns What was found, and why the Hub could not be asked, when it could not.
     */
    async (route): Promise<IntegrationSearchReply> => {
      requirePermission(route.identity, 'integration:read');

      return searchIntegrations(forRequest(context, route.request.traceId), {
        ...(route.query.q === undefined ? {} : { q: route.query.q }),
        ...(route.query.cursor === undefined ? {} : { cursor: route.query.cursor }),
      });
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/integrations/catalogue/:vendorId',
      summary: 'What the Community Hub says of one integration beyond its search row',
      tag: 'Integrations',
      permission: 'integration:read',
      params: catalogueParamsSchema,
      response: hubDetailSchema,
    },

    /**
     * Reads what the Hub says of one integration.
     *
     * @param route - Who is asking, and which integration.
     * @returns Whose it is, what it works with, what its drivers speak.
     */
    async (route): Promise<HubDetail> => {
      requirePermission(route.identity, 'integration:read');

      return readHubDetail(
        forRequest(context, route.request.traceId),
        'integration',
        route.params.vendorId,
      );
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/integrations/vendors/:vendorId/install',
      summary: "Install, update or reinstall an integration's bundle",
      tag: 'Integrations',
      permission: 'integration:install',
      successStatus: 200,
      params: catalogueParamsSchema,
      body: integrationInstallBodySchema,
      response: integrationInstallReplySchema,
    },

    /**
     * Installs a vendor's bundle and has the hub load it.
     *
     * @param route - Who is asking, which vendor, which release.
     * @returns What was done, and the build the hub runs.
     */
    async (route): Promise<IntegrationInstallReply> => {
      requirePermission(route.identity, 'integration:install');

      return audited(
        context,
        route,
        'install',
        route.params.vendorId,
        async () =>
          installIntegration(
            forRequest(context, route.request.traceId),
            route.params.vendorId,
            route.body.version,
            route.identity.userId,
          ),
        (reply) => ({
          action: reply.action,
          version: reply.install.version,
          source: reply.install.source,
        }),
      );
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/integrations/vendors/:vendorId',
      summary: 'Remove an integration: its devices, accounts and settings, then its bundle',
      tag: 'Integrations',
      permission: 'integration:install',
      successStatus: 200,
      params: catalogueParamsSchema,
      response: integrationRemovedSchema,
    },

    /**
     * Removes an integration the platform installed, and everything that came in through it.
     *
     * @param route - Who is asking, and which vendor.
     * @returns How many devices and accounts went with it.
     */
    async (route): Promise<IntegrationRemoved> => {
      requirePermission(route.identity, 'integration:install');

      return audited(
        context,
        route,
        'remove',
        route.params.vendorId,
        async () =>
          removeIntegration(forRemoval(context, route.request.traceId), route.params.vendorId),
        (removed) => ({ devices: removed.devices, accounts: removed.accounts }),
      );
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
