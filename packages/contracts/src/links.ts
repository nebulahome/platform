/**
 * One device reached two ways, and the readings it gives both ways linked into one.
 *
 * A Shelly added over its own RPC and again over Matter is the same plug. The house keeps one
 * device for it and one entity for each thing it reads, each with a **source** per transport:
 * readings come from the preferred one, and the other takes over while it is silent.
 *
 * **The longer history leads.** Linking adds no row. Of two devices, the one the house had first
 * is the one it shows, and the other names it in `linked_to`; of two entities, the one with the
 * longer history is the linked entity, keeps its address and goes on recording, and the other
 * names it and stops. Every address and row of a linked entity means the one it names - to an
 * automation, a scene, a card - so nothing that used either is rewritten, and unlinking gives each
 * back its own.
 */
import { z } from 'zod';

import { entityIdSchema } from './entity-id.js';
import { INTEGRATION_STATES, integrationIdSchema, VENDOR_ID_PATTERN } from './integrations.js';
import { jsonObjectSchema } from './json.js';
import { matterReferenceSchema } from './registration.js';
import { timestampSchema } from './timestamp.js';

/** How a pair of entities was linked: declared by the integration, read alike, or by the owner. */
export const LINK_ORIGINS = ['declared', 'auto', 'manual'] as const;

/** How a pair of entities was linked. */
export type LinkOrigin = (typeof LINK_ORIGINS)[number];

/** What a link suggestion says matched. */
export const LINK_REASON_KINDS = ['mac', 'serial', 'model'] as const;

/** One thing two devices have alike, and its value. */
export const linkReasonSchema = z.object({
  kind: z.enum(LINK_REASON_KINDS),
  value: z.string().max(256),
});

/** One thing two devices have alike. */
export type LinkReason = z.output<typeof linkReasonSchema>;

/**
 * A MAC address the way the house compares them: six bytes, lower case, colons.
 *
 * Devices write theirs every way - Shelly `08F9E0124C7A`, Matter `08:f9:e0:12:4c:7a` - and a
 * Thread radio's eight-byte address is not a MAC anybody else reports.
 *
 * @param raw - The address as the device said it.
 * @returns It, normalised; null when it is not a six-byte address.
 */
export function normalizeMac(raw: string | null | undefined): string | null {
  const hex = (raw ?? '').replaceAll(/[^0-9a-f]/giu, '').toLowerCase();

  if (hex.length !== 12 || (raw ?? '').replaceAll(/[0-9a-f:.\-\s]/giu, '') !== '') {
    return null;
  }

  return hex.replaceAll(/(..)(?!$)/gu, '$1:');
}

/** One way into a linked device: the instance, its transport and how it stands. */
export const deviceWaySchema = z.object({
  /** The instance, which is the way's own device id. */
  deviceId: integrationIdSchema,
  kind: z.string(),
  vendorId: z.string(),
  transport: z.string(),
  driverName: z.string(),
  state: z.enum(INTEGRATION_STATES),

  /** Whether its entities answer now. */
  isAvailable: z.boolean(),

  /** Whether readings come this way first. */
  isPreferred: z.boolean(),

  externalId: z.string().nullable(),

  /** Where it is reached, when its transport names a host: `192.168.178.112`. */
  address: z.string().nullable(),

  /** The Matter node, for a way through the Matter broker. */
  nodeId: z.string().nullable(),

  swVersion: z.string().nullable(),
  lastUpdatedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});

/** One way into a linked device. */
export type DeviceWay = z.output<typeof deviceWaySchema>;

/** How a linked device is reached: every way in, the device's own first. */
export const deviceLinkViewSchema = z.object({
  ways: z.array(deviceWaySchema).min(2),

  /** The instance its entities are read through first. */
  preferred: integrationIdSchema,
});

/** How a linked device is reached. */
export type DeviceLinkView = z.output<typeof deviceLinkViewSchema>;

/** One source of a linked entity: the same reading through one way in. */
export const entitySourceSchema = z.object({
  entityId: entityIdSchema,

  /** The way in, by its instance. */
  deviceId: integrationIdSchema,
  vendorId: z.string(),
  transport: z.string(),

  /** Its key in its transport, `switch:0`, when the integration names one. */
  key: z.string().nullable(),

  /** Where it sits in Matter, for a Matter source. */
  matter: matterReferenceSchema.nullable(),

  /** Whether readings come from it now. */
  isActive: z.boolean(),
  isAvailable: z.boolean(),

  /** What it last said, whether or not it is the one read. */
  state: jsonObjectSchema.nullable(),
  lastUpdated: timestampSchema.nullable(),

  /** How it was linked; null for the entity that leads. */
  origin: z.enum(LINK_ORIGINS).nullable(),
});

/** One source of a linked entity. */
export type EntitySource = z.output<typeof entitySourceSchema>;

