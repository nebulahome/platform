import { describe, expect, it } from 'vitest';

import { wsServerMessageSchema } from './api-ws.js';
import {
  deviceEventSchema,
  registerDeviceRequestSchema,
  unregisterDeviceReplySchema,
  unregisterDeviceRequestSchema,
} from './registration.js';

/**
 * A registration with every required field present, for tests that vary one of them.
 *
 * @returns The request, as `hub` would send it.
 */
function request(): Record<string, unknown> {
  return {
    integrationId: 'shelly-lab',
    externalId: 'shellyplus1-aabbcc',
    entities: [{ entityId: 'switch.lab_relay', name: 'Lab relay', capabilities: { on_off: {} } }],
  };
}

describe('registerDeviceRequestSchema', () => {
  it('accepts a device with one entity that declares one capability', () => {
    const parsed = registerDeviceRequestSchema.parse(request());

    expect(parsed.entities[0]?.capabilities).toEqual({ on_off: {} });
  });

  it('refuses a device that registers no entity', () => {
    // `core` would write a device row nothing points at, and the interface would show a device
    // that does nothing and cannot be explained.
    expect(registerDeviceRequestSchema.safeParse({ ...request(), entities: [] }).success).toBe(
      false,
    );
  });

  it('refuses an entity that declares no capability', () => {
    // Capabilities are what `core` validates a command against and what the interface renders.
    // An entity with none can neither be commanded nor shown.
    const entities = [{ entityId: 'switch.lab_relay', name: 'Lab relay', capabilities: {} }];

    expect(registerDeviceRequestSchema.safeParse({ ...request(), entities }).success).toBe(false);
  });

  it('refuses an unknown capability rather than storing it', () => {
    // `registry.entity_capabilities` has a CHECK listing the known capabilities, so an unknown
    // one fails the insert. Failing here names the capability instead of the constraint.
    const entities = [
      { entityId: 'switch.lab_relay', name: 'Lab relay', capabilities: { teleport: {} } },
    ];

    expect(registerDeviceRequestSchema.safeParse({ ...request(), entities }).success).toBe(false);
  });

  it('takes an icon only as a catalogue id, the same alphabet a device icon uses', () => {
    const [entity] = request()['entities'] as Record<string, unknown>[];

    expect(
      registerDeviceRequestSchema.parse({ ...request(), entities: [{ ...entity, icon: 'relay' }] })
        .entities[0]?.icon,
    ).toBe('relay');
    expect(
      registerDeviceRequestSchema.safeParse({
        ...request(),
        entities: [{ ...entity, icon: 'Not An Id' }],
      }).success,
    ).toBe(false);
  });

  it('carries no name: the row the API created already has the one the owner chose', () => {
    // Identification completes a device, it does not describe one. A name here would be the
    // hardware's idea of itself overwriting what the owner typed a minute ago.
    const parsed = registerDeviceRequestSchema.parse(request());

    expect('name' in parsed).toBe(false);
    expect(
      registerDeviceRequestSchema.safeParse({ ...request(), name: 'From the firmware' }).success,
    ).toBe(false);
  });
});

describe('capability parameters', () => {
  it('refuses parameters a capability cannot accept', () => {
    // `color_temp` requires the bulb's mired range: `core` validates a set_color_temp against
    // it before dispatching. Params accepted here but incomplete would surface much later, as
    // a command rejected for a reason the owner cannot act on.
    const entities = [
      { entityId: 'light.lab', name: 'Lab light', capabilities: { color_temp: {} } },
    ];

    expect(registerDeviceRequestSchema.safeParse({ ...request(), entities }).success).toBe(false);
  });

  it('accepts parameters that match the capability', () => {
    const entities = [
      {
        entityId: 'light.lab',
        name: 'Lab light',
        capabilities: { color_temp: { minMireds: 153, maxMireds: 500 } },
      },
    ];

    expect(registerDeviceRequestSchema.safeParse({ ...request(), entities }).success).toBe(true);
  });
});

