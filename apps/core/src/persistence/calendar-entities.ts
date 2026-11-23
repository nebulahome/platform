/**
 * The Calendar device and its entities (docs/calendar.md 7.1, D7).
 *
 * One device for the platform's calendar, `source = 'virtual'` and `external_id = 'calendar'` as
 * the shared Aliases device is, written by `core` the first time it is missing. On it, one
 * `calendar.<slug>` entity per calendar - the slug made from the calendar's name when the entity is
 * made and kept when the calendar is renamed, the name following the calendar - and the two
 * working-day sensors. The entities are `system` ones: read only, reported by `core`.
 *
 * A calendar deleted takes its entity with it - unless an alias reads it, which keeps it,
 * unavailable, as the sun's entities are kept when the house loses its position.
 */
import { and, eq, inArray, like, ne, sql } from 'drizzle-orm';

import {
  parseEntityId,
  type CapabilityName,
  type EntityId,
  type JsonObject,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';
import type { PlatformLogger } from '@nebulahome/logging';

import { unreadByAliases } from './alias-readers.js';
import type { CalendarRecord } from './calendar-store.js';
import type { WrittenSystemEntity } from './system-entities.js';

/** The Calendar device's external id, which finds it. */
export const CALENDAR_DEVICE_EXTERNAL_ID = 'calendar';

/** What the device is called until the owner calls it something else. */
export const CALENDAR_DEVICE_NAME = 'Calendar';

/** On while today is a working day. */
export const WORKING_TODAY_ENTITY_ID = parseEntityId('binary_sensor.working_today');

/** On while tomorrow is a working day. */
export const WORKING_TOMORROW_ENTITY_ID = parseEntityId('binary_sensor.working_tomorrow');

/** One entity of the Calendar device as written. */
export type CalendarEntity = WrittenSystemEntity & {
  readonly isEnabled: boolean;

  /** The calendar it tells, or null for a working-day sensor. */
  readonly calendarId: string | null;
};

/** What making the entities match the calendars did. */
export type CalendarEntitiesSync = {
  /** The device's row. */
  readonly deviceId: string;

  /** The entities written: one per calendar, and the working-day sensors. */
  readonly written: readonly CalendarEntity[];

  /** The entities deleted: their calendar is gone. */
  readonly removed: readonly { readonly rowId: string; readonly entityId: EntityId }[];

  /** The entities kept, made unavailable, because an alias reads them. */
  readonly stranded: readonly EntityId[];
};

/** An entity to write. */
type Wanted = {
  readonly entityId: string;
  readonly name: string;
  readonly icon: string;
  readonly deviceClass: string | null;
  readonly calendarId: string | null;
  readonly capabilities: Readonly<Partial<Record<CapabilityName, JsonObject>>>;
};

/**
 * An entity id for a calendar, from its name: `calendar.raccolta_rifiuti`, with `_2` and on when
 * the house already has it.
 *
 * @param name - The calendar's name.
 * @param taken - The ids in use; the one returned is added.
 * @returns The entity id.
 */
function freeEntityId(name: string, taken: Set<string>): string {
  const slug =
    name
      .normalize('NFD')
      .replaceAll(/\p{M}/gu, '')
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/gu, '_')
      .replaceAll(/^_+|_+$/gu, '')
      .slice(0, 56) || 'calendar';
  let entityId = `calendar.${slug}`;

  for (let index = 2; taken.has(entityId); index += 1) {
    entityId = `calendar.${slug}_${String(index)}`;
  }

  taken.add(entityId);

  return entityId;
}

/**
 * Makes the Calendar device's entities match the calendars: one per calendar, the working-day
 * sensors, and none for a calendar that is gone.
 *
 * One transaction, so a `core` that dies halfway leaves either the old rows or the new ones.
 *
 * @param db - A connected database handle.
 * @param calendars - The calendars, as they are now.
 * @param logger - Where a working-day id taken by another entity is reported.
 * @returns What was written, deleted and kept.
 */
