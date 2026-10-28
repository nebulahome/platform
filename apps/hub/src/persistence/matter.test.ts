import { describe, expect, it } from 'vitest';

import { isSealed } from '@nebulahome/db';

import { memoryMatterNetworksStore, wifiOf, wifiRowOf } from './matter.js';

/** A secrets key. */
const KEY = Buffer.alloc(32, 3);

describe('the Wi-Fi a new Matter device is given', () => {
  it('keeps the password sealed, never in the clear, and opens it', () => {
    const row = wifiRowOf({ ssid: 'Casa', password: 'secret-pass' }, undefined, KEY);

    expect(row.wifiSsid).toBe('Casa');
    expect(isSealed(row.wifiPasswordSealed)).toBe(true);
    expect(JSON.stringify(row)).not.toContain('secret-pass');
    expect(wifiOf(row, KEY)).toEqual({ ssid: 'Casa', password: 'secret-pass' });
  });

  it('keeps the saved password when none is given for the same network, and drops it for another', () => {
    const kept = wifiRowOf({ ssid: 'Casa', password: 'secret-pass' }, undefined, KEY);

    expect(wifiRowOf({ ssid: 'Casa' }, kept, KEY).wifiPasswordSealed).toBe(kept.wifiPasswordSealed);
    expect(wifiRowOf({ ssid: 'Guests' }, kept, KEY)).toEqual({
      wifiSsid: 'Guests',
      wifiPasswordSealed: null,
    });
    expect(wifiOf(wifiRowOf({ ssid: 'Guests' }, kept, KEY), KEY)).toEqual({
      ssid: 'Guests',
      password: null,
    });
  });

  it('forgets the network with null, and reads none from an empty row', () => {
    expect(wifiRowOf(null, undefined, KEY)).toEqual({ wifiSsid: null, wifiPasswordSealed: null });
    expect(wifiOf(undefined, KEY)).toBeNull();
    expect(wifiOf({ wifiSsid: null, wifiPasswordSealed: null }, KEY)).toBeNull();
  });

  it('refuses a password sealed under another key', () => {
    const row = wifiRowOf({ ssid: 'Casa', password: 'secret-pass' }, undefined, KEY);

    expect(() => wifiOf(row, Buffer.alloc(32, 4))).toThrow();
  });

  it('stores in memory as the database does: sealed', async () => {
    const store = memoryMatterNetworksStore(KEY);

    await store.saveWifi({ ssid: 'Casa', password: 'secret-pass' });

    expect(isSealed(store.row()?.wifiPasswordSealed)).toBe(true);
    await expect(store.wifi()).resolves.toEqual({ ssid: 'Casa', password: 'secret-pass' });
  });
});