/** How a linked entity is read. */
export const entityLinkViewSchema = z.object({
  /** Every source, the one that leads first. */
  sources: z.array(entitySourceSchema).min(2),

  /** The instance this entity is read through first, overriding its device; null follows it. */
  transport: integrationIdSchema.nullable(),

  /** The instance the device is read through first. */
  preferred: integrationIdSchema,

  /** The instance it is read through now; null while no source answers. */
  active: integrationIdSchema.nullable(),
});

/** How a linked entity is read. */
export type EntityLinkView = z.output<typeof entityLinkViewSchema>;

/** Two entities of a linked device that read alike and are not linked: what Sensors suggests. */
export const suggestedLinkSchema = z.object({
  entityIds: z.tuple([entityIdSchema, entityIdSchema]),
});

/** Two entities that read alike and are not linked. */
export type SuggestedLink = z.output<typeof suggestedLinkSchema>;

/** Links a device to another way into it. */
export const deviceLinkRequestSchema = z.object({ with: integrationIdSchema });

/** Links a device to another way into it. */
export type DeviceLinkRequest = z.output<typeof deviceLinkRequestSchema>;

/** Links an entity to another that reads the same thing. */
export const entityLinkRequestSchema = z.object({ with: entityIdSchema });

/** Links an entity to another that reads the same thing. */
export type EntityLinkRequest = z.output<typeof entityLinkRequestSchema>;

/** Whether a link or unlink only says what it would do. */
export const linkPreviewQuerySchema = z.object({ preview: z.stringbool().default(false) });

/** What uses an address: what follows an entity when it is linked or unlinked. */
export const linkUseSchema = z.object({
  automations: z.array(z.string()),
  scenes: z.array(z.string()),
  aliases: z.array(z.string()),

  /** Cards, by dashboard. */
  cards: z.array(z.object({ dashboard: z.string(), count: z.int().min(1) })),
});

/** What uses an address. */
export type LinkUse = z.output<typeof linkUseSchema>;

/** One entity in a link's account. */
export const linkSideSchema = z.object({
  entityId: entityIdSchema,
  name: z.string(),
  deviceId: integrationIdSchema,
  vendorId: z.string(),
  transport: z.string(),
  usedBy: linkUseSchema,
});

/** One entity in a link's account. */
export type LinkSide = z.output<typeof linkSideSchema>;

/** Entities that are, or would be, one: the one that leads, and those that read through it. */
export const linkPairSchema = z.object({
  holder: linkSideSchema,
  others: z.array(linkSideSchema).min(1),
  origin: z.enum(LINK_ORIGINS),
});

/** Entities that are, or would be, one. */
export type LinkPair = z.output<typeof linkPairSchema>;

/** A device in a link's account. */
export const linkDeviceSchema = z.object({
  id: integrationIdSchema,
  name: z.string(),
  model: z.string().nullable(),
  vendorId: z.string(),
  transport: z.string(),
  areaName: z.string().nullable(),
});

/**
 * What a link or an unlink does, before it is done: what the dialog lists for the owner to
 * confirm.
 */
export const linkPreviewSchema = z.object({
  action: z.enum(['link', 'unlink']),
  scope: z.enum(['device', 'entity']),

  /** The device the house shows, and the other way into it; null for an entity's link. */
  device: linkDeviceSchema.nullable(),
  other: linkDeviceSchema.nullable(),

  /** What is linked, or unlinked. */
  pairs: z.array(linkPairSchema),

  /** What a device's link leaves read one way. */
  single: z.array(linkSideSchema),

  /** The way read first, after a link; the way the leading entity keeps, after an unlink. */
  preferred: z.object({
    deviceId: integrationIdSchema,
    vendorId: z.string(),
    transport: z.string(),
  }),

  /** Since when the entities were linked, for an unlink. */
  linkedSince: timestampSchema.nullable(),
});

/** What a link or an unlink does. */
export type LinkPreview = z.output<typeof linkPreviewSchema>;

/** One device in a suggestion. */
const suggestedDeviceSchema = z.object({
  id: integrationIdSchema,
  name: z.string(),
  model: z.string().nullable(),
  vendorId: z.string(),
  transport: z.string(),
  createdAt: timestampSchema,
});

/**
 * Two devices that look like one, offered to link: the one the house had first, and the newer
 * way in.
 */
export const linkSuggestionViewSchema = z.object({
  id: z.uuid(),
  vendorId: z.string().regex(VENDOR_ID_PATTERN),
  device: suggestedDeviceSchema,
  twin: suggestedDeviceSchema,
  reasons: z.array(linkReasonSchema),

  /** When the owner set it aside; null while it is offered. */
  dismissedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});

/** Two devices that look like one. */
export type LinkSuggestionView = z.output<typeof linkSuggestionViewSchema>;

/** A vendor's suggestions, offered and set aside. */
export const linkSuggestionsReplySchema = z.object({ items: z.array(linkSuggestionViewSchema) });

/** Sets a suggestion aside, or offers it again. */
export const linkSuggestionDismissSchema = z.object({ isDismissed: z.boolean() });
