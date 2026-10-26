/**
 * How an entity is presented over HTTP, and how one is commanded.
 *
 * Deliberately not {@link EntityState} re-exported. The bus carries what an entity *is*; the
 * interface needs what a person calls it and which room it is in, which live in the registry
 * rather than in the state. Joining the two here means a card can be drawn from one response
 * instead of three.
 */
import { z } from 'zod';

import { capabilityNameSchema } from './capabilities.js';
import { entityIdSchema } from './entity-id.js';
import { changeContextSchema, sourceRefSchema } from './entity-state.js';
import { shownAsSchema } from './entity-types.js';
import { iconIdSchema } from './icons.js';
import { integrationIdSchema } from './integrations.js';
import { jsonObjectSchema } from './json.js';
import { entityLinkViewSchema } from './links.js';
import { TAGS_PER_ROW_MAXIMUM, tagKeySchema } from './tags.js';
import { timestampSchema } from './timestamp.js';

/** One capability an entity declares, with the parameters that describe its range. */
export const entityCapabilitySchema = z.object({
  /** Which capability. */
  capability: capabilityNameSchema,

  /** Its declared parameters, such as the minimum and maximum of a thermostat. */
  params: jsonObjectSchema.default({}),
});

/** One capability an entity declares. */
export type EntityCapability = z.output<typeof entityCapabilitySchema>;

/**
 * One entity, as the interface reads it.
 *
 * `name` and `area` are the registry's, not the adapter's: an adapter reports
 * `light.hallway_ceiling`, a person calls it "Ceiling" and looks for it in "Hallway".
 */
export const entityViewSchema = z.object({
  /** `<domain>.<object_id>`. The address, used by automations, aliases and this API. */
  entityId: entityIdSchema,

  /** The domain half of the identifier, lifted out so a client need not split the string. */
  domain: z.string(),

  /** What the owner calls it. */
  name: z.string(),

  /** An icon name, when one has been chosen. */
  icon: z.string().nullable(),

  /** The area key, or null when it has not been placed in one. */
  areaKey: z.string().nullable(),

  /** The area's display name, or null. */
  areaName: z.string().nullable(),

  /** The device that exposes it, when it comes from one. */
  deviceId: z.uuid().nullable(),

  /** Which package or engine owns it. */
  source: sourceRefSchema,

  /** Unit for numeric sensors, e.g. `°C`. */
  unitOfMeasurement: z.string().nullable(),

  /** The narrower kind, e.g. `temperature`, used to pick an icon and a formatter. */
  deviceClass: z.string().nullable(),

  /** Whether the entity is disabled in the registry. A disabled entity reports no state. */
  isEnabled: z.boolean(),

  /** Whether the interface hides it by default. */
  isHidden: z.boolean(),

  /** What it can be asked to do. */
  capabilities: z.array(entityCapabilitySchema),

  /** Free-text synonyms the search box matches on. */
  searchAliases: z.array(z.string()).default([]),

  /** The current state, one entry per capability. Absent when nothing has reported yet. */
  state: jsonObjectSchema.nullable(),

  /** Extras the adapter reports that no capability covers. */
  attributes: jsonObjectSchema.default({}),

  /** False when the owning adapter cannot currently reach the device. */
  isAvailable: z.boolean(),

  /** When the state last differed from what it was. */
  lastChanged: timestampSchema.nullable(),

  /** When a report last arrived, changed or not. */
  lastUpdated: timestampSchema.nullable(),

  /** The tags on it, by id; the tags themselves come from `GET /tags`. */
  tagIds: z.array(z.uuid()).default([]),

  /**
   * The other addresses that mean this entity: those of the entities linked to it, which read
   * the same thing another way. Empty unless it is linked.
   */
  addresses: z.array(entityIdSchema).default([]),

  /** How it is read when it is linked: its sources and which way it prefers; null otherwise. */
  linked: entityLinkViewSchema.nullable().default(null),

  /** Its key in its transport (`switch:0`), when the integration names one. */
  key: z.string().nullable().default(null),

  /** When the house first had it. */
  createdAt: timestampSchema.nullable().default(null),

  /**
   * What its integration says it is, when the owner shows it as something else: `domain` and
   * `deviceClass` above are what it is shown as. Null while it is shown as it is.
   */
  original: z
    .object({ domain: z.string(), deviceClass: z.string().nullable() })
    .nullable()
    .default(null),
});

