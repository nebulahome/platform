/**
 * `profile.json`: a declarative bundle, in full.
 *
 * A profile describes a device whose entities are **known in advance** - one relay, one
 * temperature sensor - and maps its payload onto the canonical model by naming where each value
 * is. If the number or kind of entity depends on what the device reports, a profile cannot
 * express it, and that is deliberate: it is a code bundle.
 *
 * The ceiling is enforced here rather than recommended in a guide. Every object is strict, so a
 * field this schema does not define cannot be written - no iteration, no conditionals, no escape
 * into a helper function. Every expression is a path, so logic cannot be smuggled into one.
 * Those two rules are the whole of it, and they are what stops a configuration format becoming a
 * programming language one feature at a time.
 *
 * Two conventions, because the two halves face opposite ways:
 *
 * - In `state`, every value is a path - or a path and a value to compare it with, which yields a
 *   boolean. Reading a payload is extraction and nothing else; the comparison is the same one a
 *   claim already makes, admitted here because devices say `"on"` where the model wants `true`,
 *   and a profile that could not bridge that would exclude every light that reports a word.
 * - In a request template, every value is literal **unless** it is `{ "$": "path" }`. Requests
 *   are mostly constants, with the occasional value taken from the command or the device.
 */
import { z } from 'zod';

import {
  CAPABILITIES,
  CAPABILITY_DEFINITIONS,
  ENTITY_DOMAINS,
  ENTITY_STATE_CLASSES,
  capabilityNameSchema,
  declaredCapabilitiesSchema,
  iconIdSchema,
  jsonObjectSchema,
  type CapabilityName,
  IMAGE_CONTENT_TYPES,
} from '@nebulahome/contracts';

import { pathSchema } from './expression.js';

/** What a claim compares with, and what a table maps to: a JSON scalar. */
const scalarSchema = z.union([z.string(), z.number(), z.boolean()]);

/** How many models one claim may list. Beyond this it is a catalogue, not a family. */
const MAXIMUM_ONE_OF = 64;

/**
 * One condition a candidate must satisfy for an integration to claim it.
 *
 * `oneOf` is membership in a list - a family of devices is one model string among several -
 * and not an `or` between paths: the list is still all-of, and a claim needing boolean
 * algebra is still a claim whose integration should be code.
 *
 * `startsWith` is a prefix of a text, compared without regard to case: what a name a device
 * gives itself on the network looks like - `shellyplus1-a8032ab1`, `ShellyDimmerG3-…` - when
 * the rest of it is the device's own.
 */
export const claimConditionSchema = z.union([
  z.strictObject({ path: pathSchema, equals: scalarSchema }),
  z.strictObject({ path: pathSchema, exists: z.literal(true) }),
  z.strictObject({ path: pathSchema, oneOf: z.array(scalarSchema).min(1).max(MAXIMUM_ONE_OF) }),
  z.strictObject({ path: pathSchema, startsWith: z.string().min(1).max(64) }),
]);

/** One condition a candidate must satisfy for an integration to claim it. */
export type ClaimCondition = z.output<typeof claimConditionSchema>;

/** Part of a number: `[shift, width]`, the lowest bit first. */
const bitsSchema = z
  .tuple([z.int().min(0).max(31), z.int().min(1).max(32)])
  .refine(([shift, width]) => shift + width <= 32, 'The bits must fit in 32');

/** How a number the firmware writes as text is read: decimal, or hexadecimal. */
const baseSchema = z.union([z.literal(10), z.literal(16)]);

/** One place a state field's value comes from; see {@link stateValueSchema}. */
const stateSourceSchema = z.union([
  pathSchema,
  z.strictObject({
    path: pathSchema,
    bits: bitsSchema.optional(),
    base: baseSchema.optional(),
    equals: scalarSchema,
  }),
  z.strictObject({ path: pathSchema, present: z.literal(true) }),
  z.strictObject({
    path: pathSchema,
    bits: bitsSchema.optional(),
    base: baseSchema.optional(),
    map: z.record(z.string(), scalarSchema),
    default: scalarSchema.optional(),
  }),
  z
    .strictObject({ path: pathSchema, bits: bitsSchema.optional(), base: baseSchema.optional() })
    .refine(
      (source) => source.bits !== undefined || source.base !== undefined,
      'A path alone is written as the string itself',
    ),
]);

