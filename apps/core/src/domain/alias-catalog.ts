/**
 * Alias definitions core keeps in memory for evaluation, cycle checks and command routing.
 *
 * Calculated aliases have a formula and sources; stored helpers have an empty expression and
 * accept commands locally. Distinguishing them by the expression (empty vs non-blank) matches
 * the database check and keeps a separate `kind` column out of the schema.
 */
import type {
  AliasFallbackPolicy,
  CapabilityName,
  EntityId,
  JsonObject,
} from '@nebulahome/contracts';

import type { AliasGraphEdge } from './alias-graph.js';

/** One named source feeding a calculated alias. */
export type AliasSourceBinding = {
  readonly variableName: string;
  readonly entityId: EntityId;
};

/** One alias as the engine knows it. */
export type AliasDefinition = {
  /** The aliases table row id. */
  readonly id: string;

  /** The entity the alias materialises. */
  readonly entityId: EntityId;

  /** Primary capability written into state. */
  readonly capability: CapabilityName;

  /** Empty for stored helpers; non-blank for calculated sensors. */
  readonly expression: string;

  readonly debounceMs: number;
  readonly fallbackPolicy: AliasFallbackPolicy;
  readonly isEnabled: boolean;

  /** Sources the formula reads. Empty for stored helpers. */
  readonly sources: readonly AliasSourceBinding[];

  /** Device limits and helper metadata from the entity row. */
  readonly config: JsonObject;

  /** Lower/upper/step for a stored number, when set on the entity. */
  readonly min: number | null;
  readonly max: number | null;
  readonly step: number | null;
};

/**
 * Whether an alias definition is a stored helper.
 *
 * @param alias - The definition.
 * @returns True when it has no formula.
 */
export function isStoredAlias(alias: AliasDefinition): boolean {
  return alias.expression === '';
}

/** Every alias definition, indexed for the engine and the command router. */
export class AliasCatalog {
  readonly #byEntity = new Map<EntityId, AliasDefinition>();
  readonly #byId = new Map<string, AliasDefinition>();

  /**
   * How many aliases are loaded.
   *
   * @returns The count.
   */
  public get size(): number {
    return this.#byEntity.size;
  }

  /**
   * Replaces the catalogue with a fresh load.
   *
   * @param aliases - Every alias definition.
   */
  public replaceAll(aliases: readonly AliasDefinition[]): void {
    this.#byEntity.clear();
    this.#byId.clear();

    for (const alias of aliases) {
      this.#byEntity.set(alias.entityId, alias);
      this.#byId.set(alias.id, alias);
    }
  }

  /**
   * Adds or replaces one definition after a create or update.
   *
   * @param alias - The definition.
   */
  public upsert(alias: AliasDefinition): void {
    this.#byEntity.set(alias.entityId, alias);
    this.#byId.set(alias.id, alias);
  }

  /**
   * Forgets one definition after a delete.
   *
   * @param entityId - The alias entity.
   */
  public remove(entityId: EntityId): void {
    const existing = this.#byEntity.get(entityId);

    if (existing === undefined) {
      return;
    }

    this.#byEntity.delete(entityId);
    this.#byId.delete(existing.id);
  }

  /**
   * Reads one alias by the entity it produces.
   *
   * @param entityId - The alias entity.
   * @returns The definition, or undefined.
   */
  public getByEntity(entityId: EntityId): AliasDefinition | undefined {
    return this.#byEntity.get(entityId);
  }

  /**
   * Lists every definition.
   *
   * @returns The definitions.
   */
  public all(): AliasDefinition[] {
    return [...this.#byEntity.values()];
  }

  /**
   * Builds the edge list used for cycle detection and descendant walks.
   *
   * @returns Every alias → source edge.
   */
  public edges(): AliasGraphEdge[] {
    const edges: AliasGraphEdge[] = [];

    for (const alias of this.#byEntity.values()) {
      for (const source of alias.sources) {
        edges.push({ aliasEntityId: alias.entityId, sourceEntityId: source.entityId });
      }
    }

    return edges;
  }
}
