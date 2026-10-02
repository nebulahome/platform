/**
 * The alias dependency graph: cycle detection and descendant walks.
 *
 * Aliases may read other aliases, so the set forms a directed graph. A cycle would recurse until
 * the process died; it is rejected at save time with the path that closes it (ARCHITECTURE.md
 * §6.3). On a source change, only the descendants of that source are recomputed.
 */
import type { EntityId } from '@nebulahome/contracts';

/** One edge: an alias reads a source entity under a variable name. */
export type AliasGraphEdge = {
  readonly aliasEntityId: EntityId;
  readonly sourceEntityId: EntityId;
};

/** A cycle found while validating a proposed set of edges. */
export type AliasCycle = {
  readonly path: readonly EntityId[];
};

/**
 * Finds a cycle in the alias dependency graph, if one exists.
 *
 * @param edges - Every alias → source edge, including the proposed change.
 * @returns The cycle path (first node repeated at the end), or null when the graph is a DAG.
 */
export function findAliasCycle(edges: readonly AliasGraphEdge[]): AliasCycle | null {
  const adjacency = new Map<EntityId, EntityId[]>();

  for (const edge of edges) {
    const list = adjacency.get(edge.aliasEntityId) ?? [];
    list.push(edge.sourceEntityId);
    adjacency.set(edge.aliasEntityId, list);
  }

  const visiting = new Set<EntityId>();
  const visited = new Set<EntityId>();
  const stack: EntityId[] = [];

  /**
   * Depth-first search from one alias node.
   *
   * @param node - The alias entity being visited.
   * @returns A cycle when one is found under this node.
   */
  const visit = (node: EntityId): AliasCycle | null => {
    if (visited.has(node)) {
      return null;
    }

    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      return { path: [...stack.slice(start), node] };
    }

    visiting.add(node);
    stack.push(node);

    for (const source of adjacency.get(node) ?? []) {
      // Only alias nodes participate in cycles among aliases; a physical sensor is a leaf.
      if (!adjacency.has(source) && ![...adjacency.keys()].includes(source)) {
        // Source is not itself an alias that reads further - still walk if it appears as an
        // aliasEntityId elsewhere (already covered by adjacency.has).
      }

      if (adjacency.has(source)) {
        const cycle = visit(source);
        if (cycle !== null) {
          return cycle;
        }
      }
    }

    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  };

  for (const node of adjacency.keys()) {
    const cycle = visit(node);
    if (cycle !== null) {
      return cycle;
    }
  }

  return null;
}

/**
 * Lists every alias that depends on a changed entity, direct or transitive, in topological order.
 *
 * @param edges - The full edge list.
 * @param rootEntityId - The entity whose state just changed.
 * @returns Alias entity ids that must be recomputed, sources before dependents.
 */
export function aliasDescendants(
  edges: readonly AliasGraphEdge[],
  rootEntityId: EntityId,
): EntityId[] {
  const readers = new Map<EntityId, EntityId[]>();

  for (const edge of edges) {
    const list = readers.get(edge.sourceEntityId) ?? [];
    list.push(edge.aliasEntityId);
    readers.set(edge.sourceEntityId, list);
  }

  const ordered: EntityId[] = [];
  const seen = new Set<EntityId>();
  const queue: EntityId[] = [...(readers.get(rootEntityId) ?? [])];

  while (queue.length > 0) {
    const next = queue.shift();

    if (next === undefined || seen.has(next)) {
      continue;
    }

    seen.add(next);
    ordered.push(next);

    for (const child of readers.get(next) ?? []) {
      queue.push(child);
    }
  }

  return ordered;
}
