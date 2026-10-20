/**
 * Linking, as the pages drive it: one device reached two ways, two readings linked into one, the
 * house's offers to link, and what an integration found on the network (`/api/v1`).
 *
 * Every link and unlink is asked twice: once with `preview` to say what it does, which its dialog
 * lists, and once to do it.
 */
import { z } from 'zod';

import {
  discoveredReplySchema,
  discoveryAdoptManyReplySchema,
  discoveryDismissReplySchema,
  linkPreviewSchema,
  linkSuggestionsReplySchema,
  linkSuggestionViewSchema,
  type DiscoveredDevice,
  type DiscoveryAdoptManyReply,
  type LinkPreview,
  type LinkSuggestionView,
} from '@nebulahome/contracts';

import { apiRequest } from '@/lib/api-client';

/** The keys what linking reads is cached under. */
export const LINK_QUERY_KEYS = {
  /** A vendor's suggestions, keyed further by the vendor. */
  suggestions: ['links', 'suggestions'] as const,

  /** A vendor's found devices, keyed further by the vendor. */
  found: ['links', 'found'] as const,

  /** The suggestion a device just added is part of, keyed further by the device. */
  suggestionOf: ['links', 'suggestion-of'] as const,

  /** A link's preview, keyed further by what it is. */
  preview: ['links', 'preview'] as const,
};

/** What can be linked or unlinked. */
export type LinkTarget =
  | { readonly scope: 'device'; readonly id: string }
  | { readonly scope: 'entity'; readonly id: string };

/**
 * The path of a link.
 *
 * @param target - The device or entity.
 * @returns Its link path.
 */
function linkPath(target: LinkTarget): string {
  return target.scope === 'device'
    ? `/devices/${encodeURIComponent(target.id)}/link`
    : `/entities/${encodeURIComponent(target.id)}/link`;
}

/**
 * Links a device or an entity to another, or says what that does.
 *
 * @param target - The one linked.
 * @param withId - The other.
 * @param isPreview - Whether only to say.
 * @returns What it does.
 */
export async function link(
  target: LinkTarget,
  withId: string,
  isPreview: boolean,
): Promise<LinkPreview> {
  return apiRequest(`${linkPath(target)}?preview=${String(isPreview)}`, linkPreviewSchema, {
    method: 'POST',
    body: { with: withId },
  });
}

/**
 * Unlinks a device or an entity, or says what that does.
 *
 * @param target - The one unlinked.
 * @param isPreview - Whether only to say.
 * @returns What it does.
 */
export async function unlink(target: LinkTarget, isPreview: boolean): Promise<LinkPreview> {
  return apiRequest(`${linkPath(target)}?preview=${String(isPreview)}`, linkPreviewSchema, {
    method: 'DELETE',
  });
}

/**
 * Lists a vendor's offers to link two of its devices.
 *
 * @param vendorId - The vendor.
 * @param signal - Cancels the request.
 * @returns The suggestions, offered and set aside.
 */
export async function fetchLinkSuggestions(
  vendorId: string,
  signal?: AbortSignal,
): Promise<LinkSuggestionView[]> {
  const { items } = await apiRequest(
    `/integrations/vendors/${encodeURIComponent(vendorId)}/suggestions`,
    linkSuggestionsReplySchema,
    signal === undefined ? {} : { signal },
  );

  return items;
}

/**
 * Reads the offer to link a device just added to one the house has.
 *
 * @param deviceId - The device just added.
 * @param signal - Cancels the request.
 * @returns The suggestion, or null.
 */
export async function fetchSuggestionOfDevice(
  deviceId: string,
  signal?: AbortSignal,
): Promise<LinkSuggestionView | null> {
  const { item } = await apiRequest(
    `/devices/${encodeURIComponent(deviceId)}/link-suggestion`,
    z.object({ item: linkSuggestionViewSchema.nullable() }),
    signal === undefined ? {} : { signal },
  );

  return item;
}

/**
 * Sets an offer to link aside, or offers it again.
 *
 * @param suggestionId - The suggestion.
 * @param isDismissed - Whether to set it aside.
 */
export async function dismissLinkSuggestion(
  suggestionId: string,
  isDismissed: boolean,
): Promise<void> {
  await apiRequest(`/link-suggestions/${suggestionId}/dismiss`, z.undefined(), {
    method: 'POST',
    body: { isDismissed },
  });
}

/**
 * Lists what a vendor found on the network and the house does not have.
 *
 * @param vendorId - The vendor.
 * @param signal - Cancels the request.
 * @returns The found devices, set aside or not.
 */
export async function fetchFound(
  vendorId: string,
  signal?: AbortSignal,
): Promise<DiscoveredDevice[]> {
  const { items } = await apiRequest(
    `/integrations/vendors/${encodeURIComponent(vendorId)}/found`,
    discoveredReplySchema,
    signal === undefined ? {} : { signal },
  );

  return items;
}

/**
 * Sets found devices aside, or brings them back.
 *
 * @param ids - Which.
 * @param isDismissed - Which way.
 * @returns How many the hub still had.
 */
export async function dismissFound(ids: readonly string[], isDismissed = true): Promise<number> {
  const { changed } = await apiRequest('/discovery/dismiss', discoveryDismissReplySchema, {
    method: 'POST',
    body: { ids, isDismissed },
  });

  return changed;
}

/**
 * Adopts found devices in one step, each named after its model.
 *
 * @param ids - Which.
 * @returns What became of each.
 */
export async function adoptFound(
  ids: readonly string[],
): Promise<DiscoveryAdoptManyReply['items']> {
  const { items } = await apiRequest('/discovery/adopt', discoveryAdoptManyReplySchema, {
    method: 'POST',
    body: { ids },
  });

  return items;
}
