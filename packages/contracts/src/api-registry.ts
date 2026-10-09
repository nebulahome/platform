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
import {
  CAPABILITY_DEFINITIONS,
  capabilityNameSchema,
  capabilityStateSchema,
  THERMOSTAT_MODES,
  type CapabilityName,
} from './capabilities.js';
import { entityIdSchema } from './entity-id.js';
import { iconIdSchema } from './icons.js';
import { integrationAccountViewSchema } from './integration-accounts.js';
import {
  INTEGRATION_STATES,
  integrationIdSchema,
  integrationKindIdSchema,
  integrationVendorSchema,
  probeReplySchema,
} from './integrations.js';
import { jsonObjectSchema, type JsonObject } from './json.js';
import { managedStatusSchema } from './supervisor.js';
import { isReservedDeviceId } from './system-monitor.js';
import { TAGS_PER_ROW_MAXIMUM } from './tags.js';
import { timestampSchema } from './timestamp.js';

/**
 * Where a device comes from: an integration instance, the platform itself, or one of the host's
 * containers, which the supervisor measures and controls.
 */
export const DEVICE_ORIGINS = ['integration', 'system', 'container', 'package'] as const;

/** Where a device comes from. */
export type DeviceOrigin = (typeof DEVICE_ORIGINS)[number];

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

  /**
   * Whether an integration instance reaches it, or it is the machine the platform runs on.
   *
   * The system device has no instance: its connection half is filled with fixed values -
   * `nebula/system`, the `system` transport, always running - so a page that lists devices
   * reads it like any other, and one that edits a connection checks this first. Only its name,
   * icon, room and tags can change, and it cannot be removed.
   */
  origin: z.enum(DEVICE_ORIGINS).default('integration'),

  /** What the owner calls it. */
  name: z.string(),

  /** The catalogue icon the owner picked, or the driver's default; null for none. */
  icon: iconIdSchema.nullable(),

  /** The driver, as `vendor/driver`: `shelly/dimmer-pm`. */
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

  /**
   * The series its model belongs to, as the driver groups its models (`X series` for an X1C);
   * null for a model the driver puts in none, or no model. What a page says the device is, beside
   * the model, in place of the driver's name.
   */
  series: z.string().nullable().default(null),

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

  /** The room it is in, by id and by key and name; nulls for a device in no room. */
  areaId: z.uuid().nullable(),
  areaKey: z.string().nullable(),
  areaName: z.string().nullable(),

  /** The entities it exposes; empty until identified. */
  entityIds: z.array(entityIdSchema),

  /** The tags on it, by id; the tags themselves come from `GET /tags`. */
  tagIds: z.array(z.uuid()).default([]),
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
  id: integrationIdSchema.refine((id) => !isReservedDeviceId(id), {
    message: 'Reserved for the platform',
  }),

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

  /** The room to put it in as it is added; none by default. */
  areaId: z.uuid().optional(),

  /** The tags to put on it as it is added; none by default. */
  tagIds: z.array(z.uuid()).max(TAGS_PER_ROW_MAXIMUM).default([]),
});

/** What adding a device accepts. */
export type DeviceCreate = z.output<typeof deviceCreateSchema>;

/**
 * What adopting a discovered device accepts: what the owner decides, and nothing the device said.
 *
 * The driver and the address come from the candidate, and the API reads them from the hub rather
 * than from this body, so a client cannot adopt a device as another kind or point it elsewhere.
 * `model` is needed only when the candidate names a family rather than one model, and
 * `transportConfig` and `options` only for what discovery could not fill - a token, a password.
 */
export const discoveryAdoptSchema = deviceCreateSchema
  .omit({ kind: true, model: true, transportConfig: true, isEnabled: true })
  .extend({
    /** Which of the candidate's model choices, when it offers more than one. */
    model: z.string().min(1).max(64).optional(),

    /** The fields of the driver's setup discovery left empty; the address is not among them. */
    transportConfig: jsonObjectSchema.default({}),
  });

