/**
 * Areas: the house, the floors in it and the rooms on those floors.
 *
 * One table and three kinds, and the rules that keep the tree a tree live here rather than in
 * the database: there is one house, a floor's parent is the house, a room's is a floor, only
 * the house stands somewhere. The database keeps what it can say in a CHECK - the kinds, a whole
 * position, a position only on a house - refuses a row that is its own parent, and holds the
 * one-house rule under a race with a partial unique index; everything that needs a second row
 * to judge is judged here, before the write, so that the refusal names what is wrong.
 *
 * Removing an area removes what is under it, through the cascade on `parent_id`: a room off
 * its floor is not a place anybody meant. The devices and the entities in a removed room are
 * left where they are, in no room, through the `SET NULL` on their own columns.
 */
import { asc, eq, like, sql } from 'drizzle-orm';

import {
  areaViewSchema,
  ConflictError,
  NotFoundError,
  toTagKey,
  ValidationError,
  type AreaCreate,
  type AreaKind,
  type AreaUpdate,
  type AreaView,
} from '@nebula-home/contracts';
import { schema, type Database } from '@nebula-home/db';

import { checkIcon, type IconLookup } from './icon-lookup.js';
import { chooseFreeKey, isUniqueViolation, keyPrefixOf } from './keys.js';

/** The key a name gives when it gives nothing usable. */
const FALLBACK_KEY = 'area';

/** The kind a parent must be, by the kind of its child. */
const PARENT_KIND: Record<AreaKind, AreaKind | null> = {
  house: null,
  floor: 'house',
  room: 'floor',
};

/** The columns every view is read from. */
const AREA_COLUMNS = {
  id: schema.registry.areas.id,
  key: schema.registry.areas.key,
  name: schema.registry.areas.name,
  kind: schema.registry.areas.kind,
  parentId: schema.registry.areas.parentId,
  icon: schema.registry.areas.icon,
  sortOrder: schema.registry.areas.sortOrder,
  latitude: schema.registry.areas.latitude,
  longitude: schema.registry.areas.longitude,
};

/**
 * Refuses a parent that is not there, or not of the kind above the child.
 *
 * @param db - The database.
 * @param kind - The child's kind.
 * @param parentId - The parent named.
 * @throws {ValidationError} Naming the field.
 */
async function checkParent(db: Database, kind: AreaKind, parentId: string): Promise<void> {
  const [parent] = await db
    .select({ kind: schema.registry.areas.kind })
    .from(schema.registry.areas)
    .where(eq(schema.registry.areas.id, parentId));

  if (parent === undefined) {
    throw new ValidationError('The parent is not an area', {
      details: { issues: [{ path: 'parentId', message: `No area has the id ${parentId}` }] },
    });
  }

  const wanted = PARENT_KIND[kind];

  if (parent.kind !== wanted) {
    throw new ValidationError(`A ${kind} goes in a ${String(wanted)}`, {
      details: {
        issues: [
          { path: 'parentId', message: `That area is a ${parent.kind}, not a ${String(wanted)}` },
        ],
      },
    });
  }
}

/**
 * Refuses a second house.
 *
 * @param db - The database.
 * @throws {ConflictError} When the house already exists.
 */
async function refuseSecondHouse(db: Database): Promise<void> {
  const [existing] = await db
    .select({ id: schema.registry.areas.id })
    .from(schema.registry.areas)
    .where(eq(schema.registry.areas.kind, 'house'))
    .limit(1);

  if (existing !== undefined) {
    throw new ConflictError('The house already exists; there is only one', {
      details: { id: existing.id },
    });
  }
}

/**
 * Refuses an area id unless it names a room.
 *
 * For a device being put somewhere: a device is in a room, and the floor and the house follow
 * from it.
 *
 * @param db - The database.
 * @param areaId - The area named.
 * @throws {ValidationError} Naming the field.
 */
export async function checkRoom(db: Database, areaId: string): Promise<void> {
  const [area] = await db
    .select({ kind: schema.registry.areas.kind })
    .from(schema.registry.areas)
    .where(eq(schema.registry.areas.id, areaId));

  if (area === undefined) {
    throw new ValidationError('The room is not an area', {
      details: { issues: [{ path: 'areaId', message: `No area has the id ${areaId}` }] },
    });
  }

  if (area.kind !== 'room') {
    throw new ValidationError('A device goes in a room', {
      details: { issues: [{ path: 'areaId', message: `That area is a ${area.kind}, not a room` }] },
    });
  }
}

/**
 * Lists every area, with how many devices and entities are in each directly.
 *
 * @param db - The database.
 * @returns The areas: by the order the owner arranged, then oldest first, then by name.
 */
export async function listAreas(db: Database): Promise<AreaView[]> {
  const { areas, devices, entities } = schema.registry;
  const rows = await db
    .select({
      ...AREA_COLUMNS,
      deviceCount: sql<number>`count(distinct ${devices.id})::int`,
      entityCount: sql<number>`count(distinct ${entities.id})::int`,
    })
    .from(areas)
    .leftJoin(devices, eq(devices.areaId, areas.id))
    .leftJoin(entities, eq(entities.areaId, areas.id))
    .groupBy(areas.id)
    .orderBy(asc(areas.sortOrder), asc(areas.createdAt), asc(areas.name));

  return rows.map((row) => areaViewSchema.parse(row));
}

