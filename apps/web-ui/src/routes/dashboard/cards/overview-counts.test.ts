/**
 * The counts of the cards that sum up: what is open, on, low, ready or out of reach, and what a
 * room has.
 */
import { describe, expect, it } from 'vitest';

import type { EntityView } from '@nebulahome/contracts';

import { averagePosition, countOf, roomOf, seenIn } from '@/routes/dashboard/cards/overview-counts';
import { can, sampleEntity } from '@/routes/dashboard/samples/sample-entity';

/**
 * A sample entity in an area.
 *
 * @param entity - The entity.
 * @param areaKey - Its area.
 * @param deviceId - Its device.
 * @returns The entity, placed.
 */
function inArea(entity: EntityView, areaKey: string, deviceId: string | null = null): EntityView {
  return { ...entity, areaKey, deviceId };
}

const DEVICE = '00000000-0000-4000-8000-0000000000a1';

const HOUSE: readonly EntityView[] = [
  inArea(
    sampleEntity('binary_sensor.back_door', {
      name: 'Back door',
      area: 'Hallway',
      capabilities: [can('sensor_binary')],
      state: { sensor_binary: { isOn: true } },
      deviceClass: 'door',
    }),
    'hallway',
  ),
  inArea(
    sampleEntity('binary_sensor.cellar_door', {
      name: 'Cellar door',
      area: 'Hallway',
      capabilities: [can('sensor_binary')],
      state: { sensor_binary: { isOn: true } },
      deviceClass: 'door',
      isAvailable: false,
    }),
    'hallway',
  ),
  inArea(
    sampleEntity('binary_sensor.motion', {
      name: 'Motion',
      area: 'Hallway',
      capabilities: [can('sensor_binary')],
      state: { sensor_binary: { isOn: true } },
      deviceClass: 'motion',
    }),
    'hallway',
  ),
  inArea(
    sampleEntity('sensor.lock_battery', {
      name: 'Lock battery',
      area: 'Hallway',
      capabilities: [can('sensor_numeric')],
      state: { sensor_numeric: { value: 14 } },
      deviceClass: 'battery',
    }),
    'hallway',
  ),
  inArea(
    sampleEntity('sensor.remote_battery', {
      name: 'Remote battery',
      area: 'Living room',
      capabilities: [can('sensor_numeric')],
      state: { sensor_numeric: { value: 8 } },
      deviceClass: 'battery',
    }),
    'living_room',
  ),
  inArea(
    sampleEntity('sensor.full_battery', {
      name: 'Full battery',
      area: 'Living room',
      capabilities: [can('sensor_numeric')],
      state: { sensor_numeric: { value: 20 } },
      deviceClass: 'battery',
    }),
    'living_room',
  ),
  inArea(
    sampleEntity('sensor.living_temperature', {
      name: 'Temperature',
      area: 'Living room',
      capabilities: [can('sensor_numeric')],
      state: { sensor_numeric: { value: 21.4 } },
      deviceClass: 'temperature',
    }),
    'living_room',
    DEVICE,
  ),
  inArea(
    sampleEntity('sensor.living_humidity', {
      name: 'Humidity',
      area: 'Living room',
      capabilities: [can('sensor_numeric')],
      state: { sensor_numeric: { value: 48 } },
      deviceClass: 'humidity',
      isAvailable: false,
    }),
    'living_room',
    DEVICE,
  ),
  inArea(
    sampleEntity('light.ceiling', {
      name: 'Ceiling',
      area: 'Living room',
      capabilities: [can('on_off')],
      state: { on_off: { isOn: true } },
    }),
    'living_room',
  ),
  inArea(
    sampleEntity('light.floor', {
      name: 'Floor lamp',
      area: 'Living room',
      capabilities: [can('on_off')],
      state: { on_off: { isOn: false } },
    }),
    'living_room',
  ),
  inArea(
    sampleEntity('cover.left', {
      name: 'Left blind',
      area: 'Living room',
      capabilities: [can('cover')],
      state: { cover: { position: 100, motion: 'stopped' } },
    }),
    'living_room',
  ),
  inArea(
    sampleEntity('cover.right', {
      name: 'Right blind',
      area: 'Living room',
      capabilities: [can('cover')],
      state: { cover: { position: 25, motion: 'stopped' } },
    }),
    'living_room',
  ),
  inArea(
    sampleEntity('update.hub', {
      name: 'Hub',
      area: null,
      capabilities: [can('update')],
      state: {
        update: {
          installedVersion: '1.0.0',
          latestVersion: '1.1.0',
          isInstalling: false,
          progress: null,
        },
      },
    }),
    'office',
  ),
  inArea(
    sampleEntity('update.bridge', {
      name: 'Bridge',
      area: null,
      capabilities: [can('update')],
      state: {
        update: {
          installedVersion: '2.0.0',
          latestVersion: '2.0.0',
          isInstalling: false,
          progress: null,
        },
      },
    }),
    'office',
  ),
  {
    ...sampleEntity('light.hidden', {
      name: 'Hidden',
      area: null,
      capabilities: [can('on_off')],
      state: { on_off: { isOn: true } },
    }),
    isHidden: true,
  },
];

const SEEN = seenIn(HOUSE, {}, null);

describe('countOf', () => {
  it('counts the doors open, leaving out a motion sensor and one out of reach', () => {
    const count = countOf('openings', SEEN);

    expect(count.found.map((each) => each.entity.name)).toEqual(['Back door']);
    expect(count.total).toBe(2);
  });

  it('counts the batteries under 20 %, the lowest first', () => {
    const count = countOf('batteries', SEEN);

    expect(count.found.map((each) => each.entity.name)).toEqual(['Remote battery', 'Lock battery']);
    expect(count.total).toBe(3);
  });

  it('counts the updates whose latest version is not the one installed', () => {
    expect(countOf('updates', SEEN).found.map((each) => each.entity.name)).toEqual(['Hub']);
  });

  it('counts a device out of reach only when none of its entities answers', () => {
    const count = countOf('offline', SEEN);

    // The cellar door is its own device; the humidity shares a device with a working thermometer.
    expect(count.found.map((each) => each.entity.name)).toEqual(['Cellar door']);
  });

  it('leaves hidden entities out and keeps to the area asked for', () => {
    expect(countOf('lights', SEEN).found).toHaveLength(1);
    expect(countOf('lights', seenIn(HOUSE, {}, 'hallway')).total).toBe(0);
  });
});

describe('roomOf', () => {
  it('reads the climate and the groups of a room', () => {
    const room = roomOf(seenIn(HOUSE, {}, 'living_room'));

    expect(room.temperature).toBe(21.4);
    expect(room.lights).toHaveLength(2);
    expect(averagePosition(room.blinds)).toBe(63);
    // Two entities of one device, and six of none.
    expect(room.devices).toBe(7);
  });
});
