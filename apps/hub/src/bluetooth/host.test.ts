import { describe, expect, it } from 'vitest';

import { advertOf, chipOf, shortUuid } from './host.js';

/**
 * Bytes as BlueZ hands them over inside a dictionary: a variant around a buffer.
 *
 * @param hex - The bytes.
 * @returns The variant, as far as the host reads it.
 */
function bytes(hex: string): { readonly value: Buffer } {
  return { value: Buffer.from(hex, 'hex') };
}

describe('shortUuid', () => {
  it('shortens UUIDs on the Bluetooth base, keeps others, and writes them lower case', () => {
    expect(shortUuid('0000FCD2-0000-1000-8000-00805F9B34FB')).toBe('fcd2');
    expect(shortUuid('0000fe95-0000-1000-8000-00805f9b34fb')).toBe('fe95');
    expect(shortUuid('12345678-0000-1000-8000-00805f9b34fb')).toBe('12345678');
    expect(shortUuid('6E400001-B5A3-F393-E0A9-E50E24DCCA9E')).toBe(
      '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    );
    expect(shortUuid('FCD2')).toBe('fcd2');
  });
});

describe('advertOf', () => {
  it('turns a device object into the contracts’ advertisement', () => {
    const at = new Date('2026-10-27T20:00:00Z');

    expect(
      advertOf(
        {
          Address: 'a4:c1:38:0b:5e:ed',
          AddressType: 'public',
          RSSI: -67,
          Name: 'ATC_0B5EED',
          ManufacturerData: { 76: bytes('0215AABB') },
          ServiceData: { '0000fcd2-0000-1000-8000-00805f9b34fb': bytes('40020CA8') },
          UUIDs: ['0000181A-0000-1000-8000-00805f9b34fb'],
        },
        at,
      ),
    ).toEqual({
      address: 'A4:C1:38:0B:5E:ED',
      addressType: 'public',
      rssi: -67,
      name: 'ATC_0B5EED',
      manufacturerData: { 76: '0215aabb' },
      serviceData: { fcd2: '40020ca8' },
      serviceUuids: ['181a'],
      at,
    });
  });

  it('has nothing while BlueZ holds no signal for a device it remembers', () => {
    expect(advertOf({ Address: 'A4:C1:38:0B:5E:ED', AddressType: 'random' }, new Date())).toBe(
      null,
    );
  });
});

describe('chipOf', () => {
  it('names the maker of a USB chip from its modalias', () => {
    expect(chipOf('usb:v8087p0029d0001')).toBe('Intel (8087:0029)');
    expect(chipOf('usb:v1D6Bp0246d0548')).toBe('USB 1d6b (1d6b:0246)');
    expect(chipOf(undefined)).toBeNull();
  });
});
