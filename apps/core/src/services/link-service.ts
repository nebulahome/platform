/**
 * The subjects the API brings `core` in line on after it made, undid or changed a link, and the
 * one an entity's page reads its sources on.
 *
 * The API writes the rows - which entity reads through which, which way each prefers - and `core`
 * holds what it routes, records and aliases by. Every link is read again at once rather than the
 * ones named: a house has few, and the directory is then right whole.
 */
import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  busSubjects,
  CORE_LINK_SOURCES_METHOD,
  CORE_SERVICE,
  CORE_SYNC_LINKS_METHOD,
  linkSourcesRequestSchema,
  syncLinksRequestSchema,
  type LinkSourcesReply,
} from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import type { EntityDirectory } from '../domain/entity-directory.js';
import { applyLinks, loadLinks } from '../persistence/registry-loader.js';

import type { LinkEngine } from './link-engine.js';

/** What the link service needs. */
export type LinkServiceOptions = {
  readonly client: BusClient;
  readonly db: Database;
  readonly directory: EntityDirectory;
  readonly engine: LinkEngine;
  readonly logger: PlatformLogger;
};

/**
 * Reads every link again and brings the directory and the registry in line.
 *
 * @param options - The database, the directory and the engine.
 * @returns How many entities' links changed.
 */
export async function syncLinks(
  options: Pick<LinkServiceOptions, 'db' | 'directory' | 'engine'>,
): Promise<number> {
  const before = applyLinks(options.directory, await loadLinks(options.db));

  options.engine.resync(before);

  return before.length;
}

/**
 * Serves the link subjects.
 *
 * @param options - See {@link LinkServiceOptions}.
 * @returns The subscriptions.
 */
export function startLinkService(options: LinkServiceOptions): BusSubscription[] {
  return [
    options.client.serve(
      busSubjects.service(CORE_SERVICE, CORE_SYNC_LINKS_METHOD),
      syncLinksRequestSchema,

      /**
       * Takes in what the API changed.
       *
       * @returns How many entities' links changed.
       */
      async () => {
        const synced = await syncLinks(options);

        options.logger.info({ synced }, 'Took in the links the API changed');

        return { synced };
      },
    ),
    options.client.serve(
      busSubjects.service(CORE_SERVICE, CORE_LINK_SOURCES_METHOD),
      linkSourcesRequestSchema,

      /**
       * Says what each source last said.
       *
       * @param request - The entity.
       * @returns Its sources.
       */
      (request): Promise<LinkSourcesReply> =>
        Promise.resolve({
          items: options.engine.sourcesOf(request.entityId).map((source) => ({
            entityId: source.entityId,
            source: source.source,
            isActive: source.isActive,
            state: source.state ?? null,
          })),
        }),
    ),
  ];
}