/** What adopting a discovered device accepts. */
export type DiscoveryAdopt = z.output<typeof discoveryAdoptSchema>;

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

    /** The room to put it in, or null to take it out of the one it is in. */
    areaId: z.uuid().nullable(),

    /** Every tag the device should carry - the whole set, replacing what it had. */
    tagIds: z.array(z.uuid()).max(TAGS_PER_ROW_MAXIMUM),
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

/**
 * One entity to set when a scene is created or rewritten.
 *
 * `entityId` is the address (`light.kitchen`); the row stores the registry uuid behind it.
 * `transitionMs` null or absent means the scene's own transition applies.
 */
export const sceneMemberInputSchema = z.object({
  entityId: entityIdSchema,
  targetState: capabilityStateSchema,
  transitionMs: z.int().min(0).max(600_000).nullable().optional(),
});

/** One entity to set when a scene is created or rewritten. */
export type SceneMemberInput = z.output<typeof sceneMemberInputSchema>;

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

/**
 * What creating a scene needs.
 *
 * Members are validated as writable target states here; resolving them to rows and checking
 * each entity actually declares those capabilities is the service's job, because that needs
 * the registry.
 */
export const sceneCreateSchema = z.object({
  key: libraryKeySchema,
  name: z.string().trim().min(1).max(120),
  icon: z.string().trim().min(1).max(64).nullable().optional(),
  areaId: z.uuid().nullable().optional(),
  transitionMs: z.int().min(0).max(600_000).default(0),
  rollbackOnPartialFailure: z.boolean().default(false),
  members: z.array(sceneMemberInputSchema).max(200).default([]),
});

/** What creating a scene needs. */
export type SceneCreate = z.output<typeof sceneCreateSchema>;

/**
 * What changing a scene accepts.
 *
 * A partial map without the key: the identifier other things refer to cannot move. When
 * `members` is present it replaces the whole set, rather than merging, so a save from the
 * editor is exactly what ends up stored.
 */
export const sceneUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    icon: z.string().trim().min(1).max(64).nullable(),
    areaId: z.uuid().nullable(),
    transitionMs: z.int().min(0).max(600_000),
    rollbackOnPartialFailure: z.boolean(),
    members: z.array(sceneMemberInputSchema).max(200),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Nothing to change',
  });

/** What changing a scene accepts. */
export type SceneUpdate = z.output<typeof sceneUpdateSchema>;

/** How one member of a scene fared when it was applied. */
export const sceneApplyMemberResultSchema = z.object({
  entityId: entityIdSchema,
  ok: z.boolean(),
  error: z.string().nullable(),
});

/** How one member of a scene fared when it was applied. */
export type SceneApplyMemberResult = z.output<typeof sceneApplyMemberResultSchema>;

/**
 * What applying a scene produced.
 *
 * Per-entity outcomes rather than a single success: one lamp that did not answer must not
 * hide that the others did, and a rollback is recorded on the members it touched.
 */
export const sceneApplyResultSchema = z.object({
  sceneId: z.uuid(),
  applied: z.int().min(0),
  failed: z.int().min(0),
  members: z.array(sceneApplyMemberResultSchema),
});

/** What applying a scene produced. */
export type SceneApplyResult = z.output<typeof sceneApplyResultSchema>;

/** A rule: when this happens, if these hold, do this. */
export const automationViewSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string(),

  /** The trigger, if, and then, as the engine stores them. */
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

