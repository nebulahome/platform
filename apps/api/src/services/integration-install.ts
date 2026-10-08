/**
 * Installing integrations: the Community Hub searched for them, a vendor's bundle installed,
 * updated or reinstalled, and an integration removed with everything that came in through it.
 *
 * The packet-manager is the store: it searches the Hub, downloads and checks the release, and has
 * `hub` load the build. This service relays what it answers, and does what only `api` can before
 * a bundle goes: an integration is removed whole - its devices, the accounts signed in to, its
 * settings - and only then its bundle, so nothing is left in the registry that names a vendor no
 * longer there. A derived entity that reads one of its devices stops the removal before anything
 * is taken, as it stops removing that one device.
 */
import { asc, eq, inArray, like } from 'drizzle-orm';

import type { BusClient } from '@nebulahome/bus';
import {
  busSubjects,
  ConflictError,
  hubDetailSchema,
  integrationInstallReplySchema,
  integrationRemoveReplySchema,
  integrationSearchReplySchema,
  PACKET_MANAGER_METHODS,
  PACKET_MANAGER_SERVICE,
  type HubDetail,
  type HubItemKind,
  type IntegrationInstallReply,
  type IntegrationRemoved,
  type IntegrationSearchReply,
  type IntegrationSearchRequest,
} from '@nebulahome/contracts';
import { schema } from '@nebulahome/db';

import { listAccountViews, signOutAccount } from './accounts.js';
import { deleteDevice, type DevicesContext } from './devices.js';
import { busOf, catalogueIfUp, type IntegrationsContext } from './integrations.js';

/** How long a search may take: the packet-manager asks the Hub, and maybe reads the index again. */
const SEARCH_TIMEOUT_MS = 30_000;

/** How long the Hub has to say more of one item. */
const DETAIL_TIMEOUT_MS = 20_000;

/** How long an install may take: a download, then `hub` loading the build. */
const INSTALL_TIMEOUT_MS = 900_000;

/** How long removing the bundle may take: `hub` lets go of the vendor. */
const REMOVE_TIMEOUT_MS = 90_000;

/**
 * Asks the packet-manager.
 *
 * @param context - The request's collaborators.
 * @param method - The method.
 * @param payload - What it is asked.
 * @param reply - The reply's schema.
 * @param timeoutMs - How long it may take.
 * @returns Its reply.
 */
async function ask<TReply>(
  context: IntegrationsContext,
  method: (typeof PACKET_MANAGER_METHODS)[keyof typeof PACKET_MANAGER_METHODS],
  payload: unknown,
  reply: Parameters<BusClient['request']>[2] & { parse: (value: unknown) => TReply },
  timeoutMs: number,
): Promise<TReply> {
  return busOf(context).request(
    busSubjects.service(PACKET_MANAGER_SERVICE, method),
    payload,
    reply,
    { traceId: context.traceId, timeoutMs },
  ) as Promise<TReply>;
}

/**
 * Searches the Hub's integrations, and the local integrations folder's.
 *
 * @param context - The request's collaborators.
 * @param request - What to look for, and from which page on.
 * @returns What was found, and why the Hub could not be asked, when it could not.
 */
export async function searchIntegrations(
  context: IntegrationsContext,
  request: IntegrationSearchRequest,
): Promise<IntegrationSearchReply> {
  return ask(
    context,
    PACKET_MANAGER_METHODS.integrationSearch,
    request,
    integrationSearchReplySchema,
    SEARCH_TIMEOUT_MS,
  );
}

/**
 * What the Hub says of one package or integration beyond its search row.
 *
 * @param context - The request's collaborators.
 * @param kind - Which the Hub lists.
 * @param id - The item.
 * @returns What it says.
 * @throws {NotFoundError} When the Hub does not list it.
 */
export async function readHubDetail(
  context: IntegrationsContext,
  kind: HubItemKind,
  id: string,
): Promise<HubDetail> {
  return ask(
    context,
    PACKET_MANAGER_METHODS.hubDetail,
    { kind, id },
    hubDetailSchema,
    DETAIL_TIMEOUT_MS,
  );
}

/**
 * Installs, updates or reinstalls an integration's bundle.
 *
 * @param context - The request's collaborators.
 * @param vendorId - The vendor.
 * @param version - A release; the newest that fits when not said.
 * @param requestedBy - Who asked.
 * @returns What was done, and the build `hub` runs.
 * @throws {ConflictError} When no release fits, or the build did not load.
 */
