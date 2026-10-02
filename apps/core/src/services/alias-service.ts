/**
 * The subjects the API brings an alias's rows and `core`'s view of them in line on.
 *
 * The same split a device has: the API writes what the owner configured, `core` holds what it
 * routes and recomputes by, and the API asks rather than hoping a restart will come. Taking an
 * alias in is a request after the write; taking one out is the write itself, done here, for the
 * reason a device's release is done here (see `services/alias-engine.ts`).
 */
import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  busSubjects,
  CORE_REMOVE_ALIAS_METHOD,
  CORE_SERVICE,
  CORE_SYNC_ALIAS_METHOD,
  removeAliasRequestSchema,
  syncAliasRequestSchema,
  type RemoveAliasReply,
  type RemoveAliasRequest,
  type SyncAliasReply,
  type SyncAliasRequest,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

import type { AliasEngine } from './alias-engine.js';

/** What the alias service needs. */
export type AliasServiceOptions = {
  /** The bus client to serve on. */
  readonly client: BusClient;

  /** The engine that holds the aliases. */
  readonly engine: AliasEngine;

  readonly logger: PlatformLogger;
};

/**
 * Serves the subjects the API syncs and removes aliases on.
 *
 * @param options - The bus client, the engine and the logger.
 * @returns The subscriptions, to unsubscribe on shutdown.
 */
export function startAliasService(options: AliasServiceOptions): BusSubscription[] {
  return [
    options.client.serve(
      busSubjects.service(CORE_SERVICE, CORE_SYNC_ALIAS_METHOD),
      syncAliasRequestSchema,

      /**
       * Takes in one alias the API has just written or changed.
       *
       * @param request - Which alias.
       * @returns Whether its rows were there to take in.
       */
      async (request: SyncAliasRequest): Promise<SyncAliasReply> => {
        const isLoaded = await options.engine.sync(request.entityId);

        options.logger.info({ entityId: request.entityId, isLoaded }, 'Synced an alias');

        return { isLoaded };
      },
    ),
    options.client.serve(
      busSubjects.service(CORE_SERVICE, CORE_REMOVE_ALIAS_METHOD),
      removeAliasRequestSchema,

      /**
       * Deletes one alias and forgets it.
       *
       * @param request - Which alias.
       * @returns What was deleted.
       */
      async (request: RemoveAliasRequest): Promise<RemoveAliasReply> => {
        await options.engine.remove(request.entityId);

        options.logger.info({ entityId: request.entityId }, 'Removed an alias');

        return { entityId: request.entityId };
      },
    ),
  ];
}
