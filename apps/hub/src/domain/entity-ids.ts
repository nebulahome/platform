/**
 * Turning a device's id into the identifiers its entities carry.
 *
 * A device is known by its id - `bambu-lab-x1c`, the instance id the owner's name suggested -
 * and its entities are named after it: `sensor.bambu_lab_x1c_nozzle_temperature`. Not after the
 * serial the hardware reports, which nobody chose and which changes when the hardware is
 * replaced; an entity identifier is `<domain>.<object_id>` in the narrow lower-case alphabet
 * that automations name and the interface shows, and it should read as the thing it belongs to.
 *
 * The mapping is **deterministic**: the same device produces the same identifiers on every start
 * and after every restart. That is what makes binding a device again a no-op rather than a
 * second copy of it, and it is why nothing here consults a counter or the clock.
 *
 * Two devices whose identifiers reduce to the same text collide, and that is left to fail. The
 * `UNIQUE` constraint on `registry.entities.entity_id` rejects the second one and names it,
 * which is a loud problem somebody can rename their way out of. Quietly disambiguating with a
 * numeric suffix would instead make an identifier depend on the order devices were discovered
 * in, and an automation would point at a different lamp after a rebuild without anything saying
 * so.
 */
import { formatEntityId, type EntityDomain, type EntityId } from '@nebula-home/contracts';

/** How long an object id may be, from `entities_entity_id_format` in the migration. */
const MAX_OBJECT_ID = 63;

/**
 * Reduces arbitrary text to the alphabet an object id allows.
 *
 * @param value - What the integration calls it.
 * @returns Lower-case letters, digits and single underscores, beginning with a letter.
 */
function slugify(value: string): string {
  const reduced = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  // An object id must begin with a letter, and plenty of devices identify themselves by a
  // number or a hex address. A prefix is enough, and cannot collide with a name that already
  // begins with a letter because that one keeps its own first character.
  return /^[a-z]/.test(reduced) ? reduced : `d_${reduced}`;
}

/**
 * Composes the identifier for one entity of one device.
 *
 * @param domain - The entity's domain.
 * @param deviceId - The device's id, which is the instance id.
 * @param objectId - What tells this entity from the device's others, when it has any.
 * @returns The entity identifier.
 */
export function composeEntityId(
  domain: EntityDomain,
  deviceId: string,
  objectId?: string,
): EntityId {
  const suffix = objectId === undefined ? '' : `_${slugify(objectId)}`;

  // The device part is truncated rather than the whole, so that what tells two entities of one
  // device apart survives a long device identifier. Cutting from the end would leave both
  // channels of a four-channel relay with the same name.
  const room = Math.max(MAX_OBJECT_ID - suffix.length, 1);

  return formatEntityId(domain, `${slugify(deviceId).slice(0, room)}${suffix}`);
}
