/**
 * A machine's serial ports in memory, for the Serial broker's tests: ports plugged and unplugged
 * by hand, and opened ports that record what was written and say what a test makes them say -
 * or what a device on them would answer, a Thread radio's Spinel.
 */
import type { SerialLine } from '@nebulahome/contracts';
import type { SerialSession } from '@nebulahome/package-runtime';

import type { SeenSerialPort, SerialHost } from '../serial/host.js';

/** A port the fake opened. */
export type FakeOpenPort = {
  readonly line: SerialLine;

  /** Everything written to it, in order. */
  readonly written: Buffer[];

  /** Makes the port say something. */
  readonly say: (bytes: Uint8Array) => void;

  /** Whether it is still open. */
  readonly isOpen: () => boolean;
};

/** The fake machine. */
export type FakeSerialHost = SerialHost & {
  /** The ports plugged in now; a test changes it, then asks the broker to scan. */
  ports: SeenSerialPort[];

  /** The ports opened, by node, the latest open of each. */
  readonly opened: Map<string, FakeOpenPort>;

  /** Unplugs a port: it leaves the list, and an open one closes. */
  readonly unplug: (devicePath: string) => void;

  /** What the device on a port answers what is written to it; nothing when not set. */
  respond: ((devicePath: string, bytes: Uint8Array) => Uint8Array | null) | undefined;
};

/**
 * A fake machine.
 *
 * @param ports - The ports plugged in at first.
 * @returns It.
 */
export function createFakeSerialHost(ports: SeenSerialPort[] = []): FakeSerialHost {
  const closers = new Map<string, (reason: string) => void>();
  const host: FakeSerialHost = {
    ports,
    opened: new Map(),
    respond: undefined,

    /**
     * Reads the ports plugged in.
     *
     * @returns Them.
     */
    list: async () => Promise.resolve([...host.ports]),

    /**
     * Follows nothing: tests scan by hand.
     *
     * @returns A watch that says it follows.
     */
    watch: () => ({
      isWatching: true,

      /**
       * Stops nothing.
       *
       * @returns Nothing.
       */
      stop: () => undefined,
    }),

    /**
     * Opens a port that is plugged in.
     *
     * @param devicePath - Its node.
     * @param line - How it is spoken.
     * @returns The open port.
     */
    open: async (devicePath, line) => {
      if (!host.ports.some((port) => port.devicePath === devicePath)) {
        throw new Error(`No such file or directory, cannot open ${devicePath}`);
      }

      const written: Buffer[] = [];
      const dataListeners = new Set<(bytes: Uint8Array) => void>();
      const closeListeners = new Set<(reason: string) => void>();
      let isOpen = true;

      /**
       * Closes it once.
       *
       * @param reason - Why.
       */
      const end = (reason: string): void => {
        if (isOpen) {
          isOpen = false;

          for (const listener of closeListeners) {
            listener(reason);
          }
        }
      };

      closers.set(devicePath, end);
      host.opened.set(devicePath, {
        line,
        written,

        /**
         * Makes the port say something.
         *
         * @param bytes - What.
         */
        say: (bytes) => {
          for (const listener of dataListeners) {
            listener(bytes);
          }
        },

        /**
         * Whether it is still open.
         *
         * @returns True while it is.
         */
        isOpen: () => isOpen,
      });

      const session: SerialSession = {
        /**
         * Records what is written, and has the device answer it.
         *
         * @param bytes - The bytes.
         * @returns At once.
         */
        write: async (bytes) => {
          written.push(Buffer.from(bytes));

          const answer = host.respond?.(devicePath, bytes) ?? null;

          if (answer !== null) {
            // A moment later, as a device answers.
            setImmediate(() => {
              for (const listener of dataListeners) {
                listener(answer);
              }
            });
          }

          return Promise.resolve();
        },

        /**
         * Hears what the test makes the port say.
         *
         * @param listener - Called with each chunk.
         * @returns Stops hearing.
         */
        onData: (listener) => {
          dataListeners.add(listener);

          return () => dataListeners.delete(listener);
        },

        /**
         * Hears the port go.
         *
         * @param listener - Called with why.
         * @returns Stops hearing.
         */
        onClose: (listener) => {
          closeListeners.add(listener);

          return () => closeListeners.delete(listener);
        },

        /**
         * Closes it.
         *
         * @returns At once.
         */
        close: async () => {
          end('Closed');

          return Promise.resolve();
        },
      };

      return Promise.resolve(session);
    },

    /**
     * Unplugs a port.
     *
     * @param devicePath - Its node.
     */
    unplug: (devicePath) => {
      host.ports = host.ports.filter((port) => port.devicePath !== devicePath);
      closers.get(devicePath)?.('Unplugged');
    },
  };

  return host;
}
