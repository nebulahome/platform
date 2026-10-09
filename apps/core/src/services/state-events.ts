/**
 * Telling everyone an entity changed: the `state_changed` event on the bus, and the engines in
 * this process that react to changes.
 *
 * One place, because there is more than one way for a state to change in `core`: a report
 * through the ingest pipeline, and an entity marked unreachable when its adapter goes quiet, its
 * package is removed or its container disappears. An automation waiting for a door to become
 * unavailable has to hear the second kind as surely as the first.
 */
import type { BusClient } from '@nebulahome/bus';
import { busSubjects } from '@nebulahome/contracts';

import type { IngestResult } from '../domain/entity-registry.js';

/** Something in this process that reacts to a change. It must not block, and must not throw. */
export type ChangeObserver = (result: IngestResult) => void;

/**
 * Publishes a change and hands it to the observer.
 *
 * @param client - The bus client.
 * @param result - What changed.
 * @param traceId - The unit of work it belongs to, when there is one.
 * @param observe - What in this process reacts to it.
 */
export function announceChange(
  client: BusClient,
  result: IngestResult,
  traceId: string | undefined,
  observe: ChangeObserver | undefined,
): void {
  client.publish(
    busSubjects.stateChanged(result.entityId),
    { entityId: result.entityId, current: result.current, previous: result.previous },
    traceId === undefined ? undefined : { traceId },
  );

  observe?.(result);
}
