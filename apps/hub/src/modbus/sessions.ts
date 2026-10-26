/**
 * The Modbus sessions an integration's code opens through the SDK: each holds the hub's one
 * client to its server while it is open, so an integration's requests wait their turn with the
 * polls, the tests and the search, and the server is never opened twice.
 *
 * One set per vendor, closed with the vendor.
 */
import { MODBUS_PORT } from '@nebulahome/contracts';
import type { ModbusSession, OpenModbus } from '@nebulahome/package-runtime';

import type { ModbusAddress, ModbusPool } from './client.js';

/**
 * The sessions of one vendor.
 *
 * @param pool - The hub's clients; none, as in tests, and opening a session fails.
 * @returns How to open one, and how to close every one the vendor opened.
 */
export function createModbusSessions(pool: ModbusPool | undefined): {
  readonly open: OpenModbus;
  readonly closeAll: () => Promise<void>;
} {
  const sessions = new Set<ModbusSession>();

  return {
    /**
     * Opens a session to a server, holding the hub's client to it until closed.
     *
     * @param server - The server.
     * @returns The session.
     * @throws {Error} When the hub runs no Modbus client.
     */
    open: (server) => {
      if (pool === undefined) {
        throw new Error('This hub runs no Modbus client');
      }

      const address: ModbusAddress = {
        host: server.host,
        port: server.port ?? MODBUS_PORT,
        framing: server.framing ?? 'tcp',
      };
      const client = pool.acquire(address);
      let isClosed = false;
      const session: ModbusSession = {
        /**
         * Reads bits or registers.
         *
         * @param options - The read.
         * @param signal - Gives up.
         * @returns One number per bit or register.
         */
        read: async (options, signal) => (await pool.read(address, options, signal)).values,

        /**
         * Writes a coil, a register, coils or registers.
         *
         * @param options - The write.
         * @param signal - Gives up.
         * @returns Once the server echoed it.
         */
        write: async (options, signal) => {
          await pool.write(address, options, signal);
        },

        /**
         * Lets go of the server.
         *
         * @returns At once.
         */
        close: () => {
          if (!isClosed) {
            isClosed = true;
            sessions.delete(session);
            pool.release(client);
          }

          return Promise.resolve();
        },
      };

      sessions.add(session);

      return session;
    },
    /**
     * Closes every session the vendor opened.
     *
     * @returns Once closed.
     */
    closeAll: async () => {
      await Promise.all([...sessions].map((session) => session.close()));
    },
  };
}
