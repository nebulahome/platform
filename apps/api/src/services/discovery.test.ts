/**
 * What adopting a discovered device adds, decided before anything is written.
 */
import { describe, expect, it } from 'vitest';

import {
  discoveredDeviceSchema,
  discoveryAdoptSchema,
  ValidationError,
  type DiscoveredDevice,
} from '@nebulahome/contracts';

import { adoptionOf } from './discovery.js';

/**
 * A printer discovery heard, varied by the test.
 *
 * @param change - What to change.
 * @returns The candidate, as the hub lists it.
 */
function candidate(change: Record<string, unknown> = {}): DiscoveredDevice {
  return discoveredDeviceSchema.parse({
    id: '0123456789abcdef',
    vendorId: 'bambu-lab',
    driverId: 'printer',
    kind: 'bambu-lab/printer',
    source: 'mdns',
    address: '192.168.1.70',
    externalId: '01P00A000000001',
    name: 'Workshop',
    model: 'X1C',
    modelChoices: ['X1C'],
    modelCode: 'BL-P001',
    swVersion: null,
    transportConfig: { url: 'mqtts://192.168.1.70:8883' },
    firstSeenAt: '2026-09-23T10:00:00.000Z',
    lastSeenAt: '2026-09-23T10:00:00.000Z',
    ...change,
  });
}

describe('adoptionOf', () => {
  it('adds the driver and the model the device said, under the name the owner gave', () => {
    const adoption = adoptionOf(
      candidate(),
      discoveryAdoptSchema.parse({
        id: 'bambu-lab-workshop',
        name: 'Workshop printer',
        icon: 'printer',
        transportConfig: { password: '12345678' },
      }),
    );

    expect(adoption.create).toEqual({
      id: 'bambu-lab-workshop',
      kind: 'bambu-lab/printer',
      model: 'X1C',
      name: 'Workshop printer',
      icon: 'printer',
      transportConfig: { password: '12345678', url: 'mqtts://192.168.1.70:8883' },
      options: {},
      isEnabled: true,
      tagIds: [],
    });
    expect(adoption.expectedExternalId).toBe('01P00A000000001');
  });

  it('keeps the address the device announced, whatever the body says', () => {
    // A client adopting a device at one address and pointing it at another would be adding a
    // device by hand while calling it adoption.
    const adoption = adoptionOf(
      candidate(),
      discoveryAdoptSchema.parse({
        id: 'bambu-lab-workshop',
        name: 'Workshop',
        transportConfig: { url: 'mqtts://10.0.0.9:8883', password: '12345678' },
      }),
    );

    expect(adoption.create.transportConfig['url']).toBe('mqtts://192.168.1.70:8883');
  });

  it('takes the model the owner picked from a family the device named', () => {
    const adoption = adoptionOf(
      candidate({ model: null, modelChoices: ['X1C', 'P1S'] }),
      discoveryAdoptSchema.parse({ id: 'printer', name: 'Printer', model: 'P1S' }),
    );

    expect(adoption.create.model).toBe('P1S');
  });

  it('asks for a pick when the device named a family and the owner picked nothing', () => {
    expect(() =>
      adoptionOf(
        candidate({ model: null, modelChoices: ['X1C', 'P1S'] }),
        discoveryAdoptSchema.parse({ id: 'printer', name: 'Printer' }),
      ),
    ).toThrow(ValidationError);
  });

  it('refuses a model outside what the device could be', () => {
    expect(() =>
      adoptionOf(
        candidate(),
        discoveryAdoptSchema.parse({ id: 'printer', name: 'Printer', model: 'A1 mini' }),
      ),
    ).toThrow(ValidationError);
  });

  it('expects no particular device when the device keeps its id until it is set up', () => {
    const adoption = adoptionOf(
      candidate({ externalId: null }),
      discoveryAdoptSchema.parse({ id: 'printer', name: 'Printer' }),
    );

    expect(adoption.expectedExternalId).toBeNull();
  });
});