/** A derived entity: a formula over other entities, or a stored helper that holds state. */
export const aliasViewSchema = z.object({
  id: z.uuid(),

  /** The entity it produces. */
  entityId: entityIdSchema,

  /** What the owner calls it, from the entity it produces. */
  name: z.string(),

  /**
   * Calculated sensor vs stored helper.
   *
   * Distinguished by the expression: non-blank is calculated, empty string is stored.
   */
  kind: z.enum(['calculated', 'stored']),

  /**
   * The behavioural domain the table and filters use.
   *
   * Always `alias` in the entity id; this is the kind of thing it behaves as (sensor, light,
   * switch, …), persisted on the entity's config when created.
   */
  domain: z.string(),

  /** Which capability the computed or primary value satisfies. */
  capability: capabilityNameSchema,

  /** Every capability the entity declares, including optional light extras. */
  capabilities: z.array(capabilityNameSchema),

  /** The expression, empty for a stored helper. Evaluated in the sandbox (RULES.md 16). */
  expression: z.string().max(2_000),

  /** How long a burst of source changes is collapsed for before recomputing. */
  debounceMs: z.int().min(0),

  fallbackPolicy: z.enum(ALIAS_FALLBACK_POLICIES),

  isEnabled: z.boolean(),

  /** Why it last failed, when it did. */
  lastError: z.string().nullable(),

  /** When it was last recomputed. */
  lastEvaluatedAt: timestampSchema.nullable(),

  /** Unit for a numeric sensor or stored number, from the entity row. */
  unitOfMeasurement: z.string().nullable(),

  /** Device class for a calculated sensor, from the entity row. */
  deviceClass: z.string().nullable(),

  /** Lower bound for a stored number, when set. */
  min: z.number().nullable(),

  /** Upper bound for a stored number, when set. */
  max: z.number().nullable(),

  /** Step for a stored number, when set. */
  step: z.number().nullable(),

  /** What goes into the formula. Empty for a stored helper. */
  sources: z.array(aliasSourceSchema),
});

/** A derived entity. */
export type AliasView = z.output<typeof aliasViewSchema>;

/** One source named in a create or update body. */
export const aliasSourceInputSchema = z.object({
  /** The name used in the expression, e.g. `t1`. */
  variableName: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, 'Must be a lower-case variable name'),

  entityId: entityIdSchema,
});

/** One source named in a create or update body. */
export type AliasSourceInput = z.output<typeof aliasSourceInputSchema>;

/** The object id half of `alias.<object_id>`. */
export const aliasObjectIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/, 'Must be a lower-case object id');

/** Domains a stored helper may behave as. Camera is not a helper. */
export const ALIAS_STORED_DOMAINS = [
  'switch',
  'light',
  'cover',
  'lock',
  'climate',
  'media_player',
  'sensor',
] as const;

/** Domains a stored helper may behave as. */
export type AliasStoredDomain = (typeof ALIAS_STORED_DOMAINS)[number];

/** Capabilities a calculated alias may produce. */
export const ALIAS_CALCULATED_CAPABILITIES = [
  'sensor_numeric',
  'sensor_binary',
  'sensor_text',
] as const;

/**
 * The limits a stored helper takes when the owner gives none.
 *
 * A helper is not hardware, so nothing reports its range; but `core` checks every command
 * against the declared limits, and a colour temperature or a thermostat without them could
 * never be commanded at all. These are ranges wide enough for what a helper stands in for.
 */
const HELPER_DEFAULT_PARAMS: Partial<Record<CapabilityName, JsonObject>> = {
  color_temp: { minMireds: 153, maxMireds: 500 },
  thermostat: { supportedModes: [...THERMOSTAT_MODES], minTemperature: 5, maxTemperature: 35 },
};

/**
 * One capability a stored helper declares, with its limits.
 *
 * The limits are checked against the capability's own params schema - the one `core` checks
 * commands against - and completed from {@link HELPER_DEFAULT_PARAMS} where the owner gave none,
 * so what is stored is always a set of limits a command can be validated against.
 */
export const aliasCapabilityInputSchema = z
  .object({
    capability: capabilityNameSchema,
    params: jsonObjectSchema.default({}),
  })
  .transform((entry, context) => {
    const limits: z.ZodType = CAPABILITY_DEFINITIONS[entry.capability].params;
    const parsed = limits.safeParse({
      ...HELPER_DEFAULT_PARAMS[entry.capability],
      ...entry.params,
    });
    const params = parsed.success ? jsonObjectSchema.safeParse(parsed.data) : undefined;

    if (params?.success !== true) {
      context.addIssue({
        code: 'custom',
        path: ['params'],
        message: `Not the limits ${entry.capability} takes`,
      });

      return z.NEVER;
    }

    return { capability: entry.capability, params: params.data };
  });

/** One capability a stored helper declares. */
export type AliasCapabilityInput = z.output<typeof aliasCapabilityInputSchema>;

