/**
 * Where a device serves its own web page, when it serves one.
 *
 * Only a driver that says so - its `webPagePort` - has a page to link to: a Shelly's settings on
 * port 80, Plex Web under `/web`. A device reached on an API port with nothing to look at has no
 * link, which is better than a link to a blank tab.
 *
 * The address is the one the device was added with. When the owner typed a port into it, that
 * port wins over the driver's: the device answers the platform and the browser from the same
 * server, so a Shelly moved to port 8080 serves its page there too.
 */
import type { DeviceView, IntegrationKind } from '@nebulahome/contracts';

/** A host followed by `:port`, and not an IPv6 literal that merely contains colons. */
const HOST_WITH_PORT = /^(?:\[[^\]]+\]|[^:]+):\d{1,5}$/;

/** The port a browser assumes for `http://`, left out of the address it is shown. */
const HTTP_PORT = 80;

/**
 * Builds the address of a device's own web page.
 *
 * @param device - The device, whose connection names where it is.
 * @param driver - Its driver, as the catalogue lists it; undefined while the catalogue is away.
 * @returns The page's address, or null when the driver names no page or the device has no host.
 */
export function deviceWebPageOf(
  device: Pick<DeviceView, 'transportConfig'>,
  driver: Pick<IntegrationKind, 'webPagePort' | 'webPagePath'> | undefined,
): string | null {
  const port = driver?.webPagePort;
  const host = device.transportConfig['host'];

  if (port === undefined || typeof host !== 'string' || host.trim() === '') {
    return null;
  }

  const trimmed = host.trim();
  const isBareIpv6 = !trimmed.startsWith('[') && trimmed.split(':').length > 2;
  const named = isBareIpv6 ? `[${trimmed}]` : trimmed;
  const authority =
    !isBareIpv6 && HOST_WITH_PORT.test(named)
      ? named
      : port === HTTP_PORT
        ? named
        : `${named}:${String(port)}`;

  return `http://${authority}${driver?.webPagePath ?? '/'}`;
}
