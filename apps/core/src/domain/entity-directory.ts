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
};

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