/** One entity, as the interface reads it. */
export type EntityView = z.output<typeof entityViewSchema>;

/**
 * What changing an entity accepts: what a person calls it, what it is drawn as, and the tags on
 * it. The identifier is not here - it is what automations and history name the entity by, and
 * renaming in the interface changes `name`, never that.
 */
export const entityUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(128),

    /** A catalogue icon, or null to have none. */
    icon: iconIdSchema.nullable(),

    /** Every tag the entity should carry - the whole set, replacing what it had. */
    tagIds: z.array(z.uuid()).max(TAGS_PER_ROW_MAXIMUM),

    /**
     * For a linked entity: the way it is read first, overriding its device's choice; null to
     * follow the device.
     */
    transport: integrationIdSchema.nullable(),

    /**
     * What to show it as instead of what its integration says: a relay as a light, motion as
     * presence (`entity-types.ts`); null to show it as it is.
     */
    shownAs: shownAsSchema.nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' });

/** What changing an entity accepts. */
export type EntityUpdate = z.output<typeof entityUpdateSchema>;

/** How a collection of entities may be narrowed. */
export const entityQuerySchema = z.object({
  /** Only entities in this area. */
  area: z.string().max(64).optional(),

  /** Only entities of this domain, e.g. `light`. */
  domain: z.string().max(32).optional(),

  /** Only entities declaring this capability. */
  capability: capabilityNameSchema.optional(),

  /** Only entities carrying this tag, by its key. */
  tag: tagKeySchema.optional(),

  /** Matches the name, the identifier and the search aliases. */
  search: z.string().max(128).optional(),

  /** Include entities the interface hides by default. */
  includeHidden: z.stringbool().default(false),
});

/** How a collection of entities may be narrowed. */
export type EntityQuery = z.output<typeof entityQuerySchema>;

/**
 * What `POST /api/v1/entities/:entityId/capabilities/:capability/commands` accepts.
 *
 * The same shape the bus carries, because this endpoint is a translation and nothing more. The
 * command object itself is validated by `core` against the target capability's schema - `api`
 * cannot do it, since which schema applies depends on a capability named in the path.
 */
export const entityCommandRequestSchema = z.object({
  /** The command and its arguments, such as `{ command: 'set_level', level: 40 }`. */
  command: jsonObjectSchema,

  /**
   * What caused it.
   *
   * Optional, and overwritten with the caller's own identity when absent: a command that
   * arrived over HTTP was caused by whoever sent it, and letting a client claim otherwise would
   * make the audit trail worthless.
   */
  context: changeContextSchema.optional(),
});

/** What the command endpoint accepts. */
export type EntityCommandRequest = z.output<typeof entityCommandRequestSchema>;

/**
 * What the command endpoint answers, with `202 Accepted`.
 *
 * An acknowledgement that the owning adapter took the command, not a report that the device
 * did the thing. The new state arrives separately, over the WebSocket or on the next read.
 */
export const entityCommandResponseSchema = z.object({
  entityId: entityIdSchema,
  capability: capabilityNameSchema,

  /** When the owning adapter accepted it. */
  acceptedAt: timestampSchema,

  /** Echoed from `Idempotency-Key` when one was sent, so a retry can be recognised. */
  idempotencyKey: z.string().nullable(),
});

/** What the command endpoint answers. */
export type EntityCommandResponse = z.output<typeof entityCommandResponseSchema>;
