/**
 * The house's entities as a person looks for them: by floor, then room, then device.
 *
 * The registry is flat, and so was every picker built on it - a list of hundreds of sensors
 * named "Power" and "Temperature". A person looking for the kitchen light goes to the ground
 * floor, then the kitchen, then the lamp; this builds that path.
 *
 * An entity is placed by the room it is actually in - its own, when it has been moved away from
 * its device's - so a device can appear in two rooms, each with the entities that are there. An
 * entity placed on a floor but in no room sits at the top of that floor; one in no room at all,
 * or only in the house, is gathered at the end under "Not in a room". Aliases and the system's
 * readings belong to no device and are listed under the room they are in, on their own.
 *
 * Floors and rooms follow the order the owner arranged on the areas page; devices and entities
 * read alphabetically.
 */
import type { AreaView, DeviceView, EntityView } from '@nebula-home/contracts';

/** A device and the entities of it that are in one place; no device for an alias or the like. */
export type DeviceGroup = {
  /** The device, or null for entities that come from none. */
  readonly device: DeviceView | null;

  /** Its entities in this place, alphabetically. */
  readonly entities: readonly EntityView[];
};

/** A room and what is in it. */
export type RoomGroup = {
  readonly room: AreaView;
  readonly devices: readonly DeviceGroup[];
};

/** A floor, what is on it without a room, and its rooms. */
export type FloorGroup = {
  readonly floor: AreaView;

  /** Entities placed on the floor itself rather than in one of its rooms. */
  readonly onFloor: readonly DeviceGroup[];

  readonly rooms: readonly RoomGroup[];
};

/** The whole house, as the picker draws it. */
export type EntityTree = {
  readonly floors: readonly FloorGroup[];

  /** Entities in no room and on no floor. */
  readonly unplaced: readonly DeviceGroup[];
};

/** What the tree is built from. */
export type EntityTreeInput = {
  readonly areas: readonly AreaView[];
  readonly devices: readonly DeviceView[];

  /** The entities to place, already narrowed to what is being looked for. */
  readonly entities: readonly EntityView[];
};

/** The key a device-less group is kept under. */
const NO_DEVICE = '';

/**
 * Orders areas the way the owner arranged them.
 *
 * @param left - One area.
 * @param right - The other.
 * @returns The comparison.
 */
function byArrangement(left: AreaView, right: AreaView): number {
  return left.sortOrder - right.sortOrder || left.name.localeCompare(right.name);
}

/** Anything with a name. */
type Named = { readonly name: string };

/**
 * Orders by name, as a person reads it.
 *
 * @param left - One thing with a name.
 * @param right - The other.
 * @returns The comparison.
 */
function byName(left: Named, right: Named): number {
  return left.name.localeCompare(right.name);
}

/**
 * Groups entities under the devices they come from.
 *
 * @param entities - The entities in one place.
 * @param devices - Every device, by id.
 * @returns The groups: devices alphabetically, the device-less last.
 */
function groupByDevice(
  entities: readonly EntityView[],
  devices: ReadonlyMap<string, DeviceView>,
): DeviceGroup[] {
  const groups = new Map<string, EntityView[]>();

  for (const entity of entities) {
    const key = devices.has(entity.source) ? entity.source : NO_DEVICE;

    groups.set(key, [...(groups.get(key) ?? []), entity]);
  }

  return [...groups]
    .map(([key, members]) => ({
      device: devices.get(key) ?? null,
      entities: [...members].sort(byName),
    }))
    .sort((left, right) => {
      if (left.device === null || right.device === null) {
        return left.device === null ? 1 : -1;
      }

      return byName(left.device, right.device);
    });
}

/**
 * Builds the tree.
 *
 * @param input - The areas, the devices and the entities to place.
 * @returns The floors with their rooms, and what is in no room; empty places are left out.
 */
export function buildEntityTree(input: EntityTreeInput): EntityTree {
  const { areas, entities } = input;
  const devices = new Map(input.devices.map((device) => [device.id, device]));
  const byKey = new Map(areas.map((area) => [area.key, area]));
  const inPlace = new Map<string, EntityView[]>();
  const unplaced: EntityView[] = [];

  for (const entity of entities) {
    const area = entity.areaKey === null ? undefined : byKey.get(entity.areaKey);

    if (area === undefined || area.kind === 'house') {
      unplaced.push(entity);
    } else {
      inPlace.set(area.id, [...(inPlace.get(area.id) ?? []), entity]);
    }
  }

  const floors = areas
    .filter((area) => area.kind === 'floor')
    .sort(byArrangement)
    .flatMap((floor): FloorGroup[] => {
      const rooms = areas
        .filter((area) => area.kind === 'room' && area.parentId === floor.id)
        .sort(byArrangement)
        .flatMap((room): RoomGroup[] => {
          const members = inPlace.get(room.id) ?? [];

          return members.length === 0 ? [] : [{ room, devices: groupByDevice(members, devices) }];
        });
      const onFloor = groupByDevice(inPlace.get(floor.id) ?? [], devices);

      return rooms.length === 0 && onFloor.length === 0 ? [] : [{ floor, onFloor, rooms }];
    });

  // A room whose floor is missing from the list cannot be drawn under it; its entities are
  // still findable, among those in no room.
  const drawn = new Set(
    floors.flatMap((floor) => [floor.floor.id, ...floor.rooms.map((room) => room.room.id)]),
  );

  for (const [areaId, members] of inPlace) {
    if (!drawn.has(areaId)) {
      unplaced.push(...members);
    }
  }

  return { floors, unplaced: groupByDevice(unplaced, devices) };
}

/**
 * How many entities some device groups hold.
 *
 * @param groups - The groups.
 * @returns The count.
 */
function countIn(groups: readonly DeviceGroup[]): number {
  return groups.reduce((sum, group) => sum + group.entities.length, 0);
}

/**
 * How many entities a tree holds.
 *
 * @param tree - The tree.
 * @returns The count, across every floor, room and the unplaced.
 */
export function entityCountOf(tree: EntityTree): number {
  return (
    tree.floors.reduce(
      (sum, floor) =>
        sum +
        countIn(floor.onFloor) +
        floor.rooms.reduce((inRooms, room) => inRooms + countIn(room.devices), 0),
      0,
    ) + countIn(tree.unplaced)
  );
}
