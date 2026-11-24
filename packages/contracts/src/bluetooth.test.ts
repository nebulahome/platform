import { describe, expect, it } from 'vitest';

import {
  bluetoothAdvertSchema,
  bluetoothProxyExchangeArgsSchema,
  bluetoothProxyFilterArgsSchema,
  bluetoothProxyGattEventSchema,
  bluetoothProxyJobSchema,
  bluetoothProxyLinkArgsSchema,
  bluetoothProxyProfileSchema,
  bluetoothProxyStateSchema,
  bluetoothProxyWriteArgsSchema,
  bluetoothSettingsSchema,
} from './bluetooth.js';
import { BLUETOOTH_PROXY_GATT_OPS, BLUETOOTH_PROXY_OPS } from './reserved-ops.js';

describe('bluetoothAdvertSchema', () => {
  it('reads a proxy report, address upper and bytes lower', () => {
    const advert = bluetoothAdvertSchema.parse({
      address: 'a4:c1:38:0b:5e:7f',
      addressType: 'public',
      rssi: -67,
      name: 'ATC_0B5E7F',
      manufacturerData: { '76': '0215AABB' },
      serviceData: { FCD2: '40000801' },
      serviceUuids: ['0000FCD2-0000-1000-8000-00805F9B34FB'],
      at: '2026-10-27T10:00:00.000Z',
    });

    expect(advert.address).toBe('A4:C1:38:0B:5E:7F');
    expect(advert.manufacturerData).toEqual({ '76': '0215aabb' });
    expect(advert.serviceData).toEqual({ fcd2: '40000801' });
    expect(advert.serviceUuids).toEqual(['0000fcd2-0000-1000-8000-00805f9b34fb']);
    expect(advert.at).toBeInstanceOf(Date);
  });

  it('refuses what no scanner hears', () => {
    const advert = {
      address: 'A4:C1:38:0B:5E:7F',
      addressType: 'public',
      rssi: -67,
      at: new Date(),
    };

    expect(bluetoothAdvertSchema.safeParse({ ...advert, address: 'A4C1380B5E7F' }).success).toBe(
      false,
    );
    expect(bluetoothAdvertSchema.safeParse({ ...advert, rssi: -200 }).success).toBe(false);
    expect(
      bluetoothAdvertSchema.safeParse({ ...advert, manufacturerData: { apple: '00' } }).success,
    ).toBe(false);
    expect(bluetoothAdvertSchema.safeParse({ ...advert, serviceData: { fcd2: '4' } }).success).toBe(
      false,
    );
  });
});

describe('bluetoothProxyStateSchema', () => {
  it('reads a proxy that can be one and one that cannot', () => {
    expect(
      bluetoothProxyStateSchema.parse({
        eligible: true,
        installed: true,
        version: '1',
        shipped: '2',
        running: true,
      }),
    ).toMatchObject({ eligible: true, shipped: '2' });
    expect(
      bluetoothProxyStateSchema.parse({ eligible: false, reason: 'firmware', update: true }),
    ).toMatchObject({ eligible: false, reason: 'firmware' });
  });

  it('says the connections of a proxy that can connect, and nothing of one that only listens', () => {
    const proxy = { eligible: true, installed: true, shipped: '2', running: true };

    expect(
      bluetoothProxyStateSchema.parse({ ...proxy, connections: { free: 2, limit: 3 } }),
    ).toMatchObject({ connections: { free: 2, limit: 3 } });
    expect(bluetoothProxyStateSchema.parse(proxy)).not.toHaveProperty('connections');
    expect(
      bluetoothProxyStateSchema.safeParse({ ...proxy, connections: { free: -1, limit: 3 } })
        .success,
    ).toBe(false);
  });

  it('refuses a reason on an eligible device', () => {
    expect(bluetoothProxyStateSchema.safeParse({ eligible: false, reason: 'tired' }).success).toBe(
      false,
    );
    expect(bluetoothProxyStateSchema.safeParse({ eligible: true, reason: 'gen1' }).success).toBe(
      false,
    );
  });
});

describe('bluetoothProxyProfileSchema', () => {
  it('takes each mode once', () => {
    expect(bluetoothProxyProfileSchema.parse({ modes: ['passive', 'active'] }).modes).toHaveLength(
      2,
    );
    expect(bluetoothProxyProfileSchema.safeParse({ modes: ['active', 'active'] }).success).toBe(
      false,
    );
    expect(bluetoothProxyProfileSchema.safeParse({ modes: [] }).success).toBe(false);
  });
});

