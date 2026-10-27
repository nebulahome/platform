import { describe, expect, it } from 'vitest';

import {
  bluetoothAdvertSchema,
  bluetoothProxyFilterArgsSchema,
  bluetoothProxyJobSchema,
  bluetoothProxyProfileSchema,
  bluetoothProxyStateSchema,
  bluetoothSettingsSchema,
} from './bluetooth.js';

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
});

describe('bluetoothSettingsSchema', () => {
  it('starts with the adapter on, proxies passive, a week to forget', () => {
    expect(bluetoothSettingsSchema.parse({})).toEqual({
      localEnabled: true,
      adapterId: null,
      localScanMode: 'active',
      proxyScanMode: 'passive',
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
      mode: 'passive',
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
