/**
 * Every call the library section makes, one function per endpoint.
 *
 * As in `settings/api.ts`, each names the contract schema its answer must satisfy rather than
 * declaring a response type here. A type written in this file could agree with the server today
 * and stop agreeing after a deployment, and nothing would say so.
 *
 * **What is not here is as deliberate as what is.** There is no `runAutomation`, no `applyScene`
 * and nothing that starts or stops a package, because those endpoints do not exist: the engines
 * that would have to act on them are ARCHITECTURE.md 6.1 to 6.3, and package lifecycle belongs
 * to `packet-manager`. A function here that posted to one of them would compile, ship, and fail
 * at the only moment it mattered.
 */
import { z } from 'zod';

import {
  aliasViewSchema,
  automationViewSchema,
  deviceAdoptReplySchema,
  deviceCandidatesReplySchema,
  deviceDiscoverReplySchema,
  deviceViewSchema,
  entityViewSchema,
  integrationProbeReplySchema,
  integrationVendorViewSchema,
  integrationViewSchema,
  packageViewSchema,
  sceneViewSchema,
  type AliasView,
  type AutomationCreate,
  type AutomationUpdate,
  type AutomationView,
  type DeviceAdoptReply,
  type DeviceAdoptRequest,
  type DeviceCandidatesReply,
  type DeviceDiscoverReply,
  type DeviceDiscoverRequest,
  type DeviceView,
  type EntityView,
  type IntegrationCreate,
  type IntegrationProbeReply,
  type IntegrationProbeRequest,
  type IntegrationUpdate,
  type IntegrationVendorConfigUpdate,
  type IntegrationVendorView,
  type IntegrationView,
  type PackageView,
  type SceneView,
  MAX_PAGE_LIMIT,
  pageSchema,
} from '@nebula-home/contracts';

import { apiRequest } from '@/lib/api-client';

/**
 * A collection response.
 *
 * @param item - What one entry looks like.
 * @returns The schema of a whole collection of them.
 */
const collectionSchema = <TItem extends z.ZodType>(
  item: TItem,
): z.ZodObject<{ items: z.ZodArray<TItem> }> => z.object({ items: z.array(item) });

/**
 * Lists every automation, with the document each one stores.
 *
 * @param signal - Cancels the request.
 * @returns Every automation, alphabetically.
 */
export async function fetchAutomations(signal?: AbortSignal): Promise<AutomationView[]> {
  const { items } = await apiRequest('/automations', collectionSchema(automationViewSchema), {
    ...(signal === undefined ? {} : { signal }),
  });

  return items;
}

/**
 * Creates an automation.
 *
 * @param request - What to create.
 * @returns The automation as it now stands.
 */
export async function createAutomation(request: AutomationCreate): Promise<AutomationView> {
  return apiRequest('/automations', automationViewSchema, { method: 'POST', body: request });
}

/**
 * Changes an automation.
 *
 * Turning one on and rewriting it are the same call, because they are the same row.
 *
 * @param automationId - Which one.
 * @param request - The fields to change.
 * @returns The automation as it now stands.
 */
export async function updateAutomation(
  automationId: string,
  request: AutomationUpdate,
): Promise<AutomationView> {
  return apiRequest(`/automations/${automationId}`, automationViewSchema, {
    method: 'PATCH',
    body: request,
  });
}

/**
 * Deletes an automation.
 *
 * @param automationId - Which one.
 * @returns The automation as it was.
 */
export async function deleteAutomation(automationId: string): Promise<AutomationView> {
  return apiRequest(`/automations/${automationId}`, automationViewSchema, { method: 'DELETE' });
}

/**
 * Lists every scene, with the states it sets.
 *
 * @param signal - Cancels the request.
 * @returns Every scene.
 */
export async function fetchScenes(signal?: AbortSignal): Promise<SceneView[]> {
  const { items } = await apiRequest('/scenes', collectionSchema(sceneViewSchema), {
    ...(signal === undefined ? {} : { signal }),
  });

  return items;
}

