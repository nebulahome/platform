/**
 * What `hub`'s discovery makes of a device it heard, by the vendor's `discovery.json`: whether the
 * announcement is the vendor's (`match`), who the device says it is (`identity`), and which
 * driver and model that names (`modelCodes`, then the drivers' own claims on the probe's answer).
 * The same functions `hub` runs, so a test of a vendor's discovery is a test of what the house
 * will propose.
 */
import type { Discovered, LoadedVendor } from '@nebulahome/package-runtime';
import {
  associateBroker,
  associateModel,
  identifySighting,
  matchesAnnouncement,
  matchesBroker,
  type Association,
  type SightingIdentity,
} from '@nebulahome/package-runtime';

/** What discovery made of what it heard. */
export type Identification = {
  /** Whether the announcement is the vendor's: every `match` condition holds. */
  readonly matches: boolean;

  /** Who the device says it is, by the paths of `identity`. */
  readonly identity: SightingIdentity;

  /** The driver and the model it names; null when no driver takes the device. */
  readonly association: Association | null;
};

/**
 * Says what discovery makes of a device heard.
 *
 * @param vendor - The vendor, loaded with `loadIntegration`.
 * @param heard - What was heard: the announcement `match` reads, and the probe's answer that
 * `identity` and the drivers' claims read - the announcement itself for a vendor without a probe.
 * @param heard.announcement - The announcement: an mDNS record, what a listener reported.
 * @param heard.probed - The probe's answer, for a vendor that probes; the announcement when not
 * said.
 * @param heard.deviceKey - How the device is reached, for the drivers' claims: `192.0.2.10` when
 * not said.
 * @returns What discovery makes of it.
 * @throws {Error} When the vendor has no discovery that loaded.
 */
export function identify(
  vendor: LoadedVendor,
  heard: { readonly announcement: unknown; readonly probed?: unknown; readonly deviceKey?: string },
): Identification {
  const plan = vendor.discovery?.plan;

  if (plan === undefined) {
    throw new Error(`${vendor.manifest.id} has no discovery.json that loaded`);
  }

  // A vendor without a probe reads the announcement itself, as the hub does.
  const answer =
    plan.discovery.probe === undefined ? heard.announcement : (heard.probed ?? heard.announcement);
  const identity = identifySighting(plan, answer);
  const discovered: Discovered = { deviceKey: heard.deviceKey ?? '192.0.2.10', payload: answer };
  const claims =
    plan.discovery.probe === undefined
      ? undefined
      : (driverId: string): boolean => {
          const driver = vendor.drivers.find((candidate) => candidate.driverId === driverId);

          return driver?.integration.claim(discovered, {}) != null;
        };

  return {
    matches: matchesAnnouncement(plan, heard.announcement),
    identity,
    association: associateModel(plan, identity.modelCode, claims),
  };
}

/** What discovery makes of one of the house's Matter devices. */
export type MatterIdentification = {
  /** Whether the vendor's `matter` rules take it: every condition holds. */
  readonly matches: boolean;

  /** The Matter driver and the model it names; null when no driver takes the device. */
  readonly association: Association | null;
};

/**
 * Says what discovery makes of one of the house's Matter devices, by the vendor's `matter` rules.
 * A device that another vendor's rules take too is the platform's own instead, which one vendor's
 * test cannot see.
 *
 * @param vendor - The vendor, loaded with `loadIntegration`.
 * @param identity - Who the device says it is: `vendorId`, `productId`, `vendorName`,
 * `isBridged` and the rest of the fields FILES.md lists; a field left out is one it does not say.
 * @returns What discovery makes of it.
 * @throws {Error} When the vendor has no discovery that loaded.
 */
export function identifyMatter(
  vendor: LoadedVendor,
  identity: Readonly<Record<string, unknown>>,
): MatterIdentification {
  const plan = vendor.discovery?.plan;

  if (plan === undefined) {
    throw new Error(`${vendor.manifest.id} has no discovery.json that loaded`);
  }

  const matches = matchesBroker(plan, 'matter', identity);

  return { matches, association: matches ? associateBroker(plan, 'matter', identity) : null };
}

/** What discovery makes of one of the devices the house's MQTT broker hears. */
export type MqttIdentification = {
  /** Whether the vendor's `mqtt` rules take it: every condition holds. */
  readonly matches: boolean;

  /** The MQTT driver and the model it names; null when no driver takes the device. */
  readonly association: Association | null;
};

/**
 * Says what discovery makes of one of the devices the house's MQTT broker hears - one that
 * announced itself, or one the owner mapped - by the vendor's `mqtt` rules. A device that another
 * vendor's rules take too is the platform's own instead, which one vendor's test cannot see.
 *
 * @param vendor - The vendor, loaded with `loadIntegration`.
 * @param identity - Who the device says it is: `manufacturer`, `model`, `originName`,
 * `identifiers` and the rest of the fields FILES.md lists; a field left out is one it does not say.
 * @returns What discovery makes of it.
 * @throws {Error} When the vendor has no discovery that loaded.
 */
export function identifyMqtt(
  vendor: LoadedVendor,
  identity: Readonly<Record<string, unknown>>,
): MqttIdentification {
  const plan = vendor.discovery?.plan;

  if (plan === undefined) {
    throw new Error(`${vendor.manifest.id} has no discovery.json that loaded`);
  }

  const matches = matchesBroker(plan, 'mqtt', identity);

  return { matches, association: matches ? associateBroker(plan, 'mqtt', identity) : null };
}
