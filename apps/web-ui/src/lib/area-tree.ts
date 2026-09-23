/**
 * The areas as a tree: the house, its floors, their rooms.
 *
 * The API serves areas flat, each naming its parent, and every page that shows them wants the
 * tree - the areas page to draw it, the device dialog to offer the rooms by floor, a removal
 * to say what goes with what. Built here, once, from what the API said and nothing else: a
 * room whose floor is not in the list is left out rather than given a floor that is not there.
 */
import type { AreaView } from '@nebula-home/contracts';

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
};

/**
 * Builds the tree from the flat list, in the order the list reads.
 *
 * @param areas - Every area the API lists.
 * @returns The tree, or null while there is no house.
 */
export function buildAreaTree(areas: readonly AreaView[]): HouseTree | null {
  const house = areas.find((area) => area.kind === 'house');

  if (house === undefined) {
    return null;
  }

  const floors = areas.filter((area) => area.kind === 'floor' && area.parentId === house.id);

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
 * The rooms as a dropdown offers them: none first, then each by its floor.
 *
 * @param tree - The tree, or null while there is no house.
 * @returns The options.
 */
export function roomChoices(tree: HouseTree | null): RoomChoice[] {
  return [
    { value: '', label: 'No room' },
    ...(tree?.floors ?? []).flatMap((floor) =>
      floor.rooms.map((room) => ({
        value: room.id,
        label: `${floor.floor.name} › ${room.name}`,
      })),
    ),
  ];
}
