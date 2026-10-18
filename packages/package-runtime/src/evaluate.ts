/**
 * Reading a value out of a payload, given a path.
 *
 * Forty lines rather than an expression engine, because of what the ceiling in `profile.ts`
 * already decided. A path cannot branch, cannot loop and cannot call anything, so there is no
 * evaluation to time-box, no recursion to bound and no sandbox to build: resolving one is a walk
 * down an object, and the worst a malicious path can do is find nothing.
 *
 * That is worth stating plainly, because the obvious move was to reach for an expression library
 * and cap it. Capping is what you do when the language is more powerful than you need. Here the
 * language is exactly as powerful as needed, and the cap is the grammar.
 */
import { PATH_PATTERN } from './expression.js';
import type { ClaimCondition } from './profile.js';

/** One step of a path: a key, or an index into an array. */
type Segment = { readonly key: string } | { readonly index: number };

/** Matches each segment of an already-validated path, in order. */
const SEGMENT_PATTERN = /([A-Za-z_][A-Za-z0-9_]*)|'([^']+)'|\[([0-9]+)\]/g;

/**
 * Splits a path into the steps that walk it.
 *
 * @param path - The path to split.
 * @returns Its segments, in order.
 */
function segmentsOf(path: string): Segment[] {
  const segments: Segment[] = [];

  for (const [, name, quoted, index] of path.matchAll(SEGMENT_PATTERN)) {
    if (index !== undefined) {
      segments.push({ index: Number(index) });
    } else {
      segments.push({ key: name ?? quoted ?? '' });
    }
  }

  return segments;
}

/**
 * Reads whatever a path names, if anything is there.
 *
 * @param payload - What to read from. Anything at all, since it arrived off a wire.
 * @param path - Where to look.
 * @returns The value, or undefined when the path names nothing. A device that stopped reporting
 * a field leaves the entity as it was rather than taking the integration down: absence is an
 * ordinary answer here.
 * @throws {Error} When the path is not one the grammar admits. Everything reaching this function
 * has already been validated by the profile schema, so this is the second line of defence - but
 * silently resolving a malformed path to undefined would turn a profile bug into a permanent
 * no-op, which is precisely the failure the declarative tier is built to avoid.
 */
export function resolvePath(payload: unknown, path: string): unknown {
  return walk(payload, segmentsOf(checked(path)));
}

/**
 * Says whether a path names a value, where the report carries the place it would be.
 *
 * The one reading where absence is an answer: an update the device no longer offers is simply
 * gone from `available_updates`, and that disappearance is the news. It is only an answer when the
 * object that would hold the value is there, though - a report that does not carry
 * `available_updates` at all says nothing about updates, and yields nothing, like every other read.
 *
 * @param payload - What to read from.
 * @param path - Where to look.
 * @returns True when a value other than null is there, false when the object that would hold it
 * is there without it, and undefined when that object is not.
 * @throws {Error} When the path is not one the grammar admits.
 */
export function resolvePresence(payload: unknown, path: string): boolean | undefined {
  const segments = segmentsOf(checked(path));
  const last = segments.pop();
  const holder = walk(payload, segments);

  if (last === undefined || holder === null || typeof holder !== 'object') {
    return undefined;
  }

  const value = step(holder, last);

  return value !== undefined && value !== null;
}

/**
 * Refuses a path the grammar does not admit.
 *
 * @param path - The path.
 * @returns The same path.
 * @throws {Error} When it is not a payload path.
 */
function checked(path: string): string {
  if (!PATH_PATTERN.test(path)) {
    throw new Error(`Not a payload path: ${path}`);
  }

  return path;
}

/**
 * Takes one step into a value.
 *
 * @param current - Where the walk is.
 * @param segment - The step.
 * @returns What is there, or undefined when nothing is.
 */
function step(current: unknown, segment: Segment): unknown {
  if ('index' in segment) {
    return Array.isArray(current) ? current[segment.index] : undefined;
  }

  return typeof current === 'object' && current !== null
    ? (current as Record<string, unknown>)[segment.key]
    : undefined;
}

/**
 * Walks every step of a path.
 *
 * @param payload - Where to start.
 * @param segments - The steps.
 * @returns What the steps reach, or undefined when one of them finds nothing.
 */
function walk(payload: unknown, segments: readonly Segment[]): unknown {
  let current: unknown = payload;

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }

    current = step(current, segment);
  }

  return current;
}

/**
 * Decides whether one condition holds.
 *
 * The same forms wherever a condition is written - a driver's claim, a vendor's match on an
 * announcement or on a Matter device - so there is one reading of each.
 *
 * @param condition - What to check.
 * @param payload - What the scan, the probe or the announcement said.
 * @returns True when it holds.
 */
export function conditionHolds(condition: ClaimCondition, payload: unknown): boolean {
  const value = resolvePath(payload, condition.path);

  if ('exists' in condition) {
    return value !== undefined && value !== null;
  }

  if ('oneOf' in condition) {
    return condition.oneOf.some((candidate) => candidate === value);
  }

  if ('startsWith' in condition) {
    return (
      typeof value === 'string' &&
      value.toLowerCase().startsWith(condition.startsWith.toLowerCase())
    );
  }

  if ('endsWith' in condition) {
    return (
      typeof value === 'string' && value.toLowerCase().endsWith(condition.endsWith.toLowerCase())
    );
  }

  if ('contains' in condition) {
    const wanted = condition.contains;

    if (Array.isArray(value)) {
      return value.includes(wanted);
    }

    return (
      typeof value === 'string' &&
      typeof wanted === 'string' &&
      value.toLowerCase().includes(wanted.toLowerCase())
    );
  }

  if ('equals' in condition) {
    return value === condition.equals;
  }

  return (
    typeof value === 'number' &&
    (condition.min === undefined || value >= condition.min) &&
    (condition.max === undefined || value <= condition.max)
  );
}