describe('sensor class registration', () => {
  it('refuses a unit that does not belong to the catalogue class', () => {
    const entities = [
      {
        entityId: 'sensor.lab_current',
        name: 'Current',
        capabilities: { sensor_numeric: {} },
        deviceClass: 'current',
        unitOfMeasurement: 'lx',
      },
    ];

    expect(registerDeviceRequestSchema.safeParse({ ...request(), entities }).success).toBe(false);
  });

  it('refuses a native unit when the entity must carry the canonical', () => {
    // `describe` converts and registers amperes; a hub that still sent milliamps would disagree
    // with the number it publishes.
    const entities = [
      {
        entityId: 'sensor.lab_current',
        name: 'Current',
        capabilities: { sensor_numeric: {} },
        deviceClass: 'current',
        unitOfMeasurement: 'mA',
      },
    ];

    expect(registerDeviceRequestSchema.safeParse({ ...request(), entities }).success).toBe(false);
  });

  it('fills stateClass from the catalogue default when the profile omits it', () => {
    const entities = [
      {
        entityId: 'sensor.lab_energy',
        name: 'Energy',
        capabilities: { sensor_numeric: {} },
        deviceClass: 'energy',
        unitOfMeasurement: 'Wh',
      },
    ];

    expect(
      registerDeviceRequestSchema.parse({ ...request(), entities }).entities[0]?.stateClass,
    ).toBe('total_increasing');
  });

  it('lets binary and classless sensors through without a catalogue unit', () => {
    expect(
      registerDeviceRequestSchema.safeParse({
        ...request(),
        entities: [
          {
            entityId: 'binary_sensor.lab_printing',
            name: 'Printing',
            capabilities: { sensor_binary: {} },
            deviceClass: 'running',
          },
        ],
      }).success,
    ).toBe(true);

    expect(
      registerDeviceRequestSchema.safeParse({
        ...request(),
        entities: [
          {
            entityId: 'sensor.lab_progress',
            name: 'Progress',
            capabilities: { sensor_numeric: {} },
            unitOfMeasurement: '%',
            stateClass: 'measurement',
          },
        ],
      }).success,
    ).toBe(true);
  });
});

describe('unregisterDeviceRequestSchema', () => {
  it('names the instance to release, and nothing else', () => {
    // Strict, like registering: what to delete is the id and only the id. A request that also
    // carried, say, a list of entities would invite the caller to think it chooses which go.
    expect(unregisterDeviceRequestSchema.parse({ integrationId: 'shelly-lab' })).toEqual({
      integrationId: 'shelly-lab',
    });
    expect(
      unregisterDeviceRequestSchema.safeParse({ integrationId: 'shelly-lab', entityIds: [] })
        .success,
    ).toBe(false);
  });

  it('answers with what went: the device row, if any, and every entity', () => {
    const reply = unregisterDeviceReplySchema.parse({
      deviceId: '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f',
      entityIds: ['switch.lab_relay'],
    });

    expect(reply.entityIds).toEqual(['switch.lab_relay']);
    expect(
      unregisterDeviceReplySchema.parse({ deviceId: null, entityIds: [] }).deviceId,
    ).toBeNull();
  });
});

describe('deviceEventSchema', () => {
  it('is what the WebSocket message carries, without a second definition of it', () => {
    // `api` forwards these straight to a browser. Two independent shapes for one payload drift
    // the first time a field is added to whichever half the author had open.
    const payload = {
      deviceId: 'shelly-lab',
      source: 'shelly-lab',
      name: 'Lab relay',
      entityIds: ['switch.lab_relay'],
    };

    const onTheBus = deviceEventSchema.parse(payload);
    const overTheSocket = wsServerMessageSchema.parse({
      type: 'device_event',
      event: 'added',
      payload,
    });

    expect(overTheSocket).toMatchObject({ payload: onTheBus });
  });

  it('refuses to send a browser something that is not a device event', () => {
    const result = wsServerMessageSchema.safeParse({
      type: 'device_event',
      event: 'added',
      payload: { anything: true },
    });

    expect(result.success).toBe(false);
  });

  it('names the owner in a form core can route to', () => {
    // `source` is the subject token a command goes out on. An event naming an owner that could
    // not be addressed would describe a device nobody can control.
    const result = deviceEventSchema.safeParse({
      deviceId: 'shelly-lab',
      source: 'Not A Source',
      name: 'Lab relay',
      entityIds: [],
    });

    expect(result.success).toBe(false);
  });

  it('names the device by its public id, the one the interface lists it under', () => {
    // A browser hearing about a device matches it against the devices it already shows, and
    // those are listed under the instance id - the same shape a source has, not a row uuid.
    expect(
      deviceEventSchema.safeParse({
        deviceId: 'Not An Id',
        source: 'shelly-lab',
        name: 'Lab relay',
        entityIds: [],
      }).success,
    ).toBe(false);
  });
});
