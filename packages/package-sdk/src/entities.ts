/**
 * Entity identifiers: `<domain>.<object id>`, as the platform writes them everywhere - in its
 * API, on its bus, in automations. A package never composes one by hand: the server's
 * `ctx.entityId` does, and these read one back.
 */

/** The kinds of thing an entity is. */
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
  'vacuum',
  'image',
  'custom',
  'alias',
] as const;

/** The kind of thing an entity is. */
export type EntityDomain = (typeof ENTITY_DOMAINS)[number];

/** An entity's identifier: `sensor.weather_temperature`. */
export type EntityId = string;

/** What an entity identifier is made of. */
export type ParsedEntityId = {
  readonly domain: EntityDomain;
  readonly objectId: string;
};

/** The shape of an entity identifier: a domain, a dot, an object id. */
const ENTITY_ID_PATTERN = /^([a-z][a-z0-9_]{0,31})\.([a-z][a-z0-9_]{0,63})$/;

/**
 * Says whether a word is one of the platform's domains.
 *
 * @param value - The word.
 * @returns True when it is.
 */
function isDomain(value: string): value is EntityDomain {
  return ENTITY_DOMAINS.some((domain) => domain === value);
}

/**
 * Reads an entity identifier.
 *
 * @param entityId - The identifier.
 * @returns Its domain and object id, or undefined when it is not one.
 */
export function parseEntityId(entityId: string): ParsedEntityId | undefined {
  const match = ENTITY_ID_PATTERN.exec(entityId);
  const domain = match?.[1];
  const objectId = match?.[2];

  return domain === undefined || objectId === undefined || !isDomain(domain)
    ? undefined
    : { domain, objectId };
}

/**
 * Says whether a value is an entity identifier.
 *
 * @param value - The value.
 * @returns True when it is a string the platform would take as one.
 */
export function isEntityId(value: unknown): value is EntityId {
  return typeof value === 'string' && parseEntityId(value) !== undefined;
}
