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
 * 6. **propose** - the device, its driver and its model, for an owner to adopt - or, for a vendor
 *    that says `"adopt": "automatic"`, for the platform to add at once.
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

import {
  DEVICE_ADOPTIONS,
  jsonObjectSchema,
  transportIdSchema,
  type JsonObject,
} from '@nebula-home/contracts';

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

    /**
     * Since 1.3: whether the module listens on the house's network. Most do - a multicast scan,
     * an announcement - and are off where the platform cannot hear the network (a container on a
     * bridge). One that listens somewhere the platform always reaches - zigbee2mqtt's list of
     * devices on the platform's own broker - says `false`, and runs regardless.
     */
    lan: z.boolean().default(true),
  }),
]);

/** Where a vendor's devices announce themselves. */
export type ListenSource = z.output<typeof listenSourceSchema>;

/**
 * Where one identity field is: a path, or several tried in order.
 *
 * Several when the vendor's generations answer the same question in different words - a Shelly
 * Gen1 says `type` and `mac` where later ones say `model` and `id` - so the first path that names
 * a value is the one read.
 */
const identityPathSchema = z.union([pathSchema, z.array(pathSchema).min(1).max(4)]);

/**
 * Where a device says who it is, in what the probe returned or, without one, in the announcement.
 *
 * Every field is optional, because devices say different amounts before they are set up: a
 * Nanoleaf announces its model and a name but gives its serial only to a caller holding its token.
 * What is missing the owner is asked for, or identification learns later.
 */
export const discoveryIdentitySchema = z.strictObject({
  /** What the hardware calls its model, looked up in the drivers' `modelCodes`. */
  model: identityPathSchema.optional(),

  /** What makes the device the same device next time: the same value identification reads. */
  externalId: identityPathSchema.optional(),

  name: identityPathSchema.optional(),
  swVersion: identityPathSchema.optional(),
});

/** Where a device says who it is. */
export type DiscoveryIdentity = z.output<typeof discoveryIdentitySchema>;

/**
 * What to ask an announced address.
 *
 * `op` and `args` are the transport's vocabulary, as in a profile's probe. There is no command to
 * take a value from, so the arguments are literal.
 *
 * `timeoutMs` is how long the answer may take, for devices slower than the platform's few
 * seconds: a Shelly on a weak Wi-Fi link sleeps its radio and takes seconds to answer the first
 * request. It is also handed to the transport as its own `timeoutMs`, so the transport must be one
 * that reads it - `http` and `shelly/rpc` do.
 */
export const discoveryProbeSchema = z.strictObject({
  transport: transportIdSchema,
  op: z.string().min(1).max(32),
  args: jsonObjectSchema.default({}),
  timeoutMs: z.int().min(500).max(30_000).optional(),
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

    /**
     * Since 1.4: who adds a device found. `owner` - the default - proposes it on the vendor's
     * page; `automatic` adds it as soon as it is heard, for devices the owner already chose
     * somewhere else: a Zigbee device paired with Zigbee2MQTT.
     */
    adopt: z.enum(DEVICE_ADOPTIONS).default('owner'),

    /**
     * Since 1.4: the switch that opens pairing, for a vendor whose devices are paired through one
     * of its own - a driver of the vendor and the `objectId` of a switch of its profile, on while
     * pairing is open. The vendor's page offers it in place of looking for devices.
     */
    pairing: z
      .strictObject({
        driver: z.string().min(1).max(64),
        entity: z.string().min(1).max(64),
      })
      .optional(),
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
 * @throws {Error} When the probe names another vendor's transport, one code is mapped by two
 * drivers of a vendor that does not probe - nothing but load order could then tell them apart -
 * or pairing names a driver the vendor does not have.
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

  const pairing = discovery.pairing?.driver;

  if (pairing !== undefined && !drivers.some((driver) => driver.id === pairing)) {
    throw new Error(`${vendorId} pairs through ${pairing}, which is not one of its drivers`);
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
 * @param path - Where the vendor says the field is, if anywhere: one path, or several in order.
 * @returns The text of the first path that names one, a number spelled out, or null for anything
 * else. A serial reported as a number is still a serial.
 */
function textAt(payload: unknown, path: string | readonly string[] | undefined): string | null {
  if (path === undefined) {
    return null;
  }

  for (const each of typeof path === 'string' ? [path] : path) {
    const value = resolvePath(payload, each);

    if (typeof value === 'string' && value.length > 0) {
      return value;
    }

    if (typeof value === 'number') {
      return String(value);
    }
  }

  return null;
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
 * The code the hardware reports is looked up in the drivers' `modelCodes` first; with a probe's
 * answer the drivers' own claims confirm it, and decide between two drivers that map it. When no
 * driver maps it, the drivers' own claims
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
    // With a probe's answer, the driver's own claim has the last word even when the code names
    // one driver: a Pro 3EM reports one code in either of its profiles, and only its triphase one
    // is the driver's. Without one there is nothing for a claim to read, and the code decides.
    const found =
      claimedBy === undefined
        ? coded.length === 1
          ? coded[0]
          : undefined
        : coded.find((entry) => claimedBy(entry.driverId));

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

/** Since 1.4: what the hub hands a listener beside the signal. */
export type DiscoveryListenContext = {
  /**
   * Reads what the owner saved for the vendor - an account, a key - secrets opened, for a
   * listener that asks a cloud which devices the account has. Read it at every pass rather than
   * once: a change the owner saves is then heard without the listener being started again.
   *
   * @returns The vendor's settings; empty while it is not set up.
   */
  readonly settings: () => Promise<JsonObject>;
};

/** A vendor's own listener, for a protocol the platform does not speak. */
export type DiscoverySource = {
  /**
   * Listens until the signal ends it, reporting every device heard.
   *
   * @param signal - Ends the listening.
   * @param context - Since 1.4: the vendor's settings, for a listener that needs them.
   * @returns Every sighting, as it happens. The same device may be reported again.
   */
  listen: (signal: AbortSignal, context: DiscoveryListenContext) => AsyncIterable<Sighting>;

  /**
   * Asks the network again now, rather than at the listener's own next pass: what the owner's
   * "look for devices" reaches. Optional, for a listener that only ever hears announcements and
   * has nothing to ask. Answers arrive through `listen`, like every other sighting.
   */
  scan?: () => void;
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
