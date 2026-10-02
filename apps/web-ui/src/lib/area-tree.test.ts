import { describe, expect, it } from 'vitest';

import type { AreaView } from '@nebulahome/contracts';

import {
  areaChoices,
  buildAreaTree,
  describeRemoval,
  removalImpact,
  roomChoices,
} from '@/lib/area-tree';

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
    level: kind === 'floor' ? 0 : null,
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

  it('orders the floors by their number, whatever order they come in', () => {
    const cellar = { ...area('cellar', 'floor', 'home'), level: -1 };
    const upstairs = { ...area('upstairs', 'floor', 'home'), level: 1 };
    const ground = { ...GROUND, level: 0 };
    const unnumbered = { ...area('loft', 'floor', 'home'), level: null };
    const tree = buildAreaTree([HOUSE, unnumbered, upstairs, ground, cellar]);

    expect(tree?.floors.map((floor) => floor.floor.id)).toEqual([
      'cellar',
      'ground-floor',
      'upstairs',
      'loft',
    ]);
  });

  it('offers the rooms under their floors in the floors’ order', () => {
    const upstairs = { ...FIRST, level: 1 };
    const ground = { ...GROUND, level: 0 };
    const tree = buildAreaTree([HOUSE, upstairs, ground, STUDY, KITCHEN]);

    expect(roomChoices(tree).map((choice) => choice.group ?? null)).toEqual([
      null,
      'Ground floor',
      'First floor',
    ]);
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
      { value: 'kitchen', label: 'Kitchen', group: 'Ground floor' },
      { value: 'hall', label: 'Hall', group: 'Ground floor' },
      { value: 'study', label: 'Study', group: 'First floor' },
    ]);
  });

  it('offers only no room when there is no house yet', () => {
    expect(roomChoices(null)).toEqual([{ value: '', label: 'No room' }]);
  });
});

describe('areaChoices', () => {
  it('offers the house, then each floor as a whole and its rooms, under the floor', () => {
    const tree = buildAreaTree([HOUSE, GROUND, FIRST, KITCHEN, HALL, STUDY]);

    expect(areaChoices(tree).map((choice) => [choice.label, choice.group ?? null])).toEqual([
      ['None', null],
      ['Whole house', null],
      ['Whole floor', 'Ground floor'],
      ['Kitchen', 'Ground floor'],
      ['Hall', 'Ground floor'],
      ['Whole floor', 'First floor'],
      ['Study', 'First floor'],
    ]);
  });
});