/**
 * What creating a calculated alias needs.
 *
 * Sources are checked for `entity:read` at the route: the formula must not be a way to read an
 * entity the caller cannot see, and a refusal must not include the source value.
 */
export const aliasCalculatedCreateSchema = z.object({
  kind: z.literal('calculated'),
  objectId: aliasObjectIdSchema,
  name: z.string().trim().min(1).max(120),
  capability: z.enum(ALIAS_CALCULATED_CAPABILITIES),
  expression: z.string().trim().min(1).max(2_000),
  sources: z.array(aliasSourceInputSchema).min(1).max(32),
  debounceMs: z.int().min(0).max(3_600_000).default(0),
  fallbackPolicy: z.enum(ALIAS_FALLBACK_POLICIES).default('unavailable'),
  unitOfMeasurement: z.string().trim().min(1).max(32).nullable().optional(),
  deviceClass: z.string().trim().min(1).max(64).nullable().optional(),
  isEnabled: z.boolean().default(true),
});

/**
 * What creating a stored helper needs.
 *
 * `set_value` for a stored number is applied by core against the alias row, not against the
 * shared `sensor_numeric` command schema, so a physical sensor never sees it.
 */
export const aliasStoredCreateSchema = z
  .object({
    kind: z.literal('stored'),
    objectId: aliasObjectIdSchema,
    name: z.string().trim().min(1).max(120),
    domain: z.enum(ALIAS_STORED_DOMAINS),
    capabilities: z.array(aliasCapabilityInputSchema).min(1).max(8),
    unitOfMeasurement: z.string().trim().min(1).max(32).nullable().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().gt(0).optional(),
    isEnabled: z.boolean().default(true),
  })
  .superRefine((body, context) => {
    const names = body.capabilities.map((entry) => entry.capability);

    for (const message of storedHelperCapabilityIssues(body.domain, names)) {
      context.addIssue({ code: 'custom', message, path: ['capabilities'] });
    }

    if (body.min !== undefined && body.max !== undefined && body.min > body.max) {
      context.addIssue({
        code: 'custom',
        message: 'min must not exceed max',
        path: ['min'],
      });
    }
  });

/**
 * Capabilities a stored helper domain may declare.
 *
 * @param domain - The behavioural domain.
 * @returns The allowed capability names.
 */
export function storedCapabilitiesForDomain(
  domain: AliasStoredDomain,
): ReadonlySet<CapabilityName> {
  switch (domain) {
    case 'switch':
      return new Set(['on_off']);
    case 'light':
      return new Set(['on_off', 'level', 'color_hs', 'color_temp']);
    case 'cover':
      return new Set(['cover']);
    case 'lock':
      return new Set(['lock']);
    case 'climate':
      return new Set(['thermostat']);
    case 'media_player':
      return new Set(['media_player']);
    case 'sensor':
      return new Set(['sensor_numeric']);
  }
}

/**
 * What is wrong with a stored helper's capabilities for its domain.
 *
 * One check for creating a helper and for changing its capabilities later: the domain is fixed
 * at creation, and a change must not turn a switch into something no switch is.
 *
 * @param domain - The behavioural domain.
 * @param names - The capabilities declared, in order.
 * @returns A sentence per problem; empty when there is none.
 */
export function storedHelperCapabilityIssues(
  domain: AliasStoredDomain,
  names: readonly CapabilityName[],
): string[] {
  const issues: string[] = [];
  const allowed = storedCapabilitiesForDomain(domain);

  if (new Set(names).size !== names.length) {
    issues.push('Each capability may be declared only once');
  }

  for (const name of names) {
    if (!allowed.has(name)) {
      issues.push(`Domain ${domain} cannot carry ${name}`);
    }
  }

  if ((domain === 'switch' || domain === 'light') && !names.includes('on_off')) {
    issues.push(`A ${domain} helper needs on_off`);
  }

  if (domain === 'sensor' && names.join() !== 'sensor_numeric') {
    issues.push('A stored number helper must declare only sensor_numeric');
  }

  return issues;
}

/** What creating an alias needs. */
export const aliasCreateSchema = z.discriminatedUnion('kind', [
  aliasCalculatedCreateSchema,
  aliasStoredCreateSchema,
]);

