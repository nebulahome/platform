/**
 * The platform's mDNS source: the devices that announce themselves over multicast DNS.
 *
 * Shelly, Sonoff in DIY mode, Nanoleaf, a Hue bridge - a great many LAN devices say who they are
 * on `224.0.0.251:5353`, under a service type of their own. The source browses for the types the
 * loaded vendors declared and reports each device as an {@link MdnsAnnouncement}, which is what a
 * vendor's `match` and `identity` read.
 *
 * It listens all the time and asks when told to: a PTR query for each service type, which is the
 * question mDNS exists to answer and the one every phone asks - no address is swept and no port is
 * scanned. What answers is remembered until its records expire, so each query also reports again
 * every device still remembered, which is how the hub knows it is still there.
 *
 * Three things a plain browser gets wrong, and this one does not:
 *
 * - **Every network interface is asked.** A socket sends a multicast question out of one
 *   interface, the one the system picks - on a machine with a Hyper-V, WSL, Docker or VPN adapter
 *   that is often not the house network, and nothing answers. There is one socket per private
 *   IPv4 interface of this machine (its own adapters, read from the system: no address is
 *   enumerated), and a question goes out of each.
 * - **An incomplete answer is completed.** A device may answer the PTR question without the SRV
 *   record saying its port and host, or the A record saying its address, in the same packet.
 *   What is missing is asked for by name, rather than the device being ignored until it
 *   announces itself again.
 * - **A socket that fails is logged, not thrown.** An `error` event with no listener ends the
 *   process: the port taken, the interface gone, and the hub would stop.
 *
 * Only a private IPv4 address is reported. Announcements are not authenticated - anything on the
 * network may announce anything - and the hub probes what is announced, so an announcement
 * pointing at a host on the internet is dropped here rather than followed.
 */
import os from 'node:os';

import createMulticastDns, {
  type MulticastDns,
  type MulticastDnsOptions,
  type MulticastDnsPacket,
  type MulticastDnsQuestion,
  type MulticastDnsRemote,
} from 'multicast-dns';

import type { PlatformLogger } from '@nebulahome/logging';
import type { MdnsAnnouncement } from '@nebulahome/package-runtime';

/** What the source needs of a service it found. */
export type BrowsedService = {
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly txt?: unknown;
  readonly addresses?: readonly string[];
  readonly referer?: { readonly address: string };
};

/** The platform's mDNS browser, as discovery drives it. */
export type MdnsSource = {
  /**
   * Starts browsing.
   *
   * @param services - The service types to browse for: `_shelly._tcp`.
   * @param onAnnouncement - Called with every device heard, again each time it is heard.
   */
  readonly start: (
    services: readonly string[],
    onAnnouncement: (announcement: MdnsAnnouncement) => void,
  ) => void;

  /**
   * Asks again, and reports again every device still remembered.
   *
   * @param services - Only these service types; every one browsed for when absent.
   */
  readonly query: (services?: readonly string[]) => void;

  /**
   * Stops browsing and lets go of the sockets.
   *
   * @returns A promise that settles once they are closed.
   */
  readonly stop: () => Promise<void>;
};

/** What the source is made with. */
export type MdnsSourceOptions = {
  /** Where the sockets' failures are logged. */
  readonly logger: PlatformLogger;

  /** Opens one socket on the mDNS group; `multicast-dns` when not said. */
  readonly open?: (options: MulticastDnsOptions) => MulticastDns;

  /** The addresses of this machine's interfaces to ask on; {@link lanInterfaces} when not said. */
  readonly interfaces?: () => readonly string[];

  /** The clock, in milliseconds; the wall clock when not said. */
  readonly now?: () => number;
};

/** The private IPv4 ranges a house network uses, link-local, and loopback. */
const PRIVATE_RANGES: readonly (readonly [number, number, number])[] = [
  // [first octet, lowest second octet, highest second octet]
  [10, 0, 255],
  [127, 0, 255],
  [169, 254, 254],
  [172, 16, 31],
  [192, 168, 168],
];

