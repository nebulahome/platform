/**
 * A device's activity: what changed on it, newest first.
 *
 * Read from the state history that `core` already writes, not from a log of its own. Every
 * notable change is stored there with the state it left and the state it reached, so a second
 * table would hold the same rows twice. The activity keeps what a person scanning a device wants
 * to see - things switching, opening, changing mode, going offline - and leaves numeric readings
 * to the history charts, where a power meter's second-by-second values belong.
 */
import { z } from 'zod';

import { entityIdSchema } from './entity-id.js';
import { changeContextSchema, sourceRefSchema } from './entity-state.js';
import { jsonObjectSchema } from './json.js';
import { timestampSchema } from './timestamp.js';

/**
 * What kind of thing happened.
 *
 * `state` when what the entity reports changed; `availability` when only its reachability did,
 * which is the device going offline or coming back.
 */
export const ACTIVITY_KINDS = ['state', 'availability'] as const;

/** What kind of thing happened. */
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** One thing that happened on a device. */
export const activityEntrySchema = z.object({
  /** When it happened. */
  time: timestampSchema,

  /** The entity it happened to. */
  entityId: entityIdSchema,

  kind: z.enum(ACTIVITY_KINDS),

  /** What the entity reported before, when anything had been reported. */
  from: jsonObjectSchema.nullable(),

  /** What it reported after. */
  to: jsonObjectSchema,

  /** Whether it was reachable after the change. */
  isAvailable: z.boolean(),

  /** Whether it was reachable before, when there was a before. */
  wasAvailable: z.boolean().nullable(),

  /** Which adapter or engine reported it. */
  source: sourceRefSchema,

  /** What caused it, when that is known. */
  context: changeContextSchema.optional(),
});

/** One thing that happened on a device. */
export type ActivityEntry = z.output<typeof activityEntrySchema>;
