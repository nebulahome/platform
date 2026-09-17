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
import { integrationIdSchema } from './integrations.js';
import { jsonObjectSchema } from './json.js';

/** The bus service name `core` answers registration on. */
export const CORE_SERVICE = 'core';

/** Registers a device and its entities. */
export const CORE_REGISTER_METHOD = 'register';

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
export const entityRegistrationSchema = z.object({
  entityId: entityIdSchema,
  name: z.string().min(1).max(128),
  capabilities: declaredCapabilitiesSchema,
  icon: z.string().max(64).optional(),
  unitOfMeasurement: z.string().max(32).optional(),
  deviceClass: z.string().max(64).optional(),
  stateClass: z.enum(ENTITY_STATE_CLASSES).optional(),
  displayPrecision: z.int().min(0).max(6).optional(),
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