/** A dotted-quad IPv4 address. */
const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** What every mDNS name ends in. */
const LOCAL_SUFFIX = '.local';

/**
 * How long before the same missing record is asked for again.
 *
 * A device answering several questions at once would otherwise be asked for its SRV record once
 * per answer it sends.
 */
const FOLLOW_UP_GAP_MS = 1000;

/** How long a record without a TTL is kept, in seconds: the usual TTL of a service record. */
const DEFAULT_TTL_S = 120;

/** The key of the one socket used when this machine has no private IPv4 interface to name. */
const DEFAULT_INTERFACE = '';

/**
 * Whether an address is one a device in the house can have.
 *
 * @param address - The address, as announced.
 * @returns True for a private, link-local or loopback IPv4 address.
 */
export function isPrivateIpv4(address: string): boolean {
  const match = IPV4_PATTERN.exec(address);

  if (match === null) {
    return false;
  }

  const octets = match.slice(1).map(Number);

  if (octets.some((octet) => octet > 255)) {
    return false;
  }

  const [first = -1, second = -1] = octets;

  return PRIVATE_RANGES.some(
    ([range, lowest, highest]) => first === range && second >= lowest && second <= highest,
  );
}

/**
 * The addresses of this machine's interfaces on a house network.
 *
 * Its own adapters, as the system lists them: private IPv4, not loopback, and not link-local -
 * an adapter with only a 169.254 address has no network behind it.
 *
 * @returns One address per interface, in the order the system lists them.
 */
export function lanInterfaces(): string[] {
  const addresses: string[] = [];

  for (const entries of Object.values(os.networkInterfaces())) {
    const lan = entries?.find(
      (entry) =>
        entry.family === 'IPv4' &&
        !entry.internal &&
        isPrivateIpv4(entry.address) &&
        !entry.address.startsWith('169.254.'),
    );

    if (lan !== undefined) {
      addresses.push(lan.address);
    }
  }

  return addresses;
}

/**
 * Reads a TXT record as text.
 *
 * @param txt - A decoded record: strings, bytes, or `true` for a key with no value.
 * @returns Every key with its value as text; a key with no value reads as an empty string.
 */
function txtOf(txt: unknown): Record<string, string> {
  if (txt === null || typeof txt !== 'object') {
    return {};
  }

  const read: Record<string, string> = {};

  for (const [key, value] of Object.entries(txt)) {
    if (typeof value === 'string') {
      read[key] = value;
    } else if (Buffer.isBuffer(value)) {
      read[key] = value.toString('utf8');
    } else if (typeof value === 'number') {
      read[key] = String(value);
    } else if (value === true) {
      read[key] = '';
    }
  }

  return read;
}

/**
 * Decodes the strings of a TXT record into keys and values.
 *
 * @param data - What `dns-packet` decoded: one buffer per `key=value` string.
 * @returns The keys, each with its value, or `true` for a key given without one.
 */
function decodeTxt(data: unknown): Record<string, string | true> {
  const strings = Array.isArray(data) ? data : [data];
  const decoded: Record<string, string | true> = {};

  for (const each of strings) {
    const text = Buffer.isBuffer(each)
      ? each.toString('utf8')
      : typeof each === 'string'
        ? each
        : '';
    const equals = text.indexOf('=');

    if (equals === -1) {
      if (text.length > 0) {
        decoded[text] = true;
      }
    } else if (equals > 0) {
      decoded[text.slice(0, equals)] = text.slice(equals + 1);
    }
  }

  return decoded;
}

/**
 * Turns a service the browser found into what a vendor's discovery reads.
 *
 * @param service - The service.
 * @param serviceType - The type it was browsed for: `_shelly._tcp`.
 * @returns The announcement, or null when the device has no private IPv4 address to reach it at.
 */
export function toAnnouncement(
  service: BrowsedService,
  serviceType: string,
): MdnsAnnouncement | null {
  const address =
    service.addresses?.find(isPrivateIpv4) ??
    (service.referer !== undefined && isPrivateIpv4(service.referer.address)
      ? service.referer.address
      : undefined);

  if (address === undefined) {
    return null;
  }

  return {
    service: serviceType,
    instance: service.name,
    host: service.host,
    address,
    port: service.port,
    txt: txtOf(service.txt),
  };
}

