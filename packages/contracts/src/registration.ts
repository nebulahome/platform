/**
 * Registering a device with `core`, which is the only writer of the registry.
 *
 * The API creates a device - the instance that reaches it and the registry row that names it -
 * and `hub` identifies it: hears from the hardware, learns its serial and what it exposes, and
 * asks `core` to complete the row and write the entities. `hub` writes neither table itself.
 * `core` writes, and updates the in-memory directory it routes commands against; two writers
 * would mean a directory that is stale for as long as it takes `core` to notice, and a command
 * routed at an entity `core` has not heard of.
 *
 * Defined in ARCHITECTURE.md 4.1.
 */
import { z } from 'zod';

import { CAPABILITY_DEFINITIONS, capabilityNameSchema } from './capabilities.js';
import { entityIdSchema } from './entity-id.js';
import { sourceRefSchema } from './entity-state.js';
import { iconIdSchema } from './icons.js';
import { integrationIdSchema } from './integrations.js';
import { jsonObjectSchema } from './json.js';
import { resolveStateClass, sensorRegistrationIssue } from './sensor-classes.js';

/** The bus service name `core` answers registration on. */
export const CORE_SERVICE = 'core';

/** Registers a device and its entities. */
export const CORE_REGISTER_METHOD = 'register';

/** Releases a device: its entities, its identity row and its instance row, in one transaction. */
export const CORE_UNREGISTER_METHOD = 'unregister';

/** Takes in an alias the API has just written or changed. */
export const CORE_SYNC_ALIAS_METHOD = 'sync_alias';

/** Deletes an alias and forgets it, in one step. */
export const CORE_REMOVE_ALIAS_METHOD = 'remove_alias';

/** Reads the system monitor: the host, the recent samples, the disk (system-monitor.ts). */
export const CORE_SYSTEM_MONITOR_METHOD = 'system_monitor';

/**
 * How history should aggregate a numeric entity.
 *
 * `total_increasing` is the one that matters: energy consumed over a day is last minus first,
 * not a sum of averages, and only the integration knows which kind of counter it is reading.
 */
export const ENTITY_STATE_CLASSES = ['measurement', 'total', 'total_increasing'] as const;

/** How history should aggregate a numeric entity. */
export type EntityStateClass = (typeof ENTITY_STATE_CLASSES)[number];

/**
 * What an entity declares it can do, with the device's own limits for each.
 *
 * A partial record rather than a full one: an entity declares the capabilities it has, not every
 * capability that exists. Each capability's parameters are checked against that capability's own
 * schema, because `core` later validates commands against them - `color_temp` without its mired
 * range would be accepted here and then reject every `set_color_temp` for a reason the owner
 * cannot act on.
 */
export const declaredCapabilitiesSchema = z
  .partialRecord(capabilityNameSchema, jsonObjectSchema)
  .refine((declared) => Object.keys(declared).length > 0, {
    message: 'An entity must declare at least one capability',
  })
  .superRefine((declared, ctx) => {
    for (const [capability, params] of Object.entries(declared)) {
      const definition = CAPABILITY_DEFINITIONS[capability as keyof typeof CAPABILITY_DEFINITIONS];
      const result = definition.params.safeParse(params);

      if (!result.success) {
        ctx.addIssue({
          code: 'custom',
          path: [capability],
          message: `Parameters do not match the ${capability} capability`,
        });
      }
    }
  });

/** What an entity declares it can do, with the device's own limits for each. */
export type DeclaredCapabilities = z.output<typeof declaredCapabilitiesSchema>;

/** One entity a device exposes. */
export const entityRegistrationSchema = z
  .object({
    entityId: entityIdSchema,
    name: z.string().min(1).max(128),
    capabilities: declaredCapabilitiesSchema,

    /** The catalogue icon the entity starts with; the owner's choice, once made, outlives it. */
    icon: iconIdSchema.optional(),
    unitOfMeasurement: z.string().max(32).optional(),
    deviceClass: z.string().max(64).optional(),
    stateClass: z.enum(ENTITY_STATE_CLASSES).optional(),
    displayPrecision: z.int().min(0).max(6).optional(),
  })
  .superRefine((entity, ctx) => {
    const issue = sensorRegistrationIssue(entity);

    if (issue !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['unitOfMeasurement'],
        message: issue,
      });
    }
  })
  .transform((entity) => {
    const stateClass = resolveStateClass(entity.deviceClass, entity.stateClass);

    if (stateClass === undefined || stateClass === entity.stateClass) {
      return entity;
    }

    return { ...entity, stateClass };
  });

/** One entity a device exposes. */
export type EntityRegistration = z.output<typeof entityRegistrationSchema>;

/**
 * Asks `core` to complete the device an instance has identified.
 *
 * Strict, so that what the hardware says about itself cannot reach the fields the owner set:
 * the row already has the name and the icon the owner chose, and a request carrying a `name`
 * is refused rather than quietly dropped.
 */
