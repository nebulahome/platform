/**
 * The house's Matter fabric, as the hub runs it and the Brokers page shows it.
 *
 * Matter is one of the platform's brokers: the hub holds the controller - one fabric for the
 * house - and every Matter device is reached through it. A node is commissioned once, with the
 * code another app (the maker's, Google Home, Apple Home, Alexa) shares, and is then a device of
 * the house: of the integration whose `discovery.json` recognises it, or of the platform's own
 * `matter` vendor when none does. A bridge is one node with a device per bridged endpoint.
 *
 * The identity a node is recognised by is {@link matterIdentitySchema}: what its Basic Information
 * (or, for a bridged device, its Bridged Device Basic Information), General Diagnostics and
 * Descriptor clusters say, read by an integration's rules the way an mDNS announcement is.
 */
import { z } from 'zod';

import { integrationIdSchema, integrationKindIdSchema, VENDOR_ID_PATTERN } from './integrations.js';
import { timestampSchema } from './timestamp.js';

/** The platform transport every Matter device is reached through. */
export const MATTER_TRANSPORT = 'matter';

/** The platform's own vendor: the Matter devices no integration claims. */
export const MATTER_VENDOR = 'matter';

/** The driver of the platform's own vendor, which maps any Matter device's clusters. */
export const MATTER_GENERIC_KIND = `${MATTER_VENDOR}/generic`;

/** Where the controller stands. */
export const HUB_MATTER_STATUS_METHOD = 'matter_status';

/** Every node of the fabric, with the devices it is in the house. */
export const HUB_MATTER_NODES_METHOD = 'matter_nodes';

/** Starts commissioning a node with a pairing code. */
export const HUB_MATTER_COMMISSION_METHOD = 'matter_commission';

/** Takes a node off the fabric. */
export const HUB_MATTER_REMOVE_METHOD = 'matter_remove';

/** Brings back a device removed from the house whose node is still on the fabric. */
export const HUB_MATTER_RESTORE_METHOD = 'matter_restore';

/** Answers the question a commissioning stopped on: add a device with a test certificate anyway. */
export const HUB_MATTER_ANSWER_METHOD = 'matter_answer';

/** The UDP port the controller listens on, which the engine does not let anyone change. */
export const MATTER_PORT = 5540;

/** A node id, in decimal: a 64-bit number, which JSON cannot carry as a number. */
export const matterNodeIdSchema = z.string().regex(/^[0-9]{1,20}$/u, 'Must be a node id');

/**
 * A pairing code, as another app shares it: the manual code - 11 or 21 digits, often written in
 * groups - or the QR code's text, `MT:` and base-38. Spaces and dashes are dropped from a manual
 * code, so `3497-011-2332` is `34970112332`.
 */
export const matterPairingCodeSchema = z
  .string()
  .trim()
  .max(128)
  .transform((code) => (code.startsWith('MT:') ? code : code.replaceAll(/[\s-]/gu, '')))
  .pipe(
    z
      .string()
      .regex(
        /^(?:[0-9]{11}|[0-9]{21}|MT:[0-9A-Z.-]{19,})$/u,
        'Must be the 11 or 21 digits of a pairing code, or the text of its QR code (MT:…)',
      ),
  );

/** How many items a list in an identity holds at most. */
const MAXIMUM_LIST = 64;

/**
 * Who a Matter device says it is: what an integration's rules match and the Brokers page shows.
 *
 * Every field is null when the device does not say it - most leave a product label or a serial
 * out - so a rule reads `null` rather than a missing key. `endpoint` is null for the node itself
 * and the endpoint's number for a device behind a bridge, whose names are its own.
 */
export const matterIdentitySchema = z.object({
  nodeId: matterNodeIdSchema,
  endpoint: z.int().min(0).max(65_535).nullable(),
  vendorId: z.int().min(0).max(65_535).nullable(),
  productId: z.int().min(0).max(65_535).nullable(),
  vendorName: z.string().max(256).nullable(),
  productName: z.string().max(256).nullable(),
  productLabel: z.string().max(256).nullable(),
  nodeLabel: z.string().max(256).nullable(),
  serialNumber: z.string().max(256).nullable(),
  uniqueId: z.string().max(256).nullable(),
  hardwareVersion: z.int().min(0).nullable(),
  hardwareVersionString: z.string().max(256).nullable(),
  softwareVersion: z.int().min(0).nullable(),
  softwareVersionString: z.string().max(256).nullable(),

  /** The hardware addresses of its network interfaces, lower-case and colon-separated. */
  macAddresses: z.array(z.string().max(64)).max(MAXIMUM_LIST),

  /** The Matter device types it declares, by number: `256` an on/off light. */
  deviceTypes: z.array(z.int().min(0)).max(MAXIMUM_LIST),

  /** The clusters its endpoints serve, by number, each once. */
  clusters: z.array(z.int().min(0)).max(256),

  /** Whether the node is a bridge, with devices of its own behind it. */
  isBridge: z.boolean(),

  /** Whether this is a device behind a bridge. */
  isBridged: z.boolean(),
});

