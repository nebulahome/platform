/**
 * Entity states for the automation domain's tests.
 */
import { parseEntityId, type CapabilityState, type EntityState } from '@nebulahome/contracts';

/**
 * A state as the registry would hold it.
 *
 * @param entityId - The entity.
 * @param state - Its capability state.
 * @param options - Whether it is reachable, and when it last changed.
 * @param options.isAvailable - Whether the adapter can reach it; reachable when absent.
 * @param options.lastChanged - When its state last changed.
 * @returns The state.
 */
export function entityState(
  entityId: string,
  state: CapabilityState,
  options: { isAvailable?: boolean; lastChanged?: Date } = {},
): EntityState {
  const lastChanged = options.lastChanged ?? new Date('2026-10-09T10:00:00Z');

  return {
    entityId: parseEntityId(entityId),
    state,
    attributes: {},
    isAvailable: options.isAvailable ?? true,
    lastChanged,
    lastUpdated: lastChanged,
    source: 'pkg-test',
  };
}

/**
 * A look-up over some states.
 *
 * @param states - The states.
 * @returns `stateOf`.
 */
export function statesOf(...states: EntityState[]): (entityId: string) => EntityState | undefined {
  const byId = new Map(states.map((state) => [String(state.entityId), state]));

  return (entityId) => byId.get(entityId);
}
