/**
 * The packages, as the interface reaches them: asked of the packet-manager, with what the
 * registry adds - how many devices and entities each accounts for - and the files each serves to
 * the browser.
 *
 * `api` decides nothing about a package itself: the packet-manager plans, installs, refuses. What
 * is here is the translation - the owner's settings checked against the package's setup and their
 * secrets sealed before they cross the bus, a package's interface served from its folder, and a
 * page's call to a package's method checked against who may make it.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { sql } from 'drizzle-orm';

import type { BusClient } from '@nebulahome/bus';
import {
  apiPackageDetailSchema,
  busSubjects,
  DeviceUnavailableError,
  jsonObjectSchema,
  NotFoundError,
  PACKAGE_RPC_METHOD,
  type PackageRpcCaller,
  packageAvailableReplySchema,
  packageDetailSchema,
  packageHubLogoReplySchema,
  packageInstallReplySchema,
  packageListReplySchema,
  packageLogsReplySchema,
  packageManifestSchema,
  packagePlanReplySchema,
  packageReplySchema,
  packageRpcReplySchema,
  packageSearchReplySchema,
  PACKET_MANAGER_METHODS,
  PACKET_MANAGER_SERVICE,
  secretKeysOf,
  type ApiPackage,
  type ApiPackageDetail,
  type ContainerLogsReply,
  type InstalledPackage,
  type JsonObject,
  type JsonValue,
  type PackageAvailableReply,
  type PackageConfigBody,
  type PackageDetail,
  type PackagePlanReply,
  type PackageRpcAccess,
  type PackageSearchReply,
  type PackageSearchRequest,
} from '@nebulahome/contracts';
import { maskSealed, schema, sealSecrets, type Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import { validateSetup } from './integrations.js';

/** How long a read may take. */
const READ_TIMEOUT_MS = 10_000;

/** How long an install or an update may take: every archive downloaded and started. */
const INSTALL_TIMEOUT_MS = 900_000;

/** How long starting, stopping or removing may take: a process is given twelve seconds to stop. */
const CONTROL_TIMEOUT_MS = 60_000;

/** How long a package's method may take. */
const RPC_TIMEOUT_MS = 30_000;

/** How long what is known of a package's folder is trusted, for the files it serves. */
const FOLDER_TRUST_MS = 10_000;

/** What reaching the packet-manager needs. */
export type PackagesContext = {
  readonly bus: BusClient | undefined;
  readonly db: Database;
  readonly traceId: string;
  readonly logger: PlatformLogger;
  readonly secretsKey: Buffer;
};

/**
 * The bus, or a refusal.
 *
 * @param context - The request's collaborators.
 * @returns The bus.
 * @throws {DeviceUnavailableError} When there is none.
 */
function busOf(context: PackagesContext): BusClient {
  if (context.bus === undefined) {
    throw new DeviceUnavailableError('The packet-manager cannot be reached');
  }

  return context.bus;
}

/**
 * Asks the packet-manager.
 *
 * @param context - The request's collaborators.
 * @param method - The method.
 * @param payload - What it is handed.
 * @param reply - What the reply must be.
 * @param timeoutMs - How long it may take.
 * @returns The reply.
 */
async function ask<TReply>(
  context: PackagesContext,
  method: (typeof PACKET_MANAGER_METHODS)[keyof typeof PACKET_MANAGER_METHODS],
  payload: unknown,
  reply: Parameters<BusClient['request']>[2] & { parse: (value: unknown) => TReply },
  timeoutMs = READ_TIMEOUT_MS,
): Promise<TReply> {
  return busOf(context).request(
    busSubjects.service(PACKET_MANAGER_SERVICE, method),
    payload,
    reply,
    { traceId: context.traceId, timeoutMs },
  ) as Promise<TReply>;
}

/**
 * How many devices and entities each package owns.
 *
 * @param db - The database.
 * @returns The counts, by package.
 */