/**
 * Lists every device, with the entities it owns.
 *
 * @param signal - Cancels the request.
 * @returns Every device.
 */
export async function fetchDevices(signal?: AbortSignal): Promise<DeviceView[]> {
  const { items } = await apiRequest('/devices', collectionSchema(deviceViewSchema), {
    ...(signal === undefined ? {} : { signal }),
  });

  return items;
}

/**
 * Asks the hub to start looking for devices.
 *
 * @param request - Which instance to look with, and for how long.
 * @returns The pass identifier and the instances actually looking.
 */
export async function startDiscovery(request: DeviceDiscoverRequest): Promise<DeviceDiscoverReply> {
  return apiRequest('/devices/discover', deviceDiscoverReplySchema, {
    method: 'POST',
    body: request,
  });
}

/**
 * Reads what the current pass has found so far.
 *
 * @param signal - Cancels the request.
 * @returns The candidates, and whether the pass is still running.
 */
export async function fetchCandidates(signal?: AbortSignal): Promise<DeviceCandidatesReply> {
  return apiRequest('/devices/candidates', deviceCandidatesReplySchema, {
    ...(signal === undefined ? {} : { signal }),
  });
}

/**
 * Adopts a candidate of the current pass.
 *
 * @param request - Which candidate, and what to call it.
 * @returns The device row and the entities written under it.
 */
export async function adoptCandidate(request: DeviceAdoptRequest): Promise<DeviceAdoptReply> {
  return apiRequest('/devices/adopt', deviceAdoptReplySchema, { method: 'POST', body: request });
}

/**
 * Lists every entity the caller may see, with its current state.
 *
 * The endpoint pages; this reads every page, because the callers - the devices table, the
 * entity picker - want the whole registry and the registry of a house fits in memory many times
 * over. What is kept live afterwards is the channel's business, not another request's.
 *
 * @param signal - Cancels the request.
 * @returns Every entity.
 */
export async function fetchEntities(signal?: AbortSignal): Promise<EntityView[]> {
  const items: EntityView[] = [];
  let cursor: string | undefined;

  do {
    const query = new URLSearchParams({ limit: String(MAX_PAGE_LIMIT), includeHidden: 'true' });

    if (cursor !== undefined) {
      query.set('cursor', cursor);
    }

    // Sequential by nature: each page's cursor is only known once the page before it has come.
    // eslint-disable-next-line no-await-in-loop -- see above
    const page = await apiRequest(`/entities?${query.toString()}`, pageSchema(entityViewSchema), {
      ...(signal === undefined ? {} : { signal }),
    });

    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== undefined);

  return items;
}

/**
 * Lists every derived entity, with the entities its formula reads.
 *
 * @param signal - Cancels the request.
 * @returns Every alias.
 */
export async function fetchAliases(signal?: AbortSignal): Promise<AliasView[]> {
  const { items } = await apiRequest('/aliases', collectionSchema(aliasViewSchema), {
    ...(signal === undefined ? {} : { signal }),
  });

  return items;
}

/**
 * Lists every configured integration.
 *
 * @param signal - Cancels the request.
 * @returns Every integration and what it has adopted.
 */
export async function fetchIntegrations(signal?: AbortSignal): Promise<IntegrationView[]> {
  const { items } = await apiRequest('/integrations', collectionSchema(integrationViewSchema), {
    ...(signal === undefined ? {} : { signal }),
  });

  return items;
}

/**
 * Lists the vendors the hub has loaded, with their drivers, what each asks, and what the owner
 * has done about each.
 *
 * @param signal - Cancels the request.
 * @returns Every vendor. Fails with the hub's absence when it is not reachable: the grid cannot
 * be built without it, and saying so is better than an empty page.
 */
