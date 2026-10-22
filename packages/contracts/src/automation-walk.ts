/**
 * Walking every block of an automation, with the path the editor and the trace address it by.
 *
 * Paths name lists and places in them: `triggers.0`, `if.1`, `if.1.conditions.0`, `then.2`,
 * `then.2.then.0`, `then.2.else.1`, `then.3.cases.1.0`, `then.3.default.0`, `then.4.actions.2`,
 * `then.5.branches.1.0`, `then.6.conditions.0`, `then.7.trigger`. The engine records steps under
 * the same paths, so a run's trace points at the card each step came from.
 */
import type { AutomationAction } from './automation-actions.js';
import {
  isConditionGroup,
  type ConditionLeaf,
  type ConditionNode,
} from './automation-conditions.js';
import type { AutomationDefinition } from './automation-definition.js';
import type { AutomationTrigger } from './automation-triggers.js';

/** Which part of the document a block belongs to. */
export type BlockFamily = 'trigger' | 'condition' | 'action';

/** One block, as the walk meets it. */
export type VisitedBlock =
  | { readonly family: 'trigger'; readonly block: AutomationTrigger; readonly path: string }
  | { readonly family: 'condition'; readonly block: ConditionNode; readonly path: string }
  | { readonly family: 'action'; readonly block: AutomationAction; readonly path: string };

/**
 * Calls back for each condition in a list, and in the groups under it.
 *
 * @param nodes - The conditions.
 * @param path - Where the list is.
 * @param visit - What to call.
 */
function walkConditions(
  nodes: readonly ConditionNode[],
  path: string,
  visit: (visited: VisitedBlock) => void,
): void {
  for (const [index, node] of nodes.entries()) {
    const at = `${path}.${String(index)}`;

    visit({ family: 'condition', block: node, path: at });

    if (isConditionGroup(node)) {
      walkConditions(node.conditions, `${at}.conditions`, visit);
    }
  }
}

/**
 * Calls back for each action in a list, and for everything each one holds.
 *
 * @param actions - The actions.
 * @param path - Where the list is.
 * @param visit - What to call.
 */
export function walkActions(
  actions: readonly AutomationAction[],
  path: string,
  visit: (visited: VisitedBlock) => void,
): void {
  for (const [index, action] of actions.entries()) {
    const at = `${path}.${String(index)}`;

    visit({ family: 'action', block: action, path: at });

    switch (action.type) {
      case 'if': {
        walkConditions(action.conditions, `${at}.conditions`, visit);
        walkActions(action.then, `${at}.then`, visit);
        walkActions(action.else ?? [], `${at}.else`, visit);
        break;
      }
      case 'while':
      case 'do_while': {
        walkConditions(action.conditions, `${at}.conditions`, visit);
        walkActions(action.actions, `${at}.actions`, visit);
        break;
      }
      case 'wait_for': {
        walkConditions(action.conditions, `${at}.conditions`, visit);
        break;
      }
      case 'wait_for_trigger': {
        visit({ family: 'trigger', block: action.trigger, path: `${at}.trigger` });
        break;
      }
      case 'switch': {
        for (const [caseIndex, branch] of action.cases.entries()) {
          walkActions(branch.actions, `${at}.cases.${String(caseIndex)}`, visit);
        }

        walkActions(action.default ?? [], `${at}.default`, visit);
        break;
      }
      case 'parallel': {
        for (const [branchIndex, branch] of action.branches.entries()) {
          walkActions(branch, `${at}.branches.${String(branchIndex)}`, visit);
        }

        break;
      }
      case 'sequence':
      case 'for': {
        walkActions(action.actions, `${at}.actions`, visit);
        break;
      }
      case 'command':
      case 'scene':
      case 'automation':
      case 'wait_duration':
      case 'notify':
      case 'package_service':
      case 'stop': {
        break;
      }
    }
  }
}

/**
 * Calls back for every block of an automation, in document order.
 *
 * @param definition - The document.
 * @param visit - What to call, with the block, its family and its path.
 */
export function forEachBlock(
  definition: AutomationDefinition,
  visit: (visited: VisitedBlock) => void,
): void {
  for (const [index, trigger] of definition.triggers.entries()) {
    visit({ family: 'trigger', block: trigger, path: `triggers.${String(index)}` });
  }

  walkConditions(definition.if ?? [], 'if', visit);
  walkActions(definition.then, 'then', visit);
}

/**
 * Every entity an automation names, each once, in the order the document first names it.
 *
 * Walks the whole document: the triggers, the conditions, and every action however deeply it is
 * nested, with the conditions a wait or a loop checks, the variables an expression reads and the
 * trigger a wait listens for. A scene
 * or another automation called by key is not followed: what that one touches is its own business,
 * and listing it here would make a scene's entities look like this automation's.
 *
 * @param definition - The parsed document.
 * @returns The entity ids.
 */
export function entityIdsOfDefinition(definition: AutomationDefinition): string[] {
  const found = new Set<string>();

  forEachBlock(definition, (visited) => {
    if (visited.family === 'trigger') {
      const trigger = visited.block;

      if (trigger.type === 'entity') {
        found.add(trigger.entityId);
      } else if (trigger.type === 'event' && typeof trigger.entityId === 'string') {
        found.add(trigger.entityId);
      }
    } else if (visited.family === 'condition') {
      if (visited.block.type === 'entity') {
        found.add(visited.block.entityId);
      } else if (visited.block.type === 'expression') {
        for (const entityId of Object.values(visited.block.variables ?? {})) {
          found.add(entityId);
        }
      }
    } else if (visited.block.type === 'command' || visited.block.type === 'switch') {
      // A command and a switch name the entity they act on.
      found.add(visited.block.entityId);
    }
  });

  return [...found];
}

/**
 * Every condition leaf an automation checks, wherever it is.
 *
 * @param definition - The document.
 * @returns The leaves, in document order.
 */
export function conditionLeavesOfDefinition(definition: AutomationDefinition): ConditionLeaf[] {
  const leaves: ConditionLeaf[] = [];

  forEachBlock(definition, (visited) => {
    if (visited.family === 'condition' && !isConditionGroup(visited.block)) {
      leaves.push(visited.block);
    }
  });

  return leaves;
}

/**
 * The same document with entities swapped for others, wherever it names them: an `entityId` at
 * any depth, and the entities an expression's variables stand for. Used when a file brought in
 * from elsewhere names entities this house calls something else. An address not in the map stays.
 *
 * @param value - The document, or any part of one.
 * @param renames - Old address to new.
 * @returns A copy with the addresses swapped.
 */
export function renameEntities<T>(value: T, renames: ReadonlyMap<string, string>): T {
  /**
   * One address, swapped when the map has it.
   *
   * @param entityId - The value where an address goes.
   * @returns The new address, or the value as it was.
   */
  const swap = (entityId: unknown): unknown =>
    typeof entityId === 'string' ? (renames.get(entityId) ?? entityId) : entityId;

  /**
   * One part of the document, copied with its addresses swapped.
   *
   * @param node - The part.
   * @returns Its copy.
   */
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map(walk);
    }

    if (node === null || typeof node !== 'object') {
      return node;
    }

    return Object.fromEntries(
      Object.entries(node as Readonly<Record<string, unknown>>).map(([key, child]) => {
        if (key === 'entityId') {
          return [key, swap(child)];
        }

        if (key === 'variables' && child !== null && typeof child === 'object') {
          return [
            key,
            Object.fromEntries(Object.entries(child).map(([name, id]) => [name, swap(id)])),
          ];
        }

        return [key, walk(child)];
      }),
    );
  };

  return walk(value) as T;
}
