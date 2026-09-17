/**
 * How the configured parts of a home read over HTTP: areas, devices, scenes, automations,
 * aliases and installed packages.
 *
 * These are configuration rather than state. They change when a person changes them, not when a
 * sensor reports, which is why they are read from the database directly rather than from the
 * registry `core` holds in memory.
 */
import { z } from 'zod';

import { automationDefinitionSchema } from './automation-definition.js';
import { capabilityNameSchema } from './capabilities.js';
import { entityIdSchema } from './entity-id.js';
import { iconIdSchema } from './icons.js';
import {
  INTEGRATION_STATES,
  integrationIdSchema,
  integrationKindIdSchema,
  integrationVendorSchema,
  probeReplySchema,
} from './integrations.js';
import { jsonObjectSchema } from './json.js';
import { PACKAGE_RUNTIMES, PACKAGE_STATES } from './package-manifest.js';
import { timestampSchema } from './timestamp.js';

/** A room, floor or zone. */
export const areaViewSchema = z.object({
  id: z.uuid(),

  /** The stable key used in permission scopes, e.g. `living_room` in `area.living_room`. */
  key: z.string(),

  /** What it is called. */
  name: z.string(),

  /** The area this one sits inside, for a floor containing rooms. */
  parentId: z.uuid().nullable(),

  /** An icon name, when one has been chosen. */
  icon: z.string().nullable(),

  /** Where it sorts in a list the owner has arranged by hand. */
  sortOrder: z.int(),

  /** How many entities are in it. */
  entityCount: z.int().min(0),
});

/** A room, floor or zone. */
export type AreaView = z.output<typeof areaViewSchema>;

/** A free-form tag on entities. */
export const labelViewSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  color: z.string().nullable(),

  /** How many entities carry it. */
  entityCount: z.int().min(0),
});

/** A free-form tag on entities. */
export type LabelView = z.output<typeof labelViewSchema>;

/**
 * One device: the driver bundle that reaches it, and the registry row that names it.
 *
 * Two halves under one id. The **connection half** is the integration instance - a driver
 * bound to a transport, pointed at something - which `hub` runs and reports on; `state`,
 * `lastError` and `lastStartedAt` are its and nobody else's, which the database enforces with a
 * column-level grant. The **identity half** is what the owner called it, its icon, and what the
 * hardware said about itself once the instance heard from it. The id is the instance id, the
 * token every entity of the device carries as its `source`.
 *
 * Not a package. A **package** is the unit that ships and is supervised; a device is one thing
 * in the house that a driver talks to.
 */
export const deviceViewSchema = z.object({
  /** The device id, which is the instance id, which is what an entity carries as its source. */
  id: integrationIdSchema,

  /** What the owner calls it. */
  name: z.string(),

  /** The catalogue icon the owner picked, or the driver's default; null for none. */
  icon: iconIdSchema.nullable(),

  /** The driver, as `vendor/driver`: `shelly/1pm-mini-g3`. */
  kind: z.string(),

  kindVersion: z.string(),

  /** The two halves of the kind, so a page can group by vendor without splitting a string. */
  vendorId: z.string(),
  driverId: z.string(),

  /** The driver's name as the catalogue has it, or its id when the hub is away. */
  driverName: z.string(),

  /**
   * The model: what the hardware reported once identified, else the one the owner picked when
   * adding the device (`X1C`, `1PM Mini Gen3`). Null only for a row written by hand.
   */
  model: z.string().nullable(),

  /** Which transport carries it: `http`, `mqtt`. */
  transport: z.string(),

  /**
   * The transport's configuration, with its secrets withheld.
   *
   * A configuration is what an owner has to see to correct it - which address, which broker -
   * and it is also where a password lives. Serving the whole of it would put that password in
   * every browser that opens the page and in every cache between here and there, to no purpose:
   * nobody reads a password back, they replace it.
   *
   * A value the bundle declared secret is stored sealed and served as `{ "$sealed": true }`: the
   * form learns that one is kept, and nothing else. Anything else with a secret-looking key name
   * is removed outright, a blunt instrument that is meant to be: a row written by hand, or by a
   * transport this service has never heard of, still gets its `password` withheld.
   */
  transportConfig: jsonObjectSchema,

  /** Whatever the bundle itself takes, with its secrets withheld the same way. */
  options: jsonObjectSchema,

  /** Whether the owner has it switched on. */
  isEnabled: z.boolean(),

  state: z.enum(INTEGRATION_STATES),

  /** Why it last failed. */
  lastError: z.string().nullable(),

  /** When it last started. */
  lastStartedAt: timestampSchema.nullable(),

  /** When one of its entities last reported. Null until one has. */
  lastUpdatedAt: timestampSchema.nullable(),

  /** The hardware's own identifier, once the instance has heard from it. Null until then. */
  externalId: z.string().nullable(),

  manufacturer: z.string().nullable(),
  swVersion: z.string().nullable(),
  hwVersion: z.string().nullable(),
  areaKey: z.string().nullable(),
  areaName: z.string().nullable(),

  /** The entities it exposes; empty until identified. */
  entityIds: z.array(entityIdSchema),
});

