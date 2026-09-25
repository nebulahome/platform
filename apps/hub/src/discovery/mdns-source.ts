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
 * scanned. A device answers once and is then remembered by the browser until its record expires,
 * so each query also reports again every device still remembered, which is how the hub knows it
 * is still there.
 *
 * Only a private IPv4 address is reported. Announcements are not authenticated - anything on the
 * network may announce anything - and the hub probes what is announced, so an announcement
 * pointing at a host on the internet is dropped here rather than followed.
 */
import BonjourModule from 'bonjour-service';

import type { PlatformLogger } from '@nebula-home/logging';
import type { MdnsAnnouncement } from '@nebula-home/package-runtime';

/** What the source needs of a service the browser found. */
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
   * Stops browsing and lets go of the socket.
   *
   * @returns A promise that settles once it is closed.
   */
  readonly stop: () => Promise<void>;
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
 * Reads a TXT record as text.
 *
 * @param txt - What the browser decoded: strings, bytes, or `true` for a key with no value.
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

/**
 * Splits a service type into what the browser is asked for.
 *
 * @param serviceType - `_shelly._tcp`.
 * @returns `{ type: 'shelly', protocol: 'tcp' }`.
 */
function browsedAs(serviceType: string): { type: string; protocol: 'tcp' | 'udp' } {
  const [type = '', protocol = ''] = serviceType.split('.');

  return {
    type: type.replace(/^_/, ''),
    protocol: protocol === '_udp' ? 'udp' : 'tcp',
  };
}

/**
 * Makes the platform's mDNS source.
 *
 * @param options - Where the browser's failures are logged.
 * @param options.logger - The hub's logger.
 * @returns The source, not yet browsing.
 */
export function createMdnsSource(options: { readonly logger: PlatformLogger }): MdnsSource {
  const { logger } = options;
  let bonjour: BonjourModule | undefined;
  const browsers: { readonly serviceType: string; readonly browser: BonjourModule.Browser }[] = [];
  let report: (announcement: MdnsAnnouncement) => void =
    /**
     * Reports nothing: nobody has asked to hear yet.
     *
     * @returns Nothing.
     */
    () => undefined;

  /**
   * Reports one service, if it can be reached.
   *
   * @param serviceType - The type it was browsed for.
   * @param service - What the browser found.
   */
  const emit = (serviceType: string, service: BrowsedService): void => {
    const announcement = toAnnouncement(service, serviceType);

    if (announcement === null) {
      logger.debug(
        { service: serviceType, instance: service.name, addresses: service.addresses },
        'Heard a device with no private IPv4 address; not followed',
      );

      return;
    }

    report(announcement);
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
      bonjour = new BonjourModule(
        undefined,
        /**
         * Logs a failure of the browser's socket: the port taken, the interface gone.
         *
         * @param error - What failed.
         */
        (error: unknown) => {
          logger.warn({ err: error }, 'The mDNS browser failed');
        },
      );

      for (const serviceType of services) {
        const browser = bonjour.find(browsedAs(serviceType));

        for (const event of ['up', 'srv-update', 'txt-update'] as const) {
          browser.on(event, (service: BonjourModule.Service) => {
            emit(serviceType, service);
          });
        }

        browsers.push({ serviceType, browser });
      }
    },

    /**
     * Asks again, and reports again every device still remembered.
     *
     * @param services - Only these service types; every one browsed for when absent.
     */
    query: (services?: readonly string[]): void => {
      for (const { serviceType, browser } of browsers) {
        if (services !== undefined && !services.includes(serviceType)) {
          continue;
        }

        browser.expire();
        browser.update();

        for (const service of browser.services) {
          emit(serviceType, service);
        }
      }
    },

    /**
     * Stops browsing and lets go of the socket.
     *
     * @returns A promise that settles once it is closed.
     */
    stop: async (): Promise<void> => {
      for (const { browser } of browsers) {
        browser.stop();
      }

      browsers.length = 0;

      const closing = bonjour;

      bonjour = undefined;

      if (closing !== undefined) {
        await new Promise<void>((resolve) => {
          closing.destroy(() => {
            resolve();
          });
        });
      }
    },
  };
}
