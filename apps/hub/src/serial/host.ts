/**
 * The serial ports of the machine the hub runs on, as Linux shows them.
 *
 * A port is a tty with a device behind it in sysfs - `/sys/class/tty/<name>/device` - and a node in
 * `/dev`; virtual consoles and pseudo-terminals have no device and are not ports. A USB adapter
 * says what it is through the USB device above it (`idVendor`, `idProduct`, `serial`,
 * `manufacturer`, `product`), and udev gives it a path that stays across replugging under
 * `/dev/serial/by-id`. Built-in UARTs (`ttyS*`, `ttyAMA*`) are flagged, and a `ttyS*` the kernel
 * found no UART behind (`type` 0) is no port at all.
 *
 * In a container the sysfs of the host shows every port while `/dev` has only those the compose
 * file passes in, so a port whose node is missing is one the hub cannot reach and is not listed:
 * an empty list is the honest "the container sees no serial port".
 *
 * Linux only, behind {@link SerialHost} so the broker's tests run on a fake.
 */
import { watch, type FSWatcher } from 'node:fs';
import { access, readdir, readFile, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';

import type { SerialLine, SerialPortKind, SerialUsb } from '@nebulahome/contracts';
import type { SerialSession } from '@nebulahome/package-runtime';

/** A port the machine has, as a scan finds it. */
export type SeenSerialPort = {
  /** The kernel's node: `/dev/ttyUSB0`. */
  readonly devicePath: string;

  /** The path that stays: its `/dev/serial/by-id` link when it has one, its node otherwise. */
  readonly stablePath: string;
  readonly kind: Exclude<SerialPortKind, 'network'>;

  /** What a USB adapter says it is; null for a built-in port. */
  readonly usb: SerialUsb | null;
};

/** Whether plugging is followed, and how to stop following it. */
export type SerialWatch = {
  readonly isWatching: boolean;
  readonly stop: () => void;
};

/** The ports of the machine. */
export type SerialHost = {
  /** Every port the hub can reach now. Never throws: a machine without sysfs has none. */
  list: () => Promise<SeenSerialPort[]>;

  /**
   * Follows ports being plugged and unplugged.
   *
   * @param onChange - Called, a little after, when something under `/dev` came or went.
   */
  watch: (onChange: () => void) => SerialWatch;

  /**
   * Opens a port.
   *
   * @throws {Error} When the port cannot be opened: gone, taken by another process, refused.
   */
  open: (devicePath: string, line: SerialLine) => Promise<SerialSession>;
};

/** How long a burst of `/dev` events settles before the ports are read again. */
const SETTLE_MS = 500;

/** How far above a tty's device the USB device that says what it is may sit. */
const USB_DEPTH = 4;

/** Built-in UARTs: the PC's, and the ARM boards' own. */
const BUILTIN_NAME = /^tty(?:S|AMA|AML|SAC|MFD|THS|mxc|O)\d+$/u;

/**
 * A sysfs attribute, trimmed.
 *
 * @param file - The attribute.
 * @returns Its text, or null when it is not there.
 */
async function attribute(file: string): Promise<string | null> {
  try {
    const text = (await readFile(file, 'utf8')).trim();

    return text.length > 0 ? text.slice(0, 256) : null;
  } catch {
    return null;
  }
}

/**
 * What the USB device above a tty says it is.
 *
 * @param device - The tty's device directory, resolved.
 * @returns Its ids and strings, or null when no USB device is above it.
 */
async function usbAbove(device: string): Promise<SerialUsb | null> {
  let directory = device;

  for (let depth = 0; depth <= USB_DEPTH; depth += 1) {
    // One directory at a time, by design: the nearest USB device is the adapter.
    // eslint-disable-next-line no-await-in-loop -- see above
    const [vendorId, productId] = await Promise.all([
      attribute(path.join(directory, 'idVendor')),
      attribute(path.join(directory, 'idProduct')),
    ]);

    if (vendorId !== null && productId !== null) {
      // eslint-disable-next-line no-await-in-loop -- once, on the way out
      const [serialNumber, manufacturer, product] = await Promise.all([
        attribute(path.join(directory, 'serial')),
        attribute(path.join(directory, 'manufacturer')),
        attribute(path.join(directory, 'product')),
      ]);

      return {
        vendorId: vendorId.toLowerCase(),
        productId: productId.toLowerCase(),
        serialNumber,
        manufacturer,
        product,
      };
    }

    directory = path.dirname(directory);
  }

  return null;
}

/**
 * The by-id links, by the node each points at.
 *
 * @param byId - `/dev/serial/by-id`.
 * @returns The first link of each node, by name; empty while no adapter is plugged in.
 */
async function stablePaths(byId: string): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  const names = await readdir(byId).catch(() => [] as string[]);

  for (const name of names.toSorted()) {
    const link = path.join(byId, name);
    // One link at a time: a handful, and their order decides which wins.
    // eslint-disable-next-line no-await-in-loop -- see above
    const target = await readlink(link).catch(() => null);

    if (target !== null) {
      const node = path.resolve(byId, target);

      if (!links.has(node)) {
        links.set(node, link);
      }
    }
  }

  return links;
}

/**
 * The machine's ports, read from sysfs and `/dev`.
 *
 * @param options - Where the file system starts; `/` but in tests.
 * @param options.root - The root sysfs and `/dev` are read under.
 * @returns The host.
 */
