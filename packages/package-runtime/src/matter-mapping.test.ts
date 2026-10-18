import { describe, expect, it } from 'vitest';

import type { CapabilityState, EntityId } from '@nebulahome/contracts';

import type { MappingContext } from './integration.js';
import { createMatterIntegration, matterEntitiesOf, unmappedClustersOf } from './matter-mapping.js';
import {
  deviceSnapshotOf,
  identityOf,
  scopesOf,
  type MatterAttributes,
  type MatterNodeSnapshot,
} from './matter-node.js';

/**
 * A node, from its attributes.
 *
 * @param nodeId - Its id.
 * @param attributes - Its attributes.
 * @returns The node, answering.
 */
function node(nodeId: string, attributes: MatterAttributes): MatterNodeSnapshot {
  return { nodeId, isAvailable: true, attributes };
}

/**
 * The Descriptor of one endpoint.
 *
 * @param endpoint - The endpoint.
 * @param types - Its device types.
 * @param servers - The clusters it serves.
 * @param parts - The endpoints under it.
 * @returns Its attributes.
 */
function descriptor(
  endpoint: number,
  types: readonly number[],
  servers: readonly number[],
  parts: readonly number[] = [],
): MatterAttributes {
  return {
    [`${String(endpoint)}/29/0`]: types.map((type) => ({ '0': type, '1': 1 })),
    [`${String(endpoint)}/29/1`]: servers,
    [`${String(endpoint)}/29/3`]: parts,
  };
}

/** A colour lamp: hue and saturation, colour temperature, firmware updates. */
const lamp = node('1', {
  ...descriptor(0, [22], [29, 40, 42, 51], [1]),
  '0/40/1': 'Signify',
  '0/40/2': 4107,
  '0/40/3': 'Hue color lamp',
  '0/40/4': 7,
  '0/40/5': 'Kitchen',
  '0/40/9': 123,
  '0/40/10': '1.2.3',
  '0/40/15': 'SN1',
  '0/40/18': 'U1',
  '0/42/2': 1,
  '0/51/0': [{ '0': 'wlan0', '4': Buffer.from([0xaa, 0xbb, 0xcc, 1, 2, 3]).toString('base64') }],
  ...descriptor(1, [269], [3, 4, 6, 8, 29, 768]),
  '1/6/0': true,
  '1/8/0': 127,
  '1/768/0': 127,
  '1/768/1': 254,
  '1/768/7': 370,
  '1/768/65532': 17,
  '1/768/16395': 153,
  '1/768/16396': 500,
});

/** A plug that measures power and counts energy. */
const plug = node('2', {
  ...descriptor(0, [22], [29, 40], [1]),
  ...descriptor(1, [266], [6, 29, 144, 145, 1234]),
  '1/6/0': false,
  '1/144/4': 230_000,
  '1/144/8': 12_500,
  '1/145/1': { '0': 1_500_000 },
});

/** A door sensor on a battery. */
const door = node('3', {
  ...descriptor(0, [22], [29, 40], [1]),
  ...descriptor(1, [21], [29, 47, 69]),
  '1/69/0': true,
  '1/47/12': 150,
});

/** A bridge with two lamps behind it, the second one out of reach. */
const bridge = node('4', {
  ...descriptor(0, [22], [29, 40], [1, 2, 3]),
  '0/40/3': 'Bridge',
  ...descriptor(1, [14], [29], [2, 3]),
  ...descriptor(2, [19, 256], [6, 29, 57]),
  '2/57/1': 'IKEA',
  '2/57/5': 'Lamp A',
  '2/57/17': true,
  '2/6/0': true,
  ...descriptor(3, [19, 256], [6, 29, 57]),
  '3/57/5': 'Lamp B',
  '3/57/17': false,
  '3/6/0': false,
});

/** Two relays in one device. */
const relays = node('5', {
  ...descriptor(0, [22], [29, 40], [1, 2]),
  ...descriptor(1, [266], [6, 29]),
  '1/6/0': true,
  ...descriptor(2, [266], [6, 29]),
  '2/6/0': false,
});

/**
 * The node itself, as one device.
 *
 * @param of - The node.
 * @returns Its own device.
 */
function own(of: MatterNodeSnapshot) {
  const [scope] = scopesOf(of.attributes);

  return deviceSnapshotOf(of, scope ?? { endpoint: null, endpoints: [] });
}

/**
 * A mapping context for a device described.
 *
 * @param device - The device.
 * @param last - The last states, by entity id.
 * @returns The context, entity ids composed as the hub does.
 */
