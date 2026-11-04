//#region src/entities.d.ts
/**
 * Entity identifiers: `<domain>.<object id>`, as the platform writes them everywhere - in its
 * API, on its bus, in automations. A package never composes one by hand: the server's
 * `ctx.entityId` does, and these read one back.
 */
/** The kinds of thing an entity is. */
declare const ENTITY_DOMAINS: readonly ["light", "switch", "sensor", "binary_sensor", "cover", "lock", "climate", "media_player", "camera", "button", "update", "lawn_mower", "select", "number", "vacuum", "image", "custom", "alias"];
/** The kind of thing an entity is. */
type EntityDomain = (typeof ENTITY_DOMAINS)[number];
/** An entity's identifier: `sensor.weather_temperature`. */
type EntityId = string;
/** What an entity identifier is made of. */
type ParsedEntityId = {
  readonly domain: EntityDomain;
  readonly objectId: string;
};
/**
 * Reads an entity identifier.
 *
 * @param entityId - The identifier.
 * @returns Its domain and object id, or undefined when it is not one.
 */
declare function parseEntityId(entityId: string): ParsedEntityId | undefined;
/**
 * Says whether a value is an entity identifier.
 *
 * @param value - The value.
 * @returns True when it is a string the platform would take as one.
 */
declare function isEntityId(value: unknown): value is EntityId;
//#endregion
export { isEntityId as a, ParsedEntityId as i, EntityDomain as n, parseEntityId as o, EntityId as r, ENTITY_DOMAINS as t };