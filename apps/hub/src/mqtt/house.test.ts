/**
 * The house's devices, without a broker.
 */
import { describe, expect, it } from 'vitest';

import type { MqttAnnouncedDevice, MqttEntity } from '@nebulahome/package-runtime';

import { MqttHouse } from './house.js';

/**
 * A device.
 *
 * @param id - Its id.
 * @returns It.
 */
function device(id: string): MqttAnnouncedDevice {
  return { id, name: `Device ${id}`, identifiers: [id], macAddresses: [] };
}

/**
 * A sensor entity.
 *
 * @param key - Its key.
 * @param deviceId - The device it belongs to.
 * @returns It.
 */
function sensor(key: string, deviceId: string): MqttEntity {
  return {
    key,
    origin: 'discovery',
    component: 'sensor',
    name: key,
    objectId: key,
    device: device(deviceId),
    config: { state_topic: `state/${key}` },
  };
}

describe('MqttHouse', () => {
  it('reads one device in the order its entities are held, an entity moved to it included', () => {
    // Who a device is comes from its first entity: the index must keep the order a scan would.
    const house = new MqttHouse();
    const none = (): undefined => undefined;

    house.put(sensor('a', 'one'), undefined, none);
    house.put(sensor('b', 'two'), undefined, none);
    house.put(sensor('c', 'two'), undefined, none);
    house.put(sensor('a', 'two'), undefined, none);

    expect(house.device('one')).toBeUndefined();
    expect(house.device('two')?.entities.map((each) => each.key)).toEqual(['a', 'b', 'c']);
    expect(house.devices().map((each) => each.deviceKey)).toEqual(['two']);

    house.remove('a');

    expect(house.device('two')?.entities.map((each) => each.key)).toEqual(['b', 'c']);

    house.retain('discovery', new Set());

    expect(house.device('two')).toBeUndefined();
  });
});
