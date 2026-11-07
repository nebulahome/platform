/**
 * The subject the API brings an entity's enabled flag and `core`'s view of it in line on.
 *
 * The API writes `registry.entities.is_enabled`; `core` refuses commands to a disabled entity
 * and records none of its states, both from its directory. So after the write the API asks, and
 * `core` reads the row back itself, as it does for an alias.
 */
import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  busSubjects,
  CORE_SERVICE,
  CORE_SYNC_ENTITY_METHOD,
  syncEntityRequestSchema,
  type SyncEntityReply,
  type SyncEntityRequest,
} from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import type { EntityDirectory } from '../domain/entity-directory.js';
import { loadEntityRecord } from '../persistence/registry-loader.js';

/** What the entity service needs. */
export type EntityServiceOptions = {
  readonly client: BusClient;
  readonly db: Database;
  readonly directory: EntityDirectory;
  readonly logger: PlatformLogger;
};

/**
 * Reads again whether an entity is enabled, keeping everything else the directory holds for it.
 *
 * @param options - The database and the directory.
 * @param entityId - The entity.
 * @returns Whether the directory had it.
 */
export async function syncEntityEnabled(
  options: Pick<EntityServiceOptions, 'db' | 'directory'>,
  entityId: SyncEntityRequest['entityId'],
): Promise<boolean> {
  const held = options.directory.get(entityId);
  const stored = held === undefined ? undefined : await loadEntityRecord(options.db, entityId);

  if (held === undefined || stored === undefined) {
    return false;
  }

  // Only the flag: the links and limits the directory holds are not on the row.
  options.directory.set({ ...held, isEnabled: stored.isEnabled });

  return true;
}

/**
 * Serves the subject the API syncs an entity's enabled flag on.
 *
 * @param options - See {@link EntityServiceOptions}.
 * @returns The subscription, to unsubscribe on shutdown.
 */
export function startEntityService(options: EntityServiceOptions): BusSubscription {
  return options.client.serve(
    busSubjects.service(CORE_SERVICE, CORE_SYNC_ENTITY_METHOD),
    syncEntityRequestSchema,

    /**
     * Takes in an entity the API has just enabled or disabled.
     *
     * @param request - Which entity.
     * @returns Whether it was registered.
     */
    async (request: SyncEntityRequest): Promise<SyncEntityReply> => {
      const isLoaded = await syncEntityEnabled(options, request.entityId);

      options.logger.info({ entityId: request.entityId, isLoaded }, 'Synced an entity');

      return { isLoaded };
    },
  );
}
