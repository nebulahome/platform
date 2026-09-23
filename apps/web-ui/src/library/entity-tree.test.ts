/**
 * The house's entities placed by floor, room and device.
 */
import { describe, expect, it } from 'vitest';

import { aDevice, anArea, anEntity } from '@/testing/fixtures';

import { buildEntityTree, entityCountOf } from './entity-tree';

const AREAS = [
  anArea('home', 'house', null),
  anArea('upstairs', 'floor', 'home', { sortOrder: 2 }),
  anArea('ground', 'floor', 'home', { sortOrder: 1 }),
  anArea('kitchen', 'room', 'ground', { sortOrder: 2 }),
  anArea('hall', 'room', 'ground', { sortOrder: 1 }),
  anArea('bedroom', 'room', 'upstairs'),
  anArea('attic', 'room', 'loft'),
];

const PLUG = aDevice({ id: 'shelly-plug', name: 'Kitchen plug' });
const PRINTER = aDevice({ id: 'bambu-printer', name: 'Printer' });

describe('buildEntityTree', () => {
  it('places each entity under its floor, its room and its device, in the owner’s order', () => {
    const tree = buildEntityTree({
      areas: AREAS,
      devices: [PLUG, PRINTER],
      entities: [
        anEntity({
          entityId: 'switch.plug',
          name: 'Plug',
          source: 'shelly-plug',
          areaKey: 'kitchen',
        }),
        anEntity({
          entityId: 'sensor.plug_power',
          name: 'Power',
          source: 'shelly-plug',
          areaKey: 'kitchen',
        }),
        anEntity({
          entityId: 'light.hall',
          name: 'Hall light',
          source: 'bambu-printer',
          areaKey: 'hall',
        }),
        anEntity({
          entityId: 'light.bed',
          name: 'Bedside',
          source: 'bambu-printer',
          areaKey: 'bedroom',
        }),
      ],
    });

    expect(tree.floors.map((floor) => floor.floor.key)).toEqual(['ground', 'upstairs']);
    expect(tree.floors[0]?.rooms.map((room) => room.room.key)).toEqual(['hall', 'kitchen']);
    expect(tree.floors[0]?.rooms[1]?.devices[0]?.entities.map((entity) => entity.name)).toEqual([
      'Plug',
      'Power',
    ]);
    expect(tree.floors[0]?.rooms[1]?.devices[0]?.device?.name).toBe('Kitchen plug');
  });

  it('shows a device in two rooms when one of its entities was moved to another', () => {
    const tree = buildEntityTree({
      areas: AREAS,
      devices: [PRINTER],
      entities: [
        anEntity({
          entityId: 'light.hall',
          name: 'Chamber light',
          source: 'bambu-printer',
          areaKey: 'hall',
        }),
        anEntity({
          entityId: 'sensor.nozzle',
          name: 'Nozzle',
          source: 'bambu-printer',
          areaKey: 'kitchen',
        }),
      ],
    });

    expect(tree.floors[0]?.rooms.map((room) => room.room.key)).toEqual(['hall', 'kitchen']);
    expect(
      tree.floors[0]?.rooms.every((room) => room.devices[0]?.device?.id === 'bambu-printer'),
    ).toBe(true);
  });

  it('gathers what is in no room, the house only, or a room with no floor, at the end', () => {
    const tree = buildEntityTree({
      areas: AREAS,
      devices: [PLUG],
      entities: [
        anEntity({ entityId: 'switch.a', name: 'A', source: 'shelly-plug', areaKey: null }),
        anEntity({ entityId: 'switch.b', name: 'B', source: 'shelly-plug', areaKey: 'home' }),
        anEntity({ entityId: 'switch.c', name: 'C', source: 'shelly-plug', areaKey: 'attic' }),
      ],
    });

    expect(tree.floors).toEqual([]);
    expect(tree.unplaced[0]?.entities.map((entity) => entity.name)).toEqual(['A', 'B', 'C']);
  });

  it('keeps entities placed on a floor itself at the top of that floor', () => {
    const tree = buildEntityTree({
      areas: AREAS,
      devices: [PLUG],
      entities: [
        anEntity({ entityId: 'switch.a', name: 'A', source: 'shelly-plug', areaKey: 'upstairs' }),
      ],
    });

    expect(tree.floors[0]?.floor.key).toBe('upstairs');
    expect(tree.floors[0]?.onFloor[0]?.entities).toHaveLength(1);
    expect(tree.floors[0]?.rooms).toEqual([]);
  });

  it('lists an alias with no device on its own, after the devices of its room', () => {
    const tree = buildEntityTree({
      areas: AREAS,
      devices: [PLUG],
      entities: [
        anEntity({
          entityId: 'alias.average',
          name: 'Average',
          source: 'derived',
          areaKey: 'kitchen',
        }),
        anEntity({
          entityId: 'switch.plug',
          name: 'Plug',
          source: 'shelly-plug',
          areaKey: 'kitchen',
        }),
      ],
    });
    const kitchen = tree.floors[0]?.rooms[0];

    expect(kitchen?.devices.map((group) => group.device?.id ?? null)).toEqual([
      'shelly-plug',
      null,
    ]);
    expect(entityCountOf(tree)).toBe(2);
  });
});
