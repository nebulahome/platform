/**
 * Tags: the words an owner puts on devices and entities to pick a group of them at once.
 *
 * A tag is a row of its own - a name, a colour, a key - and two join tables say which devices
 * and which entities carry it. This service owns the tag rows and the two joins, and lends the
 * device and entity services the two operations they need: checking that a set of ids names
 * real tags, and replacing what a row carries with that set. Assigning is part of changing the
 * device or the entity, so it happens inside their transactions with their permission; what
 * needs `tag:write` is the tag itself.
 *
 * The key is derived from the name once, at creation, and never changes: a permission scope
 * names a tag by it, and a renamed tag must keep meaning the same thing to a grant. Two names
 * that slug the same get a number on the second key; the owner never sees the key.
 */
import { asc, eq, inArray, like, sql } from 'drizzle-orm';

import {
  ConflictError,
  NotFoundError,
  tagViewSchema,
  toTagKey,
  ValidationError,
  type TagCreate,
  type TagUpdate,
  type TagView,
} from '@nebula-home/contracts';
import { schema, type Database } from '@nebula-home/db';

import { checkIcon, type IconLookup } from './icon-lookup.js';
import { chooseFreeKey, isUniqueViolation, keyPrefixOf } from './keys.js';

/** What a database handle or a transaction inside one can do, as far as this file needs. */
type Writer = Pick<Database, 'select' | 'insert' | 'delete' | 'update'>;

/** How many devices and entities carry a tag. */
type TagCounts = {
  readonly deviceCount: number;
  readonly entityCount: number;
};

/** The key a name gives when it gives nothing usable. */
const FALLBACK_KEY = 'tag';

/**
 * Counts what carries each tag.
 *
 * Two grouped counts merged here rather than one query with two joins: joined, the two counts
 * multiply into each other, and a tag on three devices and four entities would count twelve of
 * each.
 *
 * @param db - The database.
 * @returns The counts, by tag id; a tag on nothing is absent.
 */
async function countsByTag(db: Writer): Promise<Map<string, TagCounts>> {
  const [devices, entities] = await Promise.all([
    db
      .select({
        tagId: schema.registry.deviceTags.tagId,
        total: sql<number>`count(*)::int`,
      })
      .from(schema.registry.deviceTags)
      .groupBy(schema.registry.deviceTags.tagId),
    db
      .select({
        tagId: schema.registry.entityTags.tagId,
        total: sql<number>`count(*)::int`,
      })
      .from(schema.registry.entityTags)
      .groupBy(schema.registry.entityTags.tagId),
  ]);
  const counts = new Map<string, TagCounts>();

  for (const row of devices) {
    counts.set(row.tagId, { deviceCount: row.total, entityCount: 0 });
  }

  for (const row of entities) {
    const current = counts.get(row.tagId) ?? { deviceCount: 0, entityCount: 0 };

    counts.set(row.tagId, { ...current, entityCount: row.total });
  }

  return counts;
}

/**
 * Lists every tag, with how many devices and entities carry each.
 *
 * @param db - The database.
 * @returns The tags, by name.
 */
export async function listTags(db: Database): Promise<TagView[]> {
  const [rows, counts] = await Promise.all([
    db
      .select({
        id: schema.registry.tags.id,
        key: schema.registry.tags.key,
        name: schema.registry.tags.name,
        color: schema.registry.tags.color,
        icon: schema.registry.tags.icon,
      })
      .from(schema.registry.tags)
      .orderBy(asc(schema.registry.tags.name)),
    countsByTag(db),
  ]);

  return rows.map((row) =>
    tagViewSchema.parse({
      ...row,
      ...(counts.get(row.id) ?? { deviceCount: 0, entityCount: 0 }),
    }),
  );
}

/**
 * Reads one tag, or says it is not there.
 *
 * @param db - The database.
 * @param id - Which tag.
 * @returns The tag.
 * @throws {NotFoundError} When no tag has that id.
 */
export async function readTag(db: Database, id: string): Promise<TagView> {
  const found = (await listTags(db)).find((tag) => tag.id === id);

  if (found === undefined) {
    throw new NotFoundError('No tag has that id', { details: { id } });
  }

  return found;
}

/**
 * The key a new tag gets: the name's slug, or the slug with a number when it is taken.
 *
 * @param db - The database.
 * @param name - What the owner typed.
 * @returns A key no tag has.
 */
async function freeKeyFor(db: Writer, name: string): Promise<string> {
  const base = toTagKey(name) || FALLBACK_KEY;
  const taken = new Set(
    (
      await db
        .select({ key: schema.registry.tags.key })
        .from(schema.registry.tags)
        .where(like(schema.registry.tags.key, `${keyPrefixOf(base)}%`))
    ).map((row) => row.key),
  );

  return chooseFreeKey(base, taken);
}

/**
 * Creates a tag.
 *
 * @param db - The database.
 * @param icons - The catalogue, to refuse an icon that is not in it.
 * @param body - The name, the colour and perhaps the icon.
 * @returns The tag, on nothing yet.
 * @throws {ValidationError} When the icon is not in the catalogue.
 * @throws {ConflictError} When two requests raced for the same key; the second one asks again.
 */
export async function createTag(
  db: Database,
  icons: IconLookup,
  body: TagCreate,
): Promise<TagView> {
  if (body.icon !== undefined) {
    checkIcon(icons, body.icon);
  }

  const key = await freeKeyFor(db, body.name);

  try {
    const [row] = await db
      .insert(schema.registry.tags)
      .values({ key, name: body.name, color: body.color, icon: body.icon ?? null })
      .returning({
        id: schema.registry.tags.id,
        key: schema.registry.tags.key,
        name: schema.registry.tags.name,
        color: schema.registry.tags.color,
        icon: schema.registry.tags.icon,
      });

    return tagViewSchema.parse({ ...row, deviceCount: 0, entityCount: 0 });
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('A tag was just made with that key; try again', {
        cause: error,
        details: { key },
      });
    }

    throw error;
  }
}