/** One device. */
export type DeviceView = z.output<typeof deviceViewSchema>;

/**
 * What adding a device accepts.
 *
 * The owner chooses the id: it becomes every entity's `source` and the token `core` addresses
 * commands to, so it has to be something a person can read in a log - the form suggests one
 * from the name. `kindVersion` and `transport` are not accepted: they come from the bundle the
 * kind names, and a client that could set them could pair a profile with a transport it was
 * never written for.
 */
export const deviceCreateSchema = z.object({
  id: integrationIdSchema,

  /** Which driver, as `vendor/driver`, from the drivers `GET /integrations/vendors` lists. */
  kind: integrationKindIdSchema,

  /**
   * Which model, from the choices the driver offers. Required: the pick is what the row shows,
   * and a driver serving six printers says nothing on its own.
   */
  model: z.string().min(1).max(64),

  /** What the owner calls it; the form starts it from the model. */
  name: z.string().trim().min(1).max(128),

  /** A catalogue icon; the driver's default when omitted. */
  icon: iconIdSchema.optional(),

  /** The values the kind's `setup.transport` fields collected. */
  transportConfig: jsonObjectSchema,

  /** The values its `setup.options` fields collected. */
  options: jsonObjectSchema.default({}),

  isEnabled: z.boolean().default(true),
});

/** What adding a device accepts. */
export type DeviceCreate = z.output<typeof deviceCreateSchema>;

/**
 * What changing a device accepts.
 *
 * Configuration and identity only. `state`, `lastError` and `lastStartedAt` are what the hub
 * reports about a thing it is running, and letting the API write them would let a form
 * overwrite the truth with an assumption. `kind` and `transport` are absent for a different
 * reason: changing either makes it a different device, and the honest way to express that is a
 * new device beside the old one.
 *
 * `transportConfig` and `options` are opaque here. Which host, which broker, which credentials
 * is the bundle's vocabulary, declared in its `setup.json`, and the API checks a change against
 * that declaration once it has fetched it from the hub.
 */
export const deviceUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(128),

    /** A catalogue icon, or null to have none. */
    icon: iconIdSchema.nullable(),

    /** Whether the owner wants it running. */
    isEnabled: z.boolean(),

    /** A corrected pick; checked against the driver's list, as on create. */
    model: z.string().min(1).max(64),

    /** The transport's own configuration, checked by the transport rather than here. */
    transportConfig: jsonObjectSchema,

    /** Anything the bundle itself takes. */
    options: jsonObjectSchema,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' });

/** What changing a device accepts. */
export type DeviceUpdate = z.output<typeof deviceUpdateSchema>;

/**
 * What trying a configuration accepts.
 *
 * `deviceId` names a device being edited: a secret field left blank in the form is filled
 * from what that device has sealed, so testing after changing the address does not mean
 * typing the password again.
 */
export const deviceProbeRequestSchema = z.object({
  kind: integrationKindIdSchema,
  transportConfig: jsonObjectSchema,
  deviceId: integrationIdSchema.optional(),
});

/** What trying a configuration accepts. */
export type DeviceProbeRequest = z.output<typeof deviceProbeRequestSchema>;

/** What trying a configuration found out, exactly as the hub reported it. */
export const deviceProbeReplySchema = probeReplySchema;

