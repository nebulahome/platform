/**
 * The packages: what is installed and what the index offers, installing, updating, removing,
 * starting and stopping them, their settings and their log, the files their interface is made of,
 * and the methods their pages call (PACKAGES.md, API.md).
 *
 * Three permissions: `package:read` to see them and use their pages, `package:install` to change
 * what is installed, `package:configure` to start, stop and configure them. A package's method is
 * called with the permission its access asks - `read` or `configure` - as the package registered
 * it. What a refusal says - a system package, one something needs, one that cannot be installed -
 * is the packet-manager's, reaching the caller as the `409` it sent.
 *
 * The files of a package's interface are public, as the interface's own are: they are code, not
 * the house's data, and a module is imported by the browser with no way to add a token. The
 * address names the release, so a file is cached for good and an update is a new address.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  apiPackageDetailSchema,
  apiPackageSchema,
  containerLogsQuerySchema,
  containerLogsReplySchema,
  installedPackageSchema,
  isNebulaError,
  packageAvailableReplySchema,
  packageConfigBodySchema,
  packageIdSchema,
  packageInstallBodySchema,
  packagePlanReplySchema,
  packageRpcBodySchema,
  packageRpcReplySchema,
  type ApiPackageDetail,
  type ContainerLogsReply,
  type InstalledPackage,
  type PackageAvailableReply,
  type PackagePlanReply,
  type PackageRpcReply,
} from '@nebulahome/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { collectionSchema } from '../http/collection.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import {
  availablePackages,
  callPackage,
  configurePackage,
  controlPackage,
  installPackage,
  listPackages,
  planPackage,
  readPackage,
  readPackageLogo,
  readPackageLogs,
  readPackageUiFile,
  removePackage,
  rpcAccessOf,
  updatePackage,
  type PackageFile,
  type PackagesContext,
} from '../services/packages.js';

/** The path parameters of one package. */
const packageParamsSchema = z.object({ packageId: packageIdSchema });

/** The path parameters of one of its methods. */
const rpcParamsSchema = z.object({
  packageId: packageIdSchema,
  method: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,63}$/),
});

/** `DELETE /packages/:id`: whether its data goes too. */
const removeQuerySchema = z.object({ data: z.stringbool().default(false) });

/** One package, after something was done to it. */
const packageReplySchema = z.object({ package: installedPackageSchema });

/** What an install did. */
const installReplySchema = z.object({ installed: z.array(installedPackageSchema) });

/** The actions that start and stop a package. */
const ACTIONS = ['start', 'stop', 'restart'] as const;

/**
 * What asking the packet-manager needs, for one request.
 *
 * @param context - The service's collaborators.
 * @param traceId - The request's trace id.
 * @returns The context.
 */
function packagesContext(context: ApiContext, traceId: string): PackagesContext {
  return {
    bus: context.bus,
    db: context.db,
    traceId,
    logger: context.logger,
    secretsKey: context.secretsKey,
  };
}

/**
 * Records an action in the audit log, refused or not.
 *
 * @param context - The service's collaborators.
 * @param route - Who asked, and from where.
 * @param route.identity - Who.
 * @param route.request - The request.
 * @param route.request.ip - From where.
 * @param route.request.traceId - Its trace.
 * @param action - What: `install`, `remove`.
 * @param packageId - Which package.
 * @param work - The action.
 * @returns What the action gave.
 */
async function audited<TResult>(
  context: ApiContext,
  route: {
    readonly identity: Parameters<ApiContext['audit']['record']>[0]['identity'];
    readonly request: { readonly ip: string; readonly traceId: string };
  },
  action: string,
  packageId: string,
  work: () => Promise<TResult>,
): Promise<TResult> {
  /**
   * Writes the entry.
   *
   * @param result - How it went.
   */
  const record = async (result: 'success' | 'failure' | 'denied'): Promise<void> => {
    await context.audit.record({
      action: `package.${action}`,
      resourceType: 'package',
      resourceId: packageId,
      result,
      identity: route.identity,
      ipAddress: route.request.ip,
      traceId: route.request.traceId,
    });
  };

  try {
    const result = await work();

    await record('success');

    return result;
  } catch (error: unknown) {
    await record(isNebulaError(error) && error.code === 'CONFLICT' ? 'denied' : 'failure');

    throw error;
  }
}

/**
 * Sends one of a package's files.
 *
 * @param reply - Where it goes.
 * @param file - Its bytes and type.
 * @param cacheControl - How long it may be kept.
 * @returns The bytes.
 */
function sendFile(reply: FastifyReply, file: PackageFile, cacheControl: string): Buffer {
  void reply
    .type(file.contentType)
    .header('cache-control', cacheControl)
    .header('x-content-type-options', 'nosniff');

  return file.bytes;
}

