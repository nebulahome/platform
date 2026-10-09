/**
 * Whether something that just happened wakes an automation.
 *
 * Something happening is an event: an entity changed, a time trigger's moment came, a hold ran
 * its course, or somebody asked. Each trigger leaf reacts to an event by firing, by starting or
 * cancelling a hold (a trigger with "for at least"), or not at all; the tree then decides whether
 * the automation wakes.
 *
 * **What AND means.** An event is one moment, and two triggers almost never fire at the same
 * one. So a group fires when one of its cards fires *and every other card is satisfied right
 * then*: an entity trigger is satisfied while its entity is in the state it waits for (and has
 * been for its "for at least"), a numeric one while the comparison holds. A time trigger, a
 * manual one and an event are instants, satisfied only at their own moment - an AND of two of
 * them never fires, and the editor says so.
 *
 * **Coming back is not a change.** A device that drops off the network and returns did not turn
 * on; an entity going to or from `unavailable` fires only a trigger that names `unavailable`.
 *
 * Pure: the state of the house and the clock come in through the context.
 */
import {
  flattenTriggers,
  isTriggerTreeOp,
  numericReadingOf,
  stateTokenOf,
  STATE_TOKEN_UNAVAILABLE,
  type AutomationRunTrigger,
  type AutomationTrigger,
  type ComparisonOperator,
  type EntityState,
  type TriggerTree,
} from '@nebulahome/contracts';

/** Something that happened. */
export type TriggerEvent =
  | {
      readonly kind: 'state';
      readonly entityId: string;
      readonly previous: EntityState | undefined;
      readonly current: EntityState;
    }
  | { readonly kind: 'time'; readonly path: string }
  | {
      readonly kind: 'hold';
      readonly path: string;

      /** The token the entity was held in, which it must still be in. */
      readonly expectToken?: string | undefined;
    }
  | { readonly kind: 'manual' };

/** What the trigger tree can see of the house. */
export type TriggerContext = {
  /** The live state of an entity. */
  readonly stateOf: (entityId: string) => EntityState | undefined;

  /** Now. */
  readonly now: Date;
};

/** A trigger leaf and where it sits in the tree: `triggers`, `triggers.1`, `triggers.1.0`. */
export type TriggerLeafRef = {
  readonly path: string;
  readonly leaf: AutomationTrigger;
};

/** A hold to start: fire this leaf after `ms` if it is still satisfied then. */
export type HoldIntent = {
  readonly path: string;
  readonly ms: number;

  /** The state token the entity must still be in, for a state trigger. */
  readonly expectToken?: string | undefined;
};

/** What an event did to the tree. */
export type TriggerReaction = {
  /** The leaf that woke the automation, or null. */
  readonly fired: AutomationRunTrigger | null;

  /** Holds to start. */
  readonly holds: readonly HoldIntent[];

  /** Paths of holds to cancel: the entity left the state it was held in. */
  readonly cancels: readonly string[];
};

/**
 * Lists the leaves of a trigger tree with their paths.
 *
 * @param tree - The tree.
 * @param path - The tree's own path.
 * @returns The leaves in document order.
 */
export function triggerLeaves(tree: TriggerTree, path = 'triggers'): TriggerLeafRef[] {
  if (isTriggerTreeOp(tree)) {
    return tree.items.flatMap((item, index) => triggerLeaves(item, `${path}.${String(index)}`));
  }

  return [{ path, leaf: tree }];
}

/**
 * The entities a trigger tree watches.
 *
 * @param tree - The tree.
 * @returns Each entity once.
 */
export function entitiesOfTriggers(tree: TriggerTree): string[] {
  const found = new Set<string>();

  for (const leaf of flattenTriggers(tree)) {
    if (leaf.type === 'state' || leaf.type === 'numeric_state') {
      found.add(leaf.entityId);
    }
  }

  return [...found];
}

/**
 * Compares two numbers the way a block says.
 *
 * @param operator - How.
 * @param left - The reading.
 * @param right - The threshold.
 * @returns The comparison.
 */
export function compare(operator: ComparisonOperator, left: number, right: number): boolean {
  switch (operator) {
    case 'lt': {
      return left < right;
    }
    case 'lte': {
      return left <= right;
    }
    case 'gt': {
      return left > right;
    }
    case 'gte': {
      return left >= right;
    }
    case 'eq': {
      return left === right;
    }
    case 'neq': {
      return left !== right;
    }
  }
}

/**
 * The token of a state, unavailable included.
 *
 * @param state - The entity's state, or undefined.
 * @returns Its token.
 */
function tokenOf(state: EntityState | undefined): string | undefined {
  return state === undefined ? undefined : stateTokenOf(state.state, state.isAvailable);
}

/**
 * Whether a leaf's from or to accepts a token. Absent, null or empty means any - except
 * `unavailable`, which only a trigger naming it accepts.
 *
 * @param wanted - What the leaf asks for.
 * @param token - What the entity was or is.
 * @returns True when it matches.
 */
