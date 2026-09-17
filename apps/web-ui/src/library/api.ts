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
  deviceProbeReplySchema,
  deviceViewSchema,
  entityViewSchema,
  iconsResponseSchema,
  iconViewSchema,
  integrationVendorViewSchema,
  packageViewSchema,
  sceneViewSchema,
  type AliasView,
  type AutomationCreate,
  type AutomationUpdate,
  type AutomationView,
  type DeviceCreate,
  type DeviceProbeReply,
  type DeviceProbeRequest,
  type DeviceUpdate,
  type DeviceView,
  type EntityView,
  type IconCreate,
  type IconUpdate,
  type IconView,
  type IntegrationVendorConfigUpdate,
  type IntegrationVendorView,
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
 * Lists every device: where each stands, what it is called, what it exposes.
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
 * Adds a device: the instance that reaches it and the row that names it, under one id.
 *
 * @param request - The id, the kind, the model, the name, the icon and what its form collected.
 * @returns The device as it now stands, its state as the hub reported it.
 */
export async function createDevice(request: DeviceCreate): Promise<DeviceView> {
  return apiRequest('/devices', deviceViewSchema, { method: 'POST', body: request });
}

/**
 * Tries a configuration without saving it.
 *
 * @param request - Which kind, what was typed, and which device the blanks come from.
 * @returns The verdict and the hub's sentence about it. A configuration that does not work is a
 * reply, not a failure: `isReachable` is false and `detail` says why.
 */
export async function probeDevice(request: DeviceProbeRequest): Promise<DeviceProbeReply> {
  return apiRequest('/devices/probe', deviceProbeReplySchema, { method: 'POST', body: request });
}

/**
 * Changes a device: its name and icon, or its configuration.
 *
 * `transportConfig` is merged by the server rather than replacing what is there, which is what
 * lets a form that was served a configuration without its secrets save without deleting them.
 *
 * @param deviceId - Which one.
 * @param request - The fields to change.
 * @returns The device as it now stands.
 */
export async function updateDevice(deviceId: string, request: DeviceUpdate): Promise<DeviceView> {
  return apiRequest(`/devices/${deviceId}`, deviceViewSchema, { method: 'PATCH', body: request });
}

/** What a page of the icon catalogue is asked for. */
export type IconsRequest = {
  /** What was typed; blank for the catalogue in its own order. */
  readonly q?: string;

  /** The ids a page shows, in one request. */
  readonly ids?: readonly string[];

  /** How many at most. */
  readonly limit?: number;
};

/**
 * Reads a page of the icon catalogue: a search, or the icons some rows show.
 *
 * @param request - What to ask for.
 * @param signal - Cancels the request.
 * @returns The icons, closest match first, or in the order the ids were asked.
 */
export async function fetchIcons(request: IconsRequest, signal?: AbortSignal): Promise<IconView[]> {
  const query = new URLSearchParams();

  if (request.ids !== undefined && request.ids.length > 0) {
    query.set('ids', request.ids.join(','));
  } else if (request.q !== undefined && request.q !== '') {
    query.set('q', request.q);
  }

  if (request.limit !== undefined) {
    query.set('limit', String(request.limit));
  }

  const suffix = query.size === 0 ? '' : `?${query.toString()}`;
  const { items } = await apiRequest(`/icons${suffix}`, iconsResponseSchema, {
    ...(signal === undefined ? {} : { signal }),
  });

  return items;
}

/**
 * Adds a custom icon from an uploaded drawing.
 *
 * @param request - The id, the name, the keywords, the file and the frame it was fitted in.
 * @returns The icon as the catalogue now serves it.
 */
export async function createIcon(request: IconCreate): Promise<IconView> {
  return apiRequest('/icons', iconViewSchema, { method: 'POST', body: request });
}

/**
 * Changes an icon: a built-in one's drawing or keywords, a custom one's anything.
 *
 * @param iconId - Which icon.
 * @param request - What to change.
 * @returns The icon as the catalogue now serves it.
 */
export async function updateIcon(iconId: string, request: IconUpdate): Promise<IconView> {
  return apiRequest(`/icons/${iconId}`, iconViewSchema, { method: 'PATCH', body: request });
}

/**
 * Removes a custom icon, or puts a built-in icon's original drawing back.
 *
 * @param iconId - Which icon.
 * @returns A promise that settles once it is gone.
 */
export async function deleteIcon(iconId: string): Promise<void> {
  await apiRequest(`/icons/${iconId}`, z.undefined(), { method: 'DELETE' });
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

  /** Every derived entity. */
  aliases: ['library', 'aliases'] as const,

  /** Pages of the icon catalogue, keyed further by what was asked. */
  icons: ['library', 'icons'] as const,

  /** Every vendor the hub has loaded. */
  vendors: ['library', 'vendors'] as const,

  /** Every installed package. */
  packages: ['library', 'packages'] as const,
} as const;