/**
 * Registers the files a package's interface is made of, and its logo: public, as the interface's
 * own files are.
 *
 * @param server - The server.
 * @param context - The service's collaborators.
 * @param basePath - The versioned prefix.
 */
export function registerPackageFileRoutes(
  server: FastifyInstance,
  context: ApiContext,
  basePath: string,
): void {
  const fileParamsSchema = z.object({
    packageId: packageIdSchema,

    /** Its build, `<version>+<digest>`: a new one is another address, never a stale cache. */
    build: z.string().regex(/^[0-9A-Za-z.+-]{1,96}$/),
    '*': z.string().min(1).max(512),
  });

  server.get(
    `${basePath}/packages/:packageId/ui/:build/*`,

    /**
     * Serves one file of a package's interface.
     *
     * @param request - Which package, which build, which file.
     * @param reply - Where it goes.
     * @returns The file.
     */
    async (request: FastifyRequest, reply: FastifyReply): Promise<Buffer> => {
      const params = fileParamsSchema.parse(request.params);
      const file = await readPackageUiFile(
        packagesContext(context, request.traceId),
        params.packageId,
        params.build,
        params['*'],
      );

      return sendFile(reply, file, 'public, max-age=31536000, immutable');
    },
  );

  server.get(
    `${basePath}/packages/:packageId/logo`,

    /**
     * Serves a package's logo.
     *
     * @param request - Which package.
     * @param reply - Where it goes.
     * @returns The logo.
     */
    async (request: FastifyRequest, reply: FastifyReply): Promise<Buffer> => {
      const { packageId } = packageParamsSchema.parse(request.params);
      const file = await readPackageLogo(packagesContext(context, request.traceId), packageId);

      return sendFile(reply, file, 'public, max-age=3600');
    },
  );
}

/**
 * Registers the package routes.
 *
 * @param environment - Where routes are defined.
 * @param context - The service's collaborators.
 */
