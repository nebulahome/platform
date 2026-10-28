/**
 * `/brokers/serial`: the house's Serial broker, for its page on the Brokers screen.
 *
 * Reading it is reading devices (`device:read`). Adding a port on the network, testing one, and
 * ignoring a port are `device:write`; forgetting a port removes it (`device:delete`). The settings,
 * taking a port from the device that holds it, and the console - which reads and writes a port's
 * raw bytes - are configuring an integration (`integration:configure`). Opening the console,
 * releasing and forgetting a port are audited.
 */
import { z } from 'zod';

import {
  serialConsoleCloseReplySchema,
  serialConsoleOpenRequestSchema,
  serialConsoleReadReplySchema,
  serialConsoleSchema,
  serialConsoleWriteReplySchema,
  serialConsoleWriteRequestSchema,
  serialDevicesReplySchema,
  serialIgnoreRequestSchema,
  serialNetworkAddressSchema,
  serialNetworkPortSaveRequestSchema,
  serialNetworkPortTestReplySchema,
  serialPortSchema,
  serialPortsReplySchema,
  serialSettingsSchema,
  serialStatusSchema,
} from '@nebulahome/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import {
  closeSerialConsole,
  forgetSerialPort,
  ignoreSerialPort,
  openSerialConsole,
  readSerialConsole,
  releaseSerialPort,
  saveSerialNetworkPort,
  saveSerialSettings,
  serialDevices,
  serialPorts,
  serialStatus,
  testSerialNetworkPort,
  writeSerialConsole,
} from '../services/serial.js';

import { forRequest } from './devices.js';

/** Which port a request is about. */
const portParamsSchema = z.object({ portId: z.uuid() });

/** Which console a request is about. */
const consoleParamsSchema = z.object({ consoleId: z.string().min(1).max(64) });

/** Where a console read starts: after this chunk, or at the oldest kept. */
const consoleReadQuerySchema = z.object({ after: z.coerce.number().int().min(0).optional() });

/**
 * Registers the Serial broker's routes.
 *
 * @param environment - Where routes are registered and documented.
 * @param context - The service's collaborators.
 */
