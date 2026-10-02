/**
 * The calls the packages pages make, and where their answers are cached.
 *
 * Every answer is parsed with the contract's schema, as everywhere else. What a package's own
 * methods answer is its business: it is passed through as JSON, for its components to read.
 */
import { z } from 'zod';

import {
  apiPackageDetailSchema,
  apiPackageSchema,
  containerLogsReplySchema,
  installedPackageSchema,
  packageAvailableReplySchema,
  packagePlanReplySchema,
  packageRpcReplySchema,
  type ApiPackage,
  type ApiPackageDetail,
  type ContainerLogsReply,
  type InstalledPackage,
  type JsonValue,
  type PackageAvailableReply,
  type PackageConfigBody,
  type PackagePlanReply,
} from '@nebulahome/contracts';

import { apiRequest } from '@/lib/api-client';

/** Where the packages are cached. */
export const PACKAGE_QUERY_KEYS = {
  /** Everything about packages: what an event reads again. */
  all: ['packages'] as const,

  /** The installed packages. */
  list: ['packages', 'list'] as const,

  /** What the index offers. */
  available: ['packages', 'available'] as const,

  /**
   * One installed package.
   *
   * @param id - Its id.
   * @returns The key.
   */
  one: (id: string) => ['packages', 'one', id] as const,

  /**
   * One package's log.
   *
   * @param id - Its id.
   * @returns The key.
   */
  logs: (id: string) => ['packages', 'logs', id] as const,

  /**
   * What one of a package's methods answered, for one input.
   *
   * @param id - The package.
   * @param method - The method.
   * @param input - What it was handed.
   * @returns The key.
   */
  rpc: (id: string, method: string, input: JsonValue) =>
    ['packages', 'rpc', id, method, input] as const,

  /**
   * What a package's methods answered: every one of them, or one for any input.
   *
   * @param id - The package.
   * @param method - The method, when only its answers.
   * @returns The key's prefix.
   */
  rpcOf: (id: string, method?: string) =>
    method === undefined
      ? (['packages', 'rpc', id] as const)
      : (['packages', 'rpc', id, method] as const),
} as const;

/** Where a package's interface is served from, under the release installed. */
const API_ROOT = '/api/v1';

/**
 * The path of one package.
 *
 * @param id - Its id.
 * @returns `/packages/<id>`.
 */
function pathOf(id: string): string {
  return `/packages/${encodeURIComponent(id)}`;
}

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
 * A path as the manifest writes it, without the `./` in front.
 *
 * @param name - `./ui/index.js`.
 * @returns `ui/index.js`.
 */