async function countsByPackage(
  db: Database,
): Promise<Map<string, { deviceCount: number; entityCount: number }>> {
  const [devices, entities] = await Promise.all([
    db
      .select({ packageId: schema.registry.devices.packageId, count: sql<number>`count(*)::int` })
      .from(schema.registry.devices)
      .groupBy(schema.registry.devices.packageId),
    db
      .select({ packageId: schema.registry.entities.packageId, count: sql<number>`count(*)::int` })
      .from(schema.registry.entities)
      .groupBy(schema.registry.entities.packageId),
  ]);
  const counts = new Map<string, { deviceCount: number; entityCount: number }>();

  for (const row of devices) {
    if (row.packageId !== null) {
      counts.set(row.packageId, { deviceCount: row.count, entityCount: 0 });
    }
  }

  for (const row of entities) {
    if (row.packageId !== null) {
      const known = counts.get(row.packageId) ?? { deviceCount: 0, entityCount: 0 };

      counts.set(row.packageId, { ...known, entityCount: row.count });
    }
  }

  return counts;
}

/**
 * A package with its counts.
 *
 * @param item - The package.
 * @param counts - Every package's counts.
 * @returns It, counted.
 */
function counted<T extends InstalledPackage>(
  item: T,
  counts: Map<string, { deviceCount: number; entityCount: number }>,
): T & { deviceCount: number; entityCount: number } {
  return { ...item, ...(counts.get(item.id) ?? { deviceCount: 0, entityCount: 0 }) };
}

/**
 * Every installed package.
 *
 * @param context - The request's collaborators.
 * @returns The packages.
 */
export async function listPackages(context: PackagesContext): Promise<ApiPackage[]> {
  const [reply, counts] = await Promise.all([
    ask(context, PACKET_MANAGER_METHODS.list, {}, packageListReplySchema),
    countsByPackage(context.db),
  ]);

  return reply.items.map((item) => counted(item, counts));
}

/**
 * One installed package, as the packet-manager has it.
 *
 * @param context - The request's collaborators.
 * @param packageId - The package.
 * @returns It, with where its files are.
 */
async function detailOf(context: PackagesContext, packageId: string): Promise<PackageDetail> {
  return ask(context, PACKET_MANAGER_METHODS.get, { packageId }, packageDetailSchema);
}

/**
 * One installed package, for its page.
 *
 * @param context - The request's collaborators.
 * @param packageId - The package.
 * @returns It.
 */
export async function readPackage(
  context: PackagesContext,
  packageId: string,
): Promise<ApiPackageDetail> {
  const [detail, counts] = await Promise.all([
    detailOf(context, packageId),
    countsByPackage(context.db),
  ]);
  // Where its files are is the machine's business, not the browser's; and a secret it saved is
  // only said to be there.
  return apiPackageDetailSchema.parse({
    ...counted(detail, counts),
    config: maskSealed(detail.config),
  });
}

/**
 * What the index offers.
 *
 * @param context - The request's collaborators.
 * @returns The packages, and whether the index could be read.
 */
export async function availablePackages(context: PackagesContext): Promise<PackageAvailableReply> {
  return ask(context, PACKET_MANAGER_METHODS.available, {}, packageAvailableReplySchema, 30_000);
}

/**
 * Searches the Community Hub's packages - and the local folder's - each with what installing it
 * here would take. The packet-manager asks the Hub: the browser could not, the Hub's CORS being
 * for its own sites.
 *
 * @param context - The request's collaborators.
 * @param request - What to look for, and from which page on.
 * @returns What was found, and why the Hub could not be asked, when it could not.
 */
export async function searchCatalogue(
  context: PackagesContext,
  request: PackageSearchRequest,
): Promise<PackageSearchReply> {
  return ask(context, PACKET_MANAGER_METHODS.search, request, packageSearchReplySchema, 30_000);
}

