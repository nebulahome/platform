/**
 * What an entity's card is called when nobody named it: the device it belongs to, then the
 * entity - "Kitchen plug · Power" - because a dashboard of five cards all called "Power" says
 * nothing about which plug each one is.
 *
 * The device is left out when there is none (a helper, an alias) and when the entity's own name
 * already starts with it, so "Kitchen plug power" is not made "Kitchen plug · Kitchen plug power".
 */

/**
 * Names an entity's card.
 *
 * @param entityName - The entity's name.
 * @param deviceName - The name of its device, when it has one.
 * @returns The title.
 */
export function entityTitle(entityName: string, deviceName: string | null | undefined): string {
  const device = deviceName?.trim() ?? '';

  if (device === '' || entityName.toLocaleLowerCase().startsWith(device.toLocaleLowerCase())) {
    return entityName;
  }

  return `${device} · ${entityName}`;
}
