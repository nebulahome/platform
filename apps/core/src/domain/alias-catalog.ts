/**
 * Alias definitions `core` keeps in memory for evaluation, cycle checks and command routing.
 *
 * An alias behaves as a type (`alias-types.ts`) and is made of parts, each with a source
 * (`alias-parts.ts`). What it reads - the entities of its parts, its formulas' and its code's -
 * is worked out by the API on every save and stored beside it (`registry.alias_reads`); the
 * catalogue keeps it as the edges a source change is followed along.
 */
import type {
  AliasCustomType,
  AliasDisplay,
  AliasFallbackPolicy,
  AliasPartDef,
  AliasParts,
  AliasTypeDef,
  EntityId,
  JsonObject,
} from '@nebulahome/contracts';

import type { AliasGraphEdge } from './alias-graph.js';

/** One alias as the engine knows it. */
export type AliasDefinition = {
  /** The aliases table row id. */
  readonly id: string;

  /** The entity the alias is. */
  readonly entityId: EntityId;

  /** What it behaves as. */
  readonly type: AliasTypeDef;

  /** The parts its type has (for a custom alias, its package entity type's fields). */
  readonly defs: readonly AliasPartDef[];

  /** For a custom alias: its package entity type. */
  readonly customType: AliasCustomType | null;

  /** The parts it has, by key. */
  readonly parts: AliasParts;

  /** Its code: one file, empty when no part comes from code. */
  readonly code: string;

  /** What its code keeps between runs, as last saved. */
  readonly memory: JsonObject;

  readonly display: AliasDisplay;
  readonly debounceMs: number;
  readonly fallbackPolicy: AliasFallbackPolicy;
  readonly isEnabled: boolean;

  /** The entities it reads. */
  readonly reads: readonly EntityId[];
};

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
      this.upsert(alias);
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
   * Reads one alias by the entity it is.
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
   * @returns Every alias → read entity edge.
   */
  public edges(): AliasGraphEdge[] {
    const edges: AliasGraphEdge[] = [];

    for (const alias of this.#byEntity.values()) {
      for (const read of alias.reads) {
        edges.push({ aliasEntityId: alias.entityId, sourceEntityId: read });
      }
    }

    return edges;
  }
}
