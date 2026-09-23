/**
 * What is already added, which discovery does not propose again.
 *
 * Two ways to recognise a device that has an instance: by the id identification found it to be,
 * and by the address its instance reaches - the second is what covers an instance still waiting
 * to hear from its device, and one that failed to start. Both are keyed by vendor, since two
 * vendors' ids and addresses mean nothing to each other.
 */
import type { JsonObject } from '@nebula-home/contracts';

/**
 * What is already added.
 *
 * Keyed `<vendor>\n<value>`: a vendor's external id, and the address its instances reach.
 */
export type TakenDevices = {
  readonly externalIds: ReadonlySet<string>;
  readonly hosts: ReadonlySet<string>;
};

/** One instance, as far as recognising its device goes. */
export type TakenRow = {
  /** The driver, `vendor/driver`, which names the vendor. */
  readonly kind: string;

  /** How the instance reaches its device; only `host` is read, and it is never a secret. */
  readonly transportConfig: JsonObject;

  /** What identification found the device to be, once it has. */
  readonly externalId: string | null;
};

/**
 * Collects what is already added from every instance.
 *
 * @param rows - Every instance, with its device's external id when it has one.
 * @returns The ids and addresses, keyed by vendor.
 */
export function takenFrom(rows: readonly TakenRow[]): TakenDevices {
  const externalIds = new Set<string>();
  const hosts = new Set<string>();

  for (const row of rows) {
    const [vendorId = ''] = row.kind.split('/');
    const host = row.transportConfig['host'];

    if (row.externalId !== null) {
      externalIds.add(`${vendorId}\n${row.externalId}`);
    }

    if (typeof host === 'string' && host.length > 0) {
      hosts.add(`${vendorId}\n${host}`);
    }
  }

  return { externalIds, hosts };
}