/**
 * Reads one area, or says it is not there.
 *
 * @param db - The database.
 * @param id - Which area.
 * @returns The area.
 * @throws {NotFoundError} When no area has that id.
 */
export async function readArea(db: Database, id: string): Promise<AreaView> {
  const found = (await listAreas(db)).find((area) => area.id === id);

  if (found === undefined) {
    throw new NotFoundError('No area has that id', { details: { id } });
  }

  return found;
}

/**
 * The key a new area gets: the name's slug, or the slug with a number when it is taken.
 *
 * @param db - The database.
 * @param name - What the owner typed.
 * @returns A key no area has.
 */
async function freeKeyFor(db: Database, name: string): Promise<string> {
  const base = toTagKey(name) || FALLBACK_KEY;
  const taken = new Set(
    (
      await db
        .select({ key: schema.registry.areas.key })
        .from(schema.registry.areas)
        .where(like(schema.registry.areas.key, `${keyPrefixOf(base)}%`))
    ).map((row) => row.key),
  );

  return chooseFreeKey(base, taken);
}

/**
 * Creates an area.
 *
 * @param db - The database.
 * @param icons - The catalogue, to refuse an icon that is not in it.
 * @param body - The kind, the name, the parent for a floor or a room, and the rest.
 * @returns The area, with nothing in it yet.
 * @throws {ValidationError} When the icon is not in the catalogue, or the parent is not the
 * kind above.
 * @throws {ConflictError} When two requests raced for the same key; the second one asks again.
 */
export async function createArea(
  db: Database,
  icons: IconLookup,
  body: AreaCreate,
): Promise<AreaView> {
  if (body.icon !== undefined) {
    checkIcon(icons, body.icon);
  }

  if (body.parentId !== undefined) {
    await checkParent(db, body.kind, body.parentId);
  }

  if (body.kind === 'house') {
    await refuseSecondHouse(db);
  }

  const key = await freeKeyFor(db, body.name);

  try {
    const [row] = await db
      .insert(schema.registry.areas)
      .values({
        key,
        name: body.name,
        kind: body.kind,
        parentId: body.parentId ?? null,
        icon: body.icon ?? null,
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
      })
      .returning(AREA_COLUMNS);

    return areaViewSchema.parse({ ...row, deviceCount: 0, entityCount: 0 });
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
      throw new ConflictError(
        body.kind === 'house'
          ? 'The house already exists; there is only one'
          : 'An area was just made with that key; try again',
        { cause: error, details: { key } },
      );
    }

    throw error;
  }
}

/**
 * Renames, redraws or moves an area. The kind and the key stay.
 *
 * @param db - The database.
 * @param icons - The catalogue, to refuse an icon that is not in it.
 * @param id - Which area.
 * @param body - What changes.
 * @returns The area as it now stands.
 * @throws {ValidationError} When the icon is not in the catalogue, or a position is put on
 * something that is not a house.
 * @throws {NotFoundError} When no area has that id.
 */
export async function updateArea(
  db: Database,
  icons: IconLookup,
  id: string,
  body: AreaUpdate,
): Promise<AreaView> {
  if (body.icon !== undefined && body.icon !== null) {
    checkIcon(icons, body.icon);
  }

  if (body.latitude !== undefined && body.latitude !== null) {
    const [area] = await db
      .select({ kind: schema.registry.areas.kind })
      .from(schema.registry.areas)
      .where(eq(schema.registry.areas.id, id));

    if (area !== undefined && area.kind !== 'house') {
      throw new ValidationError('Only a house stands somewhere', {
        details: { issues: [{ path: 'latitude', message: `A ${area.kind} has no position` }] },
      });
    }
  }

  const changed = await db
    .update(schema.registry.areas)
    .set({
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.icon === undefined ? {} : { icon: body.icon }),
      ...(body.latitude === undefined ? {} : { latitude: body.latitude }),
      ...(body.longitude === undefined ? {} : { longitude: body.longitude }),
      updatedAt: new Date(),
    })
    .where(eq(schema.registry.areas.id, id))
    .returning({ id: schema.registry.areas.id });

  if (changed.length === 0) {
    throw new NotFoundError('No area has that id', { details: { id } });
  }

  return readArea(db, id);
}

/**
 * Removes an area, and with it everything under it.
 *
 * @param db - The database.
 * @param id - Which area.
 * @throws {NotFoundError} When no area has that id.
 */
export async function deleteArea(db: Database, id: string): Promise<void> {
  const gone = await db
    .delete(schema.registry.areas)
    .where(eq(schema.registry.areas.id, id))
    .returning({ id: schema.registry.areas.id });

  if (gone.length === 0) {
    throw new NotFoundError('No area has that id', { details: { id } });
  }
}
