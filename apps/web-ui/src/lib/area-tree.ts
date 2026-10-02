/**
 * The areas as a tree: the house, its floors, their rooms.
 *
 * The API serves areas flat, each naming its parent, and every page that shows them wants the
 * tree - the areas page to draw it, the device dialog to offer the rooms by floor, a removal
 * to say what goes with what. Built here, once, from what the API said and nothing else: a
 * room whose floor is not in the list is left out rather than given a floor that is not there.
 */
import type { AreaView } from '@nebulahome/contracts';

/** A floor and the rooms on it. */
export type FloorNode = {
  readonly floor: AreaView;
  readonly rooms: readonly AreaView[];
};

/** The house and the floors in it. */
export type HouseTree = {
  readonly house: AreaView;
  readonly floors: readonly FloorNode[];
};

/** What removing an area takes with it, or leaves in no room. */
export type RemovalImpact = {
  /** The floors that go with it. */
  readonly floors: number;

  /** The rooms that go with it. */
  readonly rooms: number;

  /** The devices left in no room. */
  readonly devices: number;
};

/** One option of a room dropdown. */
export type RoomChoice = {
  readonly value: string;
  readonly label: string;

  /** The floor it is listed under; none for "No room" and for the house itself. */
  readonly group?: string;
};

/**
 * Orders floors by the storey each is - the cellar, the ground, the one above - whatever they are
 * called. A floor with no number goes after the numbered ones; ties keep the order they came in.
 *
 * @param left - One floor.
 * @param right - The other.
 * @returns The comparison.
 */
export function byFloorLevel(left: AreaView, right: AreaView): number {
  if (left.level === right.level) {
    return 0;
  }

  if (left.level === null || right.level === null) {
    return left.level === null ? 1 : -1;
  }

  return left.level - right.level;
}

/**
 * Builds the tree from the flat list: floors by their number, rooms in the order the list reads.
 *
 * @param areas - Every area the API lists.
 * @returns The tree, or null while there is no house.
 */
export function buildAreaTree(areas: readonly AreaView[]): HouseTree | null {
  const house = areas.find((area) => area.kind === 'house');

  if (house === undefined) {
    return null;
  }

  const floors = areas
    .filter((area) => area.kind === 'floor' && area.parentId === house.id)
    .sort(byFloorLevel);

  return {
    house,
    floors: floors.map((floor) => ({
      floor,
      rooms: areas.filter((area) => area.kind === 'room' && area.parentId === floor.id),
    })),
  };
}

/**
 * Says what removing an area takes with it.
 *
 * @param tree - The tree the area is in.
 * @param area - What would be removed.
 * @returns The floors and rooms that go, and the devices left in no room.
 */
export function removalImpact(tree: HouseTree | null, area: AreaView): RemovalImpact {
  if (tree === null) {
    return { floors: 0, rooms: 0, devices: area.deviceCount };
  }

  const floors =
    area.kind === 'house' ? tree.floors : tree.floors.filter((floor) => floor.floor.id === area.id);
  const rooms = area.kind === 'room' ? [area] : floors.flatMap((floor) => floor.rooms);

  return {
    floors: area.kind === 'house' ? floors.length : 0,
    rooms: area.kind === 'room' ? 0 : rooms.length,
    devices: rooms.reduce((total, room) => total + room.deviceCount, 0),
  };
}

/**
 * Counts something, with its noun in the right number.
 *
 * @param count - How many.
 * @param noun - What they are, singular.
 * @returns "1 room", "2 rooms".
 */
function counted(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Says what a removal takes with it, for the question that confirms it.
 *
 * @param impact - What goes, and what is left.
 * @returns A sentence, or that nothing is in it.
 */
export function describeRemoval(impact: RemovalImpact): string {
  const goes = [
    impact.floors === 0 ? null : counted(impact.floors, 'floor'),
    impact.rooms === 0 ? null : counted(impact.rooms, 'room'),
  ].filter((part) => part !== null);
  const left =
    impact.devices === 0
      ? null
      : `${counted(impact.devices, 'device')} ${impact.devices === 1 ? 'is' : 'are'} left in no room`;

  if (goes.length === 0 && left === null) {
    return 'Nothing is in it.';
  }

  if (goes.length === 0) {
    return `${String(left)}.`;
  }

  const going = `Its ${goes.join(' and ')} go with it`;

  return left === null ? `${going}.` : `${going}, and ${left}.`;
}

/**
 * The rooms as a dropdown offers them: none first, then each listed under its floor.
 *
 * @param tree - The tree, or null while there is no house.
 * @returns The options.
 */
export function roomChoices(tree: HouseTree | null): RoomChoice[] {
  return [
    { value: '', label: 'No room' },
    ...(tree?.floors ?? []).flatMap((floor) =>
      floor.rooms.map((room) => ({ value: room.id, label: room.name, group: floor.floor.name })),
    ),
  ];
}

/**
 * Every area as a dropdown offers it, for what may be placed on a whole floor or the whole house:
 * none, the house, then each floor followed by its rooms, listed under the floor.
 *
 * @param tree - The tree, or null while there is no house.
 * @returns The options.
 */
export function areaChoices(tree: HouseTree | null): RoomChoice[] {
  if (tree === null) {
    return [{ value: '', label: 'None' }];
  }

  return [
    { value: '', label: 'None' },
    { value: tree.house.id, label: 'Whole house' },
    ...tree.floors.flatMap((floor) => [
      { value: floor.floor.id, label: 'Whole floor', group: floor.floor.name },
      ...floor.rooms.map((room) => ({ value: room.id, label: room.name, group: floor.floor.name })),
    ]),
  ];
}

/**
 * The areas some things are in, by key, as a filter offers them: in the house's own order - the
 * house, then each floor by its number with its rooms under it - so a filter reads like the
 * areas page rather than like an alphabet. A key the house no longer has is listed last, as it is.
 *
 * @param tree - The tree, or null while there is no house.
 * @param areas - Every area, flat, for the keys.
 * @param keys - The areas the things are in, by key, each with the name the things carry for
 * it - what a key the house does not list is called.
 * @returns The options, keyed by area key, in order.
 */
export function areaFacetChoices(
  tree: HouseTree | null,
  areas: readonly AreaView[],
  keys: ReadonlyMap<string, string | null>,
): RoomChoice[] {
  const keyById = new Map(areas.map((area) => [area.id, area.key]));
  const known = areaChoices(tree).flatMap((choice): RoomChoice[] => {
    const key = keyById.get(choice.value);

    return key === undefined || !keys.has(key) ? [] : [{ ...choice, value: key }];
  });
  const listed = new Set(known.map((choice) => choice.value));

  return [
    ...known,
    ...[...keys]
      .filter(([key]) => !listed.has(key))
      .map(([key, name]) => ({ value: key, label: name ?? key })),
  ];
}