export function createLinuxSerialHost(options: { readonly root?: string } = {}): SerialHost {
  const root = options.root ?? '/';
  const sysTty = path.join(root, 'sys', 'class', 'tty');
  const dev = path.join(root, 'dev');
  const byId = path.join(dev, 'serial', 'by-id');

  return {
    /**
     * Reads the ports: every tty with a device behind it and a node in `/dev`.
     *
     * @returns Them.
     */
    list: async () => {
      const names = await readdir(sysTty).catch(() => [] as string[]);
      const links = await stablePaths(byId);
      const ports = await Promise.all(
        names.map(async (name): Promise<SeenSerialPort | null> => {
          const device = await realpath(path.join(sysTty, name, 'device')).catch(() => null);
          const devicePath = path.join(dev, name);

          // No device behind it is a virtual terminal; no node is a port the container is not given.
          if (
            device === null ||
            !(await access(devicePath).then(
              () => true,
              () => false,
            ))
          ) {
            return null;
          }

          // The kernel registers ttyS ports it found no UART behind as type 0 (unknown).
          if (
            name.startsWith('ttyS') &&
            (await attribute(path.join(sysTty, name, 'type'))) === '0'
          ) {
            return null;
          }

          const usb = BUILTIN_NAME.test(name) ? null : await usbAbove(device);

          return {
            devicePath,
            stablePath: links.get(devicePath) ?? devicePath,
            kind: usb === null ? 'builtin' : 'usb',
            usb,
          };
        }),
      );

      return ports.filter((port) => port !== null);
    },

    /**
     * Follows `/dev` and `/dev/serial/by-id`.
     *
     * @param onChange - Called once a burst of events settled.
     * @returns Whether either is followed, and how to stop.
     */
    watch: (onChange) => {
      let timer: NodeJS.Timeout | undefined;
      const watchers: FSWatcher[] = [];

      /** Reads the ports again once a burst of events has settled. */
      const settle = (): void => {
        clearTimeout(timer);
        timer = setTimeout(onChange, SETTLE_MS);
        timer.unref();
      };

      // `/dev` sees every node come and go; by-id only exists while an adapter is plugged in, and
      // is where a replugged adapter's link reappears.
      for (const directory of [dev, byId]) {
        try {
          const watcher = watch(directory, { persistent: false }, settle);

          watcher.on('error', () => {
            watcher.close();
          });
          watchers.push(watcher);
        } catch {
          // Not there, or not watchable: the broker's periodic scan covers it.
        }
      }

      return {
        isWatching: watchers.length > 0,

        /** Stops following. */
        stop: () => {
          clearTimeout(timer);

          for (const watcher of watchers) {
            watcher.close();
          }
        },
      };
    },

    /**
     * Opens a port.
     *
     * @param devicePath - Its node.
     * @param line - How it is spoken.
     * @returns The open port.
     */
    open: async (devicePath, line) => {
      // Imported here, not at the top: the native binding loads only once a port is opened.
      // `@serialport/bindings-cpp` is never built (`allowBuilds` false): node-gyp-build picks its
      // prebuild for the platform - musl on Alpine - when it loads.
      const serialport = await import('serialport');
      const port = new serialport.SerialPort({
        path: devicePath,
        baudRate: line.baudRate,
        dataBits: line.dataBits,
        parity: line.parity,
        stopBits: line.stopBits,
        rtscts: line.flowControl === 'rtscts',
        xon: line.flowControl === 'xonxoff',
        xoff: line.flowControl === 'xonxoff',
        autoOpen: false,
      });

      await new Promise<void>((resolve, reject) => {
        port.open((error) => {
          if (error === null) {
            resolve();
          } else {
            reject(error);
          }
        });
      });

      let reason = 'Closed';

      port.on('error', (error: Error) => {
        reason = error.message;
      });

      return {
        /**
         * Sends bytes.
         *
         * @param bytes - The bytes.
         * @returns Once the port took them.
         */
        write: async (bytes) =>
          new Promise<void>((resolve, reject) => {
            if (!port.isOpen) {
              reject(Object.assign(new Error('The port is closed'), { name: 'SerialClosed' }));

              return;
            }

            port.write(Buffer.from(bytes), (error) => {
              if (error === null || error === undefined) {
                resolve();
              } else {
                reject(error);
              }
            });
          }),
        /**
         * Hears what the port reads.
         *
         * @param listener - Called with each chunk.
         * @returns Stops hearing.
         */
        onData: (listener) => {
          port.on('data', listener);

          return () => port.off('data', listener);
        },
        /**
         * Hears the port go: unplugged, failed or closed.
         *
         * @param listener - Called with why.
         * @returns Stops hearing.
         */
        onClose: (listener) => {
          /**
           * Says why the port went.
           *
           * @param error - Set when it was unplugged or failed.
           */
          const closed = (error?: Error | null): void => {
            listener(error?.message ?? reason);
          };

          port.once('close', closed);

          return () => port.off('close', closed);
        },
        /**
         * Closes the port.
         *
         * @returns Once closed.
         */
        close: async () =>
          new Promise<void>((resolve) => {
            if (!port.isOpen) {
              resolve();

              return;
            }

            port.close(() => {
              resolve();
            });
          }),
      };
    },
  };
}
