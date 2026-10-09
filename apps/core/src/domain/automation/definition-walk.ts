/**
 * Walking an automation's document for what a run will need before it starts.
 *
 * Whether an area is occupied is read from its sensors, and which sensors are in an area is a
 * database question. A check runs synchronously in the middle of a run, so the areas a run may
 * ask about - in `if`, and in every if/else, loop and wait inside `then` - are found here and
 * their sensors read before the run begins.
 */
import type { AutomationAction, AutomationDefinition, BooleanTree } from '@nebulahome/contracts';

import { areasOfConditions } from './conditions.js';

/**
 * Every tree of checks in a list of actions, however deeply nested.
 *
 * @param actions - The actions.
 * @returns The trees.
 */
function treesOfActions(actions: readonly AutomationAction[]): BooleanTree[] {
  return actions.flatMap((action): BooleanTree[] => {
    switch (action.type) {
      case 'if': {
        return [
          action.condition,
          ...treesOfActions(action.then),
          ...treesOfActions(action.else ?? []),
        ];
      }
      case 'while':
      case 'do_while': {
        return [action.condition, ...treesOfActions(action.actions)];
      }
      case 'wait_for': {
        return [action.condition];
      }
      case 'switch': {
        return [
          ...action.cases.flatMap((branch) => treesOfActions(branch.actions)),
          ...treesOfActions(action.default ?? []),
        ];
      }
      case 'parallel':
      case 'sequence':
      case 'for': {
        return treesOfActions(action.actions);
      }
      case 'command':
      case 'scene':
      case 'automation':
      case 'wait_duration':
      case 'wait_for_trigger':
      case 'notify':
      case 'package_service':
      case 'stop': {
        return [];
      }
    }
  });
}

/**
 * The areas an automation's checks ask about, anywhere in it.
 *
 * @param definition - The document.
 * @returns Each area key once.
 */
export function areasOfDefinition(definition: AutomationDefinition): string[] {
  const trees = [
    ...(definition.if === undefined ? [] : [definition.if]),
    ...treesOfActions(definition.then),
  ];

  return [...new Set(trees.flatMap(areasOfConditions))];
}
