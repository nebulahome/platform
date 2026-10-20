/**
 * What `core` knows about an entity that is not its state.
 *
 * Three things live here that the registry has no business holding, because they change when the
 * owner reconfigures the house rather than when a device reports:
 *
 * - the **row identifier**. `registry.entities.entity_id` is the text `light.kitchen_ceiling`,
 *   but `history.state_history.entity_id` is the table's `uuid`. Every history and telemetry
 *   write needs the translation, and doing it with a query per report would put a round trip on
 *   the hottest path in the system.
 * - the **owning package**, which is what makes command routing possible at all.
 * - the **declared capabilities and their device limits**, which are what let `core` reject a
 *   command the device cannot execute without asking the device first.
 */
import {
  NotFoundError,
  type CapabilityName,
  type EntityId,
  type JsonObject,
  type SourceRef,
} from '@nebulahome/contracts';

/** One entity's configuration, as opposed to its state. */
export type EntityRecord = {
  /** The stable text identifier, which is what every subject and automation names. */
  readonly entityId: EntityId;

  /** The `registry.entities.id` uuid, which is what every history row references. */
  readonly rowId: string;

  /** The owning package id, or `derived` or `system` for entities the platform produces. */
  readonly source: SourceRef;

  /** False when the owner has disabled the entity, which stops reports and commands alike. */
  readonly isEnabled: boolean;

  /** What the entity declares it can do, with the device's own limits for each. */
  readonly capabilities: ReadonlyMap<CapabilityName, JsonObject>;

  /**
   * For an entity linked to another that reads the same thing another way: the entity it reads
   * through, which is what its address means to everyone but its own adapter.
   */
  readonly linkedTo?: EntityId;

  /**
   * For an entity others are linked to: every source, itself first, then the others in the order
   * they were linked.
   */
  readonly sources?: readonly EntityId[];

  /** For an entity others are linked to: the instance it is read through first; null follows its device. */
  readonly transport?: string | null;

  /** For an entity others are linked to: the instance its device is read through first. */
  readonly preferred?: string | null;

  /** How a numeric reading accumulates, for a counter that must not jump when its source changes. */
  readonly stateClass?: string | null;
};

/** The link fields of a record, to carry over when the rest of it is rewritten. */
export type LinkFields = Pick<
  EntityRecord,
  'linkedTo' | 'sources' | 'transport' | 'preferred' | 'stateClass'
>;

/**
 * The link fields of a record, as they are.
 *
 * @param record - The record, if there is one.
 * @returns Its link fields; none for no record or one not linked.
 */
export function linkFieldsOf(record: LinkFields | undefined): LinkFields {
  if (record === undefined) {
    return {};
  }

  return {
    ...(record.linkedTo === undefined ? {} : { linkedTo: record.linkedTo }),
    ...(record.sources === undefined ? {} : { sources: record.sources }),
    ...(record.transport === undefined ? {} : { transport: record.transport }),
    ...(record.preferred === undefined ? {} : { preferred: record.preferred }),
    ...(record.stateClass === undefined ? {} : { stateClass: record.stateClass }),
  };
}

/**
 * Whether an entity is one side of a link: read through another, or read through by others.
 *
 * @param record - The entity.
 * @returns True for either side.
 */
export function isLinked(record: EntityRecord): boolean {
  return record.linkedTo !== undefined || record.sources !== undefined;
}

/** Every entity's configuration, indexed by the identifier the bus uses. */
export class EntityDirectory {
  readonly #records = new Map<EntityId, EntityRecord>();

  /**
   * How many entities are configured.
   *
   * @returns The number of registered entities.
   */
  public get size(): number {
    return this.#records.size;
  }

  /**
   * Adds or replaces one entity's configuration.
   *
   * @param record - The configuration.
   */
  public set(record: EntityRecord): void {
    this.#records.set(record.entityId, record);
  }

  /**
   * Reads one entity's configuration.
   *
   * @param entityId - The entity to look up.
   * @returns Its configuration, or undefined when it is not registered.
   */
  public get(entityId: EntityId): EntityRecord | undefined {
    return this.#records.get(entityId);
  }

  /**
   * Reads one entity's configuration, insisting that it exists.
   *
   * @param entityId - The entity to look up.
   * @returns Its configuration.
   * @throws {NotFoundError} When nothing by that identifier is registered. The API layer turns
   * this into a 404 unchanged, which is the honest answer to a command for a light that was
   * removed while somebody had the page open.
   */
  public require(entityId: EntityId): EntityRecord {
    const record = this.#records.get(entityId);

    if (record === undefined) {
      throw new NotFoundError(`Entity ${entityId} is not registered`, { details: { entityId } });
    }

    return record;
  }

  /**
   * Reads what an address means: the entity itself, or, for one linked to another, the entity it
   * reads through.
   *
   * @param entityId - The address.
   * @returns The entity it means, or undefined when nothing by that address is registered.
   */
  public resolve(entityId: EntityId): EntityRecord | undefined {
    const record = this.#records.get(entityId);

    return record?.linkedTo === undefined ? record : (this.#records.get(record.linkedTo) ?? record);
  }

  /**
   * Every address that means an entity: its own, and those of the entities linked to it.
   *
   * @param entityId - The entity.
   * @returns Its addresses, its own first.
   */
  public addressesOf(entityId: EntityId): readonly EntityId[] {
    return this.#records.get(entityId)?.sources ?? [entityId];
  }

  /**
   * Forgets one entity's configuration.
   *
   * @param entityId - The entity to forget.
   * @returns True when it was there to forget.
   */
  public remove(entityId: EntityId): boolean {
    return this.#records.delete(entityId);
  }

  /**
   * Lists every configured entity.
   *
   * @returns The records, in insertion order.
   */
  public all(): EntityRecord[] {
    return [...this.#records.values()];
  }

  /**
   * Lists the package ids that own at least one entity.
   *
   * This is the list `core` asks for a resynchronisation at startup: exactly the adapters that
   * have something to resend, rather than every package that happens to be installed.
   *
   * @returns The owning package ids, each once.
   */
  public owningPackages(): string[] {
    const owners = new Set<string>();

    for (const record of this.#records.values()) {
      if (record.source !== 'derived' && record.source !== 'system') {
        owners.add(record.source);
      }
    }

    return [...owners];
  }
}
