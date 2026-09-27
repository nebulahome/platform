/**
 * Folding the three columns that say who owns an entity back into the one value everything else
 * uses.
 *
 * `registry.entities.source` records the **kind** of entity - `adapter`, `derived`, `system` or
 * `container` - while the owner of an adapter entity is in either `package_id` or
 * `integration_id`, and the `entities_source_consistency` constraint guarantees exactly one of
 * them is set. Every container entity has one owner, the supervisor, whichever container it
 * belongs to. Everywhere
 * above the database an owner is a single value, because it is the subject token a command is
 * addressed on, so the fold happens once here rather than in every caller.
 */
import {
  SUPERVISOR_SERVICE,
  ValidationError,
  sourceRefSchema,
  type EntityId,
  type SourceRef,
} from '@nebula-home/contracts';

/** The three columns, as the database holds them. */
export type OwnerColumns = {
  /** What `registry.entities.source` holds: `adapter`, `derived`, `system` or `container`. */
  readonly kind: string;

  /** The package that installed it, when a package did. */
  readonly packageId: string | null;

  /** The integration instance that is the device, when one is. */
  readonly integrationId: string | null;
};

/**
 * Works out who owns an entity.
 *
 * @param columns - What the row says.
 * @param entityId - The entity, for the failure message.
 * @returns The owner, as the rest of the platform understands it.
 * @throws {ValidationError} When an adapter entity has no owner or claims two. The database
 * constraint makes both impossible, so reaching either means the schema and this build disagree -
 * and an entity nobody can command, or one two services would both answer for, is worse than a
 * loud failure at startup.
 */
export function resolveOwner(columns: OwnerColumns, entityId: EntityId): SourceRef {
  // A container's entities are reported and commanded by the supervisor, which is one owner for
  // all of them, however many containers there are.
  if (columns.kind === 'container') {
    return SUPERVISOR_SERVICE;
  }

  if (columns.kind !== 'adapter') {
    return sourceRefSchema.parse(columns.kind);
  }

  const owner = columns.packageId ?? columns.integrationId;

  if (owner === null || (columns.packageId !== null && columns.integrationId !== null)) {
    throw new ValidationError(`Entity ${entityId} is an adapter entity without exactly one owner`, {
      details: {
        entityId,
        packageId: columns.packageId,
        integrationId: columns.integrationId,
      },
    });
  }

  return sourceRefSchema.parse(owner);
}
