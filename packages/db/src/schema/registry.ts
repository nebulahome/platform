/**
 * The `registry` schema: the configured state of the house.
 *
 * Areas, devices, entities and what each entity can do, plus the definitions of the three
 * engines - scenes, automations and derived entities. `core` is the only writer of
 * `entity_states`; everything else here is written by `api` on the owner's behalf.
 *
 * Mirrors DATABASE.md 5.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  smallint,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { users } from './auth.js';
import { packages } from './system.js';

/** The `registry` schema. */
export const registrySchema = pgSchema('registry');

/**
 * Rooms, arranged in an optional hierarchy of floor and room.
 *
 * Only the one-level cycle is prevented by a constraint. Deeper cycles are rejected in `core`,
 * which already owns graph validation for derived entities and can name the offending path -
 * a recursive trigger would be business logic in the database.
 */
export const areas = registrySchema.table(
  'areas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    /**
     * The area this one sits inside.
     *
     * Typed through {@link AnyPgColumn} because it points back at this table, and Drizzle
     * cannot infer the type of a reference to the table being defined.
     */
    parentId: uuid('parent_id').references((): AnyPgColumn => areas.id, { onDelete: 'set null' }),
    icon: text('icon'),
    sortOrder: smallint('sort_order').notNull().default(100),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('areas_parent_id_idx').on(table.parentId)],
);

/**
 * One configured integration instance: a driver bundle bound to a transport.
 *
 * The row id is what an entity of this integration carries as its `source`, and what `core`
 * uses as the subject token when it routes a command there. It therefore shares one namespace
 * with `system.packages.id`, and the two are kept apart by whoever writes the row rather than
 * by a constraint, because a CHECK cannot see another table.
 *
 * `kind` and `transport` carry no constraint here or in the migration. They are resolved
 * against the registries `hub` builds from the bundles it loaded, so an unknown value leaves
 * the instance in `failed` with `lastError` set - which the interface can explain - instead of
 * failing a write for a bundle that is merely not installed yet.
 */
