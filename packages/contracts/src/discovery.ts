/**
 * Devices the hub has heard announce themselves, and that nobody has added yet.
 *
 * Discovery proposes; the owner adopts. A candidate is what the hub knows about a device before
 * it is one - where it is, which driver of which vendor takes it, which model it said it is -
 * and adopting it is adding a device with those answers already filled in, through the same
 * path an owner typing an address takes. The hub keeps the list in memory and writes nothing:
 * a restart forgets it, and the next announcement puts it back.
 */
import { z } from 'zod';

import {
  DEVICE_ADOPTIONS,
  DISCOVERY_SOURCES,
  integrationIdSchema,
  integrationKindIdSchema,
  VENDOR_ID_PATTERN,
} from './integrations.js';
import { jsonObjectSchema } from './json.js';
import { timestampSchema } from './timestamp.js';

/** Lists the devices the hub has heard and nobody has added. */
export const HUB_DISCOVERED_METHOD = 'discovered';

/**
 * Asks the hub to look for one vendor's devices now rather than at its next scheduled pass.
 */
export const HUB_DISCOVER_METHOD = 'discover';

/** A model's label, as a driver lists it. */
const modelSchema = z.string().min(1).max(64);

/** One device heard and not yet added. */
export const discoveredDeviceSchema = z.object({
  /** Stable for as long as the device is heard: the same device keeps its card. */
  id: z.string().regex(/^[a-f0-9]{16,64}$/),

  vendorId: z.string().regex(VENDOR_ID_PATTERN),
  driverId: z.string().min(1).max(64),

  /** The driver, as `vendor/driver`: what adopting it adds. */
  kind: integrationKindIdSchema,

  source: z.enum(DISCOVERY_SOURCES),

  /** Where it is, as the card shows it: the host, with a port when it is not the usual one. */
  address: z.string().min(1).max(256),

  /** What identification will find it to be; null when the device keeps it until set up. */
  externalId: z.string().min(1).max(256).nullable(),

  /** What the device calls itself, when it says. */
  name: z.string().max(256).nullable(),

  /** Which model it is, when that is certain. */
  model: modelSchema.nullable(),

  /** What the owner may adopt it as: one model when certain, its family otherwise. */
  modelChoices: z.array(modelSchema).min(1).max(64),

  /** What the hardware called its model, as it said it. */
  modelCode: z.string().max(64).nullable(),

  swVersion: z.string().max(64).nullable(),

  /** How to reach it, in its transport's terms. Never a secret: nothing was asked for yet. */
  transportConfig: jsonObjectSchema,

  /** Who adds it: the owner, from its card, or the platform, as soon as it is heard. */
  adoption: z.enum(DEVICE_ADOPTIONS).default('owner'),

  /**
   * The device already added that this one says it is, when it answered at another address -
   * a lease that changed. Proposed rather than followed: an address is moved by the owner,
   * since a device on the network claiming another's id is not proof that it is that device,
   * and the added one may carry a password its new address would be sent. Null for a device
   * nobody has added.
   */
  movedFrom: z
    .object({ deviceId: integrationIdSchema, address: z.string().min(1).max(256) })
    .nullable()
    .default(null),

  firstSeenAt: timestampSchema,
  lastSeenAt: timestampSchema,
});

/** One device heard and not yet added. */
export type DiscoveredDevice = z.output<typeof discoveredDeviceSchema>;

/** Asks the hub what it has heard. */
export const discoveredRequestSchema = z.object({});

/** Asks the hub what it has heard. */
export type DiscoveredRequest = z.output<typeof discoveredRequestSchema>;

/** Every device heard and not yet added, oldest first. */
export const discoveredReplySchema = z.object({ items: z.array(discoveredDeviceSchema) });

/** Every device heard and not yet added. */
export type DiscoveredReply = z.output<typeof discoveredReplySchema>;

/** What can happen to the list. One thing: it changed, and a reader should read it again. */
export const DISCOVERY_EVENTS = ['changed'] as const;

/** What can happen to the list. */
export type DiscoveryEvent = (typeof DISCOVERY_EVENTS)[number];

/** That the list changed, and how long it now is - enough for a badge without a request. */
export const discoveryEventSchema = z.object({ count: z.int().min(0) });

/** That the list changed. */
export type DiscoveryEventPayload = z.output<typeof discoveryEventSchema>;

/** Asks the hub to look now for one vendor's devices. */
export const discoverRequestSchema = z.object({
  vendorId: z.string().regex(VENDOR_ID_PATTERN),
});

/** Asks the hub to look now. */
export type DiscoverRequest = z.output<typeof discoverRequestSchema>;

/**
 * Which vendors the hub started looking for. Answered as soon as the questions are sent, not when
 * the answers are in: devices arrive over the following seconds, each one a `changed` event.
 */
export const discoverReplySchema = z.object({
  vendors: z.array(z.string().regex(VENDOR_ID_PATTERN)),

  /**
   * How long the hub keeps asking, in milliseconds: what a page waits before saying what was
   * found. 0 when it is not looking.
   */
  lookingForMs: z.int().min(0).default(0),
});

/** Which vendors the hub started looking for. */
export type DiscoverReply = z.output<typeof discoverReplySchema>;