function withoutDot(name: string): string {
  return name.replace(/^\.\//u, '');
}

/**
 * The address of a file of a package's interface.
 *
 * The API serves a package's interface from the folder its entry is in, so a file is named from
 * there: with the entry `./ui/index.js`, the stylesheet `./ui/index.css` is `index.css`.
 *
 * @param found - The package, at the build installed.
 * @param found.id - Its id.
 * @param found.build - The build: in the address, so an update - or another build of the same
 *   version, reinstalled from a local file - is loaded fresh.
 * @param entry - Its interface's entry, as the manifest names it.
 * @param file - The file, as the manifest names it.
 * @returns Its address.
 */
export function packageFileUrl(
  found: Pick<InstalledPackage, 'id' | 'build'>,
  entry: string,
  file: string,
): string {
  const folder = withoutDot(entry).split('/').slice(0, -1).join('/');
  const name = withoutDot(file);
  const relative =
    folder !== '' && name.startsWith(`${folder}/`) ? name.slice(folder.length + 1) : name;

  return `${API_ROOT}${pathOf(found.id)}/ui/${encodeURIComponent(found.build)}/${relative}`;
}

/**
 * The address of a package's logo.
 *
 * @param found - The package.
 * @param found.id - Its id.
 * @param found.hasLogo - Whether it ships one.
 * @returns Its address, or undefined for one that ships none.
 */
export function packageLogoUrl(
  found: Pick<InstalledPackage, 'id' | 'hasLogo'>,
): string | undefined {
  return found.hasLogo ? `${API_ROOT}${pathOf(found.id)}/logo` : undefined;
}

/**
 * Reads every installed package.
 *
 * @param signal - Cancels the request.
 * @returns The packages, with how much of the house each accounts for.
 */
export async function fetchPackages(signal?: AbortSignal): Promise<ApiPackage[]> {
  const { items } = await apiRequest(
    '/packages',
    z.object({ items: z.array(apiPackageSchema) }),
    withSignal(signal),
  );

  return items;
}

/**
 * Reads one installed package, with its setup.
 *
 * @param id - Its id.
 * @param signal - Cancels the request.
 * @returns The package.
 */
export async function fetchPackage(id: string, signal?: AbortSignal): Promise<ApiPackageDetail> {
  return apiRequest(pathOf(id), apiPackageDetailSchema, withSignal(signal));
}

/**
 * Reads what the index offers.
 *
 * @param signal - Cancels the request.
 * @returns The packages, and whether the index could be read.
 */
export async function fetchAvailablePackages(signal?: AbortSignal): Promise<PackageAvailableReply> {
  return apiRequest('/packages/available', packageAvailableReplySchema, withSignal(signal));
}

/**
 * Asks what installing a package would take.
 *
 * @param id - The package.
 * @returns What would be installed, and why it cannot be.
 */
export async function planPackage(id: string): Promise<PackagePlanReply> {
  return apiRequest(`${pathOf(id)}/plan`, packagePlanReplySchema, { method: 'POST', body: {} });
}

/**
 * Installs a package and what it needs.
 *
 * @param id - The package.
 * @returns What was installed, the one asked for last.
 */
export async function installPackage(id: string): Promise<InstalledPackage[]> {
  const { installed } = await apiRequest(
    `${pathOf(id)}/install`,
    z.object({ installed: z.array(installedPackageSchema) }),
    { method: 'POST', body: {} },
  );

  return installed;
}

/**
 * Updates a package to the newest release that fits.
 *
 * @param id - The package.
 * @returns It, as it now is.
 */
export async function updatePackage(id: string): Promise<InstalledPackage> {
  return (
    await apiRequest(`${pathOf(id)}/update`, z.object({ package: installedPackageSchema }), {
      method: 'POST',
    })
  ).package;
}

/**
 * Removes a package.
 *
 * @param id - The package.
 * @param isDataRemoved - Whether what it kept goes too.
 */
export async function removePackage(id: string, isDataRemoved: boolean): Promise<void> {
  await apiRequest(`${pathOf(id)}?data=${String(isDataRemoved)}`, z.unknown(), {
    method: 'DELETE',
  });
}

/**
 * Starts, stops or restarts a package.
 *
 * @param id - The package.
 * @param action - What to do.
 * @returns It, as it now is.
 */
export async function controlPackage(
  id: string,
  action: 'start' | 'stop' | 'restart',
): Promise<InstalledPackage> {
  return (
    await apiRequest(`${pathOf(id)}/${action}`, z.object({ package: installedPackageSchema }), {
      method: 'POST',
    })
  ).package;
}

/**
 * Saves what the owner configured, which starts the package again with it.
 *
 * @param id - The package.
 * @param body - The setup form's two groups.
 * @returns It, as it now is.
 */
export async function configurePackage(
  id: string,
  body: PackageConfigBody,
): Promise<InstalledPackage> {
  return (
    await apiRequest(`${pathOf(id)}/config`, z.object({ package: installedPackageSchema }), {
      method: 'PUT',
      body,
    })
  ).package;
}

/**
 * Reads the last lines a package's process wrote, or those after the last read.
 *
 * @param id - The package.
 * @param tail - How many lines at most.
 * @param since - Only those after this cursor.
 * @param signal - Cancels the request.
 * @returns The lines, oldest first, and where the next read carries on.
 */
export async function fetchPackageLogs(
  id: string,
  tail: number,
  since?: string,
  signal?: AbortSignal,
): Promise<ContainerLogsReply> {
  const query = new URLSearchParams({ tail: String(tail) });

  if (since !== undefined) {
    query.set('since', since);
  }

  return apiRequest(
    `${pathOf(id)}/logs?${query.toString()}`,
    containerLogsReplySchema,
    withSignal(signal),
  );
}

/**
 * Calls one of a package's methods.
 *
 * @param id - The package.
 * @param method - The method.
 * @param input - What it is handed.
 * @param signal - Cancels the request.
 * @returns What it answered.
 */
export async function callPackage(
  id: string,
  method: string,
  input: JsonValue = null,
  signal?: AbortSignal,
): Promise<JsonValue> {
  const { output } = await apiRequest(
    `${pathOf(id)}/rpc/${encodeURIComponent(method)}`,
    packageRpcReplySchema,
    { method: 'POST', body: { input }, ...withSignal(signal) },
  );

  return output;
}