export function registerPackageRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/packages',
      summary: 'List the installed packages',
      tag: 'Packages',
      permission: 'package:read',
      response: collectionSchema(apiPackageSchema),
    },

    /**
     * Lists the installed packages.
     *
     * @param route - Who is asking.
     * @returns Every package, with how much of the house it accounts for.
     */
    async (route) => {
      requirePermission(route.identity, 'package:read');

      return { items: await listPackages(packagesContext(context, route.request.traceId)) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/packages/available',
      summary: 'What the package index offers, and what fits this platform',
      tag: 'Packages',
      permission: 'package:read',
      response: packageAvailableReplySchema,
    },

    /**
     * Lists what the index offers.
     *
     * @param route - Who is asking.
     * @returns The packages, and whether the index could be read.
     */
    async (route): Promise<PackageAvailableReply> => {
      requirePermission(route.identity, 'package:read');

      return availablePackages(packagesContext(context, route.request.traceId));
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/packages/:packageId',
      summary: 'Read one installed package',
      tag: 'Packages',
      permission: 'package:read',
      params: packageParamsSchema,
      response: apiPackageDetailSchema,
    },

    /**
     * Reads one package.
     *
     * @param route - Who is asking, and which package.
     * @returns The package, its setup and its settings with their secrets masked.
     */
    async (route): Promise<ApiPackageDetail> => {
      requirePermission(route.identity, 'package:read');

      return readPackage(packagesContext(context, route.request.traceId), route.params.packageId);
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/packages/:packageId/plan',
      summary: 'What installing a package would take',
      tag: 'Packages',
      permission: 'package:install',
      successStatus: 200,
      params: packageParamsSchema,
      body: packageInstallBodySchema,
      response: packagePlanReplySchema,
    },

    /**
     * Plans an install.
     *
     * @param route - Who is asking, which package, which release.
     * @returns What would be installed, or why it cannot be.
     */
    async (route): Promise<PackagePlanReply> => {
      requirePermission(route.identity, 'package:install');

      return planPackage(
        packagesContext(context, route.request.traceId),
        route.params.packageId,
        route.body.version,
      );
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/packages/:packageId/install',
      summary: 'Install a package and what it needs',
      tag: 'Packages',
      permission: 'package:install',
      successStatus: 200,
      params: packageParamsSchema,
      body: packageInstallBodySchema,
      response: installReplySchema,
    },

    /**
     * Installs a package.
     *
     * @param route - Who is asking, which package, which release.
     * @returns What was installed.
     */
    async (route): Promise<{ installed: InstalledPackage[] }> => {
      requirePermission(route.identity, 'package:install');

      return {
        installed: await audited(context, route, 'install', route.params.packageId, async () =>
          installPackage(
            packagesContext(context, route.request.traceId),
            route.params.packageId,
            route.body.version,
          ),
        ),
      };
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/packages/:packageId/update',
      summary: 'Update a package to the newest release that fits',
      tag: 'Packages',
      permission: 'package:install',
      successStatus: 200,
      params: packageParamsSchema,
      response: packageReplySchema,
    },

    /**
     * Updates a package.
     *
     * @param route - Who is asking, and which package.
     * @returns It, as it now stands.
     */
    async (route): Promise<{ package: InstalledPackage }> => {
      requirePermission(route.identity, 'package:install');

      return {
        package: await audited(context, route, 'update', route.params.packageId, async () =>
          updatePackage(packagesContext(context, route.request.traceId), route.params.packageId),
        ),
      };
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/packages/:packageId',
      summary: 'Remove a package, and its data when asked',
      tag: 'Packages',
      permission: 'package:install',
      successStatus: 204,
      params: packageParamsSchema,
      query: removeQuerySchema,
    },

    /**
     * Removes a package.
     *
     * @param route - Who is asking, which package, and whether its data goes.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'package:install');

      await audited(context, route, 'remove', route.params.packageId, async () =>
        removePackage(
          packagesContext(context, route.request.traceId),
          route.params.packageId,
          route.query.data,
        ),
      );
    },
  );

  for (const action of ACTIONS) {
    defineRoute(
      environment,
      {
        method: 'POST',
        url: `/packages/:packageId/${action}`,
        summary: `${action.charAt(0).toUpperCase()}${action.slice(1)} a package`,
        tag: 'Packages',
        permission: 'package:configure',
        successStatus: 200,
        params: packageParamsSchema,
        response: packageReplySchema,
      },

      /**
       * Starts, stops or restarts a package.
       *
       * @param route - Who is asking, and which package.
       * @returns It, as it now stands.
       */
      async (route): Promise<{ package: InstalledPackage }> => {
        requirePermission(route.identity, 'package:configure');

        return {
          package: await audited(context, route, action, route.params.packageId, async () =>
            controlPackage(
              packagesContext(context, route.request.traceId),
              route.params.packageId,
              action,
            ),
          ),
        };
      },
    );
  }

  defineRoute(
    environment,
    {
      method: 'PUT',
      url: '/packages/:packageId/config',
      summary: "Save a package's settings, and start it again with them",
      tag: 'Packages',
      permission: 'package:configure',
      params: packageParamsSchema,
      body: packageConfigBodySchema,
      response: packageReplySchema,
    },

    /**
     * Saves a package's settings.
     *
     * @param route - Who is asking, which package, and what the form collected.
     * @returns It, as it now stands.
     */
    async (route): Promise<{ package: InstalledPackage }> => {
      requirePermission(route.identity, 'package:configure');

      return {
        package: await audited(context, route, 'configure', route.params.packageId, async () =>
          configurePackage(
            packagesContext(context, route.request.traceId),
            route.params.packageId,
            route.body,
          ),
        ),
      };
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/packages/:packageId/logs',
      summary: "Read the last lines a package's process wrote",
      tag: 'Packages',
      permission: 'package:read',
      params: packageParamsSchema,
      query: containerLogsQuerySchema,
      response: containerLogsReplySchema,
    },

    /**
     * Reads a package's log.
     *
     * @param route - Who is asking, which package, how many lines and after which cursor.
     * @returns The lines.
     */
    async (route): Promise<ContainerLogsReply> => {
      requirePermission(route.identity, 'package:read');

      return readPackageLogs(
        packagesContext(context, route.request.traceId),
        route.params.packageId,
        route.query.tail,
        route.query.since,
      );
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/packages/:packageId/rpc/:method',
      summary: "Call one of a package's methods, for its page or its cards",
      tag: 'Packages',
      permission: 'package:read',
      successStatus: 200,
      params: rpcParamsSchema,
      body: packageRpcBodySchema,
      response: packageRpcReplySchema,
    },

    /**
     * Calls a package's method, with the permission its access asks.
     *
     * @param route - Who is asking, which package, which method, with what.
     * @returns What it answered.
     */
    async (route): Promise<PackageRpcReply> => {
      const packages = packagesContext(context, route.request.traceId);
      const access = await rpcAccessOf(packages, route.params.packageId, route.params.method);

      requirePermission(
        route.identity,
        access === 'configure' ? 'package:configure' : 'package:read',
      );

      return {
        output: await callPackage(
          packages,
          route.params.packageId,
          route.params.method,
          route.body.input,
          {
            userId: route.identity.userId,
            username: route.identity.username,
            role: route.identity.role,
          },
        ),
      };
    },
  );
}
