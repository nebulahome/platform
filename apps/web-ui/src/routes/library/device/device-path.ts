/**
 * Where a device's own page lives.
 *
 * One function rather than a template in every link, so the address can change in one place: the
 * devices list, an entity's page, a tag's row, a vendor's list and the system monitor all lead
 * here.
 */

/**
 * The address of a device's page.
 *
 * @param deviceId - The device, by its id.
 * @returns The path.
 */
export function devicePath(deviceId: string): string {
  return `/devices/${encodeURIComponent(deviceId)}`;
}