/**
 * A logo of the Hub's, relayed by the packet-manager: the interface loads images from its own
 * origin only.
 *
 * @param context - The request's collaborators.
 * @param sha256 - The logo's digest, as a search handed it out.
 * @returns Its bytes and type.
 * @throws {NotFoundError} When no search showed it, or the Hub has it no more.
 */
export async function readHubLogo(context: PackagesContext, sha256: string): Promise<PackageFile> {
  const logo = await ask(
    context,
    PACKET_MANAGER_METHODS.hubLogo,
    { sha256 },
    packageHubLogoReplySchema,
    15_000,
  );

  return { bytes: Buffer.from(logo.data, 'base64'), contentType: logo.contentType };
}

/**
 * What installing a package would take.
 *
 * @param context - The request's collaborators.
 * @param packageId - The package.
 * @param version - A release, or the newest.
 * @returns The plan.
 */
export async function planPackage(
  context: PackagesContext,
  packageId: string,
  version: string | undefined,
): Promise<PackagePlanReply> {
  return ask(
    context,
    PACKET_MANAGER_METHODS.plan,
    { packageId, ...(version === undefined ? {} : { version }) },
    packagePlanReplySchema,
    30_000,
  );
}

/**
 * Installs a package and what it needs.
 *
 * @param context - The request's collaborators.
 * @param packageId - The package.
 * @param version - A release, or the newest.
 * @returns What was installed.
 */
export async function installPackage(
  context: PackagesContext,
  packageId: string,
  version: string | undefined,
): Promise<InstalledPackage[]> {
  const reply = await ask(
    context,
    PACKET_MANAGER_METHODS.install,
    { packageId, ...(version === undefined ? {} : { version }) },
    packageInstallReplySchema,
    INSTALL_TIMEOUT_MS,
  );

  return reply.installed;
}

/**
 * Updates a package.
 *
 * @param context - The request's collaborators.
 * @param packageId - The package.
 * @returns It.
 */
export async function updatePackage(
  context: PackagesContext,
  packageId: string,
): Promise<InstalledPackage> {
  return (
    await ask(
      context,
      PACKET_MANAGER_METHODS.update,
      { packageId },
      packageReplySchema,
      INSTALL_TIMEOUT_MS,
    )
  ).package;
}

/**
 * Removes a package.
 *
 * @param context - The request's collaborators.
 * @param packageId - The package.
 * @param isDataRemoved - Whether its data goes too.
 * @returns Once gone.
 */
export async function removePackage(
  context: PackagesContext,
  packageId: string,
  isDataRemoved: boolean,
): Promise<void> {
  await ask(
    context,
    PACKET_MANAGER_METHODS.remove,
    { packageId, isDataRemoved },
    jsonObjectSchema,
    CONTROL_TIMEOUT_MS,
  );
}

/**
 * Starts, stops or restarts a package.
 *
 * @param context - The request's collaborators.
 * @param packageId - The package.
 * @param action - Which.
 * @returns It, as it now stands.
 */
export async function controlPackage(
  context: PackagesContext,
  packageId: string,
  action: 'start' | 'stop' | 'restart',
): Promise<InstalledPackage> {
  return (
    await ask(
      context,
      PACKET_MANAGER_METHODS[action],
      { packageId },
      packageReplySchema,
      CONTROL_TIMEOUT_MS,
    )
  ).package;
}

/**
 * The keys a setup group declares, fields and constants.
 *
 * @param group - The group.
 * @param group.fields - Its fields.
 * @param group.constants - Its constants.
 * @returns The keys.
 */
function keysOf(group: { fields: readonly { key: string }[]; constants: JsonObject }): Set<string> {
  return new Set([...group.fields.map((field) => field.key), ...Object.keys(group.constants)]);
}

/**
 * The values of a flat document that belong to a group.
 *
 * @param values - The document.
 * @param keys - The group's keys.
 * @returns Those values.
 */
