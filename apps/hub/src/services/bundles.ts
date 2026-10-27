/**
 * Reading integrations off disk, as `hub` runs them.
 *
 * The reading itself - every file checked, the code imported and handed the SDK - is
 * `@nebulahome/package-runtime`'s loader, the one the integration SDK checks a bundle with too,
 * so that what passes `nebulahome-integration validate` is what loads here. What is `hub`'s is the
 * SDK a vendor's code is handed: the managed sockets, the platform's broker, the codecs, built
 * once per vendor so that releasing the vendor frees every port its code opened.
 *
 * Bundles are read from two places - the data directory, where the platform installs them, and
 * outside production the directories of bundles under development - and
 * {@link mergeBundleResults} puts them together.
 */
import { createLogger, type PlatformLogger } from '@nebulahome/logging';
import {
  loadBundleDirectory,
  loadVendorFolder,
  type BundleFailure,
  type BundleManifest,
  type BundleOrigin,
  type InstallMarker,
  type LoadBundlesResult,
  type LoadedVendor,
  type PlatformServices,
  type VendorManifest,
  type VendorSdk,
} from '@nebulahome/package-runtime';

import type { BluetoothBroker } from '../bluetooth/broker.js';
import { createBluetoothScanners } from '../bluetooth/scanners.js';
import type { ModbusPool } from '../modbus/client.js';
import { createModbusSessions } from '../modbus/sessions.js';
import type { SerialBroker } from '../serial/broker.js';
import { createSerialSessions } from '../serial/sessions.js';
import { createUdpSockets } from '../transports/managed-udp.js';

import { createBundleSdk } from './bundle-sdk.js';

export {
  mergeBundleResults,
  wiresOf,
  type BundleFailure,
  type BundleOrigin,
  type LoadBundlesResult,
  type LoadedAccount,
  type LoadedBundle,
  type LoadedDiscovery,
  type LoadedListenSource,
  type LoadedVendor,
} from '@nebulahome/package-runtime';

/** What the loader needs. */
export type LoadBundlesOptions = {
  /** Where bundles are installed. Missing is not an error: a fresh installation has none. */
  readonly directory: string;

  /** Which of the two places the directory is; `installed` when not said. */
  readonly origin?: BundleOrigin;

  /** The contract version this build implements, checked against each bundle's range. */
  readonly runtimeVersion: string;

  /**
   * Decides whether a driver may be loaded at all.
   *
   * Absent means anything found locally is loaded, which is the state before a catalogue signs.
   *
   * @param manifest - What the driver says about itself, joined with its vendor.
   * @param directory - Where it was read from.
   * @returns Nothing, or a promise that settles, when it may be loaded.
   */
  readonly verify?: (manifest: BundleManifest, directory: string) => void | Promise<void>;

  /**
   * Decides whether a vendor's own transports may be loaded at all: they are code, and sit
   * at the tier a code driver does. Absent means anything found locally is loaded.
   *
   * @param vendor - What the vendor says about itself.
   * @param directory - Where it was read from.
   * @returns Nothing, or a promise that settles, when they may be loaded.
   */
  readonly verifyVendor?: (vendor: VendorManifest, directory: string) => void | Promise<void>;

  /** Where bundle code may log. A silent logger when the caller has none, as in tests. */
  readonly logger?: PlatformLogger;

  /** What the platform runs that bundle code may use: its broker. None, as in tests, when absent. */
  readonly platform?: PlatformServices;

  /** The hub's Modbus clients, which a vendor's sessions go through. None, as in tests, when absent. */
  readonly modbus?: ModbusPool;

  /** The hub's Serial broker, which a vendor's ports are opened through. None, as in tests, when absent. */
  readonly serial?: SerialBroker;

  /** The hub's Bluetooth broker, which a vendor's proxies report to. None, as in tests, when absent. */
  readonly bluetooth?: BluetoothBroker;
};

/**
 * What the loader of the runtime is handed: the hub's SDK for each vendor, and the rest as said.
 *
 * @param options - What the hub's loader was asked.
 * @returns The runtime loader's options, without the directory.
 */
function runtimeOptions(options: Omit<LoadBundlesOptions, 'directory'>) {
  const logger =
    options.logger ??
    createLogger({ service: 'hub', version: options.runtimeVersion, level: 'fatal' });

  return {
    runtimeVersion: options.runtimeVersion,
    ...(options.origin === undefined ? {} : { origin: options.origin }),
    ...(options.verify === undefined ? {} : { verify: options.verify }),
    ...(options.verifyVendor === undefined ? {} : { verifyVendor: options.verifyVendor }),

    /**
     * Builds what one vendor's code is handed, with UDP sockets, Modbus sessions, serial ports and
     * Bluetooth scanners of its own to free on release.
     *
     * @param manifest - The vendor.
     * @returns The SDK, and how to let go of what the vendor opens through it.
     */
    createSdk: (manifest: VendorManifest): VendorSdk => {
      const udp = createUdpSockets(logger);
      const modbus = createModbusSessions(options.modbus);
      const serial = createSerialSessions(options.serial, manifest.id);
      const bluetooth = createBluetoothScanners(options.bluetooth, manifest.id);

      return {
        sdk: createBundleSdk({
          version: options.runtimeVersion,
          logger,
          openUdpSocket: udp.open,
          openModbus: modbus.open,
          openSerial: serial.open,
          bluetooth: bluetooth.bluetooth,
          platform: options.platform ?? { mqtt: null },
        }),
        /**
         * Lets go of every socket and session the vendor opened.
         *
         * @returns Once let go of.
         */
        release: async () => {
          await udp.closeAll();
          await modbus.closeAll();
          await serial.closeAll();
          bluetooth.closeAll();
        },
      };
    },
  };
}

/**
 * Reads every bundle in a directory.
 *
 * @param options - Where to look, what contract version to check against, and how to verify.
 * @returns The vendors and drivers that loaded, and what did not with the reason.
 */
export async function loadBundles(options: LoadBundlesOptions): Promise<LoadBundlesResult> {
  return loadBundleDirectory({ directory: options.directory, ...runtimeOptions(options) });
}

/**
 * Reads one vendor of a directory, as it is on disk now: for a vendor installed or removed while
 * the hub runs.
 *
 * @param options - The directory of vendors, the runtime, how to verify.
 * @param vendorId - The vendor's folder.
 * @param install - The build to read, unpacked and not marked yet; the one the marker names, or
 * the folder itself, when absent.
 * @returns The vendor - null when it did not load - and its failures; null when the folder is
 * not a vendor, or not there.
 */
export async function loadVendor(
  options: LoadBundlesOptions,
  vendorId: string,
  install?: InstallMarker,
): Promise<{ readonly vendor: LoadedVendor | null; readonly failures: BundleFailure[] } | null> {
  return loadVendorFolder(options.directory, vendorId, runtimeOptions(options), install);
}