/** Who a Matter device says it is. */
export type MatterIdentity = z.output<typeof matterIdentitySchema>;

/** How the controller stands. */
export const MATTER_CONTROLLER_STATES = ['starting', 'running', 'failed', 'disabled'] as const;

/** How the controller stands. */
export type MatterControllerState = (typeof MATTER_CONTROLLER_STATES)[number];

/**
 * How a commissioning goes. `needs-answer` is a job that stopped before the node joined and waits
 * for the owner: a device whose certificate is a test one, added only when they say so.
 */
export const MATTER_COMMISSIONING_STATES = [
  'running',
  'needs-answer',
  'succeeded',
  'failed',
] as const;

/**
 * The steps of a commissioning, in order: the code read, the device found on the network, its
 * certificate checked against the DCL, joining the fabric, reading what it can do, and the device
 * in the house.
 */
export const MATTER_COMMISSIONING_STEPS = [
  'code',
  'found',
  'certificate',
  'joining',
  'reading',
  'in-house',
] as const;

/** One step of a commissioning. */
export type MatterCommissioningStepId = (typeof MATTER_COMMISSIONING_STEPS)[number];

/** How one step stands. `warning` is the certificate step of a device with a test certificate. */
export const MATTER_STEP_STATES = ['pending', 'running', 'done', 'warning', 'failed'] as const;

/** One step of a commissioning, and what it found. */
export const matterCommissioningStepSchema = z.object({
  id: z.enum(MATTER_COMMISSIONING_STEPS),
  state: z.enum(MATTER_STEP_STATES),

  /**
   * What the step found, as facts the page words itself: the discriminator a code carries, the
   * address and product a device answered with, the vendor and product a test certificate names.
   */
  detail: z
    .object({
      discriminator: z.int().min(0).max(4095).nullable().default(null),
      isQrCode: z.boolean().default(false),
      address: z.string().max(256).nullable().default(null),
      product: z.string().max(256).nullable().default(null),
      vendorId: z.int().min(0).max(65_535).nullable().default(null),
      productId: z.int().min(0).max(65_535).nullable().default(null),
    })
    .default({
      discriminator: null,
      isQrCode: false,
      address: null,
      product: null,
      vendorId: null,
      productId: null,
    }),
});

/** One step of a commissioning. */
export type MatterCommissioningStep = z.output<typeof matterCommissioningStepSchema>;

/**
 * One commissioning: started by a pairing code, done once the device is in the house. A node takes
 * from seconds to a minute or two, longer than one request may wait, so the page reads the job
 * until it ends.
 */
export const matterCommissioningSchema = z.object({
  id: z.string().min(1).max(64),
  state: z.enum(MATTER_COMMISSIONING_STATES),
  startedAt: timestampSchema,
  finishedAt: timestampSchema.nullable(),

  /** The node it made; null until it is on the fabric. */
  nodeId: matterNodeIdSchema.nullable(),

  /** Why it failed, in a sentence; null unless it did. */
  error: z.string().max(2048).nullable(),

  /** Each step in order, with how it stands. */
  steps: z.array(matterCommissioningStepSchema).max(MATTER_COMMISSIONING_STEPS.length).default([]),

  /** The device it became in the house; null until it is in. */
  deviceId: integrationIdSchema.nullable().default(null),
});

/** One commissioning. */
export type MatterCommissioning = z.output<typeof matterCommissioningSchema>;

/** Where the controller stands, as the Brokers page shows it. */
export const matterStatusSchema = z.object({
  state: z.enum(MATTER_CONTROLLER_STATES),

  /** Why it failed or is off, in a sentence; null while it runs. */
  error: z.string().max(2048).nullable(),

  /** The fabric's id, in hex; null before the controller has one. */
  fabricId: z.string().max(32).nullable(),

  /**
   * Whether the hub hears the house's network. Matter finds its nodes over mDNS and IPv6, which a
   * container on a bridge network does not carry: there the controller runs and reaches nothing.
   */
  isLanReachable: z.boolean(),

  nodes: z.object({ total: z.int().min(0), online: z.int().min(0) }),

  /** The last commissioning; null when none was started since the hub started. */
  commissioning: matterCommissioningSchema.nullable(),

  /** When the controller last started; null while it is not running. */
  startedAt: timestampSchema.nullable().default(null),

  /** The engine under the controller, as `matter.js 0.17`. */
  controllerVersion: z.string().max(64).nullable().default(null),

  /** The UDP port the controller listens on. */
  port: z.int().min(1).max(65_535).default(MATTER_PORT),

  /** When this hub made the fabric; null for one made before the hub kept the date. */
  fabricCreatedAt: timestampSchema.nullable().default(null),
});

