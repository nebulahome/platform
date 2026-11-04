/**
 * Reading the house as the owner arranged it: what a package's server asks `core` for
 * (`ctx.house`, `svc.core.house`).
 *
 * `ctx.entities` hands states; a package that shows the house to somebody else - a bridge that
 * exposes it to a voice assistant - also needs what each entity is called, which device and room
 * it belongs to, what it declares it can do, and who brought it. One read, whole: a house is a
 * few thousand rows at most.
 */
import { z } from 'zod';

import { entityIdSchema } from './entity-id.js';
import { jsonObjectSchema } from './json.js';

/** One floor, room or house of the tree. */
export const houseAreaSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),

  /** `house`, `floor` or `room`. */
  kind: z.string(),

  /** The house a floor is in, or the floor a room is on. */
  parentId: z.uuid().nullable(),

  /** Which storey a floor is: 0 the ground. Null for the rest. */
  level: z.int().nullable(),
  icon: z.string().nullable(),
  sortOrder: z.int(),
});

/** One device, the way the house lists it: a linked device is shown as the one it is linked to. */
export const houseDeviceSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  icon: z.string().nullable(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  swVersion: z.string().nullable(),
  areaId: z.uuid().nullable(),

  /** The package or the integration (its vendor's id) that brought it; null for the platform's own. */
  owner: z.string().nullable(),
});

/** One entity, as the owner sees it in the house. */
export const houseEntitySchema = z.strictObject({
  entityId: entityIdSchema,
  name: z.string(),
  icon: z.string().nullable(),

  /** What the owner shows it as, when not its address's domain: a relay as a light. */
  shownDomain: z.string().nullable(),
  deviceId: z.uuid().nullable(),

  /** Its own room, else its device's. */
  areaId: z.uuid().nullable(),
  deviceClass: z.string().nullable(),
  unitOfMeasurement: z.string().nullable(),
  isHidden: z.boolean(),

  /** The package or the integration (its vendor's id) that brought it; `derived` or `system` else. */
  owner: z.string(),

  /** Each declared capability and the device's own limits for it: a lamp's mired range. */
  capabilities: z.record(z.string(), jsonObjectSchema),
});

/** The house, whole: what `svc.core.house` answers. */
export const houseReplySchema = z.strictObject({
  areas: z.array(houseAreaSchema),
  devices: z.array(houseDeviceSchema),
  entities: z.array(houseEntitySchema),
});

/** One floor, room or house of the tree. */
export type HouseArea = z.output<typeof houseAreaSchema>;

/** One device of the house. */
export type HouseDevice = z.output<typeof houseDeviceSchema>;

/** One entity of the house. */
export type HouseEntity = z.output<typeof houseEntitySchema>;

/** The house, whole. */
export type HouseReply = z.output<typeof houseReplySchema>;
