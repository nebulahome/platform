/**
 * What is already added, which discovery does not propose again.
 *
 * Two ways to recognise a device that has an instance: by the id identification found it to be,
 * and by the address its instance reaches - the second is what covers an instance still waiting
 * to hear from its device, and one that failed to start. Both are keyed by vendor, since two
 * vendors' ids and addresses mean nothing to each other.
 */
import { MATTER_TRANSPORT, type JsonObject } from '@nebulahome/contracts';

/** Where an identified device's instance reaches it. */
export type TakenLocation = {
  /** The instance, which is the device's id in the interface. */
  readonly instanceId: string;

  /** The address its configuration names. */
  readonly host: string;
};

/** The instance a Matter device was added as. */
export type TakenMatter = { readonly instanceId: string; readonly kind: string };

/**
 * What is already added.
 *
 * Keyed `<vendor>\n<value>`: a vendor's external id, and the address its instances reach.
 */
export type TakenDevices = {
  readonly externalIds: ReadonlySet<string>;
  readonly hosts: ReadonlySet<string>;

  /**
   * Where each identified device is reached, by `<vendor>\n<external id>`: what tells a device
   * heard at another address that it moved, rather than that it is a second one.
   */
  readonly locations: ReadonlyMap<string, TakenLocation>;

  /**
   * The Matter devices added, by their key - `<node>` or `<node>:<endpoint>` - whichever vendor
   * added them: a Matter device is the fabric's one device, and is never proposed twice.
   */
  readonly matter: ReadonlyMap<string, TakenMatter>;
};

/** One instance, as far as recognising its device goes. */
export type TakenRow = {
  /** The instance. */
  readonly id: string;

  /** The driver, `vendor/driver`, which names the vendor. */
  readonly kind: string;

  /** How the instance reaches its device; only the address is read, and it is never a secret. */
  readonly transportConfig: JsonObject;

  /** What identification found the device to be, once it has. */
  readonly externalId: string | null;

  /** The transport the instance opens; absent where it does not matter. */
  readonly transport?: string;
};

/** Nothing added. */
export const NOTHING_TAKEN: TakenDevices = {
  externalIds: new Set(),
  hosts: new Set(),
  locations: new Map(),
  matter: new Map(),
};

/**
 * The address a configuration reaches: its `host`, or the host of its `url` for a transport
 * reached through one - a broker, a printer's MQTT port.
 *
 * @param config - A transport configuration.
 * @returns The address, with its port when it has one; undefined when it names none.
 */
export function addressOf(config: JsonObject): string | undefined {
  const host = config['host'];

  if (typeof host === 'string' && host.length > 0) {
    return host;
  }

  const url = config['url'];

  if (typeof url === 'string') {
    try {
      const parsed = new URL(url);

      return parsed.hostname.length > 0 ? parsed.hostname : undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

/**
 * Collects what is already added from every instance.
 *
 * @param rows - Every instance, with its device's external id when it has one.
 * @returns The ids and addresses, keyed by vendor.
 */
export function takenFrom(rows: readonly TakenRow[]): TakenDevices {
  const externalIds = new Set<string>();
  const hosts = new Set<string>();
  const locations = new Map<string, TakenLocation>();
  const matter = new Map<string, TakenMatter>();

  for (const row of rows) {
    const [vendorId = ''] = row.kind.split('/');
    const host = addressOf(row.transportConfig);

    if (row.externalId !== null) {
      externalIds.add(`${vendorId}\n${row.externalId}`);

      if (host !== undefined) {
        locations.set(`${vendorId}\n${row.externalId}`, { instanceId: row.id, host });
      }

      if (row.transport === MATTER_TRANSPORT) {
        matter.set(row.externalId, { instanceId: row.id, kind: row.kind });
      }
    }

    if (host !== undefined) {
      hosts.add(`${vendorId}\n${host}`);
    }
  }

  return { externalIds, hosts, locations, matter };
}
