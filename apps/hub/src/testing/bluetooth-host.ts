/**
 * A machine's Bluetooth in memory, for the Bluetooth broker's tests: adapters added, powered and
 * taken away by hand, advertisements heard when a test says, and GATT characteristics that hold
 * what a test puts in them.
 */
import {
  bluetoothAdvertSchema,
  type BluetoothAdvertInput,
  type BluetoothScanMode,
} from '@nebulahome/contracts';

import type { BluetoothAdapters, BluetoothHost, SeenBluetoothAdapter } from '../bluetooth/host.js';

/** The fake machine. */
export type FakeBluetoothHost = BluetoothHost & {
  /** The adapters BlueZ has; a test changes it, then calls {@link FakeBluetoothHost.change}. */
  adapterList: SeenBluetoothAdapter[];

  /** Why there are none: no bus, no BlueZ. */
  problem: BluetoothAdapters['problem'];

  /** The scans running, by adapter. */
  readonly scanning: Map<string, BluetoothScanMode>;

  /** Characteristic values, by `address service characteristic`. */
  readonly values: Map<string, string>;

  /** Every write, in order. */
  readonly written: { address: string; characteristic: string; data: string }[];

  /** Makes the adapter scanning hear an advertisement. */
  readonly hear: (advert: BluetoothAdvertInput) => void;

  /** Says the adapters changed. */
  readonly change: () => void;

  /** Makes a followed characteristic notify a value. */
  readonly push: (address: string, characteristic: string, data: string) => void;
};

/**
 * An adapter, powered.
 *
 * @param id - `hci0`.
 * @param canPassive - Whether it monitors passively.
 * @returns It.
 */
export function fakeAdapter(id = 'hci0', canPassive = true): SeenBluetoothAdapter {
  return {
    id,
    name: 'nebula',
    address: '00:1A:7D:DA:71:13',
    isPowered: true,
    chip: 'Intel (8087:0029)',
    canPassive,
  };
}

/**
 * A fake machine.
 *
 * @param adapters - The adapters at first.
 * @returns It.
 */
export function createFakeBluetoothHost(
  adapters: SeenBluetoothAdapter[] = [fakeAdapter()],
): FakeBluetoothHost {
  const watchers = new Set<() => void>();
  const listeners = new Map<
    string,
    (advert: ReturnType<typeof bluetoothAdvertSchema.parse>) => void
  >();
  const followed = new Map<string, (data: string) => void>();
  const connected = new Set<string>();

  /**
   * The key of one characteristic.
   *
   * @param address - The device.
   * @param service - The service.
   * @param characteristic - The characteristic.
   * @returns The key.
   */
  const keyOf = (address: string, service: string, characteristic: string): string =>
    `${address} ${service} ${characteristic}`;
  const host: FakeBluetoothHost = {
    adapterList: adapters,
    problem: null,
    scanning: new Map(),
    values: new Map(),
    written: [],

    /**
     * Reads the adapters.
     *
     * @returns Them.
     */
    adapters: async () =>
      Promise.resolve({
        adapters: host.problem === null ? [...host.adapterList] : [],
        problem: host.problem,
        error: host.problem === null ? null : 'Not here',
      }),

    /**
     * Hears changes.
     *
     * @param onChange - Called on each.
     * @returns Stops hearing.
     */
    watch: (onChange) => {
      watchers.add(onChange);

      return () => watchers.delete(onChange);
    },

    /**
     * Starts a scan on an adapter that is there and powered.
     *
     * @param adapterId - The adapter.
     * @param mode - How.
     * @param onAdvert - Where adverts go.
     * @returns The scan.
     */
    scan: async (adapterId, mode, onAdvert) => {
      const adapter = host.adapterList.find((each) => each.id === adapterId);

      if (adapter?.isPowered !== true) {
        throw new Error('org.bluez.Error.NotReady');
      }

      const used = mode === 'passive' && adapter.canPassive ? 'passive' : 'active';

      host.scanning.set(adapterId, used);
      listeners.set(adapterId, onAdvert);

      return Promise.resolve({
        mode: used,

        /**
         * Stops it.
         *
         * @returns Once stopped.
         */
        stop: async () => {
          host.scanning.delete(adapterId);
          listeners.delete(adapterId);

          return Promise.resolve();
        },
      });
    },

    /**
     * Reads a value a test put.
     *
     * @param adapterId - The adapter.
     * @param address - The device.
     * @param service - The service.
     * @param characteristic - The characteristic.
     * @returns It.
     */
    read: async (adapterId, address, service, characteristic) => {
      const value = host.values.get(keyOf(address, service, characteristic));

      if (value === undefined) {
        throw new Error(`The device has no characteristic ${characteristic}`);
      }

      connected.add(address);

      return Promise.resolve(value);
    },

    /**
     * Records a write.
     *
     * @param adapterId - The adapter.
     * @param address - The device.
     * @param service - The service.
     * @param characteristic - The characteristic.
     * @param data - The bytes.
     * @returns Once recorded.
     */
    write: async (adapterId, address, service, characteristic, data) => {
      connected.add(address);
      host.written.push({ address, characteristic, data });
      host.values.set(keyOf(address, service, characteristic), data);

      return Promise.resolve();
    },

    /**
     * Follows a characteristic, or stops.
     *
     * @param adapterId - The adapter.
     * @param address - The device.
     * @param service - The service.
     * @param characteristic - The characteristic.
     * @param listener - Where values go; null stops.
     * @returns Once done.
     */
    notify: async (adapterId, address, service, characteristic, listener) => {
      connected.add(address);

      if (listener === null) {
        followed.delete(`${address} ${characteristic}`);
      } else {
        followed.set(`${address} ${characteristic}`, listener);
      }

      return Promise.resolve();
    },

    /**
     * The addresses connected to.
     *
     * @returns Them.
     */
    connected: () => [...connected],

    /**
     * Stops every scan.
     *
     * @returns At once.
     */
    close: async () => {
      host.scanning.clear();
      listeners.clear();

      return Promise.resolve();
    },

    /**
     * Hears an advertisement on every adapter scanning.
     *
     * @param advert - The advertisement.
     */
    hear: (advert) => {
      for (const listener of listeners.values()) {
        listener(bluetoothAdvertSchema.parse(advert));
      }
    },

    /** Tells the watchers. */
    change: () => {
      for (const watcher of watchers) {
        watcher();
      }
    },

    /**
     * Makes a followed characteristic notify.
     *
     * @param address - The device.
     * @param characteristic - The characteristic.
     * @param data - The value.
     */
    push: (address, characteristic, data) => {
      followed.get(`${address} ${characteristic}`)?.(data);
    },
  };

  return host;
}
