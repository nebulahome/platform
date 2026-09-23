/**
 * `discovery.json`: how a vendor's devices are found without an owner saying where to look.
 *
 * Optional, one per vendor, beside its `setup.json`. A vendor without it is not discoverable and
 * is added the way it always was, by address. A vendor with it says four things, and the hub
 * does the same six steps for every vendor that has one:
 *
 * 1. **listen** - where the devices announce themselves: an mDNS service the platform browses,
 *    or a module of the vendor's own for a protocol the platform does not speak.
 * 2. **match** - which announcements are the vendor's, when a service is shared.
 * 3. **probe** - what to ask the announced address, through one of the vendor's transports,
 *    when the announcement alone does not say who the device is. Without one the announcement
 *    is what the next step reads.
 * 4. **identity** - where, in what came back, the device says its model, its id and its name.
 * 5. **associate** - which driver takes that model, through the codes each driver maps onto its
 *    models (`modelCodes` in `driver.json`), or failing that the drivers' own claims. Two drivers
 *    may map one code only when the vendor probes: a Shelly 2PM reports the same code whether it
 *    runs as two relays or as a cover, and the drivers' claims read which from the answer.
 * 6. **propose** - the device, its driver and its model, for an owner to adopt.
 *
 * Steps 1 and 3 may need code; 2, 4 and 5 never do, which is the point: however a vendor hears
 * its devices, the decision about which driver a device belongs to is made by the same rule for
 * every vendor, out of what the bundle declares.
 *
 * The file is data, held to the same grammar a profile is: conditions from {@link claimConditionSchema},
 * and every expression a path. A module named in `listen` is code, at the tier a vendor's own
 * transport is.
 */
import { z } from 'zod';

import { jsonObjectSchema, transportIdSchema, type JsonObject } from '@nebula-home/contracts';

import { bundlePathSchema } from './bundle.js';
import { conditionHolds, resolvePath } from './evaluate.js';
import { pathSchema } from './expression.js';
import { claimConditionSchema } from './profile.js';
import type { BundleSdk } from './sdk.js';

/** An mDNS service type, as announcements carry it: `_shelly._tcp`, `_ewelink._tcp`. */
export const MDNS_SERVICE_PATTERN = /^_[a-z0-9][a-z0-9-]{0,62}\._(?:tcp|udp)$/;

/** How many sources one vendor may listen to. */
const MAXIMUM_SOURCES = 4;

/** How many conditions a vendor's match may hold. */
const MAXIMUM_MATCH = 16;

/**
 * Where a vendor's devices announce themselves.
 *
 * A union of strict objects, so a source the platform does not have yet - `ssdp` - fails where it
 * is written rather than being listened to by nobody.
 */
export const listenSourceSchema = z.union([
  z.strictObject({
    /** A service the platform browses for over mDNS. */
    mdns: z
      .string()
      .regex(MDNS_SERVICE_PATTERN, 'Must be an mDNS service type, as _name._tcp or _name._udp'),
  }),
  z.strictObject({
    /** A module of the vendor's own, relative to the vendor, that listens and reports. */
    module: bundlePathSchema,
  }),
]);

/** Where a vendor's devices announce themselves. */
export type ListenSource = z.output<typeof listenSourceSchema>;

/**
 * Where a device says who it is, in what the probe returned or, without one, in the announcement.
 *
 * Every field is optional, because devices say different amounts before they are set up: a
 * Nanoleaf announces its model and a name but gives its serial only to a caller holding its token.
 * What is missing the owner is asked for, or identification learns later.
 */
export const discoveryIdentitySchema = z.strictObject({
  /** What the hardware calls its model, looked up in the drivers' `modelCodes`. */
  model: pathSchema.optional(),

  /** What makes the device the same device next time: the same value identification reads. */
  externalId: pathSchema.optional(),

  name: pathSchema.optional(),
  swVersion: pathSchema.optional(),
});

/** Where a device says who it is. */
export type DiscoveryIdentity = z.output<typeof discoveryIdentitySchema>;

/**
 * What to ask an announced address.
 *
 * `op` and `args` are the transport's vocabulary, as in a profile's probe. There is no command to
 * take a value from, so the arguments are literal.
 */
export const discoveryProbeSchema = z.strictObject({
  transport: transportIdSchema,
  op: z.string().min(1).max(32),
  args: jsonObjectSchema.default({}),
});

/** What to ask an announced address. */
export type DiscoveryProbe = z.output<typeof discoveryProbeSchema>;