export async function fetchVendors(signal?: AbortSignal): Promise<IntegrationVendorView[]> {
  const { items } = await apiRequest(
    '/integrations/vendors',
    collectionSchema(integrationVendorViewSchema),
    { ...(signal === undefined ? {} : { signal }) },
  );

  return items;
}

/**
 * Reads one vendor.
 *
 * @param vendorId - Which vendor.
 * @param signal - Cancels the request.
 * @returns The vendor, with its drivers and what the owner has done about it.
 */
export async function fetchVendor(
  vendorId: string,
  signal?: AbortSignal,
): Promise<IntegrationVendorView> {
  return apiRequest(`/integrations/vendors/${vendorId}`, integrationVendorViewSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
}

/**
 * Saves what every device of a vendor shares.
 *
 * Merged by the server over what is stored, so a secret the form was not served is kept.
 *
 * @param vendorId - Which vendor.
 * @param request - The values its form collected.
 * @returns The vendor as it now stands.
 */
export async function updateVendorConfig(
  vendorId: string,
  request: IntegrationVendorConfigUpdate,
): Promise<IntegrationVendorView> {
  return apiRequest(`/integrations/vendors/${vendorId}/config`, integrationVendorViewSchema, {
    method: 'PATCH',
    body: request,
  });
}

/**
 * Adds an integration instance: a device, by its address.
 *
 * @param request - The id, the kind, the model and what its form collected.
 * @returns The integration as it now stands, its state as the hub reported it.
 */
export async function createIntegration(request: IntegrationCreate): Promise<IntegrationView> {
  return apiRequest('/integrations', integrationViewSchema, { method: 'POST', body: request });
}

/**
 * Tries a configuration without saving it.
 *
 * @param request - Which kind, what was typed, and which instance the blanks come from.
 * @returns The verdict and the hub's sentence about it. A configuration that does not work is a
 * reply, not a failure: `isReachable` is false and `detail` says why.
 */
export async function probeIntegration(
  request: IntegrationProbeRequest,
): Promise<IntegrationProbeReply> {
  return apiRequest('/integrations/probe', integrationProbeReplySchema, {
    method: 'POST',
    body: request,
  });
}

/**
 * Changes an integration's configuration.
 *
 * `transportConfig` is merged by the server rather than replacing what is there, which is what
 * lets a form that was served a configuration without its secrets save without deleting them.
 *
 * @param integrationId - Which one.
 * @param request - The fields to change.
 * @returns The integration as it now stands.
 */
export async function updateIntegration(
  integrationId: string,
  request: IntegrationUpdate,
): Promise<IntegrationView> {
  return apiRequest(`/integrations/${integrationId}`, integrationViewSchema, {
    method: 'PATCH',
    body: request,
  });
}

/**
 * Lists every installed package and how it is faring.
 *
 * @param signal - Cancels the request.
 * @returns Every package.
 */
export async function fetchPackages(signal?: AbortSignal): Promise<PackageView[]> {
  const { items } = await apiRequest('/packages', collectionSchema(packageViewSchema), {
    ...(signal === undefined ? {} : { signal }),
  });

  return items;
}

/** The cache keys the library reads under. */
export const LIBRARY_QUERY_KEYS = {
  /** Every automation. */
  automations: ['library', 'automations'] as const,

  /** Every scene. */
  scenes: ['library', 'scenes'] as const,

  /** Every device. */
  devices: ['library', 'devices'] as const,

  /** Every entity, with its state as last read. */
  entities: ['library', 'entities'] as const,

  /** What the current discovery pass has found. */
  candidates: ['library', 'candidates'] as const,

  /** Every derived entity. */
  aliases: ['library', 'aliases'] as const,

  /** Every configured integration. */
  integrations: ['library', 'integrations'] as const,

  /** Every vendor the hub has loaded. */
  vendors: ['library', 'vendors'] as const,

  /** Every installed package. */
  packages: ['library', 'packages'] as const,
} as const;