/** What trying a configuration found out. */
export type DeviceProbeReply = z.output<typeof deviceProbeReplySchema>;

/** One entity's target state inside a scene. */
export const sceneMemberSchema = z.object({
  entityId: entityIdSchema,

  /** The name the interface shows, so a scene reads without a second request. */
  entityName: z.string(),

  /** What this entity should be set to. */
  targetState: jsonObjectSchema,

  /** How long this one entity takes to get there, when it differs from the scene's own. */
  transitionMs: z.int().min(0).nullable(),
});

/** One entity's target state inside a scene. */
export type SceneMember = z.output<typeof sceneMemberSchema>;

/** A saved set of entity states. */
export const sceneViewSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  areaKey: z.string().nullable(),

  /** How long the whole scene takes to apply. */
  transitionMs: z.int().min(0),

  /** Whether a partial failure undoes what already applied. */
  rollbackOnPartialFailure: z.boolean(),

  /** What it sets. */
  members: z.array(sceneMemberSchema),
});

/** A saved set of entity states. */
export type SceneView = z.output<typeof sceneViewSchema>;

/** How an automation handles a second trigger while it is still running. */
export const AUTOMATION_MODES = ['single', 'restart', 'queued', 'parallel'] as const;

/** How an automation handles a second trigger while it is still running. */
export type AutomationMode = (typeof AUTOMATION_MODES)[number];

/**
 * The stable identifier a person types once and code refers to forever.
 *
 * Separate from the name for the same reason an entity's address is separate from its label:
 * renaming "Evening lights" to "Dusk lights" must not break the automation that runs it. Snake
 * case because it is also what a permission scope is written in.
 */
export const libraryKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,62}$/, 'Must be lower case letters, digits and underscores');

/** A rule: when this happens, if these hold, do this. */
export const automationViewSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string(),

  /** The trigger, conditions and actions, as the engine stores them. */
  definition: jsonObjectSchema,

  /** Which revision of the definition format this one is written in. */
  definitionVersion: z.int().min(1),

  mode: z.enum(AUTOMATION_MODES),

  /** How long one run may take before it is abandoned. */
  maxRuntimeMs: z.int().min(0),

  isEnabled: z.boolean(),

  /** When it last fired. Null means never. */
  lastTriggeredAt: timestampSchema.nullable(),
});

/** A rule. */
export type AutomationView = z.output<typeof automationViewSchema>;

/** One entity feeding an alias, and the letter it goes in as. */
export const aliasSourceSchema = z.object({
  /** The name used in the expression, e.g. `t1`. */
  variableName: z.string(),

  entityId: entityIdSchema,

  /** The name the interface shows, so the formula reads without a second request. */
  entityName: z.string(),

  /** Where that entity is. */
  areaName: z.string().nullable(),
});

/** One entity feeding an alias. */
export type AliasSource = z.output<typeof aliasSourceSchema>;

/** What an alias does when one of its sources stops reporting. */
export const ALIAS_FALLBACK_POLICIES = ['unavailable', 'ignore_missing', 'last_known'] as const;

/** What an alias does when one of its sources stops reporting. */
export type AliasFallbackPolicy = (typeof ALIAS_FALLBACK_POLICIES)[number];

/** A derived entity: a formula over other entities. */
export const aliasViewSchema = z.object({
  id: z.uuid(),

  /** The entity it produces. */
  entityId: entityIdSchema,

  /** What the owner calls it, from the entity it produces. */
  name: z.string(),

  /** Which capability the computed value satisfies. */
  capability: capabilityNameSchema,

  /** The expression, evaluated in the sandbox (RULES.md 16). */
  expression: z.string(),

  /** How long a burst of source changes is collapsed for before recomputing. */
  debounceMs: z.int().min(0),

  fallbackPolicy: z.enum(ALIAS_FALLBACK_POLICIES),

  isEnabled: z.boolean(),

  /** Why it last failed, when it did. */
  lastError: z.string().nullable(),

  /** When it was last recomputed. */
  lastEvaluatedAt: timestampSchema.nullable(),

  /** What goes into the formula. */
  sources: z.array(aliasSourceSchema),
});

