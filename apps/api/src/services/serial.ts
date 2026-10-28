/**
 * The house's Serial broker, read through and driven: `hub` holds it (ARCHITECTURE.md 4.2).
 *
 * Everything here is a question to the hub, which says who holds each port and never opens one
 * twice. A device reached through a port is added and removed as any device is; what it keeps of
 * its port is `transportConfig.serial`, checked where devices are written (`devices.ts`).
 */
import type { z } from 'zod';

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
  NotFoundError,
  serialConsoleCloseReplySchema,
  serialConsoleReadReplySchema,
  serialConsoleSchema,
  serialConsoleWriteReplySchema,
  serialDevicesReplySchema,
  serialForgetReplySchema,
  serialNetworkPortTestReplySchema,
  serialPortSchema,
  serialPortsReplySchema,
  serialStatusSchema,
  type SerialStatus,
} from '@nebulahome/contracts';

import { busOf, type IntegrationsContext } from './integrations.js';

/**
 * How long a question that opens a port may take: a port on the network has five seconds to
 * answer the socket (`apps/hub/src/serial/network.ts`).
 */
const OPENING_TIMEOUT_MS = 10_000;

/**
 * Asks the hub one of the broker's methods.
 *
 * @param context - The request's collaborators.
 * @param method - The method.
 * @param body - What it is asked.
 * @param schema - What the answer must be.
 * @param timeoutMs - How long the hub has; the service's usual wait unless the method needs more.
 * @returns The answer.
 * @throws {DeviceUnavailableError} When the hub cannot be asked.
 */
export async function askSerial<TSchema extends z.ZodType>(
  context: IntegrationsContext,
  method: string,
  body: object,
  schema: TSchema,
  timeoutMs = context.timeoutMs,
): Promise<z.output<TSchema>> {
  return busOf(context).request(busSubjects.service(HUB_SERVICE, method), body, schema, {
    traceId: context.traceId,
    timeoutMs,
  });
}

/**
 * Where the broker stands.
 *
 * @param context - The request's collaborators.
 * @returns Its state.
 */
export async function serialStatus(context: IntegrationsContext): Promise<SerialStatus> {
  return askSerial(context, HUB_SERIAL_STATUS_METHOD, {}, serialStatusSchema);
}

/**
 * Every port the server sees or the owner added, with who holds it.
 *
 * @param context - The request's collaborators.
 * @returns The ports, the plugged-in ones first.
 */
export async function serialPorts(context: IntegrationsContext) {
  return askSerial(context, HUB_SERIAL_PORTS_METHOD, {}, serialPortsReplySchema);
}

/**
 * The devices of the house reached through a port.
 *
 * @param context - The request's collaborators.
 * @returns Them.
 */
export async function serialDevices(context: IntegrationsContext) {
  return askSerial(context, HUB_SERIAL_DEVICES_METHOD, {}, serialDevicesReplySchema);
}

/**
 * Saves the owner's settings.
 *
 * @param context - The request's collaborators.
 * @param settings - Them, checked.
 * @returns Where the broker stands then.
 */
export async function saveSerialSettings(
  context: IntegrationsContext,
  settings: object,
): Promise<SerialStatus> {
  return askSerial(context, HUB_SERIAL_SETTINGS_METHOD, settings, serialStatusSchema);
}

/**
 * Ignores a port, or stops ignoring it.
 *
 * @param context - The request's collaborators.
 * @param request - The port, and whether it is ignored.
 * @returns The port.
 */
export async function ignoreSerialPort(context: IntegrationsContext, request: object) {
  return askSerial(context, HUB_SERIAL_IGNORE_METHOD, request, serialPortSchema);
}

/**
 * Saves a port on the network, new or changed.
 *
 * @param context - The request's collaborators.
 * @param request - Where it is, how it is spoken to, and its name.
 * @returns The port.
 * @throws {ConflictError} When another port is at that address.
 */
export async function saveSerialNetworkPort(context: IntegrationsContext, request: object) {
  return askSerial(
    context,
    HUB_SERIAL_NETWORK_PORT_SAVE_METHOD,
    request,
    serialPortSchema,
    OPENING_TIMEOUT_MS,
  );
}

/**
 * Asks whether a port on the network answers the socket.
 *
 * @param context - The request's collaborators.
 * @param address - Where it is, and how it is spoken to.
 * @returns Whether it answered, how fast, or why not.
 */
export async function testSerialNetworkPort(context: IntegrationsContext, address: object) {
  return askSerial(
    context,
    HUB_SERIAL_NETWORK_PORT_TEST_METHOD,
    address,
    serialNetworkPortTestReplySchema,
    OPENING_TIMEOUT_MS,
  );
}

/**
 * Takes a port from the device that holds it.
 *
 * @param context - The request's collaborators.
 * @param portId - The port.
 * @returns The port, free.
 * @throws {ConflictError} When a managed container holds it.
 */
export async function releaseSerialPort(context: IntegrationsContext, portId: string) {
  return askSerial(context, HUB_SERIAL_RELEASE_METHOD, { portId }, serialPortSchema);
}

/**
 * Forgets a port unplugged, or one on the network.
 *
 * @param context - The request's collaborators.
 * @param portId - The port.
 * @throws {NotFoundError} When there is no such port.
 * @throws {ConflictError} When it is plugged in.
 */
export async function forgetSerialPort(context: IntegrationsContext, portId: string) {
  const reply = await askSerial(
    context,
    HUB_SERIAL_FORGET_METHOD,
    { portId },
    serialForgetReplySchema,
  );

  if (!reply.isRemoved) {
    throw new NotFoundError('The Serial broker has no such port', { details: { portId } });
  }
}

/**
 * Opens the console on a free port.
 *
 * @param context - The request's collaborators.
 * @param request - The port, and how it is spoken.
 * @returns The console.
 * @throws {ConflictError} When the port is held.
 */
export async function openSerialConsole(context: IntegrationsContext, request: object) {
  return askSerial(
    context,
    HUB_SERIAL_CONSOLE_OPEN_METHOD,
    request,
    serialConsoleSchema,
    OPENING_TIMEOUT_MS,
  );
}

/**
 * Reads what the console's port said and was sent after a cursor.
 *
 * @param context - The request's collaborators.
 * @param request - The console, and the cursor.
 * @returns The chunks, oldest first.
 */
export async function readSerialConsole(context: IntegrationsContext, request: object) {
  return askSerial(context, HUB_SERIAL_CONSOLE_READ_METHOD, request, serialConsoleReadReplySchema);
}

/**
 * Sends bytes through the console.
 *
 * @param context - The request's collaborators.
 * @param request - The console, the bytes, and the line ending.
 * @returns How many bytes went out.
 */
export async function writeSerialConsole(context: IntegrationsContext, request: object) {
  return askSerial(
    context,
    HUB_SERIAL_CONSOLE_WRITE_METHOD,
    request,
    serialConsoleWriteReplySchema,
  );
}

/**
 * Closes the console.
 *
 * @param context - The request's collaborators.
 * @param consoleId - The console.
 * @returns Whether there was one.
 */
export async function closeSerialConsole(context: IntegrationsContext, consoleId: string) {
  return askSerial(
    context,
    HUB_SERIAL_CONSOLE_CLOSE_METHOD,
    { consoleId },
    serialConsoleCloseReplySchema,
  );
}
