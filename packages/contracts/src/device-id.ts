/**
 * The id a new device is offered: the vendor and the name, free of every id already taken.
 *
 * One rule for every way a device is added - typed in with the add form, adopted from what
 * discovery found, or added by the platform on its own - so they read alike in a log. Here rather
 * than in the interface, since `api` names the devices it adds on its own by it too.
 */

/** The longest a device id may be: an integration id's. */
const MAXIMUM_ID = 64;

/** Room kept at the end for the `-2`, `-3` that tells two of the same name apart. */
const COUNTER_ROOM = 4;

/**
 * A name as part of an id: lower case, dashes for anything that is not a letter or digit.
 *
 * @param name - What the owner typed: `Studio printer`, `1PM Mini Gen3`.
 * @returns `studio-printer`, `1pm-mini-gen3`.
 */
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

/**
 * An id for a new device of this vendor, from its name, that nobody has yet.
 *
 * `bambu-lab-x1c` for the first, `bambu-lab-x1c-2` for the next: the id is what every entity
 * of the device carries as its source, so two cannot share one. The vendor stays in front so
 * that an id reads as what it is in a log, whatever the owner called the device, and a long name
 * is cut to what an id holds.
 *
 * @param vendorId - The vendor.
 * @param name - The name typed, or the model it started as.
 * @param taken - The ids already in use.
 * @returns A free id.
 */
export function suggestDeviceId(vendorId: string, name: string, taken: readonly string[]): string {
  const part = slug(name);
  // A name that is the vendor's own - the Zigbee2MQTT bridge - would only say it twice.
  const base =
    part === '' || part === vendorId
      ? vendorId
      : `${vendorId}-${part}`.slice(0, MAXIMUM_ID - COUNTER_ROOM).replace(/-+$/u, '');
  let candidate = base;

  for (let n = 2; taken.includes(candidate); n += 1) {
    candidate = `${base}-${String(n)}`;
  }

  return candidate;
}
