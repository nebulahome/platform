/**
 * Which addresses a network search knocks on, and the knocking.
 *
 * Nothing that speaks Modbus announces itself - no mDNS, no SSDP - so a search does what the owner
 * would do by hand: it opens a connection to port 502 of every address of the ranges the owner
 * gave, or of the networks the hub is on, with a short timeout and a few dozen at a time. A /22 -
 * 1022 addresses - takes seconds. Networks wider than a /22 are asked only around the hub's own
 * address: a /16 of a campus is not a house.
 */
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';

import { ipv4RangeOf, ipv4Text } from '@nebulahome/contracts';

/** How long an address has to accept a connection before it is taken to have nothing there. */
const CONNECT_TIMEOUT_MS = 600;

/** How many addresses are knocked on at once. */
const CONCURRENCY = 32;

/** The names virtual machines' and containers' network interfaces go by. */
const VIRTUAL_INTERFACE =
  /^(?:vEthernet|docker|br-|veth|virbr|vmnet|vboxnet|VirtualBox|Hyper-V|WSL|tailscale|zt)/iu;

/** The widest network asked whole: a /22, 1022 addresses. */
const WIDEST_PREFIX = 22;

/**
 * Whether an address is one a house network uses.
 *
 * @param address - Dotted quad.
 * @returns True for 10/8, 172.16/12 and 192.168/16.
 */
function isPrivate(address: string): boolean {
  const [a = 0, b = 0] = address.split('.').map(Number);

  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * The addresses of one network, the hub's own left out.
 *
 * @param address - The hub's address on it.
 * @param prefix - The network's prefix length, from its netmask.
 * @returns Every other host address, at most a /22's worth.
 */
export function hostsOf(address: string, prefix: number): string[] {
  const bits = Math.max(prefix, WIDEST_PREFIX);
  const span = ipv4RangeOf(`${address}/${String(bits)}`);
  const own = ipv4RangeOf(address)?.first;

  if (bits >= 31 || span === null) {
    return [];
  }

  const hosts: string[] = [];

  for (let value = span.first + 1; value < span.last; value += 1) {
    if (value !== own) {
      hosts.push(ipv4Text(value));
    }
  }

  return hosts;
}

/**
 * The addresses of every house network the hub is on.
 *
 * @returns Every host address, each once.
 */
export function lanHosts(): string[] {
  const hosts = new Set<string>();

  for (const [name, entries] of Object.entries(networkInterfaces())) {
    // A virtual machine's or a container's network is not the house's: searching it finds
    // nothing, a thousand addresses at a time.
    if (VIRTUAL_INTERFACE.test(name)) {
      continue;
    }

    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal || !isPrivate(entry.address)) {
        continue;
      }

      for (const host of hostsOf(entry.address, Number(entry.cidr?.split('/')[1] ?? 24))) {
        hosts.add(host);
      }
    }
  }

  return [...hosts];
}

/**
 * The addresses of the ranges the owner wrote.
 *
 * @param ranges - Networks, spans or single addresses, as the settings hold them.
 * @returns Every address, each once.
 */
export function hostsOfRanges(ranges: readonly string[]): string[] {
  const hosts = new Set<string>();

  for (const range of ranges) {
    const span = ipv4RangeOf(range);

    if (span === null) {
      continue;
    }

    // A network's own address and broadcast are no host; a span or one address is what was said.
    const isNetwork = range.includes('/') && span.last > span.first + 1;
    const first = isNetwork ? span.first + 1 : span.first;
    const last = isNetwork ? span.last - 1 : span.last;

    for (let value = first; value <= last; value += 1) {
      hosts.add(ipv4Text(value));
    }
  }

  return [...hosts];
}

/**
 * Whether a port accepts a connection.
 *
 * @param host - The address.
 * @param port - The port.
 * @param signal - Gives up.
 * @returns True when it accepted, within the timeout.
 */
export function isOpen(host: string, port: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve(false);

      return;
    }

    const socket = connect({ host, port });

    /**
     * Settles once, and lets the socket go.
     *
     * @param value - Whether it accepted.
     */
    const done = (value: boolean): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abandon);
      socket.destroy();
      resolve(value);
    };

    /** Gives up. */
    const abandon = (): void => {
      done(false);
    };
    const timer = setTimeout(abandon, CONNECT_TIMEOUT_MS);

    signal?.addEventListener('abort', abandon, { once: true });
    socket.once('connect', () => {
      done(true);
    });
    socket.once('error', abandon);
  });
}

/**
 * Asks every host whether something answers, a few dozen at a time.
 *
 * @param hosts - The addresses.
 * @param answers - Says whether one answers.
 * @param signal - Gives up.
 * @returns The hosts that answered, in the order given.
 */
export async function sweep(
  hosts: readonly string[],
  answers: (host: string) => Promise<boolean>,
  signal?: AbortSignal,
): Promise<string[]> {
  const answered = new Set<string>();
  let next = 0;

  /**
   * Asks addresses one after the other until none is left.
   *
   * @returns Settles when the list is done.
   */
  const worker = async (): Promise<void> => {
    while (next < hosts.length && signal?.aborted !== true) {
      const host = hosts[next];

      next += 1;

      // One address at a time per worker, by design: the workers are the concurrency.
      // eslint-disable-next-line no-await-in-loop -- see above
      if (host !== undefined && (await answers(host))) {
        answered.add(host);
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  return hosts.filter((host) => answered.has(host));
}
