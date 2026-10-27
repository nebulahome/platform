/**
 * The serial ports an integration's code opens through the SDK: each goes through the Serial
 * broker, which opens a port only for a device of the vendor that holds it, and only once.
 *
 * One set per vendor, closed with the vendor.
 */
import type { OpenSerial, SerialSession } from '@nebulahome/package-runtime';

import type { SerialBroker } from './broker.js';

/**
 * The sessions of one vendor.
 *
 * @param broker - The hub's Serial broker; none, as in tests, and opening a port fails.
 * @param vendorId - The vendor whose code opens them.
 * @returns How to open one, and how to close every one the vendor opened.
 */
export function createSerialSessions(
  broker: SerialBroker | undefined,
  vendorId: string,
): { readonly open: OpenSerial; readonly closeAll: () => Promise<void> } {
  const sessions = new Set<SerialSession>();

  return {
    /**
     * Opens a port a device of the vendor holds.
     *
     * @param portId - The port its config names.
     * @param line - How it is spoken.
     * @returns The open port.
     */
    open: async (portId, line) => {
      if (broker === undefined) {
        throw Object.assign(new Error('This hub runs no Serial broker'), {
          name: 'SerialPortMissing',
        });
      }

      const session = await broker.openForVendor(vendorId, portId, line);

      sessions.add(session);
      session.onClose(() => sessions.delete(session));

      return session;
    },

    /**
     * Closes every port the vendor opened.
     *
     * @returns Once closed.
     */
    closeAll: async () => {
      await Promise.all([...sessions].map(async (session) => session.close()));
    },
  };
}