export const integrations = registrySchema.table(
  'integrations',
  {
    id: text('id').primaryKey(),

    /** The driver, vendor-qualified: `shelly/1pm-mini-g3`, `bambu-lab/printer`. */
    kind: text('kind').notNull(),
    kindVersion: text('kind_version').notNull(),

    /**
     * The model the owner picked when adding the device: `X1C`, `1PM Mini Gen3`.
     *
     * Display, not behaviour: the driver is the same whichever of its models this is. Null for
     * a row from before there was a pick to make, and the interface shows the driver's name.
     */
    model: text('model'),

    /** Which transport carries it: `http`, `mqtt`. */
    transport: text('transport').notNull(),

    transportConfig: jsonb('transport_config')
      .notNull()
      .default(sql`'{}'::jsonb`),
    options: jsonb('options')
      .notNull()
      .default(sql`'{}'::jsonb`),
    isEnabled: boolean('is_enabled').notNull().default(true),

    /**
     * Runtime status, written by `hub` and by nothing else.
     *
     * The grant for it is column-level: everything above is configuration the owner set through
     * `api`, and a blanket UPDATE would let a restart quietly overwrite it.
     */
    state: text('state').notNull().default('stopped'),
    lastError: text('last_error'),
    lastStartedAt: timestamp('last_started_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('integrations_state_idx').on(table.state)],
);

/**
 * What every device of one vendor shares: the settings the vendor bundle's own `setup.json`
 * asks for - a cloud API key, an account - as the owner supplied them, secrets sealed.
 *
 * One row per vendor, and only once the owner has saved something: the bundles themselves are
 * listed from `hub`'s disk, so a vendor without a row is still a vendor. No runtime state,
 * because a vendor does not run - its instances do, and `hub` reads this row to layer under
 * each of them when it starts one. Written by `api` and read by `hub`, which is what the
 * grants say.
 */
export const integrationVendors = registrySchema.table('integration_vendors', {
  /** The vendor bundle's directory name: `shelly`, `bambu-lab`. */
  id: text('id').primaryKey(),

  /** The bundle version the settings were saved against. */
  version: text('version').notNull(),

  transportConfig: jsonb('transport_config')
    .notNull()
    .default(sql`'{}'::jsonb`),
  options: jsonb('options')
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A physical or logical piece of hardware.
 *
 * `viaDeviceId` records that a device is reached **through** another: a Zigbee bulb through its
 * router, a BLE thermometer through the ESPHome proxy relaying it. It is what lets the interface
 * explain why a whole group of devices went offline at once.
 */
export const devices = registrySchema.table(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * The package that owns this device, when one does.
     *
     * Exactly one of this and {@link devices.integrationId} is set. Restricted on delete:
     * uninstalling an owner that still has devices fails loudly.
     */
    packageId: text('package_id').references(() => packages.id, { onDelete: 'restrict' }),

    /** The integration instance that owns this device, when one does. */
    integrationId: text('integration_id').references(() => integrations.id, {
      onDelete: 'restrict',
    }),

    /** The owner's own identifier for the device. */
    externalId: text('external_id').notNull(),

    name: text('name').notNull(),
    manufacturer: text('manufacturer'),
    model: text('model'),
    swVersion: text('sw_version'),
    hwVersion: text('hw_version'),
    areaId: uuid('area_id').references(() => areas.id, { onDelete: 'set null' }),
    /**
     * The device this one is reached through.
     *
     * Typed through {@link AnyPgColumn} because it points back at this table, and Drizzle
     * cannot infer the type of a reference to the table being defined.
     */
    viaDeviceId: uuid('via_device_id').references((): AnyPgColumn => devices.id, {
      onDelete: 'set null',
    }),
    config: jsonb('config')
      .notNull()
      .default(sql`'{}'::jsonb`),
    isEnabled: boolean('is_enabled').notNull().default(true),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('devices_area_id_idx').on(table.areaId),
    index('devices_via_device_id_idx').on(table.viaDeviceId),
    index('devices_package_id_idx').on(table.packageId),
    index('devices_integration_id_idx').on(table.integrationId),
  ],
);

/**
 * A controllable or observable thing.
 *
 * `entityId` is immutable in practice: renaming in the interface changes `name`, never this, so
 * automations and scenes keep working.
 */
export const entities = registrySchema.table(
  'entities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityId: text('entity_id').notNull().unique(),

    /** Generated from `entityId`, so the two can never disagree. */
    domain: text('domain').generatedAlwaysAs(sql`split_part(entity_id, '.', 1)`),

    /** Generated from `entityId`, so the two can never disagree. */
    objectId: text('object_id').generatedAlwaysAs(sql`split_part(entity_id, '.', 2)`),

    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'cascade' }),
    packageId: text('package_id').references(() => packages.id, { onDelete: 'restrict' }),
    integrationId: text('integration_id').references(() => integrations.id, {
      onDelete: 'restrict',
    }),
    source: text('source').notNull(),
    name: text('name').notNull(),
    icon: text('icon'),
    areaId: uuid('area_id').references(() => areas.id, { onDelete: 'set null' }),
    unitOfMeasurement: text('unit_of_measurement'),
    deviceClass: text('device_class'),
    stateClass: text('state_class'),
    displayPrecision: smallint('display_precision'),

    /**
     * Textual synonyms used by search and, later, voice control.
     *
     * **Not the same concept as `registry.aliases`**, which defines derived entities. The two
     * are deliberately kept apart with different names.
     */
    searchAliases: text('search_aliases')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    isEnabled: boolean('is_enabled').notNull().default(true),
    isHidden: boolean('is_hidden').notNull().default(false),
    config: jsonb('config')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('entities_device_id_idx').on(table.deviceId),
    index('entities_area_id_idx').on(table.areaId),
    index('entities_package_id_idx').on(table.packageId),
    index('entities_integration_id_idx').on(table.integrationId),
    index('entities_domain_idx').on(table.domain),
  ],
);

/**
 * Which capabilities an entity declares, and the device's own limits for each.
 *
 * `params` is what lets `core` reject a command a device cannot execute without a round trip:
 * the mired range of a lamp, the modes of a thermostat, whether a cover supports tilt.
 */
export const entityCapabilities = registrySchema.table(
  'entity_capabilities',
  {
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    capability: text('capability').notNull(),
    params: jsonb('params')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('entity_capabilities_capability_idx').on(table.capability)],
);

/**
 * The last known state of every entity, one row each.
 *
 * A recovery cache rather than a hot path: `core` reads it at startup to rebuild its in-memory
 * registry, and writes it back on a throttle. Losing a few seconds of it costs nothing, because
 * adapters resynchronise on startup anyway.
 */
