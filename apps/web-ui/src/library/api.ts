/**
 * Every call the library section makes, one function per endpoint.
 *
 * As in `settings/api.ts`, each names the contract schema its answer must satisfy rather than
 * declaring a response type here. A type written in this file could agree with the server today
 * and stop agreeing after a deployment, and nothing would say so.
 */
import { z } from 'zod';

import {
  activityEntrySchema,
  aliasPreviewResponseSchema,
  aliasViewSchema,
  areaViewSchema,
  automationViewSchema,
  deviceProbeReplySchema,
  deviceViewSchema,
  discoveredReplySchema,
  discoverReplySchema,
  entityCommandResponseSchema,
  entityViewSchema,
  iconsResponseSchema,
  iconViewSchema,
  integrationVendorViewSchema,
  packageViewSchema,
  sceneApplyResultSchema,
  sceneViewSchema,
  stateHistoryPointSchema,
  tagViewSchema,
  telemetryPointSchema,
  tileCacheStatusSchema,
  tilePrefetchResultSchema,
  type ActivityEntry,
  type AliasCreate,
  type AliasPreviewRequest,
  type AliasPreviewResponse,
  type AliasUpdate,
  type AliasView,
  type AreaCreate,
  type AreaUpdate,
  type AreaView,
  type AutomationCreate,
  type AutomationUpdate,
  type AutomationView,
  type CapabilityName,
  type DeviceCreate,
  type DeviceProbeReply,
  type DeviceProbeRequest,
  type DeviceUpdate,
  type DeviceView,
  type DiscoveredDevice,
  type DiscoverReply,
  type DiscoveryAdopt,
  type EntityCommandResponse,
  type EntityUpdate,
  type EntityView,
  type IconCreate,
  type IconUpdate,
  type IconView,
  type IntegrationVendorConfigUpdate,
  type IntegrationVendorView,
  type JsonObject,
  type PackageView,
  type SceneApplyResult,
  type SceneCreate,
  type SceneUpdate,
  type SceneView,
  type StateHistoryPoint,
  type TagCreate,
  type TagUpdate,
  type TagView,
  type TelemetryPoint,
  type TelemetryResolution,
  type TileCacheStatus,
  type TilePrefetchResult,
  IDEMPOTENCY_KEY_HEADER,
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
 * Creates a scene.
 *
 * @param request - What to create.
 * @returns The scene as it now stands.
 */
export async function createScene(request: SceneCreate): Promise<SceneView> {
  return apiRequest('/scenes', sceneViewSchema, { method: 'POST', body: request });
}

/**
 * Changes a scene.
 *
 * Sending `members` replaces the whole set: the server does not merge by entity.
 *
 * @param sceneId - Which one.
 * @param request - The fields to change.
 * @returns The scene as it now stands.
 */
export async function updateScene(sceneId: string, request: SceneUpdate): Promise<SceneView> {
  return apiRequest(`/scenes/${sceneId}`, sceneViewSchema, {
    method: 'PATCH',
    body: request,
  });
}

/**
 * Deletes a scene.
 *
 * @param sceneId - Which one.
 * @returns The scene as it was.
 */
export async function deleteScene(sceneId: string): Promise<SceneView> {
  return apiRequest(`/scenes/${sceneId}`, sceneViewSchema, { method: 'DELETE' });
}

/**
 * Applies a scene: every member is set to its saved state.
 *
 * @param sceneId - Which one.
 * @returns How many applied, how many failed, and which entities failed.
 */
export async function applyScene(sceneId: string): Promise<SceneApplyResult> {
  return apiRequest(`/scenes/${sceneId}/apply`, sceneApplyResultSchema, { method: 'POST' });
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

/**
 * Removes a device: the hub stops listening for it and its entities go with it.
 *
 * @param deviceId - Which one.
 * @returns A promise that settles once it is gone.
 */
export async function deleteDevice(deviceId: string): Promise<void> {
  await apiRequest(`/devices/${deviceId}`, z.undefined(), { method: 'DELETE' });
}

/**
 * Lists the devices the hub found on the network and nobody has added yet.
 *
 * @param signal - Cancels the request.
 * @returns Every device found, oldest first; none when the hub is away.
 */
export async function fetchDiscovered(signal?: AbortSignal): Promise<DiscoveredDevice[]> {
  const { items } = await apiRequest('/discovery', discoveredReplySchema, {
    ...(signal === undefined ? {} : { signal }),
  });

  return items;
}

/**
 * Asks the hub to look for one vendor's devices on the network now, rather than at its next pass.
 *
 * @param vendorId - The vendor.
 * @returns The vendor being looked for, and for how long; nothing when the hub is not looking.
 * What is found arrives over those seconds, each device a `discovery` event on the live channel.
 */
export async function scanNetwork(vendorId: string): Promise<DiscoverReply> {
  return apiRequest('/discovery/scan', discoverReplySchema, {
    method: 'POST',
    body: { vendorId },
  });
}

/**
 * Adds a device the hub found, with what it found filled in.
 *
 * @param candidateId - Which device, as the list named it.
 * @param request - What the owner decided: the id, the name, the icon, the room, the tags, and
 * whatever the driver asks that discovery could not fill.
 * @returns The device as it now stands.
 */
export async function adoptDiscovered(
  candidateId: string,
  request: DiscoveryAdopt,
): Promise<DeviceView> {
  return apiRequest(`/discovery/${candidateId}/adopt`, deviceViewSchema, {
    method: 'POST',
    body: request,
  });
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
 * Changes what an entity is called, what it is drawn as, or the tags on it.
 *
 * @param entityId - Which one, by its address.
 * @param request - The fields to change.
 * @returns The entity as it now stands.
 */
export async function updateEntity(entityId: string, request: EntityUpdate): Promise<EntityView> {
  return apiRequest(`/entities/${encodeURIComponent(entityId)}`, entityViewSchema, {
    method: 'PATCH',
    body: request,
  });
}

/**
 * Reads one entity, with its state as last recorded.
 *
 * @param entityId - Which one, by its address.
 * @param signal - Cancels the request.
 * @returns The entity.
 */
export async function fetchEntity(entityId: string, signal?: AbortSignal): Promise<EntityView> {
  return apiRequest(`/entities/${encodeURIComponent(entityId)}`, entityViewSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
}

/**
 * Makes a key no other command will carry.
 *
 * From `getRandomValues` rather than `randomUUID`: the second exists only in a secure context,
 * and a house reached at `http://192.168.1.20` is not one - the button would fail exactly where
 * the interface is used most.
 *
 * @returns 32 hexadecimal characters.
 */
function newIdempotencyKey(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Commands one capability of one entity.
 *
 * Every call carries an idempotency key of its own, so a retry of this request - a proxy that
 * resends, a reply that was lost - is recognised by the server as the same press rather than a
 * second one. Two presses of the same button are two calls, and two commands.
 *
 * @param entityId - Which entity, by its address.
 * @param capability - Which of its capabilities.
 * @param command - The command and its arguments, e.g. `{ command: 'set_level', level: 40 }`.
 * @returns The acknowledgement: the adapter took it, not that the device has done it.
 */
export async function commandEntity(
  entityId: string,
  capability: CapabilityName,
  command: JsonObject,
): Promise<EntityCommandResponse> {
  return apiRequest(
    `/entities/${encodeURIComponent(entityId)}/capabilities/${capability}/commands`,
    entityCommandResponseSchema,
    {
      method: 'POST',
      body: { command },
      headers: { [IDEMPOTENCY_KEY_HEADER]: newIdempotencyKey() },
    },
  );
}

/** A window of history to read. */
export type HistoryWindow = {
  /** The entity to read. */
  readonly entityId: string;

  /** The inclusive start. */
  readonly from: Date;

  /** The exclusive end. */
  readonly to: Date;
};

/** How many pages of history one read follows at most: a chart has no use for more. */
const HISTORY_PAGE_CAP = 4;

/**
 * Follows a paginated history endpoint, newest first, up to {@link HISTORY_PAGE_CAP} pages.
 *
 * @param path - The endpoint below `/api/v1`.
 * @param query - Its query, without the cursor.
 * @param item - What one entry looks like.
 * @param signal - Cancels the reads.
 * @returns What the pages held, oldest first.
 */
async function readHistoryPages<TItem extends z.ZodType>(
  path: string,
  query: URLSearchParams,
  item: TItem,
  signal: AbortSignal | undefined,
): Promise<z.output<TItem>[]> {
  const items: z.output<TItem>[] = [];
  let cursor: string | undefined;
  let pages = 0;

  do {
    const page = new URLSearchParams(query);

    page.set('limit', String(MAX_PAGE_LIMIT));

    if (cursor !== undefined) {
      page.set('cursor', cursor);
    }

    // Sequential by nature: each page's cursor is only known once the page before it has come.
    // eslint-disable-next-line no-await-in-loop -- see above
    const answer = await apiRequest(`${path}?${page.toString()}`, pageSchema(item), {
      ...(signal === undefined ? {} : { signal }),
    });

    items.push(...answer.items);
    cursor = answer.nextCursor;
    pages += 1;
  } while (cursor !== undefined && pages < HISTORY_PAGE_CAP);

  return items.reverse();
}

/**
 * Reads the recorded changes of an entity's state over a window.
 *
 * @param window - Which entity, and when.
 * @param signal - Cancels the reads.
 * @returns The changes, oldest first.
 */
export async function fetchStateHistory(
  window: HistoryWindow,
  signal?: AbortSignal,
): Promise<StateHistoryPoint[]> {
  const query = new URLSearchParams({
    entityId: window.entityId,
    from: window.from.toISOString(),
    to: window.to.toISOString(),
  });

  return readHistoryPages('/history/state', query, stateHistoryPointSchema, signal);
}

/** One page of a device's activity, and where the next begins. */
export type ActivityPage = {
  readonly items: ActivityEntry[];

  /** Pass back to read the next, older page; absent on the last. */
  readonly nextCursor: string | undefined;
};

/** How many changes one page of a device's activity holds. */
export const ACTIVITY_PAGE_SIZE = 40;

/**
 * Reads one page of what changed on a device, newest first.
 *
 * @param deviceId - The device.
 * @param cursor - Where the previous page ended; absent for the newest.
 * @param signal - Cancels the read.
 * @returns The page.
 */
export async function fetchDeviceActivity(
  deviceId: string,
  cursor: string | undefined,
  signal?: AbortSignal,
): Promise<ActivityPage> {
  const query = new URLSearchParams({ limit: String(ACTIVITY_PAGE_SIZE) });

  if (cursor !== undefined) {
    query.set('cursor', cursor);
  }

  const page = await apiRequest(
    `/devices/${encodeURIComponent(deviceId)}/activity?${query.toString()}`,
    pageSchema(activityEntrySchema),
    { ...(signal === undefined ? {} : { signal }) },
  );

  return { items: page.items, nextCursor: page.nextCursor };
}

/**
 * Reads an entity's numeric readings over a window, at a resolution.
 *
 * @param window - Which entity, and when.
 * @param resolution - Every reading, or buckets of a minute, an hour or a day.
 * @param signal - Cancels the reads.
 * @returns The readings or buckets, oldest first.
 */
export async function fetchTelemetry(
  window: HistoryWindow,
  resolution: TelemetryResolution,
  signal?: AbortSignal,
): Promise<TelemetryPoint[]> {
  const query = new URLSearchParams({
    entityId: window.entityId,
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    resolution,
  });

  return readHistoryPages('/history/telemetry', query, telemetryPointSchema, signal);
}

/**
 * Lists every area: the house, its floors, their rooms.
 *
 * @param signal - Cancels the request.
 * @returns Every area, in the order the owner arranged.
 */
export async function fetchAreas(signal?: AbortSignal): Promise<AreaView[]> {
  const response = await apiRequest('/areas', collectionSchema(areaViewSchema), {
    ...(signal === undefined ? {} : { signal }),
  });

  return response.items;
}

/**
 * Creates the house, a floor or a room.
 *
 * @param request - The kind, the name, the parent for a floor or a room, and the rest.
 * @returns The area, with nothing in it yet.
 */
export async function createArea(request: AreaCreate): Promise<AreaView> {
  return apiRequest('/areas', areaViewSchema, { method: 'POST', body: request });
}

/**
 * Renames, redraws or moves an area.
 *
 * @param areaId - Which one.
 * @param request - What changes.
 * @returns The area as it now stands.
 */
export async function updateArea(areaId: string, request: AreaUpdate): Promise<AreaView> {
  return apiRequest(`/areas/${areaId}`, areaViewSchema, { method: 'PATCH', body: request });
}

/**
 * Removes an area and everything under it.
 *
 * @param areaId - Which one.
 * @returns A promise that settles once it is gone.
 */
export async function deleteArea(areaId: string): Promise<void> {
  await apiRequest(`/areas/${areaId}`, z.undefined(), { method: 'DELETE' });
}

/**
 * Says how much of the map around the house is on disk.
 *
 * @param houseId - The house.
 * @param signal - Cancels the request.
 * @returns How many tiles the buffer has, and how many are on disk.
 */
export async function fetchTileStatus(
  houseId: string,
  signal?: AbortSignal,
): Promise<TileCacheStatus> {
  return apiRequest(`/areas/${houseId}/tiles`, tileCacheStatusSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
}

/**
 * Fetches the map around the house onto the server's disk.
 *
 * @param houseId - The house.
 * @returns What the fetch did.
 */
export async function prefetchTiles(houseId: string): Promise<TilePrefetchResult> {
  return apiRequest(`/areas/${houseId}/tiles`, tilePrefetchResultSchema, { method: 'POST' });
}

/**
 * Lists every tag, with how many devices and entities carry each.
 *
 * @param signal - Cancels the request.
 * @returns Every tag, alphabetically.
 */
export async function fetchTags(signal?: AbortSignal): Promise<TagView[]> {
  const response = await apiRequest('/tags', collectionSchema(tagViewSchema), {
    ...(signal === undefined ? {} : { signal }),
  });

  return response.items;
}

/**
 * Creates a tag from a name and a colour.
 *
 * @param request - The name and the colour.
 * @returns The tag, on nothing yet.
 */
export async function createTag(request: TagCreate): Promise<TagView> {
  return apiRequest('/tags', tagViewSchema, { method: 'POST', body: request });
}

/**
 * Renames or recolours a tag.
 *
 * @param tagId - Which one.
 * @param request - The new name, the new colour, or both.
 * @returns The tag as it now stands.
 */
export async function updateTag(tagId: string, request: TagUpdate): Promise<TagView> {
  return apiRequest(`/tags/${tagId}`, tagViewSchema, { method: 'PATCH', body: request });
}

/**
 * Removes a tag from everything, and deletes it.
 *
 * @param tagId - Which one.
 * @returns A promise that settles once it is gone.
 */
export async function deleteTag(tagId: string): Promise<void> {
  await apiRequest(`/tags/${tagId}`, z.undefined(), { method: 'DELETE' });
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
 * Creates a derived entity or a stored helper.
 *
 * @param request - What to create.
 * @returns The alias as it now stands.
 */
export async function createAlias(request: AliasCreate): Promise<AliasView> {
  return apiRequest('/aliases', aliasViewSchema, { method: 'POST', body: request });
}

/**
 * Changes an alias.
 *
 * The entity id is immutable after create. Expression and sources stay calculated-only.
 *
 * @param aliasId - Which one.
 * @param request - The fields to change.
 * @returns The alias as it now stands.
 */
export async function updateAlias(aliasId: string, request: AliasUpdate): Promise<AliasView> {
  return apiRequest(`/aliases/${aliasId}`, aliasViewSchema, {
    method: 'PATCH',
    body: request,
  });
}

/**
 * Deletes an alias and the entity it produces.
 *
 * @param aliasId - Which one.
 * @returns The alias as it was.
 */
export async function deleteAlias(aliasId: string): Promise<AliasView> {
  return apiRequest(`/aliases/${aliasId}`, aliasViewSchema, { method: 'DELETE' });
}

/**
 * Evaluates a calculated formula without saving it.
 *
 * @param request - The expression, sources, capability and fallback.
 * @returns The scalar result, or why evaluation failed.
 */
export async function previewAlias(request: AliasPreviewRequest): Promise<AliasPreviewResponse> {
  return apiRequest('/aliases/preview', aliasPreviewResponseSchema, {
    method: 'POST',
    body: request,
  });
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

  /** Every entity, with its state as last read; one entity is keyed further by its address. */
  entities: ['library', 'entities'] as const,

  /** An entity's recorded history, keyed further by the entity, the kind and the window. */
  history: ['library', 'history'] as const,

  /** Every derived entity. */
  aliases: ['library', 'aliases'] as const,

  /** Every tag, with what carries it counted. */
  tags: ['library', 'tags'] as const,

  /** Every area: the house, its floors, their rooms. */
  areas: ['library', 'areas'] as const,

  /** How much of the map around the house is on disk, keyed further by the house. */
  tiles: ['library', 'tiles'] as const,

  /** Pages of the icon catalogue, keyed further by what was asked. */
  icons: ['library', 'icons'] as const,

  /** Every vendor the hub has loaded. */
  vendors: ['library', 'vendors'] as const,

  /** The devices the hub found on the network and nobody has added. */
  discovered: ['library', 'discovered'] as const,

  /** What changed on a device, keyed further by the device. */
  activity: ['library', 'activity'] as const,

  /** Every installed package. */
  packages: ['library', 'packages'] as const,
} as const;
