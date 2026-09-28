/**
 * Entity identifiers: the stable name every other part of the platform refers to a thing by.
 *
 * An identifier is `<domain>.<object_id>` and is **stable across renames**. Renaming a light in
 * the interface changes its display name and nothing else, so automations written against it
 * keep working. That guarantee is the whole reason this is a separate concept from `name`.
 *
 * Defined in ARCHITECTURE.md 5.2; the same pattern is a CHECK constraint on
 * `registry.entities.entity_id`, so a value rejected here would also be rejected by the database.
 */
import { z } from 'zod';

/** The kinds of thing an entity can be. The domain is the part before the dot. */
export const ENTITY_DOMAINS = [
  'light',
  'switch',
  'sensor',
  'binary_sensor',
  'cover',
  'lock',
  'climate',
  'media_player',
  'camera',
  'button',
  'update',
  'lawn_mower',
  'select',
  'number',
  'alias',
] as const;

/** The kind of thing an entity is. */
export type EntityDomain = (typeof ENTITY_DOMAINS)[number];

/**
 * The shape of a valid identifier.
 *
 * Mirrors `entities_entity_id_format` in DATABASE.md exactly. The lengths are not arbitrary:
 * an identifier appears in NATS subjects, in URLs and in log lines, and an unbounded one would
 * eventually break one of them.
 */
export const ENTITY_ID_PATTERN = /^[a-z][a-z0-9_]{0,31}\.[a-z][a-z0-9_]{0,63}$/;

/**
 * Validates an entity identifier and brands the result.
 *
 * The brand means an `EntityId` cannot be produced from a bare string without going through
 * validation. Identifiers reach the database as primary lookups and NATS as subject tokens, so
 * an unvalidated one does not fail where it was created - it fails somewhere else, later.
 */
export const entityIdSchema = z
  .string()
  .regex(ENTITY_ID_PATTERN, 'Must be <domain>.<object_id>, lower case, letters digits underscore')
  .brand<'EntityId'>();

/** A validated `<domain>.<object_id>` identifier. */
export type EntityId = z.output<typeof entityIdSchema>;

/**
 * Parses a string into an entity identifier.
 *
 * @param value - The candidate identifier.
 * @returns The same string, branded, once it is known to be well formed.
 * @throws {z.ZodError} When the value does not match {@link ENTITY_ID_PATTERN}.
 */
export function parseEntityId(value: string): EntityId {
  return entityIdSchema.parse(value);
}

/**
 * Reports whether a string is a well-formed entity identifier.
 *
 * @param value - The candidate identifier.
 * @returns True when the value can be used as an {@link EntityId}.
 */
export function isEntityId(value: string): value is EntityId {
  return entityIdSchema.safeParse(value).success;
}

/**
 * Builds an entity identifier from its two parts.
 *
 * @param domain - The kind of thing the entity is.
 * @param objectId - The stable slug identifying it within that domain.
 * @returns The composed identifier.
 * @throws {z.ZodError} When the composed value is not well formed, usually because `objectId`
 * is empty, too long, or contains something other than lower-case letters, digits and underscores.
 */
export function formatEntityId(domain: EntityDomain, objectId: string): EntityId {
  return parseEntityId(`${domain}.${objectId}`);
}

/**
 * Splits an identifier back into its parts.
 *
 * @param entityId - A validated identifier.
 * @returns Its domain and object id. The domain is typed as a plain string rather than
 * {@link EntityDomain} because an adapter may legitimately introduce a domain this build does
 * not know about yet, and refusing to read it would be worse than not narrowing it.
 */
export function splitEntityId(entityId: EntityId): { domain: string; objectId: string } {
  const separator = entityId.indexOf('.');

  return {
    domain: entityId.slice(0, separator),
    objectId: entityId.slice(separator + 1),
  };
}

/*
 * Turning a device's id into the identifiers its entities carry - here rather than in `hub`, so
 * the interface names an entity of a device the way the hub does.
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
