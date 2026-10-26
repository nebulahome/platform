/**
 * The house's Modbus broker, as its page reads and drives it (`/api/v1/brokers/modbus`): the
 * devices and the templates they are read through, the network search, and the questions the add
 * dialog and the template editor ask a device.
 */
import { z } from 'zod';

import {
  modbusDeviceSchema,
  modbusDevicesReplySchema,
  modbusFoundReplySchema,
  modbusIdentifyReplySchema,
  modbusIgnoreReplySchema,
  modbusStatusSchema,
  modbusTemplateRecordSchema,
  modbusTemplatesReplySchema,
  modbusTestReadReplySchema,
  modbusTestTemplateReplySchema,
  modbusTestWriteReplySchema,
  type ModbusCapability,
  type ModbusDevice,
  type ModbusDeviceInput,
  type ModbusEntity,
  type ModbusRead,
  type ModbusSettings,
  type ModbusStatus,
  type ModbusTarget,
  type ModbusTemplate,
  type ModbusTemplateRecord,
} from '@nebulahome/contracts';

import { apiRequest } from '@/lib/api-client';

/** The keys the broker is cached under: below `brokers`, so reading the brokers again reads it. */
export const MODBUS_QUERY_KEYS = {
  status: ['brokers', 'modbus', 'status'] as const,
  devices: ['brokers', 'modbus', 'devices'] as const,
  templates: ['brokers', 'modbus', 'templates'] as const,
  found: ['brokers', 'modbus', 'found'] as const,
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
 * @returns Its state, its settings and the last search.
 */
export async function fetchModbusStatus(signal?: AbortSignal): Promise<ModbusStatus> {
  return apiRequest('/brokers/modbus', modbusStatusSchema, readOptions(signal));
}

/**
 * Lists the house's Modbus devices.
 *
 * @param signal - Cancels the request.
 * @returns Each, with how it answers.
 */
export async function fetchModbusDevices(signal?: AbortSignal): Promise<ModbusDevice[]> {
  return (
    await apiRequest('/brokers/modbus/devices', modbusDevicesReplySchema, readOptions(signal))
  ).items;
}

/**
 * Adds a device, or changes one.
 *
 * @param device - The device: a template at an address.
 * @returns It, as the page lists it.
 */
export async function saveModbusDevice(device: ModbusDeviceInput): Promise<ModbusDevice> {
  return apiRequest('/brokers/modbus/devices', modbusDeviceSchema, {
    method: 'POST',
    body: device,
  });
}

/**
 * Removes a device from the house.
 *
 * @param id - Which.
 */
export async function removeModbusDevice(id: string): Promise<void> {
  await apiRequest(`/brokers/modbus/devices/${encodeURIComponent(id)}`, z.undefined(), {
    method: 'DELETE',
  });
}

/**
 * Lists the templates: the owner's, then the integrations'.
 *
 * @param signal - Cancels the request.
 * @returns Them.
 */
export async function fetchModbusTemplates(signal?: AbortSignal): Promise<ModbusTemplateRecord[]> {
  return (
    await apiRequest('/brokers/modbus/templates', modbusTemplatesReplySchema, readOptions(signal))
  ).items;
}

/**
 * Saves one of the owner's templates, new when it has no id.
 *
 * @param request - Its id, and the template.
 * @param request.id - The template's id; a new one when undefined.
 * @param request.document - The template.
 * @returns It, saved.
 */
export async function saveModbusTemplate(request: {
  readonly id: string | undefined;
  readonly document: ModbusTemplate;
}): Promise<ModbusTemplateRecord> {
  return apiRequest('/brokers/modbus/templates', modbusTemplateRecordSchema, {
    method: 'POST',
    body: request.id === undefined ? { document: request.document } : request,
  });
}

/**
 * Removes one of the owner's templates no device uses.
 *
 * @param id - Which.
 */
export async function removeModbusTemplate(id: string): Promise<void> {
  await apiRequest(`/brokers/modbus/templates/${encodeURIComponent(id)}`, z.undefined(), {
    method: 'DELETE',
  });
}

/**
 * Saves the search's settings; a search starts at once when it is on.
 *
 * @param settings - Them.
 * @returns Where the broker stands then.
 */
export async function saveModbusSettings(settings: ModbusSettings): Promise<ModbusStatus> {
  return apiRequest('/brokers/modbus/settings', modbusStatusSchema, {
    method: 'PUT',
    body: settings,
  });
}

/**
 * Starts a search of the network now.
 *
 * @returns Where the broker stands, searching.
 */
export async function searchModbus(): Promise<ModbusStatus> {
  return apiRequest('/brokers/modbus/search', modbusStatusSchema, { method: 'POST' });
}

/**
 * Lists the servers found on the network, and those ignored.
 *
 * @param signal - Cancels the request.
 * @returns Both.
 */
export async function fetchModbusFound(signal?: AbortSignal) {
  return apiRequest('/brokers/modbus/found', modbusFoundReplySchema, readOptions(signal));
}

/**
 * Ignores a server found, or stops ignoring it.
 *
 * @param request - The server, and whether it is ignored now.
 * @param request.host - Its address.
 * @param request.port - Its port.
 * @param request.isIgnored - Whether it is ignored now.
 * @returns How many are ignored.
 */
export async function ignoreModbus(request: {
  readonly host: string;
  readonly port: number;
  readonly isIgnored: boolean;
}) {
  return apiRequest('/brokers/modbus/ignored', modbusIgnoreReplySchema, {
    method: 'PUT',
    body: request,
  });
}

/**
 * Asks a device whether it answers, and which integrations recognise it.
 *
 * @param target - The device.
 * @returns What it said.
 */
export async function identifyModbus(target: ModbusTarget) {
  return apiRequest('/brokers/modbus/identify', modbusIdentifyReplySchema, {
    method: 'POST',
    body: { target },
  });
}

/**
 * Reads one capability from a device.
 *
 * @param request - The device, the read and the word order.
 * @param request.target - The device.
 * @param request.read - What to read.
 * @param request.wordOrder - Which register of a 32-bit value holds the high word.
 * @returns What was sent and got back.
 */
export async function testModbusRead(request: {
  readonly target: ModbusTarget;
  readonly read: ModbusRead;
  readonly wordOrder: 'high' | 'low';
}) {
  return apiRequest('/brokers/modbus/test/read', modbusTestReadReplySchema, {
    method: 'POST',
    body: request,
  });
}

/**
 * Sends one command to a device.
 *
 * @param request - The device, the entity, the capability and the command.
 * @param request.target - The device.
 * @param request.entity - The entity.
 * @param request.capability - The capability commanded.
 * @param request.command - The command.
 * @param request.wordOrder - Which register of a 32-bit value holds the high word.
 * @returns What was sent and got back.
 */
export async function testModbusWrite(request: {
  readonly target: ModbusTarget;
  readonly entity: ModbusEntity;
  readonly capability: ModbusCapability;
  readonly command: Readonly<Record<string, unknown>>;
  readonly wordOrder: 'high' | 'low';
}) {
  return apiRequest('/brokers/modbus/test/write', modbusTestWriteReplySchema, {
    method: 'POST',
    body: request,
  });
}

/**
 * Reads every entity of a template from a device once.
 *
 * @param request - The device and the template.
 * @param request.target - The device.
 * @param request.document - The template.
 * @returns Each capability's value.
 */
export async function testModbusTemplate(request: {
  readonly target: ModbusTarget;
  readonly document: ModbusTemplate;
}) {
  return apiRequest('/brokers/modbus/test/template', modbusTestTemplateReplySchema, {
    method: 'POST',
    body: request,
  });
}
