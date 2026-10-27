/**
 * The Bluetooth scanners an integration's code opens through the SDK, one per proxy device: each
 * reports to the Bluetooth broker as heard by that proxy.
 *
 * One set per vendor, closed with the vendor.
 */
import type { BluetoothScanner, BundleBluetooth } from '@nebulahome/package-runtime';

import type { BluetoothBroker } from './broker.js';

/**
 * The scanners of one vendor.
 *
 * @param broker - The hub's Bluetooth broker; none, as in tests, and opening one fails.
 * @param vendorId - The vendor whose code opens them.
 * @returns What the SDK hands the vendor, and how to close every scanner it opened.
 */
export function createBluetoothScanners(
  broker: BluetoothBroker | undefined,
  vendorId: string,
): { readonly bluetooth: BundleBluetooth; readonly closeAll: () => void } {
  const scanners = new Set<BluetoothScanner>();

  return {
    bluetooth: {
      /**
       * Opens a proxy's scanner.
       *
       * @param options - The proxy: its connection and its device key.
       * @returns The scanner.
       * @throws {Error} When the hub runs no Bluetooth broker.
       */
      scanner: (options) => {
        if (broker === undefined) {
          throw new Error('This hub runs no Bluetooth broker');
        }

        const scanner = broker.scanner(vendorId, options);

        scanners.add(scanner);

        return {
          report: scanner.report,

          /** Stops reporting. */
          close: () => {
            scanners.delete(scanner);
            scanner.close();
          },
        };
      },
    },

    /** Closes every scanner the vendor opened. */
    closeAll: () => {
      for (const scanner of scanners) {
        scanner.close();
      }

      scanners.clear();
    },
  };
}