function contextOf(
  device: ReturnType<typeof own>,
  last: Readonly<Record<string, CapabilityState>> = {},
): MappingContext {
  const entities = new Map<string, EntityId>(
    matterEntitiesOf(device).map((entity) => [
      entity.objectId,
      `${entity.descriptor.domain}.dev_${entity.objectId}` as EntityId,
    ]),
  );

  return {
    options: {},
    claim: { deviceKey: device.nodeId, externalId: device.nodeId, descriptor: device },
    entities,
    lastState: (entityId) => last[entityId],
  };
}

describe('the Matter node', () => {
  it('says who a device is, its addresses and what it serves', () => {
    const identity = identityOf(lamp, { endpoint: null, endpoints: [0, 1] });

    expect(identity).toMatchObject({
      nodeId: '1',
      endpoint: null,
      vendorId: 4107,
      vendorName: 'Signify',
      productId: 7,
      productName: 'Hue color lamp',
      nodeLabel: 'Kitchen',
      serialNumber: 'SN1',
      softwareVersion: 123,
      softwareVersionString: '1.2.3',
      macAddresses: ['aa:bb:cc:01:02:03'],
      isBridge: false,
      isBridged: false,
    });
    expect(identity.deviceTypes).toEqual([22, 269]);
    expect(identity.clusters).toContain(768);
  });

  it('makes a device of each endpoint behind a bridge, its own names and reach', () => {
    const scopes = scopesOf(bridge.attributes);

    expect(scopes).toEqual([
      { endpoint: null, endpoints: [0, 1] },
      { endpoint: 2, endpoints: [2] },
      { endpoint: 3, endpoints: [3] },
    ]);

    const [, first, second] = scopes.map((scope) => deviceSnapshotOf(bridge, scope));

    expect(first?.identity).toMatchObject({
      nodeLabel: 'Lamp A',
      vendorName: 'IKEA',
      isBridged: true,
    });
    expect(first?.isAvailable).toBe(true);
    expect(second?.isAvailable).toBe(false);
    expect(own(bridge).identity.isBridge).toBe(true);
  });
});

describe('the Matter mapping', () => {
  it('maps a colour lamp onto one light and its firmware', () => {
    const entities = matterEntitiesOf(own(lamp));

    expect(entities.map((entity) => entity.descriptor)).toEqual([
      expect.objectContaining({
        objectId: 'light',
        domain: 'light',
        capabilities: {
          on_off: { hasTransition: false },
          level: { hasTransition: true },
          color_hs: { hasTransition: true },
          color_temp: { minMireds: 153, maxMireds: 500, hasTransition: true },
        },
      }),
      expect.objectContaining({ objectId: 'firmware', domain: 'update' }),
    ]);
    expect(entities[0]?.stateOf(lamp.attributes, undefined)).toEqual({
      on_off: { isOn: true },
      level: { level: 50 },
      color_hs: { hue: 180, saturation: 100 },
      color_temp: { mireds: 370 },
    });
    expect(
      entities[1]?.stateOf(lamp.attributes, {
        softwareVersion: 124,
        softwareVersionString: '1.2.4',
      }),
    ).toEqual({
      update: {
        installedVersion: '1.2.3',
        latestVersion: '1.2.4',
        isInstalling: false,
        progress: null,
      },
    });
  });

  it('maps a plug onto a switch and its measurements in the units the platform keeps', () => {
    const entities = matterEntitiesOf(own(plug));

    expect(entities.map((entity) => entity.objectId)).toEqual([
      'switch',
      'power',
      'voltage',
      'energy',
    ]);
    expect(
      entities.map((entity) => [
        entity.descriptor.unitOfMeasurement,
        entity.stateOf(plug.attributes, undefined),
      ]),
    ).toEqual([
      [undefined, { on_off: { isOn: false } }],
      ['W', { sensor_numeric: { value: 12.5 } }],
      ['V', { sensor_numeric: { value: 230 } }],
      ['Wh', { sensor_numeric: { value: 1500 } }],
    ]);
    expect(unmappedClustersOf(own(plug))).toEqual([1234]);
  });

  it('reads a contact sensor as a door that is on when open, and its battery', () => {
    const entities = matterEntitiesOf(own(door));
    const contact = entities.find((entity) => entity.objectId === 'contact');
    const battery = entities.find((entity) => entity.objectId === 'battery');

    expect(contact?.descriptor).toMatchObject({ objectId: 'contact', domain: 'binary_sensor' });
    expect(contact?.stateOf(door.attributes, undefined)).toEqual({
      sensor_binary: { isOn: false },
    });
    expect(battery?.stateOf(door.attributes, undefined)).toEqual({ sensor_numeric: { value: 75 } });
  });

  it('numbers the entities of a kind on more than one endpoint', () => {
    expect(
      matterEntitiesOf(own(relays)).map((entity) => [entity.objectId, entity.descriptor.name]),
    ).toEqual([
      ['switch_1', 'Switch 1'],
      ['switch_2', 'Switch 2'],
    ]);
  });
});

