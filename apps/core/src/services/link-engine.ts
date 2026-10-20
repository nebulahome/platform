/**
 * Linked entities: one reading reached two ways, read from the way the owner prefers.
 *
 * A device reached over its own transport and through the Matter broker reports each reading
 * twice, once per way in. The entity with the longer history **leads**: its address is the one
 * the house uses, its history goes on, and the others are linked to it and stop keeping their
 * own. Every report of a source lands here instead of the registry; the engine keeps what each
 * source last said, picks the one to read - the entity's own choice, then its device's, then the
 * rest in the order they were linked, the first that answers - and writes the leading entity's
 * state from it through the one ingest pipeline. A source standing by changes nothing until the
 * one in use goes silent.
 *
 * **A counter does not jump.** Two ways in count energy from different starts: a Shelly's own
 * meter and its Matter cluster disagree by hundreds of kilowatt-hours. For a `total_increasing`
 * reading the leading entity adds what the source in use counted since its last reading, so a
 * change of source moves nothing: the first reading after one is only a reference, and a source
 * counting from zero again starts a new run rather than going backwards. What the source in use
 * last said is kept in the entity's attributes (`linkCounter`), which outlive a restart.
 */
import {
  type CapabilityName,
  type CapabilityState,
  type EntityId,
  type EntityState,
  type JsonObject,
  type StateReport,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

import type { EntityDirectory, EntityRecord } from '../domain/entity-directory.js';
import { EntityRegistry } from '../domain/entity-registry.js';

import { ingestReport, type LinkRouter, type StateIngestOptions } from './state-ingest.js';

/** The attribute a counter's last reading is kept in. */
export const LINK_COUNTER_ATTRIBUTE = 'linkCounter';

/** What the engine needs. */
export type LinkEngineOptions = {
  readonly directory: EntityDirectory;

  /** The house's registry, which the leading entities are written to and the others alias. */
  readonly registry: EntityRegistry;
  readonly ingest: StateIngestOptions;
  readonly logger: PlatformLogger;
  readonly newTraceId: () => string;
};

/** What one source of a linked entity last said. */
export type LinkSourceState = {
  readonly entityId: EntityId;
  readonly source: string;
  readonly isActive: boolean;
  readonly state: EntityState | undefined;
};

/** A counter's last reading, as the leading entity keeps it. */
type Counter = { readonly source: EntityId; readonly raw: number };

/**
 * Reads the counter a leading entity keeps.
 *
 * @param attributes - Its attributes.
 * @returns The counter, or undefined when it keeps none.
 */
function counterOf(attributes: JsonObject | undefined): Counter | undefined {
  const value = attributes?.[LINK_COUNTER_ATTRIBUTE];

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const { source, raw } = value as Record<string, unknown>;

  return typeof source === 'string' && typeof raw === 'number'
    ? { source: source as EntityId, raw }
    : undefined;
}

/** Reads linked entities from the way they prefer. */
export class LinkEngine implements LinkRouter {
  readonly #options: LinkEngineOptions;

  /** What each source last said, by its own address. Its adapter's words, never the link's. */
  readonly #raw = new EntityRegistry();

  /** The source each leading entity is read from now; null while none answers. */
  readonly #active = new Map<EntityId, EntityId | null>();

  /**
   * @param options - Collaborators.
   */
  public constructor(options: LinkEngineOptions) {
    this.#options = options;
  }

  /**
   * Makes every linked entity's address read the entity it is linked to. Called once the
   * directory is loaded, before any report.
   *
   * @returns How many entities read through another.
   */
  public start(): number {
    let linked = 0;

    for (const record of this.#options.directory.all()) {
      if (record.linkedTo !== undefined) {
        this.#options.registry.alias(record.entityId, record.linkedTo);
        linked += 1;
      }
    }

    return linked;
  }

  /**
   * Takes one report of a source.
   *
   * @param record - The source.
   * @param report - What it said.
   * @param traceId - The unit of work.
   */
  public report(record: EntityRecord, report: StateReport, traceId: string): void {
    this.#raw.apply(report, { source: record.source });

    const holder = this.#options.directory.resolve(record.entityId);

    if (holder?.sources === undefined) {
      // The link went while the report was in flight: it is the entity's own again.
      ingestReport(this.#options.ingest, record, report, traceId);

      return;
    }

    this.#recompute(holder, traceId, record.entityId);
  }

  /**
   * Marks every source an adapter answers for as silent, for an adapter that did not answer.
   *
   * @param source - The adapter.
   */
  public silence(source: string): void {
    const holders = new Set<EntityId>();

    for (const entityId of this.#raw.entitiesOf(source)) {
      if (this.#raw.setAvailability(entityId, false) !== undefined) {
        const holder = this.#options.directory.resolve(entityId);

        if (holder?.sources !== undefined) {
          holders.add(holder.entityId);
        }
      }
    }

    for (const entityId of holders) {
      const holder = this.#options.directory.get(entityId);

      if (holder !== undefined) {
        this.#recompute(holder, this.#options.newTraceId());
      }
    }
  }

  /**
   * The source a command for a linked entity goes to: the first in its order that answers and
   * can do it, else the first that can do it.
   *
   * @param holder - The leading entity.
   * @param capability - What the command asks of it.
   * @returns The source, or undefined when none declares the capability.
   */
  public route(holder: EntityRecord, capability: CapabilityName): EntityRecord | undefined {
    const able = this.#order(holder).filter((record) => record.capabilities.has(capability));

    return able.find((record) => this.#raw.get(record.entityId)?.isAvailable === true) ?? able[0];
  }

  /**
   * What each source of a linked entity last said, for its page.
   *
   * @param entityId - The leading entity, or any of its sources.
   * @returns Each source, the leading one first; empty for an entity that is not linked.
   */
  public sourcesOf(entityId: EntityId): LinkSourceState[] {
    const holder = this.#options.directory.resolve(entityId);

    if (holder?.sources === undefined) {
      return [];
    }

    const active = this.#active.get(holder.entityId) ?? null;

    return holder.sources.flatMap((address) => {
      const record = this.#options.directory.get(address);

      return record === undefined
        ? []
        : [
            {
              entityId: address,
              source: record.source,
              isActive: address === active,
              state: this.#raw.get(address),
            },
          ];
    });
  }

  /**
   * Takes in links the API changed: the directory already holds the new records, and this brings
   * the registry in line - an entity now read through another stops having a state of its own,
   * one no longer linked gets back what its adapter last said, and every leading entity is read
   * again.
   *
   * @param before - The records as they were, for every entity whose link changed.
   */
  public resync(before: readonly EntityRecord[]): void {
    const { directory, registry, ingest } = this.#options;
    const traceId = this.#options.newTraceId();
    const holders = new Set<EntityId>();

    for (const previous of before) {
      const record = directory.get(previous.entityId);

      if (record === undefined) {
        continue;
      }

      if (record.linkedTo !== undefined) {
        registry.alias(record.entityId, record.linkedTo);
        holders.add(record.linkedTo);
        continue;
      }

      if (previous.linkedTo !== undefined) {
        registry.unalias(record.entityId);
      }

      if (record.sources !== undefined) {
        holders.add(record.entityId);
        continue;
      }

      // Its own again: what its adapter last said becomes its state, through the pipeline.
      const raw = this.#raw.get(record.entityId);

      this.#active.delete(record.entityId);

      if (
        raw !== undefined &&
        (previous.linkedTo !== undefined || previous.sources !== undefined)
      ) {
        ingestReport(
          ingest,
          record,
          {
            entityId: record.entityId,
            state: raw.state,
            attributes: raw.attributes,
            isAvailable: raw.isAvailable,
          },
          traceId,
        );
      }
    }

    for (const entityId of holders) {
      const holder = directory.get(entityId);

      if (holder?.sources !== undefined) {
        this.#recompute(holder, traceId);
      }
    }
  }

  /**
   * The sources of a leading entity, in the order they are tried: the entity's own choice, its
   * device's, then the rest as linked.
   *
   * @param holder - The leading entity.
   * @returns The sources still registered.
   */
  #order(holder: EntityRecord): EntityRecord[] {
    const records = (holder.sources ?? [holder.entityId]).flatMap((address) => {
      const record = this.#options.directory.get(address);

      return record === undefined ? [] : [record];
    });
    const first = [holder.transport, holder.preferred].filter(
      (each): each is string => typeof each === 'string',
    );

    return [...records].sort((a, b) => rank(first, a) - rank(first, b));
  }

  /**
   * Reads a leading entity again from its sources.
   *
   * @param holder - The leading entity.
   * @param traceId - The unit of work.
   * @param reporter - The source whose report caused it, when one did.
   */
  #recompute(holder: EntityRecord, traceId: string, reporter?: EntityId): void {
    const { ingest, registry } = this.#options;
    const active = this.#order(holder).find(
      (record) => this.#raw.get(record.entityId)?.isAvailable === true,
    );
    const was = this.#active.get(holder.entityId);
    const now = active?.entityId ?? null;
    const isSwitch = was !== undefined && was !== now;

    this.#active.set(holder.entityId, now);

    if (active === undefined) {
      const last = registry.get(holder.entityId);

      if (last?.isAvailable !== false) {
        ingestReport(
          ingest,
          holder,
          { entityId: holder.entityId, state: {}, isAvailable: false },
          traceId,
          undefined,
          { source: last?.source ?? holder.source },
        );
      }

      return;
    }

    if (!isSwitch && reporter !== undefined && reporter !== active.entityId) {
      // A source standing by spoke: what the entity reads has not changed.
      return;
    }

    const raw = this.#raw.get(active.entityId);

    if (raw === undefined) {
      return;
    }

    const counted =
      holder.stateClass === 'total_increasing'
        ? this.#count(holder, active.entityId, raw, isSwitch)
        : { state: raw.state, attributes: raw.attributes };

    ingestReport(
      ingest,
      holder,
      {
        entityId: holder.entityId,
        state: counted.state,
        attributes: counted.attributes,
        isAvailable: true,
        observedAt: raw.lastUpdated,
      },
      traceId,
      undefined,
      { source: active.source, isSourceSwitch: isSwitch },
    );

    if (isSwitch) {
      this.#options.logger.info(
        { entityId: holder.entityId, from: was, to: now },
        'A linked entity is read another way',
      );
    }
  }

  /**
   * A counter's reading through the source in use, carried on from the leading entity's total.
   *
   * @param holder - The leading entity.
   * @param source - The source in use.
   * @param raw - What it last said.
   * @param isSwitch - Whether it just became the source in use.
   * @returns The state to write, and the attributes with the counter's last reading.
   */
  #count(
    holder: EntityRecord,
    source: EntityId,
    raw: EntityState,
    isSwitch: boolean,
  ): { state: CapabilityState; attributes: JsonObject } {
    const value = raw.state.sensor_numeric?.value;
    const previous = this.#options.registry.get(holder.entityId);
    const total = previous?.state.sensor_numeric?.value;

    if (typeof value !== 'number') {
      return { state: raw.state, attributes: raw.attributes };
    }

    const counter = counterOf(previous?.attributes);
    const next = countOn({
      total,
      counter,
      source,
      value,
      isSwitch,
      isHolder: source === holder.entityId,
    });

    return {
      state: { ...raw.state, sensor_numeric: { ...raw.state.sensor_numeric, value: next } },
      attributes: { ...raw.attributes, [LINK_COUNTER_ATTRIBUTE]: { source, raw: value } },
    };
  }
}