/** One place a state field's value comes from. */
export type StateSource = z.output<typeof stateSourceSchema>;

/**
 * Where a state field's value comes from.
 *
 * A path reads the value as it is. A path with `equals` reads it and compares, producing `true`
 * or `false`. A path with `map` reads it and looks it up: a table that renames what a device
 * says into what the capability accepts - `opening` for `opening`, `stopped` for everything
 * else through `default`. A table cannot compute, only rename, which is why it is admitted.
 *
 * All three yield nothing at all when the path names nothing, so a partial report that omits
 * the field leaves the entity as it was rather than switching it off. A value the table lacks
 * yields `default`, and nothing when there is none. That last point is the difference between
 * a lookup and a program: a program would have to be told about absence.
 *
 * The fourth form, `present`, is the one that is told about absence, and only in one place: it
 * is true when the path names a value and false when the object that would hold it is there
 * without it - an update offered, then no longer offered. A report that does not carry that
 * object at all still yields nothing.
 *
 * `bits` reads a field that is part of a number: `[shift, width]`, the lowest bit first. Some
 * firmware packs two readings into one integer - a Bambu printer's `temp` holds the current
 * temperature in the low 16 bits and the target in the high 16 - or a set of flags, one of which
 * is a door. It is indexing into a number, as a path indexes into a list, and nothing more: the
 * bits are read, then compared or looked up as any value is. `base` reads a number the firmware
 * writes as text - `"18"` with 10, flags as `"46A58008"` with 16 - and a text that is no
 * number yields nothing.
 *
 * Finally a field may name up to four of these, tried in order, the first that yields a value
 * being the one read: firmware that moved a reading keeps both places alive for a while, and a
 * report from either must be understood.
 */
export const stateValueSchema = z.union([
  stateSourceSchema,
  z.array(stateSourceSchema).min(2).max(4),
]);

/** Where a state field's value comes from. */
export type StateValue = z.output<typeof stateValueSchema>;

/**
 * Where a device's identity is found in what the probe returned.
 *
 * `externalId` is required because it is what makes the device the same device next time. The
 * rest is what the interface shows, and a device with no model is merely less informative.
 */
export const identityMappingSchema = z.strictObject({
  externalId: pathSchema,
  name: pathSchema.optional(),
  manufacturer: pathSchema.optional(),
  model: pathSchema.optional(),
  swVersion: pathSchema.optional(),
  hwVersion: pathSchema.optional(),
});

/** Where a device's identity is found in what the probe returned. */
export type IdentityMapping = z.output<typeof identityMappingSchema>;

/**
 * A value in a request template: a literal, or a path into the command.
 *
 * Recursive, so a nested query object can carry a path at any depth. Declared with an explicit
 * annotation for the same reason `jsonValueSchema` is: TypeScript cannot infer the type of a
 * schema that refers to itself.
 */
export type TemplateValue =
  | string
  | number
  | boolean
  | null
  | TemplateReference
  | TemplateValue[]
  | { readonly [key: string]: TemplateValue };

/** A path into the command, with what to do to what it names; see `templateReferenceSchema`. */
export type TemplateReference = {
  readonly $: string;
  readonly scale?: number | undefined;
  readonly decimals?: number | undefined;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly optional?: boolean | undefined;
};

/**
 * A path into the command, with what to do to what it names.
 *
 * `{ "$": "command.level" }` takes the value as it is. A device that counts in other units says
 * so: `scale` multiplies a number (`0.001` turns milliseconds into seconds), `decimals` rounds it,
 * `min` and `max` clamp it - in that order, numbers only. `optional` leaves the key out of the
 * request when the path names nothing, instead of sending `null`: a fade the command did not ask
 * for is no fade, not a fade of null seconds.
 */
