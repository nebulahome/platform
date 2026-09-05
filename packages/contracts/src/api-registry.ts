/**
 * How the configured parts of a home read over HTTP: areas, devices, scenes, automations,
 * aliases and installed packages.
 *
 * These are configuration rather than state. They change when a person changes them, not when a
 * sensor reports, which is why they are read from the database directly rather than from the
 * registry `core` holds in memory.
 */
import { z } from 'zod';

import { capabilityNameSchema } from './capabilities.js';
import { entityIdSchema } from './entity-id.js';
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

/** A physical device and how it is reaching the platform. */
export const deviceViewSchema = z.object({
  id: z.uuid(),

  /** The package that owns it. */
  packageId: z.string(),

  /** The identifier the package knows it by, shown for troubleshooting. */
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