export const registerDeviceRequestSchema = z.strictObject({
  /** The instance that owns it - which is the device's own id - and that `core` routes to. */
  integrationId: integrationIdSchema,

  /** The hardware's own identifier: the serial on the broker, the id the relay answers with. */
  externalId: z.string().min(1).max(256),

  manufacturer: z.string().max(128).optional(),
  model: z.string().max(128).optional(),
  swVersion: z.string().max(64).optional(),
  hwVersion: z.string().max(64).optional(),

  /**
   * What the owner needs to find the device again after a restart.
   *
   * Kept in `registry.devices.config` and handed back to nobody but the owner: for `hub` it is
   * the claim - how the transport addresses the device and what it was recognised from - which
   * is what lets an instance bind its device again when it starts, rather than listening for
   * it a second time. Opaque to `core`.
   */
  config: jsonObjectSchema.default({}),

  /** At least one: a device row nothing points at is a device the interface cannot explain. */
  entities: z.array(entityRegistrationSchema).min(1),
});

/** Asks `core` to complete the device an instance has identified. */
export type RegisterDeviceRequest = z.output<typeof registerDeviceRequestSchema>;

/** What `core` wrote. */
export const registerDeviceReplySchema = z.object({
  deviceId: z.uuid(),
  entityIds: z.array(entityIdSchema).min(1),
});

/** What `core` wrote. */
export type RegisterDeviceReply = z.output<typeof registerDeviceReplySchema>;

/**
 * Asks `core` to release a device the owner is removing.
 *
 * Strict, and only the id: which rows go is not the caller's to choose. `core` deletes the
 * entities, the identity row and the instance row together, because the entities restrict the
 * instance's deletion and the directory it routes by must forget them in the same step.
 */
export const unregisterDeviceRequestSchema = z.strictObject({
  integrationId: integrationIdSchema,
});

/** Asks `core` to release a device the owner is removing. */
export type UnregisterDeviceRequest = z.output<typeof unregisterDeviceRequestSchema>;

/** What `core` released: the identity row, when the device had been identified, and every entity. */
export const unregisterDeviceReplySchema = z.object({
  deviceId: z.uuid().nullable(),
  entityIds: z.array(entityIdSchema),
});

/** What `core` released. */
export type UnregisterDeviceReply = z.output<typeof unregisterDeviceReplySchema>;

/**
 * Asks `core` to take in an alias the API has just written or changed.
 *
 * The API writes an alias's rows - the entity, the definition, its sources and capabilities -
 * and `core` holds what it routes and recomputes by: the directory, the alias catalogue, the
 * live state. This is the step that brings the second in line with the first, the way a
 * device's completion does. `core` reads the rows back itself rather than being handed them,
 * so what it runs is what was committed.
 */
export const syncAliasRequestSchema = z.strictObject({ entityId: entityIdSchema });

/** Asks `core` to take in an alias the API has just written or changed. */
export type SyncAliasRequest = z.output<typeof syncAliasRequestSchema>;

/** Whether `core` found the alias to take in; false when its rows are already gone. */
export const syncAliasReplySchema = z.object({ isLoaded: z.boolean() });

/** Whether `core` found the alias to take in. */
export type SyncAliasReply = z.output<typeof syncAliasReplySchema>;

/**
 * Asks `core` to delete an alias: its entity row, which takes the definition with it, and
 * everything `core` holds about it, in one step - for the reason a device's release is one.
 * Refused with a conflict naming the aliases that still read it.
 */
export const removeAliasRequestSchema = z.strictObject({ entityId: entityIdSchema });

/** Asks `core` to delete an alias. */
export type RemoveAliasRequest = z.output<typeof removeAliasRequestSchema>;

/** What `core` deleted. */
export const removeAliasReplySchema = z.object({ entityId: entityIdSchema });

/** What `core` deleted. */
export type RemoveAliasReply = z.output<typeof removeAliasReplySchema>;

/** What can happen to a device that everyone else needs to hear about. */
export const DEVICE_EVENTS = ['added', 'removed', 'offline'] as const;

/** What can happen to a device that everyone else needs to hear about. */
export type DeviceEvent = (typeof DEVICE_EVENTS)[number];

/**
 * What a device lifecycle event carries.
 *
 * Enough for a browser to update a list without asking for it again: which device, who owns it,
 * what it is called, and which entities went with it. `offline` names the whole device rather
 * than each entity, because a hub losing power takes twenty entities with it and twenty
 * unavailability events say the same thing twenty times without saying why.
 */
export const deviceEventSchema = z.object({
  /** The device's public id - the instance id it is listed under, not the registry row. */
  deviceId: integrationIdSchema,

  /** The integration instance or package that owns it. */
  source: sourceRefSchema,

  name: z.string().min(1).max(128),
  entityIds: z.array(entityIdSchema),
});

/** What a device lifecycle event carries. */
export type DeviceEventPayload = z.output<typeof deviceEventSchema>;

/**
 * Narrows a subject token to a device event.
 *
 * The last token of `nebula.v1.event.device.*` is a string as far as the bus is concerned. This
 * is what turns it back into the union without a cast, the way `isEntityId` does for identifiers.
 *
 * @param value - The token to check.
 * @returns True when it names a device event.
 */
export function isDeviceEvent(value: string): value is DeviceEvent {
  return (DEVICE_EVENTS as readonly string[]).includes(value);
}
