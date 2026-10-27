/**
 * The Serial broker on the bus: what the Brokers page reads and asks, through `api`.
 *
 * `svc.hub.serial_status`, `serial_ports` and `serial_devices` read; `serial_settings` saves the
 * owner's settings, `serial_ignore` ignores a port or stops; `serial_network_port_save` keeps a
 * port on the network and `serial_network_port_test` opens one once; `serial_release` takes a port
 * from its holder and `serial_forget` forgets one unplugged or on the network; the
 * `serial_console_*` methods are the owner's console. A device on a port is added and removed the
 * way any device is: its instance claims the port as it starts, and lets go as it is removed.
 */
import { z } from 'zod';

import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  busSubjects,
  HUB_SERIAL_CONSOLE_CLOSE_METHOD,
  HUB_SERIAL_CONSOLE_OPEN_METHOD,
  HUB_SERIAL_CONSOLE_READ_METHOD,
  HUB_SERIAL_CONSOLE_WRITE_METHOD,
  HUB_SERIAL_DEVICES_METHOD,
  HUB_SERIAL_FORGET_METHOD,
  HUB_SERIAL_IGNORE_METHOD,
  HUB_SERIAL_NETWORK_PORT_SAVE_METHOD,
  HUB_SERIAL_NETWORK_PORT_TEST_METHOD,
  HUB_SERIAL_PORTS_METHOD,
  HUB_SERIAL_RELEASE_METHOD,
  HUB_SERIAL_SETTINGS_METHOD,
  HUB_SERIAL_STATUS_METHOD,
  HUB_SERVICE,
  serialConsoleCloseRequestSchema,
  serialConsoleOpenRequestSchema,
  serialConsoleReadRequestSchema,
  serialConsoleWriteRequestSchema,
  serialIgnoreRequestSchema,
  serialNetworkAddressSchema,
  serialNetworkPortSaveRequestSchema,
  serialPortIdRequestSchema,
  serialSettingsSchema,
} from '@nebulahome/contracts';

import type { SerialBroker } from '../serial/broker.js';

/**
 * Serves the Serial broker's methods.
 *
 * @param client - The hub's bus client.
 * @param broker - The broker.
 * @returns The subscriptions, to drop on stop.
 */
export function serveSerial(client: BusClient, broker: SerialBroker): BusSubscription[] {
  /**
   * One method of the broker's.
   *
   * @param method - Its name.
   * @returns Its subject.
   */
  const subject = (method: string): string => busSubjects.service(HUB_SERVICE, method);

  return [
    client.serve(
      subject(HUB_SERIAL_STATUS_METHOD),
      z.object({}),

      /**
       * Says where the broker stands.
       *
       * @returns Its status.
       */
      async () => broker.status(),
    ),

    client.serve(
      subject(HUB_SERIAL_PORTS_METHOD),
      z.object({}),

      /**
       * Lists the ports.
       *
       * @returns Each, with who holds it and who would take it.
       */
      async () => ({ items: await broker.ports() }),
    ),

    client.serve(
      subject(HUB_SERIAL_DEVICES_METHOD),
      z.object({}),

      /**
       * Lists the devices reached through a port.
       *
       * @returns Each, with its port and line.
       */
      async () => ({ items: await broker.devices() }),
    ),

    client.serve(
      subject(HUB_SERIAL_SETTINGS_METHOD),
      serialSettingsSchema,

      /**
       * Saves the settings.
       *
       * @param settings - The settings.
       * @returns Where the broker stands.
       */
      async (settings) => broker.saveSettings(settings),
    ),

    client.serve(
      subject(HUB_SERIAL_IGNORE_METHOD),
      serialIgnoreRequestSchema,

      /**
       * Ignores a port, or stops ignoring it.
       *
       * @param request - The port, and whether it is ignored.
       * @returns The port.
       */
      async (request) => broker.ignore(request.portId, request.isIgnored),
    ),

    client.serve(
      subject(HUB_SERIAL_NETWORK_PORT_SAVE_METHOD),
      serialNetworkPortSaveRequestSchema,

      /**
       * Saves a port on the network.
       *
       * @param request - The port.
       * @returns It.
       */
      async (request) => broker.saveNetworkPort(request),
    ),

    client.serve(
      subject(HUB_SERIAL_NETWORK_PORT_TEST_METHOD),
      serialNetworkAddressSchema,

      /**
       * Opens a socket to a port on the network once.
       *
       * @param address - Where it is.
       * @returns Whether it answered, how fast, or why not.
       */
      async (address) => broker.testNetworkPort(address),
    ),

    client.serve(
      subject(HUB_SERIAL_RELEASE_METHOD),
      serialPortIdRequestSchema,

      /**
       * Takes a port from its holder.
       *
       * @param request - Which.
       * @returns The port, free.
       */
      async (request) => broker.release(request.portId),
    ),

    client.serve(
      subject(HUB_SERIAL_FORGET_METHOD),
      serialPortIdRequestSchema,

      /**
       * Forgets a port unplugged, or one on the network.
       *
       * @param request - Which.
       * @returns Whether there was one.
       */
      async (request) => ({ isRemoved: await broker.forget(request.portId) }),
    ),

    client.serve(
      subject(HUB_SERIAL_CONSOLE_OPEN_METHOD),
      serialConsoleOpenRequestSchema,

      /**
       * Opens the console on a free port.
       *
       * @param request - The port and its line.
       * @returns The console.
       */
      async (request) => broker.openConsole(request.portId, request.line),
    ),

    client.serve(
      subject(HUB_SERIAL_CONSOLE_READ_METHOD),
      serialConsoleReadRequestSchema,

      /**
       * Reads what the console's port said and was sent after a cursor.
       *
       * @param request - The console and the cursor.
       * @returns The chunks.
       */
      (request) => broker.readConsole(request.consoleId, request.after),
    ),

    client.serve(
      subject(HUB_SERIAL_CONSOLE_WRITE_METHOD),
      serialConsoleWriteRequestSchema,

      /**
       * Sends bytes through the console.
       *
       * @param request - The console, the bytes and the line ending.
       * @returns How many bytes went out.
       */
      async (request) => ({
        bytes: await broker.writeConsole(request.consoleId, request.data, request.lineEnding),
      }),
    ),

    client.serve(
      subject(HUB_SERIAL_CONSOLE_CLOSE_METHOD),
      serialConsoleCloseRequestSchema,

      /**
       * Closes the console.
       *
       * @param request - Which.
       * @returns Whether there was one.
       */
      async (request) => ({ isClosed: await broker.closeConsole(request.consoleId) }),
    ),
  ];
}
