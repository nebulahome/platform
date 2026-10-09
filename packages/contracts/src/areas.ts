/**
 * Areas: the house, the floors in it, and the rooms on each floor.
 *
 * One table, three kinds, one tree. The house is its root and there is exactly one - an
 * installation is one home - and it is the only kind that stands somewhere: it carries a
 * position on the map, so that an automation can one day know when the sun sets on it and so
 * that the map around it can be kept on disk for the days the internet is away. A floor sits in
 * the house and a room on a floor; a device is put in a room, and its entities are wherever it
 * is unless one of them says otherwise.
 *
 * Two decisions are visible in the shape:
 *
 * - **The kind is fixed at creation**, like the key. A room does not become a floor; it is
 *   removed and a floor made. Everything that validates a parent - a floor's is a house, a
 *   room's is a floor - would have to be re-run on a kind change, and nobody has asked for one.
 * - **A position is two numbers or none.** Half a position is a bug, not a state, so the schemas
 *   refuse a latitude without its longitude in both directions.
 */
import { z } from 'zod';

import { iconIdSchema } from './icons.js';
import { tagNameSchema } from './tags.js';

/** The kinds, top of the tree first. Mirrors `areas_kind`. */
export const AREA_KINDS = ['house', 'floor', 'room'] as const;

/** One of the kinds. */
export type AreaKind = (typeof AREA_KINDS)[number];

/** Validates a kind. */
export const areaKindSchema = z.enum(AREA_KINDS);

/** Validates a latitude, in degrees. */
export const latitudeSchema = z.number().min(-90).max(90);

/** Validates a longitude, in degrees. */
export const longitudeSchema = z.number().min(-180).max(180);

/** The lowest storey a floor may be: a deep cellar, and well past any real one. */
export const FLOOR_LEVEL_MINIMUM = -20;

/** The highest storey a floor may be. */
export const FLOOR_LEVEL_MAXIMUM = 200;

/**
 * Validates a floor's number: which storey it is, whatever it is called. Mirrors
 * `areas_level_range`.
 */
export const floorLevelSchema = z.int().min(FLOOR_LEVEL_MINIMUM).max(FLOOR_LEVEL_MAXIMUM);

/** A house, a floor or a room. */
export const areaViewSchema = z.object({
  id: z.uuid(),

  /** The stable key used in permission scopes, e.g. `living_room` in `area.living_room`. */
  key: z.string(),

  /** What it is called. */
  name: z.string(),
  kind: areaKindSchema,

  /** The house a floor is in, or the floor a room is on. Null for a house. */
  parentId: z.uuid().nullable(),

  /** A catalogue icon id, when one has been chosen. */
  icon: z.string().nullable(),

  /** Where it sorts among its siblings. */
  sortOrder: z.int(),

  /**
   * Which storey a floor is - 0 the ground, 1 the one above, -1 the cellar - independent of its
   * name, and what floors are ordered by. Unique among floors; null for a house and a room.
   */
  level: z.int().nullable(),

  /** Where a house stands; null for a house not yet placed, and always for the rest. */
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),

  /** How many devices are in it directly. */
  deviceCount: z.int().min(0),

  /** How many entities are in it directly. */
  entityCount: z.int().min(0),
});

/** A house, a floor or a room. */
export type AreaView = z.output<typeof areaViewSchema>;

/**
 * What creating an area takes. The key is derived from the name.
 *
 * A house has no parent and may have a position; a floor and a room have a parent and no
 * position. The API checks that the parent is of the kind above.
 */
export const areaCreateSchema = z
  .object({
    kind: areaKindSchema,
    name: tagNameSchema,
    parentId: z.uuid().optional(),
    icon: iconIdSchema.optional(),
    level: floorLevelSchema.optional(),
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
  })
  .superRefine((body, context) => {
    if (body.kind === 'floor' && body.level === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['level'],
        message: 'A floor needs its number: 0 for the ground floor, 1 for the one above',
      });
    }

    if (body.kind !== 'floor' && body.level !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['level'],
        message: 'Only a floor has a number',
      });
    }

    if (body.kind === 'house' && body.parentId !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['parentId'],
        message: 'A house is the top of its tree and has no parent',
      });
    }

    if (body.kind !== 'house' && body.parentId === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['parentId'],
        message: `A ${body.kind} needs the ${body.kind === 'floor' ? 'house' : 'floor'} it is in`,
      });
    }

    if (body.kind !== 'house' && (body.latitude !== undefined || body.longitude !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['latitude'],
        message: 'Only a house stands somewhere',
      });
    }

    if ((body.latitude === undefined) !== (body.longitude === undefined)) {
      context.addIssue({
        code: 'custom',
        path: [body.latitude === undefined ? 'latitude' : 'longitude'],
        message: 'A position is a latitude and a longitude together',
      });
    }
  });

/** What creating an area takes. */
export type AreaCreate = z.output<typeof areaCreateSchema>;

/**
 * What changing an area takes: a new name, a new icon (null for none), for a floor a new number,
 * or - for a house - a new position, where nulls for both take it away. Never a kind, never a key.
 */
export const areaUpdateSchema = z
  .object({
    name: tagNameSchema,
    icon: iconIdSchema.nullable(),
    level: floorLevelSchema,
    latitude: latitudeSchema.nullable(),
    longitude: longitudeSchema.nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' })
  .refine(
    (body) =>
      (body.latitude === undefined) === (body.longitude === undefined) &&
      (body.latitude === null) === (body.longitude === null),
    { message: 'A position is a latitude and a longitude together', path: ['latitude'] },
  );

/** What changing an area takes. */
export type AreaUpdate = z.output<typeof areaUpdateSchema>;

/** How much of the map around a house is on disk. */
export const tileCacheStatusSchema = z.object({
  /** How many tiles the buffer around the house is made of. */
  total: z.int().min(0),

  /** How many of them are on disk. */
  cached: z.int().min(0),
});

/** How much of the map around a house is on disk. */
export type TileCacheStatus = z.output<typeof tileCacheStatusSchema>;

/** What a prefetch of the map around a house did. */
export const tilePrefetchResultSchema = tileCacheStatusSchema.extend({
  /** How many tiles could not be fetched this time. */
  failed: z.int().min(0),
});

/** What a prefetch of the map around a house did. */
export type TilePrefetchResult = z.output<typeof tilePrefetchResultSchema>;