export async function installIntegration(
  context: IntegrationsContext,
  vendorId: string,
  version: string | undefined,
  requestedBy: string | undefined,
): Promise<IntegrationInstallReply> {
  return ask(
    context,
    PACKET_MANAGER_METHODS.integrationInstall,
    {
      vendorId,
      ...(version === undefined ? {} : { version }),
      ...(requestedBy === undefined ? {} : { requestedBy }),
    },
    integrationInstallReplySchema,
    INSTALL_TIMEOUT_MS,
  );
}

/**
 * Removes an integration the platform installed, and everything that came in through it: its
 * devices, the accounts signed in to, its settings - then its bundle.
 *
 * @param context - The request's collaborators.
 * @param vendorId - The vendor.
 * @returns How many devices and accounts went with it.
 * @throws {ConflictError} For a vendor under development, which the platform did not install,
 *   and while a derived entity reads one of its devices; nothing is removed then.
 * @throws {NotFoundError} When the platform did not install it.
 */
export async function removeIntegration(
  context: DevicesContext,
  vendorId: string,
): Promise<IntegrationRemoved> {
  const vendor = (await catalogueIfUp(context)).find((each) => each.id === vendorId);

  if (vendor?.origin === 'development') {
    throw new ConflictError(
      `${vendor.name} is a copy under development, not installed: it cannot be removed`,
      { details: { vendorId, reason: 'built-in' } },
    );
  }

  const devices = await context.db
    .select({ id: schema.registry.integrations.id })
    .from(schema.registry.integrations)
    .where(like(schema.registry.integrations.kind, `${vendorId}/%`));
  const deviceIds = devices.map((device) => device.id);

  await assertNotReadByAliases(context, vendorId, deviceIds);

  for (const id of deviceIds) {
    // One after another: each asks `hub` and `core`, and a failure stops the rest.
    // eslint-disable-next-line no-await-in-loop -- see above
    await deleteDevice(context, id);
  }

  const accounts = await listAccountViews(context.db, vendorId);

  for (const account of accounts) {
    try {
      // eslint-disable-next-line no-await-in-loop -- one session at a time, best effort
      await signOutAccount(context, vendorId, account.id);
    } catch (error: unknown) {
      context.logger.warn(
        { err: error, vendorId, accountId: account.id },
        'An account was not signed out at its cloud; its row is deleted anyway',
      );
    }
  }

  await context.db
    .delete(schema.registry.integrationAccounts)
    .where(eq(schema.registry.integrationAccounts.vendorId, vendorId));
  await context.db
    .delete(schema.registry.integrationVendors)
    .where(eq(schema.registry.integrationVendors.id, vendorId));

  const removed = await ask(
    context,
    PACKET_MANAGER_METHODS.integrationRemove,
    { vendorId },
    integrationRemoveReplySchema,
    REMOVE_TIMEOUT_MS,
  );

  return {
    devices: deviceIds.length,
    accounts: accounts.length,
    isRestartNeeded: removed.isRestartNeeded,
  };
}

/**
 * Refuses to remove an integration while a derived entity reads one of its devices' entities: the
 * same refusal removing one of those devices gives, made before anything is taken.
 *
 * @param context - The request's collaborators.
 * @param vendorId - The vendor.
 * @param deviceIds - Its devices.
 * @throws {ConflictError} Naming the entities an alias still reads.
 */
async function assertNotReadByAliases(
  context: DevicesContext,
  vendorId: string,
  deviceIds: readonly string[],
): Promise<void> {
  if (deviceIds.length === 0) {
    return;
  }

  const read = await context.db
    .selectDistinct({ entityId: schema.registry.entities.entityId })
    .from(schema.registry.aliasSources)
    .innerJoin(
      schema.registry.entities,
      eq(schema.registry.entities.id, schema.registry.aliasSources.entityId),
    )
    .where(inArray(schema.registry.entities.integrationId, [...deviceIds]))
    .orderBy(asc(schema.registry.entities.entityId));

  if (read.length > 0) {
    throw new ConflictError("Derived entities still read this integration's devices", {
      details: { vendorId, entityIds: read.map((row) => row.entityId) },
    });
  }
}
