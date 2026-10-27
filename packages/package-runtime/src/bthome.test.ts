/**
 * BTHome v2 service data as sensors send it: a Shelly BLU H&T, a button press, a window sensor,
 * several of one object, an encrypted packet and an object id nobody knows.
 */
import { describe, expect, it } from 'vitest';

import { decodeBthome } from './bthome.js';

describe('decodeBthome', () => {
  it('reads a Shelly BLU H&T: packet id, battery, humidity, temperature, its idle button', () => {
    // 0x40: v2, plain, regular; 0x00 162; 0x01 100 %; 0x2E 61 %; 0x45 195 × 0.1 °C; 0x3A none.
    expect(decodeBthome('4000a201642e3d45c3003a00')).toEqual({
      isEncrypted: false,
      isTriggerBased: false,
      packetId: 162,
      readings: [
        {
          key: 'battery',
          name: 'Battery',
          kind: 'number',
          value: 100,
          unit: '%',
          decimals: 0,
          deviceClass: 'battery',
        },
        {
          key: 'humidity',
          name: 'Humidity',
          kind: 'number',
          value: 61,
          unit: '%',
          decimals: 0,
          deviceClass: 'humidity',
        },
        {
          key: 'temperature',
          name: 'Temperature',
          kind: 'number',
          value: 19.5,
          unit: '°C',
          decimals: 1,
          deviceClass: 'temperature',
        },
        { key: 'button', name: 'Button', kind: 'event', value: 'none' },
      ],
    });
  });

  it('reads signed values below zero, and hundredths', () => {
    const packet = decodeBthome('4002bbfe45cbff03b80b');

    expect(
      packet?.isEncrypted === false ? packet.readings.map((each) => each.value) : null,
    ).toEqual([-3.25, -5.3, 30]);
  });

  it('reads a button press from a trigger-based device', () => {
    const packet = decodeBthome('44000b015a3a01');

    expect(packet).toMatchObject({ isTriggerBased: true, packetId: 11 });
    expect(packet?.isEncrypted === false ? packet.readings.at(-1)?.value : null).toBe('press');
  });

  it('reads a window sensor: illuminance, open, rotated', () => {
    const packet = decodeBthome('44001c016405a086012d013f8403');

    expect(
      packet?.isEncrypted === false
        ? packet.readings.map(({ key, value, deviceClass }) => ({ key, value, deviceClass }))
        : null,
    ).toEqual([
      { key: 'battery', value: 100, deviceClass: 'battery' },
      { key: 'illuminance', value: 1000, deviceClass: 'illuminance' },
      { key: 'window', value: true, deviceClass: 'window' },
      { key: 'rotation', value: 90, deviceClass: undefined },
    ]);
  });

  it('reads every one of several objects of one id, and a dimmer turned', () => {
    const buttons = decodeBthome('44000c3a013a003a043a80');
    const dimmer = decodeBthome('403c0203');

    expect(
      buttons?.isEncrypted === false ? buttons.readings.map((each) => each.value) : null,
    ).toEqual(['press', 'none', 'long_press', 'hold_press']);
    expect(dimmer?.isEncrypted === false ? dimmer.readings : null).toEqual([
      { key: 'dimmer', name: 'Dimmer', kind: 'event', value: 'rotate_right', steps: 3 },
    ]);
  });

  it('stops at an object id it does not know, with what it read before', () => {
    const packet = decodeBthome('400164ff123402c409');

    expect(packet?.isEncrypted === false ? packet.readings.map((each) => each.key) : null).toEqual([
      'battery',
    ]);
  });

  it('says an encrypted packet is one, and reads nothing of it', () => {
    expect(decodeBthome('41a1b2c3d4e5f60708090a0b0c')).toEqual({
      isEncrypted: true,
      isTriggerBased: false,
    });
  });

  it('is null for what is not BTHome v2', () => {
    expect(decodeBthome('020164')).toBeNull();
    expect(decodeBthome('')).toBeNull();
    expect(decodeBthome('4g')).toBeNull();
  });
});