/** What creating an alias needs. */
export type AliasCreate = z.output<typeof aliasCreateSchema>;

/**
 * What changing an alias accepts.
 *
 * The entity id is not in the map: `alias.*` is immutable after create. Expression and sources
 * stay calculated-only; a stored helper cannot grow a formula through a patch.
 */
export const aliasUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    expression: z.string().trim().min(1).max(2_000),
    sources: z.array(aliasSourceInputSchema).min(1).max(32),
    debounceMs: z.int().min(0).max(3_600_000),
    fallbackPolicy: z.enum(ALIAS_FALLBACK_POLICIES),
    capabilities: z.array(aliasCapabilityInputSchema).min(1).max(8),
    unitOfMeasurement: z.string().trim().min(1).max(32).nullable(),
    deviceClass: z.string().trim().min(1).max(64).nullable(),
    min: z.number().nullable(),
    max: z.number().nullable(),
    step: z.number().gt(0).nullable(),
    isEnabled: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Nothing to change',
  });

/** What changing an alias accepts. */
export type AliasUpdate = z.output<typeof aliasUpdateSchema>;

/**
 * What previewing a calculated formula needs.
 *
 * Same evaluator and source permission checks as create; nothing is saved.
 */
export const aliasPreviewRequestSchema = z.object({
  expression: z.string().trim().min(1).max(2_000),
  sources: z.array(aliasSourceInputSchema).min(1).max(32),
  capability: z.enum(ALIAS_CALCULATED_CAPABILITIES),
  fallbackPolicy: z.enum(ALIAS_FALLBACK_POLICIES).default('unavailable'),
});

/** What previewing a calculated formula needs. */
export type AliasPreviewRequest = z.output<typeof aliasPreviewRequestSchema>;

/** The result of evaluating a formula without saving it. */
export const aliasPreviewResponseSchema = z.object({
  /** The scalar result, when evaluation succeeded. */
  value: z.union([z.number(), z.boolean(), z.string()]).nullable(),

  /** Whether the derived entity would be available. */
  isAvailable: z.boolean(),

  /** Why evaluation failed, when it did. */
  error: z.string().nullable(),
});

/** The result of evaluating a formula without saving it. */
export type AliasPreviewResponse = z.output<typeof aliasPreviewResponseSchema>;

/**
 * Aliases that still read an entity, which is why deleting it (or this alias) is blocked.
 *
 * Returned only to callers with `alias:read`.
 */
export const aliasDependentSchema = z.object({
  entityId: entityIdSchema,
  name: z.string(),
});

/** One alias that depends on another entity. */
export type AliasDependent = z.output<typeof aliasDependentSchema>;

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

  /**
   * A day is the ceiling, as the column's. A run that waits for the evening is an automation;
   * one that waits for next week is a schedule.
   */
  maxRuntimeMs: z.int().min(1_000).max(86_400_000).default(300_000),
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
    maxRuntimeMs: z.int().min(1_000).max(86_400_000),
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

  /**
   * Where each container the vendor depends on stands, in the catalogue's order; null for one the
   * supervisor did not answer about - it is down, or Docker cannot be reached.
   */
  containerStatuses: z.array(managedStatusSchema.nullable()).default([]),

  /** The accounts signed in to, for a vendor that has an account; empty otherwise. */
  accounts: z.array(integrationAccountViewSchema).default([]),

  /**
   * Whether the vendor has an account to sign in to and none is signed in: its devices cannot be
   * added until one is. False for a vendor without an account.
   */
  needsAccount: z.boolean().default(false),

  /**
   * Whether a package the vendor needs is missing or stopped - `packageProblems` says which: its
   * devices cannot be added, nor its instances started, until it runs.
   */
  needsPackage: z.boolean().default(false),

  /**
   * What the integrations index offers a vendor the platform installed: a newer release, or a
   * rebuild of the one installed in the local folder. Null for one under development, and while
   * the packet-manager cannot be asked.
   */
  update: z
    .object({
      latestVersion: z.string().max(64).nullable(),
      hasUpdate: z.boolean(),
      hasNewBuild: z.boolean(),
    })
    .nullable()
    .default(null),
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
