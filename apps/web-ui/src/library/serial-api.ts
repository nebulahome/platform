/**
 * The house's Serial broker, as its page reads and drives it (`/api/v1/brokers/serial`): the ports
 * the server sees and who holds each, the devices reached through them, the network ports, and
 * the console the owner debugs a protocol with.
 */
import { z } from 'zod';

import {
  serialConsoleCloseReplySchema,
  serialConsoleReadReplySchema,
  serialConsoleSchema,
  serialConsoleWriteReplySchema,
  serialDevicesReplySchema,
  serialNetworkPortTestReplySchema,
  serialPortSchema,
  serialPortsReplySchema,
  serialStatusSchema,
  type SERIAL_LINE_ENDINGS,
  type SerialConsole,
  type SerialDevice,
  type SerialLine,
  type SerialNetworkAddress,
  type SerialNetworkPortSaveRequest,
  type SerialPort,
  type SerialSettings,
  type SerialStatus,
} from '@nebulahome/contracts';

import { apiRequest } from '@/lib/api-client';

/** The keys the broker is cached under: below `brokers`, so reading the brokers again reads it. */
export const SERIAL_QUERY_KEYS = {
  status: ['brokers', 'serial', 'status'] as const,
  ports: ['brokers', 'serial', 'ports'] as const,
  devices: ['brokers', 'serial', 'devices'] as const,
  console: ['brokers', 'serial', 'console'] as const,
};

/**
 * The options of a read: its abort signal, when it has one.
 *
 * @param signal - Cancels the request.
 * @returns The options.
 */
function readOptions(signal: AbortSignal | undefined) {
  return signal === undefined ? {} : { signal };
}

/**
 * Reads where the broker stands.
 *
 * @param signal - Cancels the request.
 * @returns Its state, its access to the ports, the hot-plug watch and the conflicts.
 */
export async function fetchSerialStatus(signal?: AbortSignal): Promise<SerialStatus> {
  return apiRequest('/brokers/serial', serialStatusSchema, readOptions(signal));
}

/**
 * Lists the ports.
 *
 * @param signal - Cancels the request.
 * @returns Each, with its holder.
 */
export async function fetchSerialPorts(signal?: AbortSignal): Promise<SerialPort[]> {
  return (await apiRequest('/brokers/serial/ports', serialPortsReplySchema, readOptions(signal)))
    .items;
}

/**
 * Lists the devices reached through a port.
 *
 * @param signal - Cancels the request.
 * @returns Them.
 */
export async function fetchSerialDevices(signal?: AbortSignal): Promise<SerialDevice[]> {
  return (
    await apiRequest('/brokers/serial/devices', serialDevicesReplySchema, readOptions(signal))
  ).items;
}

/**
 * Saves the broker's settings.
 *
 * @param settings - Them.
 * @returns Where the broker stands then.
 */
export async function saveSerialSettings(settings: SerialSettings): Promise<SerialStatus> {
  return apiRequest('/brokers/serial/settings', serialStatusSchema, {
    method: 'PUT',
    body: settings,
  });
}

/**
 * Ignores a port, or stops ignoring it.
 *
 * @param portId - The port.
 * @param isIgnored - Whether to ignore it.
 * @returns The port.
 */
export async function ignoreSerialPort(portId: string, isIgnored: boolean): Promise<SerialPort> {
  return apiRequest('/brokers/serial/ignored', serialPortSchema, {
    method: 'PUT',
    body: { portId, isIgnored },
  });
}

/**
 * Adds a port on the network, or changes one.
 *
 * @param port - Its name and address.
 * @returns It, saved.
 */
export async function saveSerialNetworkPort(
  port: Omit<SerialNetworkPortSaveRequest, 'id'> & { readonly id?: string },
): Promise<SerialPort> {
  return apiRequest('/brokers/serial/ports', serialPortSchema, { method: 'POST', body: port });
}

/**
 * Opens a network port's socket once, to see that it answers.
 *
 * @param address - Its host, port and protocol.
 * @returns Whether it connected, how fast, or why not.
 */
export async function testSerialNetworkPort(address: SerialNetworkAddress) {
  return apiRequest('/brokers/serial/ports/test', serialNetworkPortTestReplySchema, {
    method: 'POST',
    body: address,
  });
}

/**
 * Takes a port from its holder.
 *
 * @param portId - The port.
 * @returns It, free.
 */
export async function releaseSerialPort(portId: string): Promise<SerialPort> {
  return apiRequest(
    `/brokers/serial/ports/${encodeURIComponent(portId)}/release`,
    serialPortSchema,
    { method: 'POST' },
  );
}

/**
 * Forgets a port unplugged, or one on the network.
 *
 * @param portId - The port.
 */
export async function forgetSerialPort(portId: string): Promise<void> {
  await apiRequest(`/brokers/serial/ports/${encodeURIComponent(portId)}`, z.undefined(), {
    method: 'DELETE',
  });
}

/**
 * Opens the console on a free port.
 *
 * @param portId - The port.
 * @param line - Its line settings.
 * @returns The console.
 */
export async function openSerialConsole(portId: string, line: SerialLine): Promise<SerialConsole> {
  return apiRequest('/brokers/serial/console', serialConsoleSchema, {
    method: 'POST',
    body: { portId, line },
  });
}

/**
 * Reads what crossed the console since a chunk.
 *
 * @param consoleId - The console.
 * @param after - The last chunk read; from the oldest kept when undefined.
 * @param signal - Cancels the request.
 * @returns The chunks, and where to read from next.
 */
export async function readSerialConsole(
  consoleId: string,
  after: number | undefined,
  signal?: AbortSignal,
) {
  const query = after === undefined ? '' : `?after=${String(after)}`;

  return apiRequest(
    `/brokers/serial/console/${encodeURIComponent(consoleId)}${query}`,
    serialConsoleReadReplySchema,
    readOptions(signal),
  );
}

/**
 * Writes bytes to the console's port.
 *
 * @param consoleId - The console.
 * @param data - The bytes, as hex.
 * @param lineEnding - What follows them.
 * @returns How many went.
 */
export async function writeSerialConsole(
  consoleId: string,
  data: string,
  lineEnding: (typeof SERIAL_LINE_ENDINGS)[number],
): Promise<number> {
  return (
    await apiRequest(
      `/brokers/serial/console/${encodeURIComponent(consoleId)}/write`,
      serialConsoleWriteReplySchema,
      { method: 'POST', body: { data, lineEnding } },
    )
  ).bytes;
}

/**
 * Closes the console, which frees its port.
 *
 * @param consoleId - The console.
 * @returns Whether it was open.
 */
export async function closeSerialConsole(consoleId: string): Promise<boolean> {
  return (
    await apiRequest(
      `/brokers/serial/console/${encodeURIComponent(consoleId)}`,
      serialConsoleCloseReplySchema,
      { method: 'DELETE' },
    )
  ).isClosed;
}
