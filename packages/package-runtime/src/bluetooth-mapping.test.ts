/**
 * A BTHome sensor as a device: its entities from the advertisement it was recognised by, in the
 * platform's classes and canonical units, and its reports from every advertisement after.
 */
import { describe, expect, it } from 'vitest';

import { formatEntityId } from '@nebulahome/contracts';

import { createBthomeIntegration, type BluetoothDeviceSnapshot } from './bluetooth-mapping.js';
import type { MappingContext } from './integration.js';

const ADDRESS = '7C:C6:B6:61:2A:10';

/** When every advertisement here was heard. */
const HEARD_AT = new Date('2026-10-27T10:00:00.000Z');

/**
 * An advertisement of the sensor.
 *
 * @param bthome - Its BTHome service data.
 * @returns The advertisement.
 */
function advertOf(bthome: string): BluetoothDeviceSnapshot['advert'] {
  return {
    address: ADDRESS,
    addressType: 'public',
    rssi: -71,
    name: 'SBHT-003C',
    serviceData: { fcd2: bthome },
    at: HEARD_AT,
  };
}

/** A Shelly BLU H&T with a pressure sensor and two buttons, as the broker hands it over. */
const device: BluetoothDeviceSnapshot = {
  deviceKey: ADDRESS,
  kind: 'bluetooth/bthome',
  name: 'Bedroom H&T',
  advert: advertOf('4000a2016404a08601452d003a003a00'),
};

const integration = createBthomeIntegration({ id: 'bluetooth/bthome' });

/**
 * The context the hub hands a mapper of the sensor.
 *
 * @returns The context, each reading given an entity.
 */
function contextOf(): MappingContext {
  return {
    options: {},
    claim: { deviceKey: ADDRESS, externalId: ADDRESS, descriptor: device },
    entities: new Map([
      ['battery', formatEntityId('sensor', 'h_t_battery')],
      ['pressure', formatEntityId('sensor', 'h_t_pressure')],
      ['temperature', formatEntityId('sensor', 'h_t_temperature')],
      ['button', formatEntityId('event', 'h_t_button')],
      ['button_2', formatEntityId('event', 'h_t_button_2')],
    ]),
    lastState: () => undefined,
  };
}

describe('createBthomeIntegration', () => {
  it('claims the devices of its own kind, and follows their addresses', () => {
    const claim = integration.claim({ deviceKey: ADDRESS, payload: device }, {});

    expect(claim).toEqual({ deviceKey: ADDRESS, externalId: ADDRESS, descriptor: device });
    expect(
      integration.claim({ deviceKey: ADDRESS, payload: { ...device, kind: 'acme/tag' } }, {}),
    ).toBeNull();
    expect(integration.subscriptions(claim === null ? [] : [claim], {})).toEqual([
      { op: 'follow', args: { address: ADDRESS } },
    ]);
  });

  it('describes an entity per reading, in its class and canonical unit, a second key numbered', () => {
    const button = {
      domain: 'event',
      capabilities: {
        event: {
          eventTypes: [
            'press',
            'double_press',
            'triple_press',
            'long_press',
            'long_double_press',
            'long_triple_press',
            'hold_press',
          ],
        },
      },
      deviceClass: 'button',
    };
    const claim = integration.claim({ deviceKey: ADDRESS, payload: device }, {});

    expect(claim === null ? null : integration.describe(claim, {})).toEqual({
      externalId: ADDRESS,
      name: 'Bedroom H&T',
      model: 'SBHT-003C',
      entities: [
        {
          domain: 'sensor',
          objectId: 'battery',
          name: 'Battery',
          capabilities: { sensor_numeric: {} },
          unitOfMeasurement: '%',
          deviceClass: 'battery',
          stateClass: 'measurement',
          displayPrecision: 0,
        },
        {
          domain: 'sensor',
          objectId: 'pressure',
          name: 'Pressure',
          capabilities: { sensor_numeric: {} },
          unitOfMeasurement: 'Pa',
          deviceClass: 'atmospheric_pressure',
          stateClass: 'measurement',
        },
        {
          domain: 'sensor',
          objectId: 'temperature',
          name: 'Temperature',
          capabilities: { sensor_numeric: {} },
          unitOfMeasurement: '°C',
          deviceClass: 'temperature',
          stateClass: 'measurement',
          displayPrecision: 1,
        },
        { ...button, objectId: 'button', name: 'Button' },
        { ...button, objectId: 'button_2', name: 'Button 2' },
      ],
    });
  });

  it('reports each reading of an advertisement, converted, and an event only when one happened', () => {
    const reports = integration.toState(
      {
        connectionKey: 'bluetooth',
        deviceKey: ADDRESS,
        payload: advertOf('4000a3016304a08601452d003a003a02'),
      },
      contextOf(),
    );

    expect(reports).toEqual([
      {
        entityId: 'sensor.h_t_battery',
        state: { sensor_numeric: { value: 99 } },
        attributes: {},
        isAvailable: true,
        observedAt: HEARD_AT,
      },
      {
        entityId: 'sensor.h_t_pressure',
        state: { sensor_numeric: { value: 100_000 } },
        attributes: {},
        isAvailable: true,
        observedAt: HEARD_AT,
      },
      {
        entityId: 'sensor.h_t_temperature',
        state: { sensor_numeric: { value: 4.5 } },
        attributes: {},
        isAvailable: true,
        observedAt: HEARD_AT,
      },
      {
        entityId: 'event.h_t_button_2',
        state: { event: { eventType: 'double_press', at: '2026-10-27T10:00:00.000Z' } },
        attributes: {},
        isAvailable: true,
        observedAt: HEARD_AT,
      },
    ]);
  });

  it('reports an event once however many times its packet is sent, and the next packet again', () => {
    const bthome = createBthomeIntegration({ id: 'bluetooth/bthome' });
    /**
     * The event entities' reports of an advertisement.
     *
     * @param data - Its BTHome service data.
     * @returns Them.
     */
    const events = (data: string) =>
      bthome
        .toState(
          { connectionKey: 'bluetooth', deviceKey: ADDRESS, payload: advertOf(data) },
          contextOf(),
        )
        .filter((report) => 'event' in report.state);

    expect(events('4000a43a01')).toHaveLength(1);
    expect(events('4000a43a01')).toEqual([]);
    expect(events('4000a53a01')).toHaveLength(1);
  });

  it('reads nothing of an encrypted or foreign advertisement, and takes no command', () => {
    const context = contextOf();

    expect(
      integration.toState(
        { connectionKey: 'bluetooth', deviceKey: ADDRESS, payload: advertOf('41a1b2c3d4') },
        context,
      ),
    ).toEqual([]);
    expect(
      integration.toState({ connectionKey: 'bluetooth', deviceKey: ADDRESS, payload: 42 }, context),
    ).toEqual([]);
    expect(() =>
      integration.toCommand(
        {
          entityId: formatEntityId('sensor', 'h_t_battery'),
          capability: 'sensor_numeric',
          command: {},
        },
        context,
      ),
    ).toThrow('takes no commands');
  });
});
