/**
 * Whether something that just happened wakes an automation.
 *
 * Something happening is an event: an entity changed, a time or sun trigger's moment came, a hold
 * ran its course, or somebody asked. Each trigger reacts to an event by firing, by starting or
 * cancelling a hold (an entity trigger with "for at least"), or not at all. The triggers are a
 * list and any one of them wakes the automation; a trigger turned off reacts to nothing.
 *
 * **Coming back is not a change.** A device that drops off the network and returns did not turn
 * on; an entity going to or from `unavailable` fires only a trigger that names `unavailable`.
 *
 * Pure: the state of the house and the clock come in through the context.
 */
import {
  isBlockEnabled,
  numericReadingOf,
  stateTokenOf,
  STATE_TOKEN_UNAVAILABLE,
  SUN_ELEVATION_ENTITY_ID,
  type AutomationRunTrigger,
  type AutomationTrigger,
  type ComparisonOperator,
  type EntityChange,
  type EntityState,
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

/** What the triggers can see of the house. */
export type TriggerContext = {
  /** The live state of an entity. */
  readonly stateOf: (entityId: string) => EntityState | undefined;

  /** Now. */
  readonly now: Date;
};

/** A trigger and where it sits: `triggers.1`, or `then.2.trigger` for a wait. */
export type TriggerLeafRef = {
  readonly path: string;
  readonly leaf: AutomationTrigger;
};

/** A hold to start: fire this trigger after `ms` if it is still satisfied then. */
export type HoldIntent = {
  readonly path: string;
  readonly ms: number;

  /** The state token the entity must still be in, for a state change. */
  readonly expectToken?: string | undefined;
};

/** What an event did to the triggers. */
export type TriggerReaction = {
  /** The trigger that woke the automation, or null. */
  readonly fired: AutomationRunTrigger | null;

  /** Holds to start. */
  readonly holds: readonly HoldIntent[];

  /** Paths of holds to cancel: the entity left the state it was held in. */
  readonly cancels: readonly string[];
};

/** An entity trigger, waiting for a state. */
type EntityTrigger = Extract<AutomationTrigger, { type: 'entity' }>;

/**
 * Lists the triggers that are on, with their paths.
 *
 * A trigger turned off keeps its place - its path is its index in the document, so the editor
 * can point at it - and is simply not listed.
 *
 * @param triggers - The automation's triggers.
 * @param path - Where the list is.
 * @returns The triggers that are on, in document order.
 */
export function triggerLeaves(
  triggers: readonly AutomationTrigger[],
  path = 'triggers',
): TriggerLeafRef[] {
  return triggers.flatMap((leaf, index) =>
    isBlockEnabled(leaf) ? [{ path: `${path}.${String(index)}`, leaf }] : [],
  );
}

/**
 * The entities a list of triggers watches.
 *
 * A sun trigger waiting for the elevation to change watches the sun's elevation entity, which is
 * how it hears the change.
 *
 * @param triggers - The triggers.
 * @returns Each entity once.
 */
export function entitiesOfTriggers(triggers: readonly AutomationTrigger[]): string[] {
  const found = new Set<string>();

  for (const { leaf } of triggerLeaves(triggers)) {
    if (leaf.type === 'entity') {
      found.add(leaf.entityId);
    } else if (leaf.type === 'sun' && leaf.event === 'elevation_changed') {
      found.add(SUN_ELEVATION_ENTITY_ID);
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
 * Whether a trigger's from or to accepts a token. Absent, null or empty means any - except
 * `unavailable`, which only a trigger naming it accepts.
 *
 * @param wanted - What the trigger asks for.
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
 * Whether a numeric change's comparison holds for a state.
 *
 * @param change - The comparison.
 * @param state - The entity's state.
 * @returns True when it holds, false when it does not or there is no reading.
 */
function numericHolds(
  change: Extract<EntityChange, { kind: 'numeric' }>,
  state: EntityState | undefined,
): boolean {
  if (state?.isAvailable !== true) {
    return false;
  }

  const reading = numericReadingOf(state.state);

  return reading !== undefined && compare(change.operator, reading, change.value);
}

/**
 * Whether a trigger has held its state long enough, judged by when the entity last changed.
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
 * Whether what an entity trigger waits for holds right now - for a test from the editor.
 *
 * A state change with a `to` holds while the entity is in that state (for long enough); a number
 * while the comparison holds. A change to any state, and every other kind of trigger, is an
 * instant rather than a condition: null.
 *
 * @param leaf - The trigger.
 * @param context - The house.
 * @returns Whether it holds now, or null when the question does not apply.
 */
export function triggerHoldsNow(leaf: AutomationTrigger, context: TriggerContext): boolean | null {
  if (leaf.type !== 'entity') {
    return null;
  }

  const state = context.stateOf(leaf.entityId);

  if (leaf.change.kind === 'numeric') {
    return (
      state !== undefined &&
      numericHolds(leaf.change, state) &&
      hasHeld(state, leaf.forMs, context.now)
    );
  }

  const { to } = leaf.change;

  if (to === undefined || to === null || to === '') {
    return null;
  }

  return state !== undefined && tokenOf(state) === to && hasHeld(state, leaf.forMs, context.now);
}

/** How one trigger reacted to an event. */
type LeafReaction = {
  readonly fires: AutomationRunTrigger | null;
  readonly hold?: HoldIntent;
  readonly cancel?: boolean;
};

/** A trigger that did nothing. */
const NOTHING: LeafReaction = { fires: null };

/**
 * How an entity trigger waiting for a state reacts to a change of its entity.
 *
 * @param ref - The trigger and its path.
 * @param leaf - The trigger.
 * @param change - What it waits for.
 * @param event - The change.
 * @returns Its reaction.
 */
function reactState(
  ref: TriggerLeafRef,
  leaf: EntityTrigger,
  change: Extract<EntityChange, { kind: 'state' }>,
  event: Extract<TriggerEvent, { kind: 'state' }>,
): LeafReaction {
  const was = tokenOf(event.previous);
  const now = tokenOf(event.current);
  const wantsHold = (leaf.forMs ?? 0) > 0;

  // Whatever else happens, a hold whose entity has left the state it was held in is over.
  const cancel = wantsHold && !accepts(change.to, now);

  if (event.previous === undefined || was === now || now === undefined) {
    return cancel ? { fires: null, cancel } : NOTHING;
  }

  if (!accepts(change.from, was) || !accepts(change.to, now)) {
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
      kind: 'entity',
      path: ref.path,
      entityId: leaf.entityId,
      ...(was === undefined ? {} : { from: was }),
      to: now,
    },
  };
}

/**
 * How an entity trigger waiting for a number reacts: it fires on crossing into the comparison.
 *
 * @param ref - The trigger and its path.
 * @param leaf - The trigger.
 * @param change - The comparison.
 * @param event - The change.
 * @returns Its reaction.
 */
function reactNumeric(
  ref: TriggerLeafRef,
  leaf: EntityTrigger,
  change: Extract<EntityChange, { kind: 'numeric' }>,
  event: Extract<TriggerEvent, { kind: 'state' }>,
): LeafReaction {
  const holdsNow = numericHolds(change, event.current);
  const wantsHold = (leaf.forMs ?? 0) > 0;

  if (!holdsNow) {
    return wantsHold ? { fires: null, cancel: true } : NOTHING;
  }

  // Coming back from unreachable is not crossing a threshold.
  if (event.previous?.isAvailable !== true) {
    return NOTHING;
  }

  if (numericHolds(change, event.previous)) {
    return NOTHING;
  }

  if (wantsHold) {
    return { fires: null, cancel: true, hold: { path: ref.path, ms: leaf.forMs ?? 0 } };
  }

  const value = numericReadingOf(event.current.state);

  return {
    fires: {
      kind: 'entity',
      path: ref.path,
      entityId: leaf.entityId,
      ...(value === undefined ? {} : { value }),
    },
  };
}

/**
 * How a trigger whose hold ran its course reacts: it fires if it is still satisfied.
 *
 * @param ref - The trigger and its path.
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

  if (leaf.type !== 'entity') {
    return NOTHING;
  }

  const state = context.stateOf(leaf.entityId);

  if (leaf.change.kind === 'state') {
    const token = tokenOf(state);
    const isStill =
      token !== undefined &&
      accepts(leaf.change.to, token) &&
      (event.expectToken === undefined || event.expectToken === token);

    return isStill
      ? { fires: { kind: 'entity', path: ref.path, entityId: leaf.entityId, to: token } }
      : NOTHING;
  }

  const value = state === undefined ? undefined : numericReadingOf(state.state);

  return numericHolds(leaf.change, state)
    ? {
        fires: {
          kind: 'entity',
          path: ref.path,
          entityId: leaf.entityId,
          ...(value === undefined ? {} : { value }),
        },
      }
    : NOTHING;
}

/**
 * How one trigger reacts to an event.
 *
 * @param ref - The trigger and its path.
 * @param event - What happened.
 * @param context - The house.
 * @returns Its reaction.
 */
function react(ref: TriggerLeafRef, event: TriggerEvent, context: TriggerContext): LeafReaction {
  const { leaf } = ref;

  switch (event.kind) {
    case 'state': {
      if (leaf.type === 'entity' && leaf.entityId === event.entityId) {
        return leaf.change.kind === 'state'
          ? reactState(ref, leaf, leaf.change, event)
          : reactNumeric(ref, leaf, leaf.change, event);
      }

      if (
        leaf.type === 'sun' &&
        leaf.event === 'elevation_changed' &&
        event.entityId === SUN_ELEVATION_ENTITY_ID &&
        event.current.isAvailable
      ) {
        const value = numericReadingOf(event.current.state);

        return {
          fires: {
            kind: 'sun',
            path: ref.path,
            event: leaf.event,
            entityId: SUN_ELEVATION_ENTITY_ID,
            ...(value === undefined ? {} : { value }),
          },
        };
      }

      return NOTHING;
    }
    case 'time': {
      if (event.path !== ref.path) {
        return NOTHING;
      }

      if (leaf.type === 'time') {
        return { fires: { kind: 'time', path: ref.path } };
      }

      return leaf.type === 'sun'
        ? { fires: { kind: 'sun', path: ref.path, event: leaf.event } }
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
 * Reacts the triggers to one event.
 *
 * @param triggers - The automation's triggers.
 * @param event - What happened.
 * @param context - The house and the clock.
 * @returns The trigger that woke the automation if any, and the holds to start and cancel.
 */
export function reactTriggers(
  triggers: readonly AutomationTrigger[],
  event: TriggerEvent,
  context: TriggerContext,
): TriggerReaction {
  let fired: AutomationRunTrigger | null = null;
  const holds: HoldIntent[] = [];
  const cancels: string[] = [];

  for (const ref of triggerLeaves(triggers)) {
    const reaction = react(ref, event, context);

    if (reaction.cancel === true) {
      cancels.push(ref.path);
    }

    if (reaction.hold !== undefined) {
      holds.push(reaction.hold);
    }

    fired ??= reaction.fires;
  }

  return { fired, holds, cancels };
}