export const templateReferenceSchema = z.strictObject({
  $: pathSchema,
  scale: z.number().positive().optional(),
  decimals: z.int().min(0).max(6).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  optional: z.boolean().optional(),
});

/** A value in a request template: a literal, or a {@link TemplateReference} into the command. */
export const templateValueSchema: z.ZodType<TemplateValue> = z.lazy(() =>
  z.union([
    templateReferenceSchema,
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(templateValueSchema),
    z.record(z.string(), templateValueSchema),
  ]),
);

/**
 * What the integration asks the transport to do.
 *
 * `op` and `args` are the transport's own vocabulary and are opaque here - `get` and a path for
 * HTTP, `publish` and a topic for MQTT. The transport validates them against its own schema,
 * because this file has no business knowing what an HTTP request looks like.
 */
export const requestTemplateSchema = z.strictObject({
  op: z.string().min(1).max(32),
  args: z.record(z.string(), templateValueSchema).default({}),
});

/** What the integration asks the transport to do. */
export type RequestTemplate = z.output<typeof requestTemplateSchema>;

/**
 * A command key: the capability, a dot, and the command name.
 *
 * Built from the capability list rather than matching any word, so a command naming a capability
 * that does not exist is refused where it is written instead of at the first attempt to send it.
 */
const COMMAND_KEY_PATTERN = new RegExp(`^(?:${CAPABILITIES.join('|')})[.][a-z][a-z0-9_]*$`);

/** How the integration finds devices and decides which are its own. */
export const discoveryProfileSchema = z.strictObject({
  /** Transport vocabulary: an mDNS service, an MQTT topic filter. Opaque here. */
  scan: jsonObjectSchema.default({}),

  /** What to ask a candidate before deciding, when the scan alone does not say enough. */
  probe: requestTemplateSchema.optional(),

  /**
   * Every condition must hold for the integration to claim the candidate.
   *
   * A list that means all-of, with no `or` and no `not`. Devices are told apart by a model
   * string and a field or two being present; a claim needing boolean algebra is a claim whose
   * integration should be code.
   */
  claim: z.array(claimConditionSchema).min(1),

  identity: identityMappingSchema,
});

/** How the integration finds devices and decides which are its own. */
export type DiscoveryProfile = z.output<typeof discoveryProfileSchema>;