export function registerSerialRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/brokers/serial',
      summary: "Where the house's Serial broker stands",
      tag: 'Brokers',
      permission: 'device:read',
      response: serialStatusSchema,
    },

    /**
     * Says where the broker stands.
     *
     * @param route - Who is asking.
     * @returns Its state.
     */
    async (route) => {
      requirePermission(route.identity, 'device:read');

      return serialStatus(forRequest(context, route.request.traceId));
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/brokers/serial/ports',
      summary: 'List the serial ports the server sees or the owner added, with who holds each',
      tag: 'Brokers',
      permission: 'device:read',
      response: serialPortsReplySchema,
    },

    /**
     * Lists the ports.
     *
     * @param route - Who is asking.
     * @returns Them, the plugged-in ones first.
     */
    async (route) => {
      requirePermission(route.identity, 'device:read');

      return serialPorts(forRequest(context, route.request.traceId));
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/brokers/serial/devices',
      summary: 'List the devices of the house reached through a serial port',
      tag: 'Brokers',
      permission: 'device:read',
      response: serialDevicesReplySchema,
    },

    /**
     * Lists the devices.
     *
     * @param route - Who is asking.
     * @returns Them.
     */
    async (route) => {
      requirePermission(route.identity, 'device:read');

      return serialDevices(forRequest(context, route.request.traceId));
    },
  );

  defineRoute(
    environment,
    {
      method: 'PUT',
      url: '/brokers/serial/settings',
      summary: "Change the Serial broker's settings",
      tag: 'Brokers',
      permission: 'integration:configure',
      body: serialSettingsSchema,
      response: serialStatusSchema,
    },

    /**
     * Saves the settings.
     *
     * @param route - The settings, and who is asking.
     * @returns Where the broker stands then.
     */
    async (route) => {
      requirePermission(route.identity, 'integration:configure');

      const status = await saveSerialSettings(
        forRequest(context, route.request.traceId),
        route.body,
      );

      await context.audit.record({
        action: 'serial.settings',
        resourceType: 'serial',
        resourceId: 'settings',
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { ...route.body },
      });

      return status;
    },
  );

  defineRoute(
    environment,
    {
      method: 'PUT',
      url: '/brokers/serial/ignored',
      summary: 'Ignore a serial port, or stop ignoring it',
      tag: 'Brokers',
      permission: 'device:write',
      body: serialIgnoreRequestSchema,
      response: serialPortSchema,
    },

    /**
     * Ignores a port, or stops.
     *
     * @param route - The port, and who is asking.
     * @returns The port.
     */
    async (route) => {
      requirePermission(route.identity, 'device:write');

      return ignoreSerialPort(forRequest(context, route.request.traceId), route.body);
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/serial/ports',
      summary: 'Add a serial port on the network, or change one',
      tag: 'Brokers',
      permission: 'device:write',
      body: serialNetworkPortSaveRequestSchema,
      response: serialPortSchema,
    },

    /**
     * Saves a port on the network: one with an id replaces it.
     *
     * @param route - The port, and who is asking.
     * @returns It, as the page lists it.
     */
    async (route) => {
      requirePermission(route.identity, 'device:write');

      const saved = await saveSerialNetworkPort(
        forRequest(context, route.request.traceId),
        route.body,
      );

      await context.audit.record({
        action: 'serial.port.save',
        resourceType: 'serial',
        resourceId: saved.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { name: saved.name, path: saved.path },
      });

      return saved;
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/serial/ports/test',
      summary: 'Ask whether a serial port on the network answers',
      tag: 'Brokers',
      permission: 'device:write',
      body: serialNetworkAddressSchema,
      response: serialNetworkPortTestReplySchema,
    },

    /**
     * Opens a socket to the address and closes it.
     *
     * @param route - The address, and who is asking.
     * @returns Whether it answered, how fast, or why not.
     */
    async (route) => {
      requirePermission(route.identity, 'device:write');

      return testSerialNetworkPort(forRequest(context, route.request.traceId), route.body);
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/serial/ports/:portId/release',
      summary: 'Take a serial port from the device that holds it',
      tag: 'Brokers',
      permission: 'integration:configure',
      params: portParamsSchema,
      response: serialPortSchema,
    },

    /**
     * Frees a port: its device is refused it until it is started again with the port free.
     *
     * @param route - The port, and who is asking.
     * @returns The port, free.
     */
    async (route) => {
      requirePermission(route.identity, 'integration:configure');

      const port = await releaseSerialPort(
        forRequest(context, route.request.traceId),
        route.params.portId,
      );

      await context.audit.record({
        action: 'serial.port.release',
        resourceType: 'serial',
        resourceId: route.params.portId,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { name: port.name },
      });

      return port;
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/brokers/serial/ports/:portId',
      summary: 'Forget a serial port unplugged, or one on the network',
      tag: 'Brokers',
      permission: 'device:delete',
      params: portParamsSchema,
      successStatus: 204,
    },

    /**
     * Forgets a port.
     *
     * @param route - The port, and who is asking.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'device:delete');

      await forgetSerialPort(forRequest(context, route.request.traceId), route.params.portId);
      await context.audit.record({
        action: 'serial.port.forget',
        resourceType: 'serial',
        resourceId: route.params.portId,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: {},
      });
    },
  );

  registerSerialConsoleRoutes(environment, context);
}

/**
 * Registers the console's routes: a port's raw bytes, read and written by the owner.
 *
 * @param environment - Where routes are registered and documented.
 * @param context - The service's collaborators.
 */
function registerSerialConsoleRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/serial/console',
      summary: 'Open the console on a free serial port',
      tag: 'Brokers',
      permission: 'integration:configure',
      body: serialConsoleOpenRequestSchema,
      response: serialConsoleSchema,
    },

    /**
     * Opens the console: the port is the console's until it is closed.
     *
     * @param route - The port and its line, and who is asking.
     * @returns The console.
     */
    async (route) => {
      requirePermission(route.identity, 'integration:configure');

      const opened = await openSerialConsole(
        forRequest(context, route.request.traceId),
        route.body,
      );

      await context.audit.record({
        action: 'serial.console.open',
        resourceType: 'serial',
        resourceId: opened.portId,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { consoleId: opened.consoleId, line: opened.line },
      });

      return opened;
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/brokers/serial/console/:consoleId',
      summary: "Read what the console's port said and was sent after a cursor",
      tag: 'Brokers',
      permission: 'integration:configure',
      params: consoleParamsSchema,
      query: consoleReadQuerySchema,
      response: serialConsoleReadReplySchema,
    },

    /**
     * Reads the console.
     *
     * shortcut: polled by the page, move to the websocket topic if latency matters.
     *
     * @param route - The console and the cursor, and who is asking.
     * @returns The chunks, oldest first.
     */
    async (route) => {
      requirePermission(route.identity, 'integration:configure');

      return readSerialConsole(forRequest(context, route.request.traceId), {
        consoleId: route.params.consoleId,
        ...(route.query.after === undefined ? {} : { after: route.query.after }),
      });
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/serial/console/:consoleId/write',
      summary: 'Send bytes through the console to its port',
      tag: 'Brokers',
      permission: 'integration:configure',
      params: consoleParamsSchema,
      body: serialConsoleWriteRequestSchema.omit({ consoleId: true }),
      response: serialConsoleWriteReplySchema,
    },

    /**
     * Sends bytes, and the line ending after them.
     *
     * @param route - The console, the bytes, and who is asking.
     * @returns How many bytes went out.
     */
    async (route) => {
      requirePermission(route.identity, 'integration:configure');

      return writeSerialConsole(forRequest(context, route.request.traceId), {
        ...route.body,
        consoleId: route.params.consoleId,
      });
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/brokers/serial/console/:consoleId',
      summary: 'Close the console, which frees its port',
      tag: 'Brokers',
      permission: 'integration:configure',
      params: consoleParamsSchema,
      response: serialConsoleCloseReplySchema,
    },

    /**
     * Closes the console.
     *
     * @param route - The console, and who is asking.
     * @returns Whether there was one.
     */
    async (route) => {
      requirePermission(route.identity, 'integration:configure');

      return closeSerialConsole(forRequest(context, route.request.traceId), route.params.consoleId);
    },
  );
}
