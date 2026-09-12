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
import {
  adoptReplySchema,
  adoptRequestSchema,
  candidatesReplySchema,
  discoveredCandidateSchema,
  discoverReplySchema,
  discoverRequestSchema,
  INTEGRATION_STATES,
  integrationIdSchema,
  integrationKindIdSchema,
  integrationVendorSchema,
  probeReplySchema,
} from './integrations.js';
import { jsonObjectSchema } from './json.js';
import { PACKAGE_RUNTIMES, PACKAGE_STATES, packageIdSchema } from './package-manifest.js';
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
 * Who a device belongs to.
 *
 * A package, for one an adapter registered; an integration instance, for one the hub adopted.
 * The devices table keeps the two in separate columns with a constraint that exactly one is
 * set, and this is that constraint as a value: the kind says which column, the id is what the
 * interface shows and what the packages and integrations pages call the same thing.
 */
export const deviceOwnerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('package'), id: packageIdSchema }),
  z.object({ kind: z.literal('integration'), id: integrationIdSchema }),
]);

/** Who a device belongs to: a package, or an integration instance. */
export type DeviceOwner = z.output<typeof deviceOwnerSchema>;

/** A physical device and how it is reaching the platform. */
export const deviceViewSchema = z.object({
  id: z.uuid(),

  /** The package or integration instance that owns it. */
  owner: deviceOwnerSchema,

  /** The identifier the owner knows it by, shown for troubleshooting. */
  externalId: z.string(),

  name: z.string(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  swVersion: z.string().nullable(),
  hwVersion: z.string().nullable(),
  areaKey: z.string().nullable(),
  areaName: z.string().nullable(),

  /** The device this one reaches the platform through, for a sensor behind a hub. */
  viaDeviceId: z.uuid().nullable(),

  isEnabled: z.boolean(),

  /** When the package last heard from it. Null means never. */
  lastSeenAt: timestampSchema.nullable(),

  /** The entities it exposes. */
  entityIds: z.array(entityIdSchema),
});

/** A physical device. */
export type DeviceView = z.output<typeof deviceViewSchema>;

/**
 * What `POST /api/v1/devices/discover` accepts: which instance to look with, and for how long.
 *
 * The hub's own request, because the API adds nothing to it - it is a relay. The pass runs in
 * the background; what it finds is read from `GET /api/v1/devices/candidates` while it runs.
 */
export const deviceDiscoverRequestSchema = discoverRequestSchema;

/** Which instance to look with, and for how long. */
export type DeviceDiscoverRequest = z.output<typeof deviceDiscoverRequestSchema>;

/** What starting a pass answers: its identifier, and which instances are actually looking. */
export const deviceDiscoverReplySchema = discoverReplySchema;

/** What starting a pass answers. */
export type DeviceDiscoverReply = z.output<typeof deviceDiscoverReplySchema>;

/** A device a pass found and an instance claimed, not yet adopted. */
export const deviceCandidateViewSchema = discoveredCandidateSchema;

/** A device a pass found, not yet adopted. */
export type DeviceCandidateView = z.output<typeof deviceCandidateViewSchema>;

/** What the current pass has found so far, and whether it is still looking. */
export const deviceCandidatesReplySchema = candidatesReplySchema;

/** What the current pass has found so far. */
export type DeviceCandidatesReply = z.output<typeof deviceCandidatesReplySchema>;

/** What `POST /api/v1/devices/adopt` accepts: which candidate, and what to call it. */
export const deviceAdoptRequestSchema = adoptRequestSchema;

/** Which candidate to adopt, and what to call it. */
export type DeviceAdoptRequest = z.output<typeof deviceAdoptRequestSchema>;

/** What adopting wrote: the device row, and the entities under it. */
export const deviceAdoptReplySchema = adoptReplySchema;

/** What adopting wrote. */
export type DeviceAdoptReply = z.output<typeof deviceAdoptReplySchema>;

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
 * One configured integration: a driver bundle, bound to a transport, pointed at something.
 *
 * Not a package, though the two were shown as one thing for a release and should not have been.
 * A **package** is the unit that ships and is supervised; an **integration** is a driver bound to
 * a transport, and an *instance* of one is this MQTT broker, that Shelly. A package may
 * contribute an integration, a house may run three instances of the same one, and neither fact
 * is expressible while they share a row on a page.
 *
 * `state`, `lastError` and `lastStartedAt` are written by `hub` and by nothing else; everything
 * above them is configuration the owner set. The database enforces that split with a
 * column-level grant, which is why they are read-only here too.
 */
export const integrationViewSchema = z.object({
  /** The instance id, which is also what an entity carries as its source. */
  id: z.string(),

  /** The driver, as `vendor/driver`: `shelly/1pm-mini-g3`. */
  kind: z.string(),

  kindVersion: z.string(),

  /** The two halves of the kind, so a page can group by vendor without splitting a string. */
  vendorId: z.string(),
  driverId: z.string(),

  /** The driver's name as the catalogue has it, or its id when the hub is away. */
  driverName: z.string(),

  /**
   * The model the owner picked when adding the device: `X1C`, `1PM Mini Gen3`.
   *
   * Null for a row from before there was a pick to make, or written by hand; the interface
   * shows the driver's name then.
   */
  model: z.string().nullable(),

  /** Which transport carries it: `http`, `mqtt`. */
  transport: z.string(),

  /**
   * The transport's configuration, with its secrets withheld.
   *
   * A configuration is what an owner has to see to correct it - which addresses, which broker -
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

  /** How many devices it has adopted. */
  deviceCount: z.int().min(0),

  /** How many entities those devices expose. */
  entityCount: z.int().min(0),
});

/** One configured integration. */
export type IntegrationView = z.output<typeof integrationViewSchema>;

/**
 * What changing an integration accepts.
 *
 * Configuration only. `state`, `lastError` and `lastStartedAt` are what the hub reports about a
 * thing it is running, and letting the API write them would let a form overwrite the truth with
 * an assumption — a page that said `running` because somebody ticked a box would be worse than a
 * page that said nothing.
 *
 * `kind` and `transport` are absent for a different reason: changing either makes it a different
 * integration, and the honest way to express that is a new instance beside the old one.
 *
 * `transportConfig` and `options` are opaque here. Which hosts, which broker, which credentials
 * is the bundle's vocabulary, declared in its `setup.json`, and the API checks a change against
 * that declaration once it has fetched it from the hub - a schema here would have to be rewritten
 * every time a bundle is added.
 */
export const integrationUpdateSchema = z
  .object({
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

/** What changing an integration accepts. */
export type IntegrationUpdate = z.output<typeof integrationUpdateSchema>;

/**
 * What creating an integration accepts.
 *
 * The owner chooses the id: it becomes every entity's `source` and the token `core` addresses
 * commands to, so it has to be something a person can read in a log. `kindVersion` and
 * `transport` are not accepted - they come from the bundle the kind names, and a client that
 * could set them could pair a profile with a transport it was never written for.
 */
export const integrationCreateSchema = z.object({
  id: integrationIdSchema,

  /** Which driver, as `vendor/driver`, from the drivers `GET /integrations/vendors` lists. */
  kind: integrationKindIdSchema,

  /**
   * Which model, from the choices the driver offers. Required: the pick is what the vendor
   * page shows for the row, and a driver serving six printers says nothing on its own.
   */
  model: z.string().min(1).max(64),

  /** The values the kind's `setup.transport` fields collected. */
  transportConfig: jsonObjectSchema,

  /** The values its `setup.options` fields collected. */
  options: jsonObjectSchema.default({}),

  isEnabled: z.boolean().default(true),
});

/** What creating an integration accepts. */
export type IntegrationCreate = z.output<typeof integrationCreateSchema>;

/**
 * What trying a configuration accepts.
 *
 * `integrationId` names an instance being edited: a secret field left blank in the form is
 * filled from what that instance has sealed, so testing after changing the address does not
 * mean typing the password again.
 */
export const integrationProbeRequestSchema = z.object({
  kind: integrationKindIdSchema,
  transportConfig: jsonObjectSchema,
  integrationId: integrationIdSchema.optional(),
});

/** What trying a configuration accepts. */
export type IntegrationProbeRequest = z.output<typeof integrationProbeRequestSchema>;

/** What trying a configuration found out, exactly as the hub reported it. */
export const integrationProbeReplySchema = probeReplySchema;

/** What trying a configuration found out. */
export type IntegrationProbeReply = z.output<typeof integrationProbeReplySchema>;

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

  /** How many instances - devices added by hand - run under it. */
  instanceCount: z.int().min(0),

  /** How many devices those instances have adopted. */
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