/** One service instance heard, as far as its records have said. */
type Instance = {
  readonly serviceType: string;

  /** Its full name, as it is asked for: `shellyplus1-a8032ab1._shelly._tcp.local`. */
  readonly fqdn: string;

  /** Its own part: `shellyplus1-a8032ab1`. */
  readonly label: string;

  expiresAtMs: number;
  srv?: { readonly target: string; readonly port: number };
  txt?: Record<string, string | true>;

  /** Where its last record came from. */
  referer?: string;

  /** When its missing records were last asked for. */
  askedAtMs: number;
};

/** The addresses a host name was last said to have. */
type HostAddresses = { readonly addresses: readonly string[]; readonly expiresAtMs: number };

/**
 * Whether a record's data is an SRV target.
 *
 * @param data - The record's data.
 * @returns True for an object with a target name and a port.
 */
function isSrvData(data: unknown): data is { readonly target: string; readonly port: number } {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { target?: unknown }).target === 'string' &&
    typeof (data as { port?: unknown }).port === 'number'
  );
}

/**
 * Makes the platform's mDNS source.
 *
 * @param options - See {@link MdnsSourceOptions}.
 * @returns The source, not yet browsing.
 */
export function createMdnsSource(options: MdnsSourceOptions): MdnsSource {
  const { logger } = options;
  const open = options.open ?? createMulticastDns;
  const interfaces = options.interfaces ?? lanInterfaces;
  const now = options.now ?? Date.now;
  const sockets = new Map<string, MulticastDns>();
  const instances = new Map<string, Instance>();
  const hosts = new Map<string, HostAddresses>();
  const hostsAskedAt = new Map<string, number>();
  let browsed: readonly string[] = [];
  let report: (announcement: MdnsAnnouncement) => void =
    /**
     * Reports nothing: nobody has asked to hear yet.
     *
     * @returns Nothing.
     */
    () => undefined;

  /**
   * Sends questions out of every socket, each in a packet of its own.
   *
   * One question per packet, although a packet may carry several: a Shelly Gen3 answers only a
   * packet whose question it recognises first, so `_shelly._tcp` and `_http._tcp` asked together
   * go unanswered when the first is one it does not answer.
   *
   * @param questions - What to ask.
   */
  const send = (questions: readonly MulticastDnsQuestion[]): void => {
    for (const [address, socket] of sockets) {
      for (const question of questions) {
        try {
          socket.query({ questions: [question] });
        } catch (error: unknown) {
          logger.debug({ err: error, interface: address || 'default' }, 'An mDNS question failed');
        }
      }
    }
  };

  /**
   * The browsed service type a PTR name is the question of.
   *
   * @param name - The record's name, lower case: `_shelly._tcp.local`.
   * @returns The type, or undefined when it is not one browsed for.
   */
  const browsedTypeOf = (name: string): string | undefined =>
    browsed.find((serviceType) => name === `${serviceType.toLowerCase()}${LOCAL_SUFFIX}`);

  /**
   * The browsed service type an instance name belongs to.
   *
   * @param fqdn - The instance's full name, lower case.
   * @returns The type, or undefined when it is not one browsed for.
   */
  const instanceTypeOf = (fqdn: string): string | undefined =>
    browsed.find((serviceType) => fqdn.endsWith(`.${serviceType.toLowerCase()}${LOCAL_SUFFIX}`));

  /**
   * The instance of a name, remembered from now on.
   *
   * @param fqdn - Its full name.
   * @param serviceType - The type it belongs to.
   * @param nowMs - The time.
   * @returns The instance.
   */
  const instanceFor = (fqdn: string, serviceType: string, nowMs: number): Instance => {
    const key = fqdn.toLowerCase();
    const known = instances.get(key);

    if (known !== undefined) {
      return known;
    }

    const instance: Instance = {
      serviceType,
      fqdn,
      label: fqdn.slice(0, fqdn.length - serviceType.length - LOCAL_SUFFIX.length - 1),
      expiresAtMs: nowMs + DEFAULT_TTL_S * 1000,
      askedAtMs: 0,
    };

    instances.set(key, instance);

    return instance;
  };

  /**
   * Reports an instance whose records say enough, and asks for what is missing.
   *
   * @param instance - The instance.
   * @param nowMs - The time.
   */
  const settle = (instance: Instance, nowMs: number): void => {
    if (
      (instance.srv === undefined || instance.txt === undefined) &&
      nowMs - instance.askedAtMs >= FOLLOW_UP_GAP_MS
    ) {
      instance.askedAtMs = nowMs;
      send([
        { name: instance.fqdn, type: 'SRV' },
        { name: instance.fqdn, type: 'TXT' },
      ]);
    }

    const { srv } = instance;

    if (srv === undefined) {
      return;
    }

    const target = srv.target.toLowerCase();
    const known = hosts.get(target);
    const addresses = known !== undefined && known.expiresAtMs > nowMs ? known.addresses : [];

    if (addresses.length === 0 && nowMs - (hostsAskedAt.get(target) ?? 0) >= FOLLOW_UP_GAP_MS) {
      hostsAskedAt.set(target, nowMs);
      send([{ name: srv.target, type: 'A' }]);
    }

    const announcement = toAnnouncement(
      {
        name: instance.label,
        host: srv.target,
        port: srv.port,
        txt: instance.txt ?? {},
        addresses,
        ...(instance.referer === undefined ? {} : { referer: { address: instance.referer } }),
      },
      instance.serviceType,
    );

    if (announcement === null) {
      logger.debug(
        { service: instance.serviceType, instance: instance.label, addresses },
        'Heard a device with no private IPv4 address; not followed',
      );

      return;
    }

    report(announcement);
  };

  /**
   * Reads one answer: remembers its records, and reports what they complete.
   *
   * @param packet - The answer.
   * @param remote - Who sent it.
   */
  const onResponse = (packet: MulticastDnsPacket, remote: MulticastDnsRemote): void => {
    const nowMs = now();
    const touched = new Set<Instance>();
    const addressed = new Set<string>();

    for (const record of [...(packet.answers ?? []), ...(packet.additionals ?? [])]) {
      const name = record.name.toLowerCase();
      const ttlMs = (record.ttl ?? DEFAULT_TTL_S) * 1000;

      if (record.type === 'A' && typeof record.data === 'string') {
        if (ttlMs === 0) {
          hosts.delete(name);
        } else {
          const known = hosts.get(name);
          const others =
            known !== undefined && known.expiresAtMs > nowMs
              ? known.addresses.filter((address) => address !== record.data)
              : [];

          hosts.set(name, { addresses: [record.data, ...others], expiresAtMs: nowMs + ttlMs });
          addressed.add(name);
        }
      } else if (record.type === 'PTR' && typeof record.data === 'string') {
        const serviceType = browsedTypeOf(name);

        if (serviceType === undefined) {
          continue;
        }

        if (ttlMs === 0) {
          // A goodbye: the device is leaving the network.
          instances.delete(record.data.toLowerCase());
          continue;
        }

        const instance = instanceFor(record.data, serviceType, nowMs);

        instance.expiresAtMs = nowMs + ttlMs;
        touched.add(instance);
      } else if (record.type === 'SRV' || record.type === 'TXT') {
        const serviceType = instanceTypeOf(name);

        if (serviceType === undefined) {
          continue;
        }

        const instance = instanceFor(record.name, serviceType, nowMs);

        if (record.type === 'SRV' && isSrvData(record.data)) {
          instance.srv = { target: record.data.target, port: record.data.port };
        } else if (record.type === 'TXT') {
          instance.txt = decodeTxt(record.data);
        }

        touched.add(instance);
      }
    }

    for (const instance of touched) {
      instance.referer = remote.address;
      settle(instance, nowMs);
    }

    // An address answered on its own completes the instances that were waiting for it.
    if (addressed.size > 0) {
      for (const instance of instances.values()) {
        if (
          !touched.has(instance) &&
          instance.srv !== undefined &&
          addressed.has(instance.srv.target.toLowerCase())
        ) {
          settle(instance, nowMs);
        }
      }
    }
  };

  /**
   * Opens one socket, on one interface or on the system's choice.
   *
   * @param address - The interface's address, or {@link DEFAULT_INTERFACE}.
   * @returns The socket, listening.
   */
  const openOn = (address: string): MulticastDns => {
    // Bound to every address: bound to the interface's own, Linux delivers it no multicast.
    const socket = open(
      address === DEFAULT_INTERFACE ? {} : { interface: address, bind: '0.0.0.0' },
    );
    const named = address === DEFAULT_INTERFACE ? 'default' : address;

    socket.on('response', (packet, remote) => {
      try {
        onResponse(packet, remote);
      } catch (error: unknown) {
        logger.debug({ err: error, interface: named }, 'An mDNS answer could not be read');
      }
    });
    socket.on('error', (error) => {
      // The port taken, the interface gone: this socket is done, and the next question opens it
      // again rather than the hub going down with it.
      logger.warn({ err: error, interface: named }, 'An mDNS socket failed');

      if (sockets.get(address) === socket) {
        sockets.delete(address);
        socket.destroy();
      }
    });
    socket.on('warning', (error) => {
      logger.debug({ err: error, interface: named }, 'An mDNS socket warned');
    });

    return socket;
  };

  /** Opens a socket for every interface there now is, and closes those of interfaces gone. */
  const refreshSockets = (): void => {
    const wanted = [...new Set(interfaces())];
    const addresses = wanted.length === 0 ? [DEFAULT_INTERFACE] : wanted;

    for (const [address, socket] of sockets) {
      if (!addresses.includes(address)) {
        sockets.delete(address);
        socket.destroy();
      }
    }

    for (const address of addresses) {
      if (!sockets.has(address)) {
        sockets.set(address, openOn(address));
      }
    }
  };

  /**
   * Forgets what has expired.
   *
   * @param nowMs - The time.
   */
  const expire = (nowMs: number): void => {
    for (const [key, instance] of instances) {
      if (instance.expiresAtMs <= nowMs) {
        instances.delete(key);
      }
    }

    for (const [key, host] of hosts) {
      if (host.expiresAtMs <= nowMs) {
        hosts.delete(key);
      }
    }
  };

  return {
    /**
     * Starts browsing.
     *
     * @param services - The service types to browse for.
     * @param onAnnouncement - Called with every device heard.
     */
    start: (services, onAnnouncement): void => {
      report = onAnnouncement;
      browsed = [...services];
      refreshSockets();
    },

    /**
     * Asks again, and reports again every device still remembered.
     *
     * @param services - Only these service types; every one browsed for when absent.
     */
    query: (services?: readonly string[]): void => {
      const nowMs = now();
      const asked =
        services === undefined
          ? browsed
          : browsed.filter((serviceType) => services.includes(serviceType));

      if (asked.length === 0) {
        return;
      }

      refreshSockets();
      expire(nowMs);
      send(asked.map((serviceType) => ({ name: `${serviceType}${LOCAL_SUFFIX}`, type: 'PTR' })));

      for (const instance of [...instances.values()]) {
        if (asked.includes(instance.serviceType)) {
          settle(instance, nowMs);
        }
      }
    },

    /**
     * Stops browsing and lets go of the sockets.
     *
     * @returns A promise that settles once they are closed.
     */
    stop: async (): Promise<void> => {
      const closing = [...sockets.values()];

      sockets.clear();
      instances.clear();
      hosts.clear();
      hostsAskedAt.clear();
      browsed = [];

      await Promise.all(
        closing.map(
          (socket) =>
            new Promise<void>((resolve) => {
              socket.destroy(() => {
                resolve();
              });
            }),
        ),
      );
    },
  };
}
