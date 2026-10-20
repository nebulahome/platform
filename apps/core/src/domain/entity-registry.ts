/**
 * The in-memory registry: the authoritative, hot view of every entity.
 *
 * `core` is the single writer of entity state (ARCHITECTURE.md 4.1). Everything else - the API,
 * the engines, the interface - reads a copy through `state.snapshot` and keeps it current from
 * `state_changed` events. With N writers, a device reporting while an automation applies a scene
 * produces two concurrent writes with no ordering guarantee; funnelling every mutation through
 * here makes the order well-defined and means history rows are written exactly once.
 *
 * Deliberately free of the bus and the database. Everything it needs arrives as an argument, so
 * the ingest pipeline can be tested without a broker, a schema or a clock.
 */
import type {
  ChangeContext,
  EntityId,
  EntityState,
  SourceRef,
  StateReport,
} from '@nebulahome/contracts';

import { hasStateChanged, haveAttributesChanged, mergeCapabilityState } from './state-diff.js';

/** Where a report came from and what caused it. */
export type IngestOptions = {
  /** The adapter or engine that produced the report. */
  readonly source: SourceRef;

  /** What caused it, when it is known. */
  readonly context?: ChangeContext;
};

/** What one report did to the registry. */
export type IngestResult = {
  /** The entity the report was about. */
  readonly entityId: EntityId;

  /** Its state after the report. */
  readonly current: EntityState;

  /** Its state before, absent when this was the first report for the entity. */
  readonly previous: EntityState | undefined;

  /**
   * Whether the capability state differs.
   *
   * This and only this moves `lastChanged`, because that is what the field means and what
   * automations triggering on change rely on.
   */
  readonly hasStateChanged: boolean;

  /** Whether the entity went from reachable to unreachable, or back. */
  readonly hasAvailabilityChanged: boolean;

  /** Whether the free-form attributes differ. */
  readonly haveAttributesChanged: boolean;

  /**
   * Whether anything happened that a subscriber should be told about.
   *
   * Wider than `hasStateChanged`: a light that became unreachable has the same state it had a
   * second ago, and the interface still has to grey it out.
   */
  readonly isNotable: boolean;
};

/** The authoritative, hot view of every entity. */
export class EntityRegistry {
  readonly #states = new Map<EntityId, EntityState>();

  /**
   * Addresses that mean another entity: an entity linked to another reads through it, and its
   * address reads the state of the one it is linked to.
   */
  readonly #aliases = new Map<EntityId, EntityId>();
  readonly #now: () => Date;

  /**
   * Builds an empty registry.
   *
   * @param now - The clock, injected so that a test asserting on `lastChanged` does not have to
   * assert on the wall clock.
   */
  public constructor(now: () => Date = (): Date => new Date()) {
    this.#now = now;
  }

  /**
   * How many entities the registry holds.
   *
   * @returns The number of entities with a known state.
   */
  public get size(): number {
    return this.#states.size;
  }

  /**
   * Loads a state without treating it as a report.
   *
   * Used at startup to rebuild from the database. It emits nothing and moves no timestamp: the
   * rows are what `core` last managed to persist, not news, and announcing them as state changes
   * would fire every automation in the house on every restart.
   *
   * @param state - The stored state.
   */
  public seed(state: EntityState): void {
    this.#states.set(state.entityId, state);
  }

  /**
   * Reads one entity.
   *
   * @param entityId - The entity to read.
   * @returns Its current state, or undefined when nothing has ever reported it.
   */
  public get(entityId: EntityId): EntityState | undefined {
    const target = this.#aliases.get(entityId);

    if (target === undefined) {
      return this.#states.get(entityId);
    }

    const state = this.#states.get(target);

    // Named by the address asked for, so a reader comparing ids sees the one it asked about.
    return state === undefined ? undefined : { ...state, entityId };
  }

  /**
   * Makes one address read another entity's state, and forgets the state it had of its own.
   *
   * @param entityId - The entity linked to another.
   * @param target - The entity it reads through.
   */
  public alias(entityId: EntityId, target: EntityId): void {
    this.#aliases.set(entityId, target);
    this.#states.delete(entityId);
  }

  /**
   * Gives an address its own state back.
   *
   * @param entityId - The entity no longer linked.
   * @returns True when it was an alias.
   */
  public unalias(entityId: EntityId): boolean {
    return this.#aliases.delete(entityId);
  }

  /**
   * Reads the whole registry.
   *
   * @returns Every entity's current state, in insertion order; an address that means another
   * entity is not listed apart from it.
   */
  public snapshot(): EntityState[] {
    return [...this.#states.values()];
  }

  /**
   * Lists the entities one source owns.
   *
   * @param source - The adapter or engine.
   * @returns The identifiers of the entities it currently owns.
   */
  public entitiesOf(source: SourceRef): EntityId[] {
    return [...this.#states.values()]
      .filter((state) => state.source === source)
      .map((state) => state.entityId);
  }

  /**
   * Applies one report.
   *
   * @param report - What the adapter observed.
   * @param options - Who reported it and what caused it.
   * @returns What the report did, so the caller can decide what to emit and what to persist.
   */
  public apply(report: StateReport, options: IngestOptions): IngestResult {
    const previous = this.#states.get(report.entityId);
    const observedAt = report.observedAt ?? this.#now();

    const state = mergeCapabilityState(previous?.state ?? {}, report.state);
    const attributes = report.attributes ?? previous?.attributes ?? {};
    const isAvailable = report.isAvailable ?? previous?.isAvailable ?? true;

    const stateChanged = previous === undefined || hasStateChanged(previous.state, state);
    const availabilityChanged = previous !== undefined && previous.isAvailable !== isAvailable;
    const attributesChanged =
      previous !== undefined && haveAttributesChanged(previous.attributes, attributes);

    const current: EntityState = {
      entityId: report.entityId,
      state,
      attributes,
      isAvailable,
      lastChanged: stateChanged ? observedAt : previous.lastChanged,
      lastUpdated: observedAt,
      source: options.source,
      ...(options.context === undefined ? {} : { context: options.context }),
    };

    this.#states.set(report.entityId, current);

    return {
      entityId: report.entityId,
      current,
      previous,
      hasStateChanged: stateChanged,
      hasAvailabilityChanged: availabilityChanged,
      haveAttributesChanged: attributesChanged,
      isNotable: stateChanged || availabilityChanged || attributesChanged,
    };
  }

  /**
   * Marks an entity reachable or unreachable without changing its state.
   *
   * Used when an adapter stops or its package is removed: the last known values stay, because
   * "the thermostat was at 19 degrees when we lost it" is more useful than a blank card, but the
   * interface has to show that nobody has heard from it since.
   *
   * @param entityId - The entity whose reachability changed.
   * @param isAvailable - Whether it is reachable now.
   * @returns What changed, or undefined when the entity is unknown or already in that state.
   */
  public setAvailability(entityId: EntityId, isAvailable: boolean): IngestResult | undefined {
    const previous = this.#states.get(entityId);

    if (previous === undefined || previous.isAvailable === isAvailable) {
      return undefined;
    }

    const current: EntityState = { ...previous, isAvailable, lastUpdated: this.#now() };

    this.#states.set(entityId, current);

    return {
      entityId,
      current,
      previous,
      hasStateChanged: false,
      hasAvailabilityChanged: true,
      haveAttributesChanged: false,
      isNotable: true,
    };
  }

  /**
   * Forgets an entity.
   *
   * @param entityId - The entity to forget.
   * @returns True when it was there to forget.
   */
  public remove(entityId: EntityId): boolean {
    return this.#states.delete(entityId);
  }
}