/**
 * Renames, recolours or redraws a tag. The key stays.
 *
 * @param db - The database.
 * @param icons - The catalogue, to refuse an icon that is not in it.
 * @param id - Which tag.
 * @param body - The new name, the new colour, the new icon (null for none), or any of them.
 * @returns The tag as it now stands.
 * @throws {ValidationError} When the icon is not in the catalogue.
 * @throws {NotFoundError} When no tag has that id.
 */
export async function updateTag(
  db: Database,
  icons: IconLookup,
  id: string,
  body: TagUpdate,
): Promise<TagView> {
  if (body.icon !== undefined && body.icon !== null) {
    checkIcon(icons, body.icon);
  }

  const changed = await db
    .update(schema.registry.tags)
    .set({
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.color === undefined ? {} : { color: body.color }),
      ...(body.icon === undefined ? {} : { icon: body.icon }),
      updatedAt: new Date(),
    })
    .where(eq(schema.registry.tags.id, id))
    .returning({ id: schema.registry.tags.id });

  if (changed.length === 0) {
    throw new NotFoundError('No tag has that id', { details: { id } });
  }

  return readTag(db, id);
}

/**
 * Removes a tag, and with it its place on every device and entity.
 *
 * @param db - The database.
 * @param id - Which tag.
 * @throws {NotFoundError} When no tag has that id.
 */
export async function deleteTag(db: Database, id: string): Promise<void> {
  const gone = await db
    .delete(schema.registry.tags)
    .where(eq(schema.registry.tags.id, id))
    .returning({ id: schema.registry.tags.id });

  if (gone.length === 0) {
    throw new NotFoundError('No tag has that id', { details: { id } });
  }
}

/**
 * Refuses a set of tag ids unless every one names a tag.
 *
 * Before the join rows are written, so the refusal names the field rather than surfacing as a
 * foreign key the owner cannot read.
 *
 * @param db - The database, or the transaction the write is in.
 * @param tagIds - What the request carried.
 * @throws {ValidationError} Naming the ids no tag has.
 */
export async function assertTagsExist(db: Writer, tagIds: readonly string[]): Promise<void> {
  if (tagIds.length === 0) {
    return;
  }

  const found = new Set(
    (
      await db
        .select({ id: schema.registry.tags.id })
        .from(schema.registry.tags)
        .where(inArray(schema.registry.tags.id, [...tagIds]))
    ).map((row) => row.id),
  );
  const missing = tagIds.filter((id) => !found.has(id));

  if (missing.length > 0) {
    throw new ValidationError('Unknown tag', {
      details: {
        issues: missing.map((id) => ({ path: 'tagIds', message: `No tag has the id ${id}` })),
      },
    });
  }
}

/**
 * Makes a device carry exactly these tags.
 *
 * @param db - The transaction the device change is in.
 * @param deviceRowId - The identity row of the device.
 * @param tagIds - The whole set.
 */
export async function replaceDeviceTags(
  db: Writer,
  deviceRowId: string,
  tagIds: readonly string[],
): Promise<void> {
  const wanted = [...new Set(tagIds)];

  await db
    .delete(schema.registry.deviceTags)
    .where(eq(schema.registry.deviceTags.deviceId, deviceRowId));

  if (wanted.length > 0) {
    await db
      .insert(schema.registry.deviceTags)
      .values(wanted.map((tagId) => ({ deviceId: deviceRowId, tagId })));
  }
}

/**
 * Makes an entity carry exactly these tags.
 *
 * @param db - The transaction the entity change is in.
 * @param entityRowId - The entity's row.
 * @param tagIds - The whole set.
 */
export async function replaceEntityTags(
  db: Writer,
  entityRowId: string,
  tagIds: readonly string[],
): Promise<void> {
  const wanted = [...new Set(tagIds)];

  await db
    .delete(schema.registry.entityTags)
    .where(eq(schema.registry.entityTags.entityId, entityRowId));

  if (wanted.length > 0) {
    await db
      .insert(schema.registry.entityTags)
      .values(wanted.map((tagId) => ({ entityId: entityRowId, tagId })));
  }
}

/**
 * Reads the tags on a set of devices, by the id the interface lists devices under.
 *
 * @param db - The database.
 * @param integrationIds - Which devices.
 * @returns Each device's tag ids, in key order; a device with none is absent.
 */
export async function tagIdsOfDevices(
  db: Database,
  integrationIds: readonly string[],
): Promise<Map<string, string[]>> {
  const byDevice = new Map<string, string[]>();

  if (integrationIds.length === 0) {
    return byDevice;
  }

  const rows = await db
    .select({
      integrationId: schema.registry.devices.integrationId,
      tagId: schema.registry.deviceTags.tagId,
    })
    .from(schema.registry.deviceTags)
    .innerJoin(
      schema.registry.devices,
      eq(schema.registry.devices.id, schema.registry.deviceTags.deviceId),
    )
    .innerJoin(schema.registry.tags, eq(schema.registry.tags.id, schema.registry.deviceTags.tagId))
    .where(inArray(schema.registry.devices.integrationId, [...integrationIds]))
    .orderBy(asc(schema.registry.tags.key));

  for (const row of rows) {
    if (row.integrationId !== null) {
      byDevice.set(row.integrationId, [...(byDevice.get(row.integrationId) ?? []), row.tagId]);
    }
  }

  return byDevice;
}
