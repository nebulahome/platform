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
  if (!PATH_PATTERN.test(path)) {
    throw new Error(`Not a payload path: ${path}`);
  }

  let current: unknown = payload;

  for (const segment of segmentsOf(path)) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if ('index' in segment) {
      current = Array.isArray(current) ? current[segment.index] : undefined;
      continue;
    }

    current =
      typeof current === 'object' ? (current as Record<string, unknown>)[segment.key] : undefined;
  }

  return current;
}
