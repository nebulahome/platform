/**
 * What the API takes and gives for aliases.
 *
 * An alias is one entity (`alias.<object_id>`) on a device - the shared virtual device "Aliases",
 * a virtual device of its own, or a real device - made of parts (`alias-parts.ts`) of the type it
 * behaves as (`alias-types.ts`), and, when a part comes from code, one file of code
 * (`alias-code/`). The view carries everything the alias page shows; the list item only what the
 * list does.
 */
import { z } from 'zod';

import { aliasPartsSchema } from './alias-parts.js';
import { ALIAS_TYPE_IDS } from './alias-types.js';
import { entityIdSchema } from './entity-id.js';
import { iconIdSchema } from './icons.js';
import { jsonObjectSchema, jsonValueSchema } from './json.js';
import { timestampSchema } from './timestamp.js';

/** What an alias does when one of the entities it reads stops reporting. */
export const ALIAS_FALLBACK_POLICIES = ['unavailable', 'ignore_missing', 'last_known'] as const;

/** What an alias does when one of the entities it reads stops reporting. */
export type AliasFallbackPolicy = (typeof ALIAS_FALLBACK_POLICIES)[number];

/** How an alias is doing, as the list and the page say it. */
export const ALIAS_HEALTHS = ['ok', 'failing', 'unavailable', 'off'] as const;

/** How an alias is doing. */
export type AliasHealth = (typeof ALIAS_HEALTHS)[number];

/** The object id half of `alias.<object_id>`. */
export const aliasObjectIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/u, 'Must be a lower-case object id');

/** The package entity type a custom alias behaves as. */
export const aliasCustomTypeSchema = z.object({
  packageId: z.string().min(1).max(64),
  type: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/u),
});

/** The package entity type a custom alias behaves as. */
export type AliasCustomType = z.output<typeof aliasCustomTypeSchema>;

/** How an alias is shown: its device class, unit and precision. */
export const aliasDisplaySchema = z.object({
  deviceClass: z.string().trim().min(1).max(64).nullable().default(null),
  unit: z.string().trim().min(1).max(32).nullable().default(null),
  precision: z.int().min(0).max(6).nullable().default(null),
});

/** How an alias is shown. */
export type AliasDisplay = z.output<typeof aliasDisplaySchema>;

/** Why an alias failed last, and how often since it started. */
export const aliasErrorSchema = z.object({
  message: z.string(),

  /** The part whose value failed, when one did. */
  part: z.string().nullable().default(null),

  /** For code: where. */
  function: z.string().nullable().default(null),
  line: z.int().min(1).nullable().default(null),
  column: z.int().min(1).nullable().default(null),

  /** When it started failing, and how many times it has since. */
  since: timestampSchema,
  count: z.int().min(1),

  /** What it read at that moment, by entity id or `part.<key>`, for a replay. */
  inputs: z.record(z.string(), jsonValueSchema).default({}),
});

/** Why an alias failed last. */
export type AliasError = z.output<typeof aliasErrorSchema>;

/** One case a code function is tried against: values in, the value expected out. */
export const aliasCaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/u),
  name: z.string().trim().min(1).max(80),
  function: z.string().regex(/^[a-z_][a-z0-9_]{0,63}$/u),

  /** The values pretended, by entity id or `part.<key>`. */
  inputs: z.record(z.string(), jsonValueSchema).default({}),

  /** The time pretended, when the code reads it. */
  now: timestampSchema.nullable().default(null),

  /** The memory pretended, when the code uses it. */
  mem: jsonObjectSchema.default({}),

  /** What the function should return. */
  expected: jsonValueSchema,

  /** For a case made from a failure: when that failure happened. */
  fromFailureAt: timestampSchema.nullable().default(null),
});

/** One case a code function is tried against. */
export type AliasCase = z.output<typeof aliasCaseSchema>;

/** The device an alias is on. */
export const aliasDeviceViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),

  /** A virtual device (the shared "Aliases" one, or one of the owner's) rather than hardware. */
  isVirtual: z.boolean(),

  /** The shared "Aliases" device every new alias goes on by default. */
  isShared: z.boolean(),
});

/** The device an alias is on. */
export type AliasDeviceView = z.output<typeof aliasDeviceViewSchema>;

/** Where an alias is. */
export const aliasAreaViewSchema = z.object({ key: z.string(), name: z.string() });

/** One alias, as the list shows it. */
export const aliasListItemSchema = z.object({
  id: z.uuid(),
  entityId: entityIdSchema,
  name: z.string(),
  icon: z.string().nullable(),
  behavesAs: z.enum(ALIAS_TYPE_IDS),
  area: aliasAreaViewSchema.nullable(),
  device: aliasDeviceViewSchema,
  isEnabled: z.boolean(),
  health: z.enum(ALIAS_HEALTHS),

  /** The first words of what is wrong, for the row's second line. */
  problem: z.string().nullable(),

  /** The entities it reads, for the search. */
  reads: z.array(entityIdSchema),
});

/** One alias, as the list shows it. */
export type AliasListItem = z.output<typeof aliasListItemSchema>;

