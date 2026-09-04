/**
 * The one way a moment in time is validated at a boundary.
 *
 * Every timestamp in the platform is a `Date` in memory and an ISO 8601 string on the wire,
 * because JSON has no date type. A schema written as `z.date()` therefore accepts a value built
 * in this process and rejects the identical value after a round trip through the bus - which
 * would mean two schemas for every shape that carries a time, one per side of the boundary, and
 * two places to forget a field.
 *
 * This accepts both forms and always produces a `Date`.
 */
import { z } from 'zod';

/**
 * A moment in time, given either as a `Date` or as an ISO 8601 string with a zone.
 *
 * Deliberately not `z.coerce.date()`. That runs `new Date(value)` on whatever it is handed, and
 * `new Date(null)` is a valid date at the Unix epoch - so a report that omitted its timestamp
 * would arrive dated 1 January 1970 instead of being rejected, and the entity would appear to
 * have last changed fifty years ago.
 */
export const timestampSchema = z.union([
  z.date(),
  z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
]);

/** A moment in time, always a `Date` once validated. */
export type Timestamp = z.output<typeof timestampSchema>;