export async function syncCalendarEntities(
  db: Database,
  calendars: readonly CalendarRecord[],
  logger: PlatformLogger,
): Promise<CalendarEntitiesSync> {
  const { devices, entities, entityCapabilities } = schema.registry;

  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({ id: devices.id })
      .from(devices)
      .where(
        and(eq(devices.source, 'virtual'), eq(devices.externalId, CALENDAR_DEVICE_EXTERNAL_ID)),
      )
      .limit(1);
    const [device] =
      found === undefined
        ? await tx
            .insert(devices)
            .values({
              source: 'virtual',
              externalId: CALENDAR_DEVICE_EXTERNAL_ID,
              name: CALENDAR_DEVICE_NAME,
              icon: 'calendar',
              manufacturer: 'Nebula',
              model: 'Calendar',
            })
            .returning({ id: devices.id })
        : [found];

    if (device === undefined) {
      throw new Error('The Calendar device was neither found nor written');
    }

    const present = await tx
      .select({ rowId: entities.id, entityId: entities.entityId, calendarId: entities.calendarId })
      .from(entities)
      .where(eq(entities.deviceId, device.id));
    const taken = new Set(
      (
        await tx
          .select({ entityId: entities.entityId })
          .from(entities)
          .where(like(entities.entityId, 'calendar.%'))
      ).map((row) => row.entityId),
    );
    // A device of the owner's may call its sensor that already; it keeps it.
    const blocked = await tx
      .select({ entityId: entities.entityId })
      .from(entities)
      .where(
        and(
          inArray(entities.entityId, [WORKING_TODAY_ENTITY_ID, WORKING_TOMORROW_ENTITY_ID]),
          ne(entities.source, 'system'),
        ),
      );

    for (const row of blocked) {
      logger.error(
        { entityId: row.entityId },
        'A working-day entity id is taken by another entity; that sensor will have no entity',
      );
    }

    const wanted: Wanted[] = [
      ...calendars.map((calendar) => ({
        entityId:
          present.find(
            (row) => row.calendarId === calendar.id && row.entityId.startsWith('calendar.'),
          )?.entityId ?? freeEntityId(calendar.name, taken),
        name: calendar.name,
        icon: calendar.icon ?? 'calendar',
        deviceClass: null,
        calendarId: calendar.id,
        capabilities: { calendar: { calendarId: calendar.id, color: calendar.color } },
      })),
      ...[
        { entityId: WORKING_TODAY_ENTITY_ID, name: 'Working today' },
        { entityId: WORKING_TOMORROW_ENTITY_ID, name: 'Working tomorrow' },
      ]
        .filter((sensor) => !blocked.some((row) => row.entityId === sensor.entityId))
        .map((sensor) => ({
          ...sensor,
          icon: 'briefcase',
          deviceClass: 'workday',
          calendarId: null,
          capabilities: { sensor_binary: {} },
        })),
    ];
    const rows = await tx
      .insert(entities)
      .values(
        wanted.map((entity) => ({
          entityId: entity.entityId,
          deviceId: device.id,
          source: 'system',
          name: entity.name,
          icon: entity.icon,
          deviceClass: entity.deviceClass,
          calendarId: entity.calendarId,
        })),
      )
      .onConflictDoUpdate({
        target: entities.entityId,
        set: {
          // A calendar's entity is named as the calendar is; a working-day sensor keeps the
          // owner's name and icon once given.
          name: sql`CASE WHEN excluded.calendar_id IS NULL THEN ${entities.name} ELSE excluded.name END`,
          icon: sql`CASE WHEN excluded.calendar_id IS NULL THEN coalesce(${entities.icon}, excluded.icon) ELSE excluded.icon END`,
          deviceId: sql`excluded.device_id`,
          deviceClass: sql`excluded.device_class`,
          calendarId: sql`excluded.calendar_id`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: entities.id, entityId: entities.entityId, isEnabled: entities.isEnabled });
    const declared = new Map(wanted.map((entity) => [entity.entityId, entity]));

    // Replaced rather than merged, as a device's are: the colour follows the calendar.
    await tx.delete(entityCapabilities).where(
      inArray(
        entityCapabilities.entityId,
        rows.map((row) => row.id),
      ),
    );
    await tx.insert(entityCapabilities).values(
      rows.flatMap((row) =>
        Object.entries(declared.get(row.entityId)?.capabilities ?? {}).map(
          ([capability, params]) => ({
            entityId: row.id,
            capability,
            params,
          }),
        ),
      ),
    );

    const kept = new Set(rows.map((row) => row.id));
    const leftover = present.filter((row) => !kept.has(row.rowId));
    const free = await unreadByAliases(
      tx,
      leftover.map((row) => row.rowId),
    );

    if (free.size > 0) {
      await tx.delete(entities).where(inArray(entities.id, [...free]));
    }

    return {
      deviceId: device.id,
      written: rows.map((row) => ({
        rowId: row.id,
        entityId: parseEntityId(row.entityId),
        isEnabled: row.isEnabled,
        calendarId: declared.get(row.entityId)?.calendarId ?? null,
        capabilities: new Map(
          Object.entries(declared.get(row.entityId)?.capabilities ?? {}) as [
            CapabilityName,
            JsonObject,
          ][],
        ),
      })),
      removed: leftover
        .filter((row) => free.has(row.rowId))
        .map((row) => ({ rowId: row.rowId, entityId: parseEntityId(row.entityId) })),
      stranded: leftover
        .filter((row) => !free.has(row.rowId))
        .map((row) => parseEntityId(row.entityId)),
    };
  });
}
