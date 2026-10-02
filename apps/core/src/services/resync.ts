/**
 * Asking every adapter to say what it currently owns.
 *
 * The database holds the last state `core` managed to persist; the adapters hold the truth. On
 * startup the two can differ by however long the process was down, so `core` rebuilds from the
 * database to have something to show immediately, and then asks every adapter to resend
 * (ARCHITECTURE.md 4.1).
 *
 * An adapter that does not answer is not an error to abort on. It is a package that is not
 * running, and the honest thing to do is mark its entities unreachable so the interface greys
 * them out instead of showing values nobody has confirmed since the restart.
 */
import type { BusClient } from '@nebulahome/bus';
import {
  busSubjects,
  resyncReplySchema,
  type ResyncRequest,
  type SourceRef,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

import type { EntityDirectory } from '../domain/entity-directory.js';
import type { EntityRegistry } from '../domain/entity-registry.js';

/** What a resynchronisation pass needs. */
export type ResyncOptions = {
  /** The bus client to send the requests on. */
  readonly client: BusClient;

  /** Configured entities, which name the adapters worth asking. */
  readonly directory: EntityDirectory;

  /** The registry, so unreachable adapters' entities can be marked as such. */
  readonly registry: EntityRegistry;

  /** Where the outcome is reported. */
  readonly logger: PlatformLogger;

  /** How long an adapter has to accept the request. */
  readonly timeoutMs: number;

  /** Why the pass is happening, passed through for the adapter's own logs. */
  readonly reason: ResyncRequest['reason'];
};

/** What one pass achieved. */
export type ResyncOutcome = {
  /** Adapters that accepted the request. */
  readonly answered: readonly string[];

  /** Adapters that did not, whose entities were marked unreachable. */
  readonly silent: readonly string[];
};

/**
 * Asks every adapter that owns an entity to republish everything it owns.
 *
 * Requests go out **together** rather than one after another: a house with five adapters, one of
 * which is not running, would otherwise spend the command timeout waiting for it before asking
 * the fourth. `Promise.allSettled` because partial failure is the expected case, not an
 * exception (RULES.md 9).
 *
 * @param options - Bus client, directory, registry, logger, timeout and reason.
 * @returns Which adapters answered and which did not.
 */
export async function requestResync(options: ResyncOptions): Promise<ResyncOutcome> {
  const owners = options.directory.owningPackages();

  if (owners.length === 0) {
    return { answered: [], silent: [] };
  }

  const request: ResyncRequest = { reason: options.reason };

  const results = await Promise.allSettled(
    owners.map(async (packageId) =>
      options.client.request(busSubjects.stateResync(packageId), request, resyncReplySchema, {
        timeoutMs: options.timeoutMs,
      }),
    ),
  );

  const answered: string[] = [];
  const silent: string[] = [];

  for (const [index, result] of results.entries()) {
    const packageId = owners[index];

    if (packageId === undefined) {
      continue;
    }

    if (result.status === 'fulfilled') {
      answered.push(packageId);
      continue;
    }

    silent.push(packageId);
    markUnavailable(options, packageId);
  }

  options.logger.info(
    { reason: options.reason, answered, silent },
    'Asked every adapter to resynchronise',
  );

  return { answered, silent };
}

/**
 * Marks every entity of an unreachable adapter as unavailable, and says so on the bus.
 *
 * @param options - The registry, the bus client and the logger.
 * @param source - The adapter that did not answer.
 */
function markUnavailable(options: ResyncOptions, source: SourceRef): void {
  for (const entityId of options.registry.entitiesOf(source)) {
    const result = options.registry.setAvailability(entityId, false);

    if (result !== undefined) {
      options.client.publish(busSubjects.stateChanged(entityId), {
        entityId,
        current: result.current,
        previous: result.previous,
      });
    }
  }
}
