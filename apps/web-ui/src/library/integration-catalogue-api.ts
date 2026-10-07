/**
 * Installing integrations, as the API serves it: the Community Hub's integrations searched, what
 * it says of one, and a vendor's bundle installed, updated or removed (API.md, Integrations).
 */
import {
  hubDetailSchema,
  integrationInstallReplySchema,
  integrationRemovedSchema,
  integrationSearchReplySchema,
  type HubDetail,
  type IntegrationInstallReply,
  type IntegrationRemoved,
  type IntegrationSearchReply,
} from '@nebulahome/contracts';

import { apiRequest } from '@/lib/api-client';

/** Where the catalogue of integrations is cached. */
export const INTEGRATION_CATALOGUE_KEYS = {
  /** Everything about the catalogue: what an install reads again. */
  all: ['integrations', 'catalogue'] as const,

  /**
   * A search of the Community Hub.
   *
   * @param q - What was looked for; empty for the Hub's most installed.
   * @returns The key.
   */
  search: (q: string) => ['integrations', 'catalogue', 'search', q] as const,

  /**
   * What the Hub says of one integration.
   *
   * @param id - The vendor.
   * @returns The key.
   */
  detail: (id: string) => ['integrations', 'catalogue', 'detail', id] as const,
} as const;

/**
 * The signal, as the request options take it.
 *
 * @param signal - Cancels the request, when there is one.
 * @returns The options.
 */
function withSignal(signal: AbortSignal | undefined): { signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

/**
 * Searches the Hub's integrations, and the local integrations folder's.
 *
 * @param q - Words of a name, a description or a model; empty for the Hub's most installed.
 * @param cursor - The page after the first, from the reply before.
 * @param signal - Cancels the request.
 * @returns What was found, and why the Hub could not be asked, when it could not.
 */
export async function searchIntegrationCatalogue(
  q: string,
  cursor: string | undefined,
  signal?: AbortSignal,
): Promise<IntegrationSearchReply> {
  const params = new URLSearchParams();

  if (q !== '') {
    params.set('q', q);
  }

  if (cursor !== undefined) {
    params.set('cursor', cursor);
  }

  const query = params.toString();

  return apiRequest(
    `/integrations/catalogue${query === '' ? '' : `?${query}`}`,
    integrationSearchReplySchema,
    withSignal(signal),
  );
}

/**
 * What the Hub says of one integration beyond its search row.
 *
 * @param id - The vendor.
 * @param signal - Cancels the request.
 * @returns Whose it is, what it works with, what its drivers speak.
 */
export async function fetchIntegrationDetail(id: string, signal?: AbortSignal): Promise<HubDetail> {
  return apiRequest(
    `/integrations/catalogue/${encodeURIComponent(id)}`,
    hubDetailSchema,
    withSignal(signal),
  );
}

/**
 * Installs, updates or reinstalls a vendor's bundle.
 *
 * @param vendorId - The vendor.
 * @param version - A release; the newest that fits when not said.
 * @returns What was done, and the build the hub runs.
 */
export async function installIntegration(
  vendorId: string,
  version?: string,
): Promise<IntegrationInstallReply> {
  return apiRequest(
    `/integrations/vendors/${encodeURIComponent(vendorId)}/install`,
    integrationInstallReplySchema,
    { method: 'POST', body: version === undefined ? {} : { version } },
  );
}

/**
 * Removes an integration: its devices, accounts and settings, then its bundle.
 *
 * @param vendorId - The vendor.
 * @returns How many devices and accounts went with it.
 */
export async function removeIntegration(vendorId: string): Promise<IntegrationRemoved> {
  return apiRequest(
    `/integrations/vendors/${encodeURIComponent(vendorId)}`,
    integrationRemovedSchema,
    { method: 'DELETE' },
  );
}
