/**
 * Reading the network's byte counters out of what the operating system prints.
 *
 * Linux keeps them in `/proc/net/dev`, one line per interface, and which interface the internet
 * is on in `/proc/net/route`. Windows prints a single total with `netstat -e`, in the language of
 * the installation - "Bytes" in English, "Byte" in Italian - so that one is read by its shape,
 * never by its words. Both are parsed here, as text, so the parsing can be tested on a machine
 * that is neither.
 */

/** The bytes an interface has carried, since it came up or since boot. */
export type NetworkCounters = {
  /** The interface, or null when the counters are a sum over every one. */
  readonly interface: string | null;
  readonly receivedBytes: number;
  readonly transmittedBytes: number;
};

/**
 * Finds the interface the default route leaves by.
 *
 * That is the one the internet is reached through, and the one whose traffic a person means by
 * "the network": a machine running Docker has a bridge and a virtual interface per container,
 * and summing them all would count every container's traffic twice.
 *
 * @param routeTable - The contents of `/proc/net/route`.
 * @returns The interface of the default route with the lowest metric, or undefined for none.
 */
export function defaultRouteInterface(routeTable: string): string | undefined {
  let best: { readonly name: string; readonly metric: number } | undefined;

  // The first line is the column header.
  for (const line of routeTable.split('\n').slice(1)) {
    const [name, destination, , , , , metric, mask] = line.trim().split(/\s+/);

    if (name === undefined || destination !== '00000000' || mask !== '00000000') {
      continue;
    }

    const cost = Number(metric);

    if (best === undefined || cost < best.metric) {
      best = { name, metric: cost };
    }
  }

  return best?.name;
}

/**
 * Reads the byte counters out of `/proc/net/dev`.
 *
 * @param text - The file's contents.
 * @param interfaceName - The interface to read; without one, every interface but the loopback
 * is summed.
 * @returns The counters, or undefined when the interface is not there or the text is not the
 * file it should be.
 */
export function parseProcNetDev(
  text: string,
  interfaceName: string | undefined,
): NetworkCounters | undefined {
  let received = 0;
  let transmitted = 0;
  let isFound = false;

  // Two header lines, then `  eth0: <8 receive columns> <8 transmit columns>`. A large first
  // number can follow the colon with no space, so the line is split on the colon, not on space.
  for (const line of text.split('\n').slice(2)) {
    const colon = line.indexOf(':');

    if (colon === -1) {
      continue;
    }

    const name = line.slice(0, colon).trim();
    const columns = line
      .slice(colon + 1)
      .trim()
      .split(/\s+/)
      .map(Number);
    const bytesIn = columns[0];
    const bytesOut = columns[8];

    if (bytesIn === undefined || bytesOut === undefined || Number.isNaN(bytesIn + bytesOut)) {
      continue;
    }

    if (interfaceName === undefined ? name === 'lo' : name !== interfaceName) {
      continue;
    }

    received += bytesIn;
    transmitted += bytesOut;
    isFound = true;
  }

  return isFound
    ? { interface: interfaceName ?? null, receivedBytes: received, transmittedBytes: transmitted }
    : undefined;
}

/**
 * Reads the byte totals out of what `netstat -e` prints on Windows.
 *
 * The first line that ends in two whole numbers is the bytes line, in any language: the header
 * above it names the two columns and holds no numbers, and every line below it counts packets.
 *
 * @param text - What the command printed.
 * @returns The totals since boot, over every interface, or undefined when there is no such line.
 */
export function parseNetstatE(text: string): NetworkCounters | undefined {
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*\S.*?\s+(\d+)\s+(\d+)\s*$/.exec(line);

    if (match?.[1] !== undefined && match[2] !== undefined) {
      return {
        interface: null,
        receivedBytes: Number(match[1]),
        transmittedBytes: Number(match[2]),
      };
    }
  }

  return undefined;
}