function pick(values: JsonObject, keys: Set<string>): JsonObject {
  return Object.fromEntries(Object.entries(values).filter(([key]) => keys.has(key)));
}

/**
 * Saves what the owner configured: checked against the package's setup, merged over what is
 * saved - a secret left out keeps its seal - with the secrets sealed before they leave `api`.
 *
 * @param context - The request's collaborators.
 * @param packageId - The package.
 * @param body - What the form collected.
 * @returns The package, as it now stands.
 * @throws {NotFoundError} When the package asks nothing to be configured.
 */
export async function configurePackage(
  context: PackagesContext,
  packageId: string,
  body: PackageConfigBody,
): Promise<InstalledPackage> {
  const detail = await detailOf(context, packageId);
  const { setup } = detail;

  if (setup === null) {
    throw new NotFoundError(`${detail.name} has nothing to configure`, { details: { packageId } });
  }

  const current = detail.config;
  const change = validateSetup(
    setup,
    { transportConfig: body.transportConfig ?? {}, options: body.options ?? {} },
    Object.keys(current).length === 0 ? 'complete' : 'partial',
  );
  const transportKeys = keysOf(setup.transport);
  const optionKeys = keysOf(setup.options);
  const values: JsonObject = {
    ...sealSecrets(
      { ...setup.transport.constants, ...pick(current, transportKeys), ...change.transportConfig },
      secretKeysOf(setup.transport),
      context.secretsKey,
    ),
    ...sealSecrets(
      { ...setup.options.constants, ...pick(current, optionKeys), ...change.options },
      secretKeysOf(setup.options),
      context.secretsKey,
    ),
  };

  return (
    await ask(
      context,
      PACKET_MANAGER_METHODS.configure,
      { packageId, values },
      packageReplySchema,
      CONTROL_TIMEOUT_MS,
    )
  ).package;
}

/**
 * A package's log.
 *
 * @param context - The request's collaborators.
 * @param packageId - The package.
 * @param tail - How many lines at most.
 * @param since - Only after this cursor.
 * @returns The lines.
 */
export async function readPackageLogs(
  context: PackagesContext,
  packageId: string,
  tail: number,
  since: string | undefined,
): Promise<ContainerLogsReply> {
  return ask(
    context,
    PACKET_MANAGER_METHODS.logs,
    { packageId, tail, ...(since === undefined ? {} : { since }) },
    packageLogsReplySchema,
  );
}

/**
 * Who may call one of a package's methods: `read` or `configure`, as it registered it.
 *
 * @param context - The request's collaborators.
 * @param packageId - The package.
 * @param method - The method.
 * @returns Its access.
 * @throws {NotFoundError} When the package, running, registered no such method.
 */
export async function rpcAccessOf(
  context: PackagesContext,
  packageId: string,
  method: string,
): Promise<PackageRpcAccess> {
  const detail = await detailOf(context, packageId);
  const found = detail.rpcMethods.find((each) => each.name === method);

  if (found === undefined) {
    throw new NotFoundError(
      detail.state === 'running'
        ? `${detail.name} has no method ${method}`
        : `${detail.name} is not running`,
      { details: { packageId, method, state: detail.state } },
    );
  }

  return found.access;
}

/**
 * Calls one of a package's methods, once who may has been checked.
 *
 * @param context - The request's collaborators.
 * @param packageId - The package.
 * @param method - The method.
 * @param input - What it is handed.
 * @param caller - Who calls: the method is told.
 * @returns What it answered.
 */
export async function callPackage(
  context: PackagesContext,
  packageId: string,
  method: string,
  input: JsonValue,
  caller: PackageRpcCaller,
): Promise<JsonValue> {
  const reply = await busOf(context).request(
    busSubjects.service(packageId, PACKAGE_RPC_METHOD),
    { method, input, caller },
    packageRpcReplySchema,
    { traceId: context.traceId, timeoutMs: RPC_TIMEOUT_MS },
  );

  return reply.output;
}