/** Where the controller stands. */
export type MatterStatus = z.output<typeof matterStatusSchema>;

/** One device a node is in the house: the node itself, or one endpoint behind a bridge. */
export const matterNodeDeviceSchema = z.object({
  identity: matterIdentitySchema,

  /** The clusters the platform turns into entities, and those it does not, by number. */
  mappedClusters: z.array(z.int().min(0)).max(256),
  unmappedClusters: z.array(z.int().min(0)).max(256),

  /** The device added for it; null while it is not, or after it was removed from the house. */
  deviceId: integrationIdSchema.nullable(),

  /** The driver it was added as; null while it is not added. */
  kind: integrationKindIdSchema.nullable(),

  /**
   * The integrations whose rules all take it. One is the integration it belongs to; several, and it
   * is added as the platform's own and the page says who else wants it. Empty when none takes it.
   */
  claimedBy: z.array(z.string().regex(VENDOR_ID_PATTERN)).max(16),

  /** Removed from the house, its node still on the fabric: the page offers it back. */
  isRemoved: z.boolean(),
});

/** One device a node is in the house. */
export type MatterNodeDevice = z.output<typeof matterNodeDeviceSchema>;

/** One node of the fabric. */
export const matterNodeSchema = z.object({
  nodeId: matterNodeIdSchema,
  isAvailable: z.boolean(),

  /** When it joined the fabric, as the controller recorded it; null when it did not say. */
  commissionedAt: timestampSchema.nullable().default(null),

  /** Since when it has not answered, as far as this hub saw; null while it answers. */
  offlineSince: timestampSchema.nullable().default(null),

  /** The node itself first, then each device behind it when it is a bridge. */
  devices: z.array(matterNodeDeviceSchema).min(1).max(256),
});

/** One node of the fabric. */
export type MatterNode = z.output<typeof matterNodeSchema>;

/** Asks for the controller's state. */
export const matterStatusRequestSchema = z.object({});

/** Asks for the nodes. */
export const matterNodesRequestSchema = z.object({});

/** Every node of the fabric, in the order they were commissioned. */
export const matterNodesReplySchema = z.object({ items: z.array(matterNodeSchema) });

/** Every node of the fabric. */
export type MatterNodesReply = z.output<typeof matterNodesReplySchema>;

/** Starts commissioning a node. */
export const matterCommissionRequestSchema = z.object({ code: matterPairingCodeSchema });

/** Starts commissioning a node. */
export type MatterCommissionRequest = z.output<typeof matterCommissionRequestSchema>;

/** Takes a node off the fabric. */
export const matterRemoveRequestSchema = z.object({ nodeId: matterNodeIdSchema });

/** Takes a node off the fabric. */
export type MatterRemoveRequest = z.output<typeof matterRemoveRequestSchema>;

/** Whether the node was on the fabric and left it. */
export const matterRemoveReplySchema = z.object({ isRemoved: z.boolean() });

/** Brings back a device removed from the house: the node, or one endpoint behind a bridge. */
export const matterRestoreRequestSchema = z.object({
  nodeId: matterNodeIdSchema,
  endpoint: z.int().min(0).max(65_535).nullable(),
});

/** Brings back a device removed from the house. */
export type MatterRestoreRequest = z.output<typeof matterRestoreRequestSchema>;

/** Whether it was removed, and is now offered to be added again. */
export const matterRestoreReplySchema = z.object({ isRestored: z.boolean() });

/**
 * The owner's answer to the question a commissioning stopped on: add the device with a test
 * certificate anyway, or not.
 */
export const matterAnswerRequestSchema = z.object({
  jobId: z.string().min(1).max(64),
  isAccepted: z.boolean(),
});

/** The owner's answer. */
export type MatterAnswerRequest = z.output<typeof matterAnswerRequestSchema>;

/** The brokers the platform runs, as the Brokers page lists them. */
export const BROKER_IDS = [MATTER_VENDOR] as const;

/** One broker of the platform. */
export type BrokerId = (typeof BROKER_IDS)[number];

/** One broker, for its card. */
export const brokerSummarySchema = z.object({
  id: z.enum(BROKER_IDS),
  state: z.enum(MATTER_CONTROLLER_STATES),

  /**
   * The devices the house has through it, how many of them answer, and how many are also
   * reached another way.
   */
  devices: z.object({
    total: z.int().min(0),
    online: z.int().min(0),
    linked: z.int().min(0).default(0),
  }),
});

/** One broker, for its card. */
export type BrokerSummary = z.output<typeof brokerSummarySchema>;

/** Every broker of the platform. */
export const brokersReplySchema = z.object({ items: z.array(brokerSummarySchema) });
