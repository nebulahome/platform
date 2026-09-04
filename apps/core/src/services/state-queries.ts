/**
 * Answering "what is the state of the house?".
 *
 * Two request/reply subjects, and the reason there are exactly two. Everything that needs the
 * registry asks for a **snapshot** once at startup and then keeps itself current from the
 * `state_changed` event stream; the per-entity read exists for the cases where a caller wants
 * one value and has no reason to hold a copy of the rest (ARCHITECTURE.md 4.1).
 *
 * That pairing is what lets every event on the bus be fire-and-forget: a subscriber that missed
 * events while it was restarting does not replay a durable log, it asks for a snapshot.
 */
import type { BusClient, BusSubscription, MessageContext } from '@nebula-home/bus';
import {
  busSubjects,
  BUS_SUBJECT_PREFIX,
  isEntityId,
  NotFoundError,
  stateGetRequestSchema,
  stateSnapshotRequestSchema,
  ValidationError,
  type EntityId,
  type EntityState,
  type StateSnapshotReply,
} from '@nebula-home/contracts';

import type { EntityRegistry } from '../domain/entity-registry.js';

/** The wildcard `core` receives every single-entity read on. */
const STATE_GET_PATTERN = `${BUS_SUBJECT_PREFIX}.state.get.>`;

/** What the query handlers need. */
export type StateQueryOptions = {
  /** The bus client to serve on. */
  readonly client: BusClient;

  /** The registry being read. */
  readonly registry: EntityRegistry;

  /** The clock, so the snapshot can say when it was taken. */
  readonly now?: () => Date;
};

/**
 * Reads the entity a `state.get` subject addresses.
 *
 * @param subject - The subject the request arrived on.
 * @returns The entity identifier.
 * @throws {ValidationError} When the subject does not name a valid entity. The subscription is a
 * wildcard, so the subject is the only thing that says what was asked for, and a subject that
 * cannot be read is a request that cannot be answered.
 */
function entityIdFromGetSubject(subject: string): EntityId {
  const prefix = `${BUS_SUBJECT_PREFIX}.state.get.`;

  const entityId = subject.startsWith(prefix) ? subject.slice(prefix.length) : '';

  if (!isEntityId(entityId)) {
    throw new ValidationError(`Subject ${subject} does not name an entity`, {
      details: { subject },
    });
  }

  return entityId;
}

/**
 * Serves the full registry snapshot.
 *
 * @param options - The bus client, the registry and the clock.
 * @returns The subscription, to unsubscribe on shutdown.
 */
export function startSnapshotService(options: StateQueryOptions): BusSubscription {
  const now = options.now ?? ((): Date => new Date());

  return options.client.serve(
    busSubjects.stateSnapshot(),
    stateSnapshotRequestSchema,

    /**
     * Answers with everything the registry holds.
     *
     * @returns The snapshot.
     */
    (): StateSnapshotReply => ({ entities: options.registry.snapshot(), takenAt: now() }),
  );
}

/**
 * Serves per-entity reads.
 *
 * @param options - The bus client and the registry.
 * @returns The subscription, to unsubscribe on shutdown.
 */
export function startEntityReadService(options: StateQueryOptions): BusSubscription {
  return options.client.serve(
    STATE_GET_PATTERN,
    stateGetRequestSchema,

    /**
     * Answers with one entity's state.
     *
     * @param request - Ignored; the entity is named by the subject.
     * @param context - The subject the request arrived on.
     * @returns The entity's current state.
     * @throws {NotFoundError} When nothing has ever reported that entity. Distinct from an
     * entity that exists and is unavailable, which answers normally with `isAvailable: false`.
     */
    (request, context: MessageContext): EntityState => {
      const entityId = entityIdFromGetSubject(context.subject);
      const state = options.registry.get(entityId);

      if (state === undefined) {
        throw new NotFoundError(`No state for ${entityId}`, { details: { entityId } });
      }

      return state;
    },
  );
}