/** Validates a whole `discovery.json`. */
export const vendorDiscoverySchema = z
  .strictObject({
    listen: z.array(listenSourceSchema).min(1).max(MAXIMUM_SOURCES),

    /** Every condition must hold of an announcement for it to be the vendor's. All-of. */
    match: z.array(claimConditionSchema).max(MAXIMUM_MATCH).default([]),

    probe: discoveryProbeSchema.optional(),
    identity: discoveryIdentitySchema,
  })
  .superRefine((discovery, ctx) => {
    if (discovery.probe === undefined && discovery.identity.model === undefined) {
      // Without a probe there is no answer for the drivers' own claims to read - they were
      // written for what identification sees - so the model is the only way to a driver.
      ctx.addIssue({
        code: 'custom',
        path: ['identity', 'model'],
        message: 'A vendor that does not probe must say where the announcement names the model',
      });
    }
  });

/** A whole `discovery.json`, parsed. */
export type VendorDiscovery = z.output<typeof vendorDiscoverySchema>;

/** A driver, as far as discovery needs one: its name, its models and their codes. */
export type DiscoveryDriver = {
  readonly id: string;

  /** The driver's own name, offered as its one model when it lists none. */
  readonly name: string;

  readonly models: readonly string[];
  readonly modelCodes?: Readonly<Record<string, string | readonly string[]>> | undefined;
};

/** A vendor's discovery, checked against its drivers and ready to answer. */
export type DiscoveryPlan = {
  readonly vendorId: string;
  readonly discovery: VendorDiscovery;
  readonly drivers: readonly DiscoveryDriver[];

  /** Every code any driver maps, and the drivers and models it names, in load order. */
  readonly codes: ReadonlyMap<string, readonly CodedModels[]>;
};

/** What one driver maps one code onto. */
export type CodedModels = { readonly driverId: string; readonly models: readonly string[] };

/**
 * Checks a vendor's discovery against its drivers, once, at load.
 *
 * @param vendorId - The vendor the file belongs to.
 * @param discovery - The parsed file.
 * @param drivers - The vendor's drivers, in the order they were loaded.
 * @returns The plan the hub answers announcements with.
 * @throws {Error} When the probe names another vendor's transport, or one code is mapped by two
 * drivers of a vendor that does not probe - nothing but load order could then tell them apart.
 */
export function resolveDiscovery(
  vendorId: string,
  discovery: VendorDiscovery,
  drivers: readonly DiscoveryDriver[],
): DiscoveryPlan {
  const transport = discovery.probe?.transport;
  const slash = transport?.indexOf('/') ?? -1;

  if (transport !== undefined && slash !== -1 && transport.slice(0, slash) !== vendorId) {
    throw new Error(
      `${vendorId} probes with ${transport}, which belongs to another vendor; discovery uses the platform's transports or its own vendor's`,
    );
  }

  const codes = new Map<string, CodedModels[]>();

  for (const driver of drivers) {
    for (const [code, named] of Object.entries(driver.modelCodes ?? {})) {
      const taken = codes.get(code) ?? [];
      const [first] = taken;

      if (first !== undefined && discovery.probe === undefined) {
        throw new Error(
          `${vendorId}: ${code} is mapped by both ${first.driverId} and ${driver.id}, and without a probe nothing tells the two apart`,
        );
      }

      codes.set(code, [
        ...taken,
        { driverId: driver.id, models: typeof named === 'string' ? [named] : named },
      ]);
    }
  }

  return { vendorId, discovery, drivers, codes };
}

/**
 * Whether an announcement is the vendor's.
 *
 * @param plan - The vendor's discovery.
 * @param record - What the source heard.
 * @returns True when every condition of the vendor's match holds, and always for a vendor that
 * asks for none.
 */
export function matchesAnnouncement(plan: DiscoveryPlan, record: unknown): boolean {
  return plan.discovery.match.every((condition) => conditionHolds(condition, record));
}

/** Who a sighted device says it is. Each field is null when it did not say. */
export type SightingIdentity = {
  readonly externalId: string | null;
  readonly name: string | null;
  readonly modelCode: string | null;
  readonly swVersion: string | null;
};

/**
 * Reads one identity field as text.
 *
 * @param payload - What came back.
 * @param path - Where the vendor says the field is, if anywhere.
 * @returns The text, a number spelled out, or null for anything else. A serial reported as a
 * number is still a serial.
 */