function accepts(wanted: string | null | undefined, token: string | undefined): boolean {
  if (wanted === undefined || wanted === null || wanted === '') {
    return token !== STATE_TOKEN_UNAVAILABLE;
  }

  return wanted === token;
}

/**
 * Whether a numeric leaf's comparison holds for a state.
 *
 * @param leaf - The numeric trigger.
 * @param state - The entity's state.
 * @returns True when it holds, false when it does not or there is no reading.
 */
function numericHolds(
  leaf: Extract<AutomationTrigger, { type: 'numeric_state' }>,
  state: EntityState | undefined,
): boolean {
  if (state?.isAvailable !== true) {
    return false;
  }

  const reading = numericReadingOf(state.state);

  return reading !== undefined && compare(leaf.operator, reading, leaf.value);
}

/**
 * Whether a leaf has held its state long enough, judged by when the entity last changed.
 *
 * @param state - The entity's state.
 * @param forMs - How long it must have held.
 * @param now - Now.
 * @returns True when long enough.
 */
function hasHeld(state: EntityState, forMs: number | null | undefined, now: Date): boolean {
  return (forMs ?? 0) <= 0 || now.getTime() - state.lastChanged.getTime() >= (forMs ?? 0);
}

/**
 * Whether a leaf is satisfied right now, for the other cards of an AND group.
 *
 * @param leaf - The leaf.
 * @param context - The house.
 * @returns True when it is.
 */
function isSatisfied(leaf: AutomationTrigger, context: TriggerContext): boolean {
  switch (leaf.type) {
    case 'state': {
      const state = context.stateOf(leaf.entityId);

      // "Any change" is an instant, not a condition.
      if (state === undefined || leaf.to === undefined || leaf.to === null || leaf.to === '') {
        return false;
      }

      return tokenOf(state) === leaf.to && hasHeld(state, leaf.forMs, context.now);
    }
    case 'numeric_state': {
      const state = context.stateOf(leaf.entityId);

      return (
        state !== undefined && numericHolds(leaf, state) && hasHeld(state, leaf.forMs, context.now)
      );
    }
    case 'time':
    case 'event':
    case 'manual': {
      return false;
    }
  }
}

/** How one leaf reacted to an event. */
type LeafReaction = {
  readonly fires: AutomationRunTrigger | null;
  readonly hold?: HoldIntent;
  readonly cancel?: boolean;
};

/** A leaf that did nothing. */
const NOTHING: LeafReaction = { fires: null };

/**
 * How a state leaf reacts to a change of its entity.
 *
 * @param ref - The leaf and its path.
 * @param leaf - The state trigger.
 * @param event - The change.
 * @returns Its reaction.
 */
function reactState(
  ref: TriggerLeafRef,
  leaf: Extract<AutomationTrigger, { type: 'state' }>,
  event: Extract<TriggerEvent, { kind: 'state' }>,
): LeafReaction {
  const was = tokenOf(event.previous);
  const now = tokenOf(event.current);
  const wantsHold = (leaf.forMs ?? 0) > 0;

  // Whatever else happens, a hold whose entity has left the state it was held in is over.
  const cancel = wantsHold && !accepts(leaf.to, now);

  if (event.previous === undefined || was === now || now === undefined) {
    return cancel ? { fires: null, cancel } : NOTHING;
  }

  if (!accepts(leaf.from, was) || !accepts(leaf.to, now)) {
    return cancel ? { fires: null, cancel } : NOTHING;
  }

  if (wantsHold) {
    return {
      fires: null,
      cancel: true,
      hold: { path: ref.path, ms: leaf.forMs ?? 0, expectToken: now },
    };
  }

  return {
    fires: {
      kind: 'state',
      path: ref.path,
      entityId: leaf.entityId,
      ...(was === undefined ? {} : { from: was }),
      to: now,
    },
  };
}

/**
 * How a numeric leaf reacts to a change of its entity: it fires on crossing into the comparison.
 *
 * @param ref - The leaf and its path.
 * @param leaf - The numeric trigger.
 * @param event - The change.
 * @returns Its reaction.
 */
function reactNumeric(
  ref: TriggerLeafRef,
  leaf: Extract<AutomationTrigger, { type: 'numeric_state' }>,
  event: Extract<TriggerEvent, { kind: 'state' }>,
): LeafReaction {
  const holdsNow = numericHolds(leaf, event.current);
  const wantsHold = (leaf.forMs ?? 0) > 0;

  if (!holdsNow) {
    return wantsHold ? { fires: null, cancel: true } : NOTHING;
  }

  // Coming back from unreachable is not crossing a threshold.
  if (event.previous?.isAvailable !== true) {
    return NOTHING;
  }

  if (numericHolds(leaf, event.previous)) {
    return NOTHING;
  }

  if (wantsHold) {
    return { fires: null, cancel: true, hold: { path: ref.path, ms: leaf.forMs ?? 0 } };
  }

  const value = numericReadingOf(event.current.state);

  return {
    fires: {
      kind: 'numeric_state',
      path: ref.path,
      entityId: leaf.entityId,
      ...(value === undefined ? {} : { value }),
    },
  };
}