export const entityStates = registrySchema.table(
  'entity_states',
  {
    entityId: uuid('entity_id')
      .primaryKey()
      .references(() => entities.id, { onDelete: 'cascade' }),

    /** Validated against `capabilityStateSchema` in `@nebula-home/contracts`. */
    state: jsonb('state').notNull(),

    attributes: jsonb('attributes')
      .notNull()
      .default(sql`'{}'::jsonb`),
    isAvailable: boolean('is_available').notNull().default(true),

    /** When `state` last differed. Not the same as `lastUpdated`, and automations rely on that. */
    lastChanged: timestamp('last_changed', { withTimezone: true }).notNull(),

    /** When a report last arrived, changed or not. */
    lastUpdated: timestamp('last_updated', { withTimezone: true }).notNull(),

    source: text('source').notNull(),
    contextId: uuid('context_id'),
    contextType: text('context_type'),
  },
  (table) => [
    index('entity_states_is_available_idx')
      .on(table.isAvailable)
      .where(sql`is_available = false`),
  ],
);

/** Free-form tags used for cross-cutting selection, such as "exterior" or "energy monitored". */
export const labels = registrySchema.table('labels', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  color: text('color'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Which labels are on which entities. */
export const entityLabels = registrySchema.table(
  'entity_labels',
  {
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    labelId: uuid('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
  },
  (table) => [index('entity_labels_label_id_idx').on(table.labelId)],
);

/**
 * Derived entity definitions.
 *
 * `expression` is owner input, evaluated by the sandboxed evaluator in `core` - never by the
 * database, and never by `eval`.
 */
export const aliases = registrySchema.table(
  'aliases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityId: uuid('entity_id')
      .notNull()
      .unique()
      .references(() => entities.id, { onDelete: 'cascade' }),
    capability: text('capability').notNull(),
    expression: text('expression').notNull(),
    debounceMs: integer('debounce_ms').notNull().default(0),
    fallbackPolicy: text('fallback_policy').notNull().default('unavailable'),
    isEnabled: boolean('is_enabled').notNull().default(true),
    lastError: text('last_error'),
    lastEvaluatedAt: timestamp('last_evaluated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [index('aliases_created_by_idx').on(table.createdBy)],
);

/**
 * The dependency graph edge list for derived entities.
 *
 * Sources are named variables rather than an array of ids, so an expression reads
 * `(t1 + t2 + t3) / 3` and replacing a source is a one-row update that leaves it untouched.
 *
 * `entityId` is restricted on delete: removing a sensor a derived entity depends on fails, and
 * the interface can list exactly what would break. Cascading would leave aliases referencing
 * nothing.
 */
export const aliasSources = registrySchema.table(
  'alias_sources',
  {
    aliasId: uuid('alias_id')
      .notNull()
      .references(() => aliases.id, { onDelete: 'cascade' }),
    variableName: text('variable_name').notNull(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'restrict' }),
  },
  (table) => [index('alias_sources_entity_id_idx').on(table.entityId)],
);

/** A named set of target states applied together. */
export const scenes = registrySchema.table(
  'scenes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    icon: text('icon'),
    areaId: uuid('area_id').references(() => areas.id, { onDelete: 'set null' }),
    transitionMs: integer('transition_ms').notNull().default(0),
    rollbackOnPartialFailure: boolean('rollback_on_partial_failure').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [index('scenes_area_id_idx').on(table.areaId)],
);

/** The target state one scene sets one entity to. */
export const sceneEntities = registrySchema.table(
  'scene_entities',
  {
    sceneId: uuid('scene_id')
      .notNull()
      .references(() => scenes.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),

    /** Validated against `capabilityStateSchema` in `@nebula-home/contracts`. */
    targetState: jsonb('target_state').notNull(),

    /** Overrides the scene default for this entity only. */
    transitionMs: integer('transition_ms'),
  },
  (table) => [index('scene_entities_entity_id_idx').on(table.entityId)],
);

/**
 * Automations.
 *
 * `definition` is the whole trigger, condition and action tree as one validated document. It is
 * not normalised into a dozen tables because it is always read and written whole, it is a
 * recursive structure that relational modelling handles badly, and its shape is already enforced
 * by a Zod schema at the boundary.
 */
export const automations = registrySchema.table(
  'automations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),

    /** Validated against `automationDefinitionSchema` in `@nebula-home/contracts`. */
    definition: jsonb('definition').notNull(),

    /** Versions the automation DSL itself, so old documents can be migrated on read. */
    definitionVersion: integer('definition_version').notNull().default(1),

    mode: text('mode').notNull().default('single'),
    maxRuntimeMs: integer('max_runtime_ms').notNull().default(300_000),
    isEnabled: boolean('is_enabled').notNull().default(true),
    lastTriggeredAt: timestamp('last_triggered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    index('automations_is_enabled_idx')
      .on(table.isEnabled)
      .where(sql`is_enabled`),
    index('automations_created_by_idx').on(table.createdBy),
  ],
);
