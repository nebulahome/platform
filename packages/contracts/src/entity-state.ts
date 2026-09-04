/**
 * The state of an entity as `core` holds it and as every other service receives it.
 *
 * This is the single shape that travels from an adapter's report, through `core`'s in-memory
 * registry, into `registry.entity_states`, out over the bus and up to the API. One definition
 * for all five, because a state that means something slightly different at each hop is how a
 * light ends up shown as on while it is off.
 *
 * Defined in ARCHITECTURE.md 5.4.
 */
import { z } from 'zod';

import { capabilityStateSchema } from './capabilities.js';
import { entityIdSchema } from './entity-id.js';
import { jsonObjectSchema } from './json.js';

/**
 * What caused a state to change.
 *
 * Recorded on every change so that "why did this light turn on?" is answerable. Without it the
 * history is a list of things that happened with no way to attribute any of them.
 */
export const CONTEXT_TYPES = ['automation', 'scene', 'user', 'device', 'alias', 'startup'] as const;

/** The kind of thing that caused a state change. */
export type ContextType = (typeof CONTEXT_TYPES)[number];

/** What caused a change, and which one. */
export const changeContextSchema = z.object({
  type: z.enum(CONTEXT_TYPES),

  /**
   * Identifier of the cause: an automation run, a scene, a user. Absent for `device` and
   * `startup`, where the cause has no identity worth recording.
   */
  id: z.uuid().optional(),
});

/** What caused a change, and which one. */
export type ChangeContext = z.output<typeof changeContextSchema>;

/**
 * Where a state came from.
 *
 * The id of the owning package for an adapter entity, or one of the two reserved values for
 * entities the platform itself produces. Mirrors `registry.entity_states.source`.
 */
export const sourceRefSchema = z.union([
  z.literal('derived'),
  z.literal('system'),
  z.string().regex(/^[a-z][a-z0-9-]{1,63}$/, 'Must be a package id'),
]);

/** Where a state came from: a package id, `derived`, or `system`. */
export type SourceRef = z.output<typeof sourceRefSchema>;

/** The complete state of one entity. */
export const entityStateSchema = z.object({
  entityId: entityIdSchema,

  /** One entry per capability the entity declares. */
  state: capabilityStateSchema,

  /** Free-form extras an adapter reports that no capability covers. */
  attributes: jsonObjectSchema.default({}),

  /** False when the owning adapter cannot currently reach the device. */
  isAvailable: z.boolean().default(true),

  /**
   * When `state` last differed from what it was.
   *
   * Distinct from `lastUpdated` on purpose: a temperature sensor reporting the same value every
   * thirty seconds updates but does not change, and an automation triggering on change must not
   * fire on every report.
   */
  lastChanged: z.date(),

  /** When a report last arrived, whether or not it changed anything. */
  lastUpdated: z.date(),

  /** Which adapter or engine produced this state. */
  source: sourceRefSchema,

  /** What caused the last change, when it is known. */
  context: changeContextSchema.optional(),
});

/** The complete state of one entity. */
export type EntityState = z.output<typeof entityStateSchema>;

/**
 * What an adapter publishes when a device reports.
 *
 * Deliberately smaller than {@link entityStateSchema}: an adapter reports what it observed, and
 * `core` is the single writer that decides `lastChanged`, resolves the context and persists the
 * result. An adapter that could set `lastChanged` itself would be a second writer of the
 * registry's most load-bearing field.
 */
export const stateReportSchema = z.object({
  entityId: entityIdSchema,
  state: capabilityStateSchema,
  attributes: jsonObjectSchema.optional(),
  isAvailable: z.boolean().optional(),

  /** When the device reported, if the adapter knows. `core` uses its own clock otherwise. */
  observedAt: z.date().optional(),
});

/** What an adapter publishes when a device reports. */
export type StateReport = z.output<typeof stateReportSchema>;

/** What `core` fans out after a report changed something. */
export const stateChangedEventSchema = z.object({
  entityId: entityIdSchema,
  current: entityStateSchema,

  /** The state before this change. Absent on the first report after startup. */
  previous: entityStateSchema.optional(),
});

/** What `core` fans out after a report changed something. */
export type StateChangedEvent = z.output<typeof stateChangedEventSchema>;