describe('the Matter driver', () => {
  const driver = createMatterIntegration({ id: 'matter/generic' });

  it('claims a device as its node, or its node and endpoint behind a bridge', () => {
    const behind = deviceSnapshotOf(bridge, { endpoint: 2, endpoints: [2] });

    expect(driver.claim({ deviceKey: '1', payload: own(lamp) }, {})?.externalId).toBe('1');
    expect(driver.claim({ deviceKey: '4:2', payload: behind }, {})?.externalId).toBe('4:2');
    expect(driver.claim({ deviceKey: 'x', payload: { nothing: true } }, {})).toBeNull();

    const described = driver.describe(
      { deviceKey: '4:2', externalId: '4:2', descriptor: behind },
      {},
    );

    expect(described).toMatchObject({ name: 'Lamp A', manufacturer: 'IKEA', viaExternalId: '4' });
  });

  it('reports only the entities what changed is about', () => {
    const device = own(plug);
    const reports = driver.toState(
      {
        connectionKey: 'matter',
        deviceKey: '2',
        payload: { device, changed: ['1/144/8'] },
      },
      contextOf(device),
    );

    expect(reports).toEqual([
      {
        entityId: 'sensor.dev_power',
        state: { sensor_numeric: { value: 12.5 } },
        attributes: {},
        isAvailable: true,
      },
    ]);
  });

  it('turns commands into the cluster commands and writes Matter takes', () => {
    const device = own(lamp);
    const context = contextOf(device);

    expect(
      driver.toCommand(
        {
          entityId: 'light.dev_light' as EntityId,
          capability: 'level',
          command: { command: 'set_level', level: 50, transitionMs: 1000 },
        },
        context,
      ),
    ).toEqual({
      deviceKey: '1',
      op: 'invoke',
      args: {
        endpoint: 1,
        cluster: 8,
        command: 'moveToLevelWithOnOff',
        payload: { level: 127, transitionTime: 10, optionsMask: 0, optionsOverride: 0 },
      },
    });
    expect(
      driver.toCommand(
        {
          entityId: 'light.dev_light' as EntityId,
          capability: 'level',
          command: { command: 'set_level', level: 0 },
        },
        context,
      ).args,
    ).toMatchObject({ cluster: 6, command: 'off' });
    expect(() =>
      driver.toCommand(
        {
          entityId: 'light.dev_light' as EntityId,
          capability: 'cover',
          command: { command: 'open' },
        },
        context,
      ),
    ).toThrow(/does not take/u);
  });

  it('writes a thermostat setpoint for the mode it is in, and opens a cover by how closed it is', () => {
    const climate = node('6', {
      ...descriptor(0, [22], [29, 40], [1]),
      ...descriptor(1, [769], [29, 258, 513]),
      '1/513/0': 2050,
      '1/513/18': 2100,
      '1/513/28': 4,
      '1/513/65532': 1,
      '1/258/14': 2500,
      '1/258/10': 0,
      '1/258/65532': 5,
    });
    const device = own(climate);
    const context = contextOf(device, {
      'climate.dev_thermostat': {
        thermostat: {
          currentTemperature: 20.5,
          targetTemperature: 21,
          mode: 'heat',
          action: 'idle',
        },
      },
    });
    const [cover, thermostat] = matterEntitiesOf(device);

    expect(cover?.stateOf(climate.attributes, undefined)).toEqual({
      cover: { position: 75, motion: 'stopped' },
    });
    expect(thermostat?.stateOf(climate.attributes, undefined)).toEqual({
      thermostat: { currentTemperature: 20.5, targetTemperature: 21, mode: 'heat', action: 'idle' },
    });
    expect(
      driver.toCommand(
        {
          entityId: 'climate.dev_thermostat' as EntityId,
          capability: 'thermostat',
          command: { command: 'set_target', temperature: 21.5 },
        },
        context,
      ).args,
    ).toEqual({ endpoint: 1, cluster: 513, attribute: 18, value: 2150 });
    expect(
      driver.toCommand(
        {
          entityId: 'cover.dev_cover' as EntityId,
          capability: 'cover',
          command: { command: 'set_position', position: 30 },
        },
        context,
      ).args,
    ).toMatchObject({ command: 'goToLiftPercentage', payload: { liftPercent100thsValue: 7000 } });
  });
});
