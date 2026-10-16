/**
 * Reading a window of history for several entities at once: what a package's server asks `core`
 * for (`ctx.history`, `svc.core.history_states` and `svc.core.history_telemetry`).
 *
 * The API pages history newest first, one entity at a time, for a person scrolling back. A
 * package wants the window whole, for a handful of entities, to work something out from it: so a
 * read names the entities and the window, and the answer holds each entity's points oldest first,
 * up to a limit. A window longer than the limit loses its oldest points and says so, never the
 * newest - the end a chart or a replay starts from.
 */
import { z } from 'zod';

import {
  stateHistoryPointSchema,
  TELEMETRY_RESOLUTIONS,
  telemetryPointSchema,
} from './api-history.js';
import { entityIdSchema } from './entity-id.js';
import { timestampSchema } from './timestamp.js';

/** The most entities one read may name. */
export const HISTORY_READ_MAX_ENTITIES = 64;

/** The most points one read returns for one entity. */
export const HISTORY_READ_MAX_POINTS = 10_000;

/** A minute, an hour and a day, in milliseconds. */
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * The rolled-up level of telemetry a window reads best at, by its length.
 *
 * @param spanMs - How long the window is, in milliseconds.
 * @returns Raw readings up to an hour, minutes up to a day and a bit, hours up to a couple of
 * months, days beyond: each keeps a chart within a couple of thousand points.
 */
export function telemetryResolutionForSpan(spanMs: number): (typeof TELEMETRY_RESOLUTIONS)[number] {
  if (spanMs <= HOUR_MS) {
    return 'raw';
  }

  if (spanMs <= 30 * HOUR_MS) {
    return '1m';
  }

  return spanMs <= 80 * DAY_MS ? '1h' : '1d';
}

/** `svc.core.history_states`: which entities, over which window, how many points each at most. */
export const historyStatesRequestSchema = z
  .strictObject({
    entityIds: z.array(entityIdSchema).min(1).max(HISTORY_READ_MAX_ENTITIES),

    /** Inclusive. */
    from: timestampSchema,

    /** Exclusive. */
    to: timestampSchema,

    limit: z.int().min(1).max(HISTORY_READ_MAX_POINTS).default(HISTORY_READ_MAX_POINTS),
  })
  .refine((request) => request.from.getTime() < request.to.getTime(), {
    message: 'The window starts at or after it ends',
    path: ['from'],
  });

/** Which entities, over which window. */
export type HistoryStatesRequest = z.output<typeof historyStatesRequestSchema>;

/** `svc.core.history_telemetry`: which entities, over which window, at which resolution. */
export const historyTelemetryRequestSchema = z
  .strictObject({
    entityIds: z.array(entityIdSchema).min(1).max(HISTORY_READ_MAX_ENTITIES),
    from: timestampSchema,
    to: timestampSchema,
    resolution: z.enum(TELEMETRY_RESOLUTIONS),
    limit: z.int().min(1).max(HISTORY_READ_MAX_POINTS).default(HISTORY_READ_MAX_POINTS),
  })
  .refine((request) => request.from.getTime() < request.to.getTime(), {
    message: 'The window starts at or after it ends',
    path: ['from'],
  });

/** Which entities, over which window, at which resolution. */
export type HistoryTelemetryRequest = z.output<typeof historyTelemetryRequestSchema>;

/** The changes of each entity read, oldest first; an entity never recorded has none. */
export const historyStatesReplySchema = z.strictObject({
  series: z.record(entityIdSchema, z.array(stateHistoryPointSchema)),

  /** The entities whose window held more than the limit: their oldest points are missing. */
  truncated: z.array(entityIdSchema),
});

/** The changes of each entity read. */
export type HistoryStatesReply = z.output<typeof historyStatesReplySchema>;

/** The readings of each entity read, oldest first. */
export const historyTelemetryReplySchema = z.strictObject({
  series: z.record(entityIdSchema, z.array(telemetryPointSchema)),
  truncated: z.array(entityIdSchema),
  resolution: z.enum(TELEMETRY_RESOLUTIONS),
});

/** The readings of each entity read. */
export type HistoryTelemetryReply = z.output<typeof historyTelemetryReplySchema>;
