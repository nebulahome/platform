/**
 * Deciding whether a report changed anything.
 *
 * This is the smallest piece of `core` and the one the rest of the system leans on hardest. A
 * temperature sensor reporting the same value every thirty seconds updates but does not change,
 * and an automation that triggers on change must not fire on every report (ARCHITECTURE.md 5.4).
 * Get this wrong in the permissive direction and every automation in the house fires twice a
 * minute; get it wrong in the strict direction and none of them ever fire.
 */
import type { CapabilityState } from '@nebula-home/contracts';

/**
 * Applies a report on top of what is already known.
 *
 * Reports are **partial by capability**. A dimmable colour bulb declares `on_off`, `level` and
 * `color_hs`, and an adapter that observed only a brightness change reports only `level`. Taking
 * the report as the whole truth would erase the other two, and the interface would show a lamp
 * with no colour every time somebody dimmed it.
 *
 * A capability the report does mention is replaced wholesale rather than merged field by field:
 * the fields of one capability are one observation, and mixing a new hue with an old saturation
 * would produce a colour the device never reported.
 *
 * @param previous - What the registry holds now.
 * @param reported - What the adapter just observed.
 * @returns The two combined, with the report winning where the two overlap.
 */
export function mergeCapabilityState(
  previous: CapabilityState,
  reported: CapabilityState,
): CapabilityState {
  // Validated values never carry an explicit `undefined` - a capability absent from a report is
  // absent from the parsed object - so a plain spread cannot erase anything by accident.
  return { ...previous, ...reported };
}

/**
 * Compares two values that came out of JSON.
 *
 * Written out rather than delegating to `JSON.stringify`, which reports two identical states as
 * different when their keys were inserted in a different order - which happens as soon as one
 * state came from a merge and the other from a database row.
 *
 * @param left - One value.
 * @param right - The other.
 * @returns True when the two are structurally identical.
 */
function areValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }

    return left.every((value, index) => areValuesEqual(value, right[index]));
  }

  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return false;
  }

  const leftEntries = Object.entries(left);

  if (leftEntries.length !== Object.keys(right).length) {
    return false;
  }

  return leftEntries.every(
    ([key, value]) =>
      Object.hasOwn(right, key) && areValuesEqual(value, (right as Record<string, unknown>)[key]),
  );
}

/**
 * Reports whether an entity's state actually differs.
 *
 * @param previous - The state before the report.
 * @param next - The state after merging the report in.
 * @returns True when something a subscriber would care about differs.
 */
export function hasStateChanged(previous: CapabilityState, next: CapabilityState): boolean {
  return !areValuesEqual(previous, next);
}

/**
 * Reports whether two sets of free-form attributes differ.
 *
 * Attributes are outside the capability model - whatever an adapter reports that no capability
 * covers - but they are shown in the interface, so a change in them is still a change.
 *
 * @param previous - The attributes before the report.
 * @param next - The attributes after it.
 * @returns True when they differ.
 */
export function haveAttributesChanged(previous: unknown, next: unknown): boolean {
  return !areValuesEqual(previous, next);
}