function textAt(payload: unknown, path: string | undefined): string | null {
  if (path === undefined) {
    return null;
  }

  const value = resolvePath(payload, path);

  if (typeof value === 'string') {
    return value.length === 0 ? null : value;
  }

  return typeof value === 'number' ? String(value) : null;
}

/**
 * Reads who a device is from where the vendor says.
 *
 * @param plan - The vendor's discovery.
 * @param payload - What the probe returned, or the announcement when there was none.
 * @returns The identity, with null wherever the device did not say.
 */
export function identifySighting(plan: DiscoveryPlan, payload: unknown): SightingIdentity {
  const { identity } = plan.discovery;

  return {
    externalId: textAt(payload, identity.externalId),
    name: textAt(payload, identity.name),
    modelCode: textAt(payload, identity.model),
    swVersion: textAt(payload, identity.swVersion),
  };
}

/** The driver a device belongs to, and which of its models it is. */
export type Association = {
  readonly driverId: string;

  /** The model, when it is certain; null when the owner has to pick among the choices. */
  readonly model: string | null;

  /** What the owner may pick from: the family a code names, or every model of the driver. */
  readonly modelChoices: readonly string[];
};

/**
 * The models an owner adding a device of a driver picks from.
 *
 * @param driver - The driver.
 * @returns Its models, or its own name when it lists none - the same rule the add form follows.
 */
function choicesOf(driver: DiscoveryDriver): readonly string[] {
  return driver.models.length === 0 ? [driver.name] : driver.models;
}

/**
 * Finds the driver a device belongs to, and its model.
 *
 * The code the hardware reports is looked up in the drivers' `modelCodes` first; when two drivers
 * map it, their own claims decide between them. When no driver maps it, the drivers' own claims
 * decide, in the order the drivers were loaded - the claim identification already makes, so a
 * vendor whose drivers claim by model needs no codes at all.
 *
 * @param plan - The vendor's discovery.
 * @param modelCode - What the hardware calls its model, when it said.
 * @param claimedBy - Whether a driver's own claim takes what the probe returned. Absent when
 * there was no probe: the claims were written for that answer and read nothing else.
 * @returns The association, or null when no driver of the vendor takes the device.
 */
export function associateModel(
  plan: DiscoveryPlan,
  modelCode: string | null,
  claimedBy?: (driverId: string) => boolean,
): Association | null {
  const coded = modelCode === null ? [] : (plan.codes.get(modelCode) ?? []);

  if (coded.length > 0) {
    const found =
      coded.length === 1 ? coded[0] : coded.find((entry) => claimedBy?.(entry.driverId) === true);

    return found === undefined
      ? null
      : {
          driverId: found.driverId,
          model: found.models.length === 1 ? (found.models[0] ?? null) : null,
          modelChoices: found.models,
        };
  }

  if (claimedBy === undefined) {
    return null;
  }

  const driver = plan.drivers.find((candidate) => claimedBy(candidate.id));

  if (driver === undefined) {
    return null;
  }

  const choices = choicesOf(driver);
  const named = modelCode !== null && choices.includes(modelCode) ? modelCode : null;

  return {
    driverId: driver.id,
    model: named ?? (choices.length === 1 ? (choices[0] ?? null) : null),
    modelChoices: choices,
  };
}

/**
 * What a listening source heard: a device, how to reach it, and what it said.
 *
 * `config` is what reaches it in the transport's own terms - `{ host }` - and becomes the
 * device's connection once adopted. `payload` is what identity and match read.
 */
export type Sighting = {
  readonly config: JsonObject;
  readonly payload: JsonObject;
};

/** A vendor's own listener, for a protocol the platform does not speak. */
export type DiscoverySource = {
  /**
   * Listens until the signal ends it, reporting every device heard.
   *
   * @param signal - Ends the listening.
   * @returns Every sighting, as it happens. The same device may be reported again.
   */
  listen: (signal: AbortSignal) => AsyncIterable<Sighting>;
};

/** What a discovery module default-exports. */
export type DiscoverySourceFactory = (sdk: BundleSdk) => DiscoverySource;

/**
 * What the platform's mDNS source reports, which a vendor's match and identity read.
 *
 * `txt` holds the service's TXT record as text; a key with no value reads as an empty string.
 */
export type MdnsAnnouncement = {
  readonly service: string;
  readonly instance: string;
  readonly host: string;
  readonly address: string;
  readonly port: number;
  readonly txt: Readonly<Record<string, string>>;
};
