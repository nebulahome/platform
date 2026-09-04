/**
 * Commanding an entity, on both hops of the journey.
 *
 * A command is published on `nebula.v1.cmd.<entityId>.<capability>`, which `core` answers. The
 * subject already names the entity and the capability, so the payload carries only the command
 * itself - repeating the target in the body would create two sources of truth for where a
 * command is going, and the routing uses the subject.
 *
 * `core` then forwards it to the owning adapter as a **service call**,
 * `nebula.v1.svc.<packageId>.command`, rather than by republishing the same subject. There is
 * only one command subject in the taxonomy (ARCHITECTURE.md 7.2) and `core` is subscribed to it,
 * so republishing would deliver the command straight back to `core`.
 */
import { z } from 'zod';

import { capabilityNameSchema } from './capabilities.js';
import { entityIdSchema } from './entity-id.js';
import { changeContextSchema } from './entity-state.js';
import { jsonObjectSchema } from './json.js';
import { timestampSchema } from './timestamp.js';

/** The method name an adapter answers commands on. */
export const ADAPTER_COMMAND_METHOD = 'command';

/**
 * What a caller publishes to command an entity.
 *
 * `command` is left as a plain object here and validated against the target capability's own
 * schema by `core`. It cannot be typed at this level: the schema that applies depends on the
 * capability named in the subject, and there is no capability yet when this schema is written.
 */
export const capabilityCommandRequestSchema = z.object({
  /** The command and its arguments, such as `{ command: 'set_level', level: 40 }`. */
  command: jsonObjectSchema,

  /**
   * What caused the command.
   *
   * Carried through to the state change it produces, which is what makes "why did this light
   * turn on?" answerable rather than a guess.
   */
  context: changeContextSchema.optional(),
});

/** What a caller publishes to command an entity. */
export type CapabilityCommandRequest = z.output<typeof capabilityCommandRequestSchema>;

/**
 * What `core` replies once the owning adapter has accepted a command.
 *
 * An acknowledgement, not a result: the adapter confirms it has accepted the command, and the
 * device reaching the commanded state arrives separately as a state report. A reply that waited
 * for the new state would block for the length of a two-minute cover transition.
 */
export const commandAckSchema = z.object({
  entityId: entityIdSchema,
  capability: capabilityNameSchema,

  /** When the owning adapter accepted it. */
  acceptedAt: timestampSchema,
});

/** What `core` replies once the owning adapter has accepted a command. */
export type CommandAck = z.output<typeof commandAckSchema>;

/**
 * What `core` sends to the adapter that owns the entity.
 *
 * The target is repeated in the body on this hop, because the subject addresses the *adapter*
 * rather than the entity - one adapter owns many entities, and the subject cannot say which.
 */
export const adapterCommandSchema = z.object({
  entityId: entityIdSchema,
  capability: capabilityNameSchema,

  /** Already validated against the capability's command schema by `core`. */
  command: jsonObjectSchema,
});

/** What `core` sends to the adapter that owns the entity. */
export type AdapterCommand = z.output<typeof adapterCommandSchema>;

/** What an adapter replies when it has accepted a command. */
export const adapterAckSchema = z.object({
  /** When the adapter accepted it. */
  acceptedAt: timestampSchema,
});

/** What an adapter replies when it has accepted a command. */
export type AdapterAck = z.output<typeof adapterAckSchema>;
