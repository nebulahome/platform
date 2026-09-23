import { describe, expect, it } from 'vitest';

import type { AreaView } from '@nebula-home/contracts';

import { buildAreaTree, describeRemoval, removalImpact, roomChoices } from '@/lib/area-tree';

/**
 * An area as the API serves it.
 *
 * @param id - Its id, and its key.
 * @param kind - House, floor or room.
 * @param parentId - What it is in.
 * @param deviceCount - How many devices are in it.
 * @returns The area.
 */
function area(
  id: string,
  kind: AreaView['kind'],
  parentId: string | null,
  deviceCount = 0,
): AreaView {
  return {
    id,
    key: id,
    name: id.charAt(0).toUpperCase() + id.slice(1).replaceAll('-', ' '),
    kind,
    parentId,
    icon: null,
    sortOrder: 100,
    latitude: null,
    longitude: null,
    deviceCount,
    entityCount: 0,
  };
}

const HOUSE = area('home', 'house', null);
const GROUND = area('ground-floor', 'floor', 'home');
const FIRST = area('first-floor', 'floor', 'home');
const KITCHEN = area('kitchen', 'room', 'ground-floor', 2);
const HALL = area('hall', 'room', 'ground-floor');
const STUDY = area('study', 'room', 'first-floor', 1);

describe('buildAreaTree', () => {
  it('is nothing until there is a house', () => {
    expect(buildAreaTree([])).toBeNull();
    expect(buildAreaTree([GROUND, KITCHEN])).toBeNull();
  });

  it('hangs the floors on the house and the rooms on their floors, in the order given', () => {
    const tree = buildAreaTree([HOUSE, GROUND, FIRST, KITCHEN, HALL, STUDY]);

    expect(tree?.house).toBe(HOUSE);
    expect(tree?.floors.map((floor) => floor.floor.id)).toEqual(['ground-floor', 'first-floor']);
    expect(tree?.floors[0]?.rooms.map((room) => room.id)).toEqual(['kitchen', 'hall']);
    expect(tree?.floors[1]?.rooms.map((room) => room.id)).toEqual(['study']);
  });

  it('leaves out a room whose floor is not there, rather than inventing a floor', () => {
    const tree = buildAreaTree([HOUSE, GROUND, area('attic-room', 'room', 'attic')]);

    expect(tree?.floors).toHaveLength(1);
    expect(tree?.floors[0]?.rooms).toEqual([]);
  });
});

describe('removalImpact', () => {
  const tree = buildAreaTree([HOUSE, GROUND, FIRST, KITCHEN, HALL, STUDY]);

  it('counts the devices a room would leave in no room', () => {
    expect(removalImpact(tree, KITCHEN)).toEqual({ floors: 0, rooms: 0, devices: 2 });
  });

  it('counts the rooms that go with a floor, and their devices', () => {
    expect(removalImpact(tree, GROUND)).toEqual({ floors: 0, rooms: 2, devices: 2 });
  });

  it('counts everything under the house', () => {
    expect(removalImpact(tree, HOUSE)).toEqual({ floors: 2, rooms: 3, devices: 3 });
  });
});

describe('describeRemoval', () => {
  it('says what goes and what is left, and nothing when nothing is', () => {
    expect(describeRemoval({ floors: 0, rooms: 0, devices: 0 })).toBe('Nothing is in it.');
    expect(describeRemoval({ floors: 0, rooms: 0, devices: 1 })).toBe(
      '1 device is left in no room.',
    );
    expect(describeRemoval({ floors: 0, rooms: 2, devices: 3 })).toBe(
      'Its 2 rooms go with it, and 3 devices are left in no room.',
    );
    expect(describeRemoval({ floors: 2, rooms: 1, devices: 0 })).toBe(
      'Its 2 floors and 1 room go with it.',
    );
  });
});

describe('roomChoices', () => {
  it('offers no room first, then every room by its floor', () => {
    const tree = buildAreaTree([HOUSE, GROUND, FIRST, KITCHEN, HALL, STUDY]);

    expect(roomChoices(tree)).toEqual([
      { value: '', label: 'No room' },
      { value: 'kitchen', label: 'Ground floor › Kitchen' },
      { value: 'hall', label: 'Ground floor › Hall' },
      { value: 'study', label: 'First floor › Study' },
    ]);
  });

  it('offers only no room when there is no house yet', () => {
    expect(roomChoices(null)).toEqual([{ value: '', label: 'No room' }]);
  });
});