/** One entity the device exposes, known before the device is ever contacted. */
export const entityProfileSchema = z
  .strictObject({
    domain: z.enum(ENTITY_DOMAINS),

    /**
     * Distinguishes this entity from the device's others.
     *
     * A literal, not a path: the entities are fixed, so their identifiers are too. `hub`
     * composes the entity id from the device and this. Omitted when a device exposes one entity.
     */
    objectId: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,31}$/, 'Must be a lower-case slug')
      .optional(),

    name: z.string().min(1).max(128).optional(),

    /**
     * The catalogue icon the entity starts with, by id, like a driver's `defaultIcon` for the
     * device. The owner may pick another afterwards; the bundle's choice is only the first.
     */
    icon: iconIdSchema.optional(),
    capabilities: declaredCapabilitiesSchema,

    /** Capability, then state field, then where its value is in the payload. */
    state: z.partialRecord(capabilityNameSchema, z.record(z.string(), stateValueSchema)),

    /** `<capability>.<command>`, then what to ask the transport to do. */
    commands: z.record(z.string().regex(COMMAND_KEY_PATTERN), requestTemplateSchema).default({}),

    /**
     * Attributes the entity reports beside its state, each read as a state field is:
     * what a page needs of it and the entity itself is not - when pairing closes by itself, beside
     * whether it is open. A scalar each; one whose source names nothing is left out, and every
     * report carries all of them, so one that stopped being said is gone rather than stale.
     */
    attributes: z
      .record(
        z.string().regex(/^[a-z][a-zA-Z0-9]{0,31}$/, 'Must be a camelCase key'),
        stateValueSchema,
      )
      .refine((attributes) => Object.keys(attributes).length <= 16, 'At most 16 attributes')
      .optional(),

    unitOfMeasurement: z.string().max(32).optional(),
    deviceClass: z.string().max(64).optional(),
    stateClass: z.enum(ENTITY_STATE_CLASSES).optional(),
    displayPrecision: z.int().min(0).max(6).optional(),

    /**
     * For a camera: the stream source that reads its picture, `<vendor>/<name>`, and what it is
     * told to read. The source is handed the instance's transport settings as well.
     */
    stream: z
      .strictObject({
        source: z.string().regex(/^[a-z][a-z0-9-]{1,63}\/[a-z][a-z0-9-]{0,63}$/u),
        args: jsonObjectSchema.default({}),
      })
      .optional(),

    /**
     * For an image: where in the payload the picture is - an SVG's text, a PNG's bytes
     * in base64 - what it is, and how often at most a new one is announced. The hub keeps the
     * picture and publishes only which one it is (`revision`), so the state stays small however
     * large the picture.
     */
    image: z
      .strictObject({
        path: pathSchema,
        contentType: z.enum(IMAGE_CONTENT_TYPES),
        encoding: z.enum(['utf8', 'base64']).default('utf8'),
        minIntervalMs: z.int().min(0).max(600_000).default(2000),
      })
      .optional(),
  })
  .superRefine((entity, ctx) => {
    if (entity.stream !== undefined && entity.domain !== 'camera') {
      ctx.addIssue({
        code: 'custom',
        path: ['stream'],
        message: 'Only a camera has a stream',
      });
    }

    if (entity.image !== undefined && entity.domain !== 'image') {
      ctx.addIssue({
        code: 'custom',
        path: ['image'],
        message: 'Only an image has a picture',
      });
    }

    for (const [capability, fields] of Object.entries(entity.state)) {
      const name = capability as CapabilityName;

      if (!(name in entity.capabilities)) {
        ctx.addIssue({
          code: 'custom',
          path: ['state', capability],
          message: `The entity does not declare the ${capability} capability`,
        });
        continue;
      }

      const state = CAPABILITY_DEFINITIONS[name].state;

      if (!(state instanceof z.ZodObject)) {
        continue;
      }

      for (const field of Object.keys(fields)) {
        if (!(field in state.shape)) {
          // A misspelt field maps nothing, forever, in silence: the entity simply never
          // reports. Whoever writes a profile is not necessarily a programmer, and this is the
          // one mistake they cannot see from the outside.
          ctx.addIssue({
            code: 'custom',
            path: ['state', capability, field],
            message: `The ${capability} capability has no ${field} field`,
          });
        }
      }
    }
  });

/** One entity the device exposes, known before the device is ever contacted. */
export type EntityProfile = z.output<typeof entityProfileSchema>;

/**
 * Where what the device reports says what it is, after it was found: its firmware, above all,
 * which an update changes and which identification read only once. A path or a list of paths
 * tried in order, as identity's.
 */
export const deviceInfoMappingSchema = z.strictObject({
  swVersion: z.union([pathSchema, z.array(pathSchema).min(1).max(4)]).optional(),
  hwVersion: z.union([pathSchema, z.array(pathSchema).min(1).max(4)]).optional(),
});

/** Where what the device reports says what it is. */
export type DeviceInfoMapping = z.output<typeof deviceInfoMappingSchema>;

/** The whole of a declarative bundle. */
export const integrationProfileSchema = z.strictObject({
  discovery: discoveryProfileSchema,

  /** What the transport should subscribe to or poll on this integration's behalf. */
  subscriptions: z.array(requestTemplateSchema).default([]),

  /** Where the device's own reports say which firmware it runs now. */
  device: deviceInfoMappingSchema.optional(),

  /** At least one: a profile that declares no entity describes nothing. */
  entities: z.array(entityProfileSchema).min(1),
});

/** The whole of a declarative bundle. */
export type IntegrationProfile = z.output<typeof integrationProfileSchema>;
