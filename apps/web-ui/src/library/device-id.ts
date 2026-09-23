/**
 * The id a new device is offered: the vendor and the name, free of every id already taken.
 *
 * One rule for both ways a device is added - typed in with the add form, or adopted from what
 * discovery found - so the two read alike in a log.
 */

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
 * that an id reads as what it is in a log, whatever the owner called the device.
 *
 * @param vendorId - The vendor.
 * @param name - The name typed, or the model it started as.
 * @param taken - The ids already in use.
 * @returns A free id.
 */
export function suggestDeviceId(vendorId: string, name: string, taken: readonly string[]): string {
  const part = slug(name);
  const base = part === '' ? vendorId : `${vendorId}-${part}`;
  let candidate = base;

  for (let n = 2; taken.includes(candidate); n += 1) {
    candidate = `${base}-${String(n)}`;
  }

  return candidate;
}