describe('bluetoothProxyFilterArgsSchema', () => {
  it('forwards everything, or the addresses named', () => {
    expect(bluetoothProxyFilterArgsSchema.parse({ addresses: 'all' }).addresses).toBe('all');
    expect(
      bluetoothProxyFilterArgsSchema.parse({ addresses: ['a4:c1:38:0b:5e:7f'] }).addresses,
    ).toEqual(['A4:C1:38:0B:5E:7F']);
  });

  it('carries whether the hub wants an active scan', () => {
    expect(bluetoothProxyFilterArgsSchema.parse({ addresses: 'all', active: true }).active).toBe(
      true,
    );
    expect(bluetoothProxyFilterArgsSchema.parse({ addresses: [] }).active).toBeUndefined();
  });
});

describe('the GATT a proxy carries out', () => {
  it('names its ops apart from the proxy’s own', () => {
    const names = [
      ...Object.values(BLUETOOTH_PROXY_OPS),
      ...Object.values(BLUETOOTH_PROXY_GATT_OPS),
    ];

    expect(new Set(names).size).toBe(names.length);
    expect(
      Object.values(BLUETOOTH_PROXY_GATT_OPS).every((op) => op.startsWith('bluetooth-proxy.')),
    ).toBe(true);
  });

  it('carries the address, upper case, beside what the driver asked', () => {
    expect(bluetoothProxyLinkArgsSchema.parse({ address: 'c4:be:84:12:34:56' })).toEqual({
      address: 'C4:BE:84:12:34:56',
    });
    expect(
      bluetoothProxyExchangeArgsSchema.parse({
        address: 'c4:be:84:12:34:56',
        service: 'CBA20D00-224D-11E6-9FB8-0002A5D5C51B',
        characteristic: 'cba20002-224d-11e6-9fb8-0002a5d5c51b',
        notify: 'cba20003-224d-11e6-9fb8-0002a5d5c51b',
        data: '570F',
      }),
    ).toEqual({
      address: 'C4:BE:84:12:34:56',
      service: 'cba20d00-224d-11e6-9fb8-0002a5d5c51b',
      characteristic: 'cba20002-224d-11e6-9fb8-0002a5d5c51b',
      notify: 'cba20003-224d-11e6-9fb8-0002a5d5c51b',
      data: '570f',
      withResponse: false,
      timeoutMs: 5000,
    });
    expect(
      bluetoothProxyWriteArgsSchema.safeParse({
        service: 'fee7',
        characteristic: 'fec7',
        data: '01',
      }).success,
    ).toBe(false);
  });

  it('reads a notification, a link lost and the slots free', () => {
    expect(
      bluetoothProxyGattEventSchema.parse({
        kind: 'notification',
        address: 'c4:be:84:12:34:56',
        service: 'CBA20D00-224D-11E6-9FB8-0002A5D5C51B',
        characteristic: 'cba20003-224d-11e6-9fb8-0002a5d5c51b',
        data: '01FF',
      }),
    ).toMatchObject({ address: 'C4:BE:84:12:34:56', data: '01ff' });
    expect(
      bluetoothProxyGattEventSchema.parse({ kind: 'disconnected', address: 'C4:BE:84:12:34:56' }),
    ).toEqual({ kind: 'disconnected', address: 'C4:BE:84:12:34:56' });
    expect(bluetoothProxyGattEventSchema.parse({ kind: 'slots', free: 1, limit: 3 })).toEqual({
      kind: 'slots',
      free: 1,
      limit: 3,
    });
    expect(bluetoothProxyGattEventSchema.safeParse({ kind: 'slots', free: 1 }).success).toBe(false);
    expect(
      bluetoothProxyGattEventSchema.safeParse({ kind: 'connected', address: 'C4:BE:84:12:34:56' })
        .success,
    ).toBe(false);
  });
});

describe('bluetoothSettingsSchema', () => {
  it('starts with the adapter on and active, a week to forget', () => {
    expect(bluetoothSettingsSchema.parse({})).toEqual({
      localEnabled: true,
      adapterId: null,
      localScanMode: 'active',
      forgetAfterDays: 7,
      showPrivate: false,
    });
  });
});

describe('bluetoothProxyJobSchema', () => {
  it('takes only its own steps', () => {
    const job = {
      id: 'job-1',
      state: 'running',
      startedAt: new Date(),
      finishedAt: null,
      error: null,
      deviceId: 'shelly-plug-1',
      steps: [{ id: 'installing', state: 'running', message: null }],
    };

    expect(bluetoothProxyJobSchema.safeParse(job).success).toBe(true);
    expect(
      bluetoothProxyJobSchema.safeParse({
        ...job,
        steps: [{ id: 'network', state: 'running', message: null }],
      }).success,
    ).toBe(false);
  });
});