/** What is known of the folder a package serves its interface from. */
type Folder = {
  /** The build it holds: its version and the archive it was unpacked from. */
  readonly build: string;

  readonly uiDir: string | null;
  readonly logo: string | null;
  readonly untilMs: number;
};

/** The folders, by package, trusted for a few seconds. */
const folders = new Map<string, Folder>();

/**
 * The folder a package serves its interface and its logo from.
 *
 * @param context - The request's collaborators.
 * @param packageId - The package.
 * @param isFresh - Whether to ask again whatever was known: a build not yet seen was asked for.
 * @returns Its build, the folder of its interface's entry, and its logo's file.
 */
async function folderOf(
  context: PackagesContext,
  packageId: string,
  isFresh = false,
): Promise<Folder> {
  const known = folders.get(packageId);

  if (!isFresh && known !== undefined && known.untilMs > Date.now()) {
    return known;
  }

  const detail = await detailOf(context, packageId);
  const manifest = packageManifestSchema.parse(
    JSON.parse(await readFile(path.join(detail.root, 'nebula.package.json'), 'utf8')),
  );
  const folder: Folder = {
    build: detail.build,
    uiDir:
      manifest.ui === undefined ? null : path.dirname(path.resolve(detail.root, manifest.ui.entry)),
    logo: manifest.logo === undefined ? null : path.resolve(detail.root, manifest.logo.path),
    untilMs: Date.now() + FOLDER_TRUST_MS,
  };

  folders.set(packageId, folder);

  return folder;
}

/** The content type of each file a package's interface may serve. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
};

/** One file a package serves: its bytes and what they are. */
export type PackageFile = { readonly bytes: Buffer; readonly contentType: string };

/**
 * One file of a package's interface.
 *
 * @param context - The request's collaborators.
 * @param packageId - The package.
 * @param build - The build the address names: another one, old or not installed, is not served.
 * @param file - The file, under the folder of its interface's entry.
 * @returns Its bytes and type.
 * @throws {NotFoundError} When there is no such file, of this build, of a type it may serve.
 */
export async function readPackageUiFile(
  context: PackagesContext,
  packageId: string,
  build: string,
  file: string,
): Promise<PackageFile> {
  const known = await folderOf(context, packageId);
  // A build just installed is newer than what was known a few seconds ago.
  const folder = known.build === build ? known : await folderOf(context, packageId, true);
  const contentType = CONTENT_TYPES[path.extname(file).toLowerCase()];

  if (folder.uiDir === null || folder.build !== build || contentType === undefined) {
    throw new NotFoundError('No such file', { details: { packageId, build, file } });
  }

  const resolved = path.resolve(folder.uiDir, file);

  if (!resolved.startsWith(folder.uiDir + path.sep)) {
    throw new NotFoundError('No such file', { details: { packageId, file } });
  }

  try {
    return { bytes: await readFile(resolved), contentType };
  } catch {
    throw new NotFoundError('No such file', { details: { packageId, file } });
  }
}

/**
 * A package's logo.
 *
 * @param context - The request's collaborators.
 * @param packageId - The package.
 * @returns Its bytes and type.
 * @throws {NotFoundError} When it has none.
 */
export async function readPackageLogo(
  context: PackagesContext,
  packageId: string,
): Promise<PackageFile> {
  const folder = await folderOf(context, packageId);
  const contentType =
    folder.logo === null ? undefined : CONTENT_TYPES[path.extname(folder.logo).toLowerCase()];

  if (folder.logo === null || contentType === undefined) {
    throw new NotFoundError('The package has no logo', { details: { packageId } });
  }

  try {
    return { bytes: await readFile(folder.logo), contentType };
  } catch {
    throw new NotFoundError('The package has no logo', { details: { packageId } });
  }
}