/** A derived entity. */
export type AliasView = z.output<typeof aliasViewSchema>;

/**
 * What creating an automation needs.
 *
 * The definition is validated in full rather than accepted as opaque JSON: the column has always
 * claimed to hold a document of a known shape, and the only moment anybody can be told it does
 * not is while they are still looking at the form.
 */
export const automationCreateSchema = z.object({
  key: libraryKeySchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000).default(''),
  definition: automationDefinitionSchema,
  mode: z.enum(AUTOMATION_MODES).default('single'),

  /** Ten minutes is the ceiling: a run longer than that is a schedule, not an automation. */
  maxRuntimeMs: z.int().min(1_000).max(600_000).default(300_000),
  isEnabled: z.boolean().default(true),
});

/** What creating an automation needs. */
export type AutomationCreate = z.output<typeof automationCreateSchema>;

/**
 * What changing one accepts.
 *
 * A partial map, and the key is not in it. Two people editing different fields do not overwrite
 * each other, and the identifier other automations refer to cannot move underneath them.
 */
export const automationUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2_000),
    definition: automationDefinitionSchema,
    mode: z.enum(AUTOMATION_MODES),
    maxRuntimeMs: z.int().min(1_000).max(600_000),
    isEnabled: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Nothing to change',
  });

/** What changing an automation accepts. */
export type AutomationUpdate = z.output<typeof automationUpdateSchema>;

/**
 * One vendor the hub has loaded, as `GET /integrations/vendors` lists it: the catalogue entry
 * with what the owner has done about it.
 *
 * `needsSetup` is the one thing a page has to know before offering Add device: the vendor
 * asks for something - an API key, an account - and nobody has given it yet. A vendor whose
 * `setup` has no required field never needs it, row or no row.
 */
export const integrationVendorViewSchema = integrationVendorSchema.extend({
  /** Whether a required vendor-wide setting is still missing. */
  needsSetup: z.boolean(),

  /** Whether the owner has saved the vendor's settings at all. */
  isConfigured: z.boolean(),

  /** The vendor's settings, secrets withheld the way an instance's are; empty when none saved. */
  transportConfig: jsonObjectSchema,
  options: jsonObjectSchema,

  /** When the settings were last saved. Null until they are. */
  configuredAt: timestampSchema.nullable(),

  /** How many devices have been added under it. */
  deviceCount: z.int().min(0),

  /** How many entities those devices expose. */
  entityCount: z.int().min(0),
});

/** One vendor the hub has loaded, with what the owner has done about it. */
export type IntegrationVendorView = z.output<typeof integrationVendorViewSchema>;

/**
 * What changing a vendor's settings accepts.
 *
 * Merged over what is stored, like an instance's change, and for the same reason: the form was
 * served the settings with their secrets withheld, and a whole-document write would send that
 * back and delete the key on the way through.
 */
export const integrationVendorConfigUpdateSchema = z
  .object({
    /** The values the vendor's `setup.transport` fields collected. */
    transportConfig: jsonObjectSchema,

    /** The values its `setup.options` fields collected. */
    options: jsonObjectSchema,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' });

/** What changing a vendor's settings accepts. */
export type IntegrationVendorConfigUpdate = z.output<typeof integrationVendorConfigUpdateSchema>;

/** An installed package and how it is faring. */
export const packageViewSchema = z.object({
  /** The package id, e.g. `pkg-mqtt`. */
  id: z.string(),

  version: z.string(),

  /** Whether it runs as a child process or in a container. */
  runtime: z.enum(PACKAGE_RUNTIMES),

  state: z.enum(PACKAGE_STATES),

  /** What it says about itself: permissions, contributions, resource limits. */
  manifest: jsonObjectSchema,

  /** The version it was upgraded from, kept so a rollback knows where to go. */
  previousVersion: z.string().nullable(),

  /** When it last started. */
  lastStartedAt: timestampSchema.nullable(),

  /** Why it last failed. */
  lastError: z.string().nullable(),

  installedAt: timestampSchema,

  /** How many entities it owns. */
  entityCount: z.int().min(0),

  /** How many devices it owns. */
  deviceCount: z.int().min(0),
});

/** An installed package. */
export type PackageView = z.output<typeof packageViewSchema>;