/** One alias, whole: what its page shows and edits. */
export const aliasViewSchema = aliasListItemSchema.extend({
  /** The object id half of its entity id. */
  key: aliasObjectIdSchema,
  customType: aliasCustomTypeSchema.nullable(),
  parts: aliasPartsSchema,

  /** Its code: one file, empty when no part comes from code. */
  code: z.string().max(100_000),

  cases: z.array(aliasCaseSchema),

  /** What its code kept between runs. */
  memory: jsonObjectSchema,

  ifOneStops: z.enum(ALIAS_FALLBACK_POLICIES),
  debounceMs: z.int().min(0),
  display: aliasDisplaySchema,
  lastError: aliasErrorSchema.nullable(),
  lastEvaluatedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});

/** One alias, whole. */
export type AliasView = z.output<typeof aliasViewSchema>;

/** One entity an alias reads, as its Inputs show it. */
export const aliasInputSchema = z.object({
  entityId: entityIdSchema,
  name: z.string(),
  areaName: z.string().nullable(),

  /** False when the entity is gone: the alias names one that is not in the house. */
  isPresent: z.boolean(),
});

/** One entity an alias reads. */
export type AliasInput = z.output<typeof aliasInputSchema>;

/** One thing that uses an alias. */
export const aliasUserSchema = z.object({ id: z.string(), name: z.string() });

/** What uses an alias, by kind: what stops working if it goes. */
export const aliasUsedBySchema = z.object({
  automations: z.array(aliasUserSchema),
  scenes: z.array(aliasUserSchema),
  dashboards: z.array(aliasUserSchema),
  aliases: z.array(aliasUserSchema),
});

/** What uses an alias. */
export type AliasUsedBy = z.output<typeof aliasUsedBySchema>;

/** One alias with what it reads and what uses it: the page's whole answer. */
export const aliasDetailSchema = z.object({
  alias: aliasViewSchema,
  inputs: z.array(aliasInputSchema),
  usedBy: aliasUsedBySchema,

  /** Whether code can be changed now (`system.developer_mode`), told to anyone who can read. */
  developerMode: z.boolean(),
});

/** One alias with what it reads and what uses it. */
export type AliasDetail = z.output<typeof aliasDetailSchema>;

/**
 * Which device a new alias goes on: the shared "Aliases" device, a device by id (virtual or
 * real), or a new virtual device by name.
 */
export const aliasDeviceInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('shared') }),
  z.object({ kind: z.literal('device'), deviceId: z.uuid() }),
  z.object({ kind: z.literal('new'), name: z.string().trim().min(1).max(120) }),
]);

/** Which device a new alias goes on. */
export type AliasDeviceInput = z.output<typeof aliasDeviceInputSchema>;

/** A virtual device an alias can go on. */
export const aliasVirtualDeviceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  isShared: z.boolean(),
});

/** A virtual device an alias can go on. */
export type AliasVirtualDevice = z.output<typeof aliasVirtualDeviceSchema>;

/**
 * What creating an alias needs. Parts may be left out: every required part then starts Stored.
 * An image has no stored picture, so its `picture` part must name the entity it comes from.
 */
export const aliasCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  icon: iconIdSchema.nullable().default(null),

  /** The room, by key, for an alias on a virtual device; one on a real device takes its room. */
  area: z.string().max(64).nullable().default(null),
  behavesAs: z.enum(ALIAS_TYPE_IDS),
  customType: aliasCustomTypeSchema.nullable().default(null),
  device: aliasDeviceInputSchema.default({ kind: 'shared' }),
  parts: aliasPartsSchema.optional(),
  isEnabled: z.boolean().default(true),
});

/** What creating an alias needs. */
export type AliasCreate = z.output<typeof aliasCreateSchema>;

/** What changing an alias accepts; the type and the entity id never change. */
export const aliasUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    icon: iconIdSchema.nullable(),
    area: z.string().max(64).nullable(),
    isEnabled: z.boolean(),
    parts: aliasPartsSchema,
    code: z.string().max(100_000),
    cases: z.array(aliasCaseSchema).max(64),
    memory: jsonObjectSchema,
    ifOneStops: z.enum(ALIAS_FALLBACK_POLICIES),
    debounceMs: z.int().min(0).max(3_600_000),
    display: aliasDisplaySchema,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' });

/** What changing an alias accepts. */
export type AliasUpdate = z.output<typeof aliasUpdateSchema>;

/** What duplicating an alias needs: the copy's name. */
export const aliasDuplicateSchema = z.object({ name: z.string().trim().min(1).max(120) });

/** What deleting an alias stopped: the things that used it. */
export const aliasDeleteResultSchema = z.object({ id: z.uuid(), usedBy: aliasUsedBySchema });

/** One change to an alias's setup, as its History lists it. */
export const aliasSetupChangeSchema = z.object({
  at: timestampSchema,

  /** Who made it, by name, or null for the platform itself. */
  by: z.string().nullable(),

  action: z.enum(['create', 'update', 'import']),

  /** The setup before and after, for the Diff (the file's entry for this alias). */
  before: jsonObjectSchema.nullable(),
  after: jsonObjectSchema.nullable(),
});

/** One change to an alias's setup. */
export type AliasSetupChange = z.output<typeof aliasSetupChangeSchema>;