/**
 * How a leaf whose hold ran its course reacts: it fires if it is still satisfied.
 *
 * @param ref - The leaf and its path.
 * @param event - The hold that ran its course.
 * @param context - The house.
 * @returns Its reaction.
 */
function reactHold(
  ref: TriggerLeafRef,
  event: Extract<TriggerEvent, { kind: 'hold' }>,
  context: TriggerContext,
): LeafReaction {
  const { leaf } = ref;

  if (leaf.type === 'state') {
    const token = tokenOf(context.stateOf(leaf.entityId));
    const isStill =
      token !== undefined &&
      accepts(leaf.to, token) &&
      (event.expectToken === undefined || event.expectToken === token);

    return isStill
      ? { fires: { kind: 'state', path: ref.path, entityId: leaf.entityId, to: token } }
      : NOTHING;
  }

  if (leaf.type === 'numeric_state') {
    const state = context.stateOf(leaf.entityId);
    const value = state === undefined ? undefined : numericReadingOf(state.state);

    return numericHolds(leaf, state)
      ? {
          fires: {
            kind: 'numeric_state',
            path: ref.path,
            entityId: leaf.entityId,
            ...(value === undefined ? {} : { value }),
          },
        }
      : NOTHING;
  }

  return NOTHING;
}

/**
 * How one leaf reacts to an event.
 *
 * @param ref - The leaf and its path.
 * @param event - What happened.
 * @param context - The house.
 * @returns Its reaction.
 */
function react(ref: TriggerLeafRef, event: TriggerEvent, context: TriggerContext): LeafReaction {
  const { leaf } = ref;

  switch (event.kind) {
    case 'state': {
      if (leaf.type === 'state' && leaf.entityId === event.entityId) {
        return reactState(ref, leaf, event);
      }

      if (leaf.type === 'numeric_state' && leaf.entityId === event.entityId) {
        return reactNumeric(ref, leaf, event);
      }

      return NOTHING;
    }
    case 'time': {
      return leaf.type === 'time' && event.path === ref.path
        ? { fires: { kind: 'time', path: ref.path } }
        : NOTHING;
    }
    case 'hold': {
      return event.path === ref.path ? reactHold(ref, event, context) : NOTHING;
    }
    case 'manual': {
      return leaf.type === 'manual' ? { fires: { kind: 'manual', path: ref.path } } : NOTHING;
    }
  }
}

/**
 * Whether a subtree is satisfied right now.
 *
 * @param tree - The subtree.
 * @param context - The house.
 * @returns True when it is.
 */
function treeSatisfied(tree: TriggerTree, context: TriggerContext): boolean {
  if (isTriggerTreeOp(tree)) {
    return tree.op === 'and'
      ? tree.items.every((item) => treeSatisfied(item, context))
      : tree.items.some((item) => treeSatisfied(item, context));
  }

  return isSatisfied(tree, context);
}

/**
 * Which leaf of a subtree woke it, given how each leaf reacted.
 *
 * @param tree - The subtree.
 * @param path - Its path.
 * @param fired - The leaves that fired, by path.
 * @param context - The house.
 * @returns The trigger that woke it, or null.
 */
function treeFired(
  tree: TriggerTree,
  path: string,
  fired: ReadonlyMap<string, AutomationRunTrigger>,
  context: TriggerContext,
): AutomationRunTrigger | null {
  if (!isTriggerTreeOp(tree)) {
    return fired.get(path) ?? null;
  }

  for (const [index, item] of tree.items.entries()) {
    const woke = treeFired(item, `${path}.${String(index)}`, fired, context);

    if (woke === null) {
      continue;
    }

    if (tree.op === 'or') {
      return woke;
    }

    const othersHold = tree.items.every(
      (other, otherIndex) => otherIndex === index || treeSatisfied(other, context),
    );

    if (othersHold) {
      return woke;
    }
  }

  return null;
}

/**
 * Reacts a trigger tree to one event.
 *
 * @param tree - The automation's triggers.
 * @param event - What happened.
 * @param context - The house and the clock.
 * @returns The trigger that woke the automation if any, and the holds to start and cancel.
 */
export function reactTriggers(
  tree: TriggerTree,
  event: TriggerEvent,
  context: TriggerContext,
): TriggerReaction {
  const fired = new Map<string, AutomationRunTrigger>();
  const holds: HoldIntent[] = [];
  const cancels: string[] = [];

  for (const ref of triggerLeaves(tree)) {
    const reaction = react(ref, event, context);

    if (reaction.cancel === true) {
      cancels.push(ref.path);
    }

    if (reaction.hold !== undefined) {
      holds.push(reaction.hold);
    }

    if (reaction.fires !== null) {
      fired.set(ref.path, reaction.fires);
    }
  }

  return {
    fired: fired.size === 0 ? null : treeFired(tree, 'triggers', fired, context),
    holds,
    cancels,
  };
}