/**
 * Where a source stands in the order: first the ones named, in the order named, then the rest.
 *
 * @param first - The instances to try first.
 * @param record - The source.
 * @returns Its rank; lower is tried earlier.
 */
function rank(first: readonly string[], record: EntityRecord): number {
  const index = first.indexOf(record.source);

  return index === -1 ? first.length : index;
}

/** What carrying a counter on needs. */
export type CountOnInput = {
  /** The leading entity's total so far; undefined before it has one. */
  readonly total: number | undefined;

  /** What the source in use said last time, as the leading entity kept it. */
  readonly counter: Counter | undefined;
  readonly source: EntityId;
  readonly value: number;
  readonly isSwitch: boolean;

  /** Whether the source in use is the leading entity itself, whose total is its own reading. */
  readonly isHolder: boolean;
};

/**
 * Carries a counter on: adds what the source in use counted since it last said.
 *
 * @param input - The total, the counter kept, and the new reading.
 * @returns The new total.
 */
export function countOn(input: CountOnInput): number {
  const { total, counter, source, value, isSwitch, isHolder } = input;

  if (total === undefined) {
    return value;
  }

  if (isSwitch || counter?.source !== source) {
    // Freshly linked, the leading entity's total is its own reading; anything else is a reference.
    return counter === undefined && isHolder && !isSwitch ? value : total;
  }

  // A reading lower than the last is a meter that started again from zero.
  return total + (value >= counter.raw ? value - counter.raw : value);
}
