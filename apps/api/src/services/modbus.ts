/**
 * The house's Modbus broker, read through and driven: `hub` holds it (ARCHITECTURE.md 4.2).
 *
 * Everything here is a question to the hub. What it adds is what removing a device means for the
 * house: the device is removed the way any device is - `hub` lets go, `core` deletes the rows -
 * and then the broker forgets it.
 */
import type { z } from 'zod';

import {
  busSubjects,
  HUB_MODBUS_DEVICE_REMOVE_METHOD,
  HUB_MODBUS_DEVICE_SAVE_METHOD,
  HUB_MODBUS_DEVICES_METHOD,
  HUB_MODBUS_FOUND_METHOD,
  HUB_MODBUS_IDENTIFY_METHOD,
  HUB_MODBUS_IGNORE_METHOD,
  HUB_MODBUS_SEARCH_METHOD,
  HUB_MODBUS_SETTINGS_METHOD,
  HUB_MODBUS_STATUS_METHOD,
  HUB_MODBUS_TEMPLATE_REMOVE_METHOD,
  HUB_MODBUS_TEMPLATE_SAVE_METHOD,
  HUB_MODBUS_TEMPLATES_METHOD,
  HUB_MODBUS_TEST_READ_METHOD,
  HUB_MODBUS_TEST_TEMPLATE_METHOD,
  HUB_MODBUS_TEST_WRITE_METHOD,
  HUB_SERVICE,
  modbusDeviceSchema,
  modbusDevicesReplySchema,
  modbusFoundReplySchema,
  modbusIdentifyReplySchema,
  modbusIgnoreReplySchema,
  modbusRemoveReplySchema,
  modbusStatusSchema,
  modbusTemplateRecordSchema,
  modbusTemplatesReplySchema,
  modbusTestReadReplySchema,
  modbusTestTemplateReplySchema,
  modbusTestWriteReplySchema,
  NotFoundError,
  type ModbusDevice,
  type ModbusDeviceInput,
  type ModbusSettings,
  type ModbusStatus,
  type ModbusTemplateRecord,
} from '@nebulahome/contracts';

import { deleteDevice, type DevicesContext, type RemovedDevice } from './devices.js';
import { busOf, type IntegrationsContext } from './integrations.js';

/**
 * Asks the hub one of the broker's methods.
 *
 * @param context - The request's collaborators.
 * @param method - The method.
 * @param body - What it is asked.
 * @param schema - What the answer must be.
 * @returns The answer.
 * @throws {DeviceUnavailableError} When the hub cannot be asked.
 */
export async function askModbus<TSchema extends z.ZodType>(
  context: IntegrationsContext,
  method: string,
  body: object,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  return busOf(context).request(busSubjects.service(HUB_SERVICE, method), body, schema, {
    traceId: context.traceId,
    timeoutMs: context.timeoutMs,
  });
}

/**
 * Where the broker stands.
 *
 * @param context - The request's collaborators.
 * @returns Its state.
 */
export async function modbusStatus(context: IntegrationsContext): Promise<ModbusStatus> {
  return askModbus(context, HUB_MODBUS_STATUS_METHOD, {}, modbusStatusSchema);
}

/**
 * The house's Modbus devices.
 *
 * @param context - The request's collaborators.
 * @returns Each, with how it answers.
 */
export async function modbusDevices(context: IntegrationsContext): Promise<ModbusDevice[]> {
  return (await askModbus(context, HUB_MODBUS_DEVICES_METHOD, {}, modbusDevicesReplySchema)).items;
}

/**
 * Saves a device, new or changed.
 *
 * @param context - The request's collaborators.
 * @param input - The device, checked.
 * @returns It, as the page lists it.
 */
export async function saveModbusDevice(
  context: IntegrationsContext,
  input: ModbusDeviceInput,
): Promise<ModbusDevice> {
  const saved = await askModbus(
    context,
    HUB_MODBUS_DEVICE_SAVE_METHOD,
    input,
    modbusDeviceSchema.nullable(),
  );

  if (saved === null) {
    throw new NotFoundError('The Modbus broker lost the device it saved', {
      details: { name: input.name },
    });
  }

  return saved;
}

/**
 * Removes a device: from the house, then from the broker.
 *
 * @param context - The request's collaborators.
 * @param id - The device's row.
 * @returns The device removed from the house, if it was added.
 * @throws {NotFoundError} When the broker has no such device.
 */
export async function removeModbusDevice(
  context: DevicesContext,
  id: string,
): Promise<RemovedDevice | null> {
  const device = (await modbusDevices(context)).find((each) => each.id === id);

  if (device === undefined) {
    throw new NotFoundError('The Modbus broker has no such device', { details: { id } });
  }

  // Removing the device from the house lets the broker forget it too; the request after it is for
  // a device never added.
  const removed = device.deviceId === null ? null : await deleteDevice(context, device.deviceId);

  await askModbus(context, HUB_MODBUS_DEVICE_REMOVE_METHOD, { id }, modbusRemoveReplySchema);

  return removed;
}

/**
 * Every template: the owner's, then the integrations'.
 *
 * @param context - The request's collaborators.
 * @returns The templates.
 */
export async function modbusTemplates(
  context: IntegrationsContext,
): Promise<ModbusTemplateRecord[]> {
  return (await askModbus(context, HUB_MODBUS_TEMPLATES_METHOD, {}, modbusTemplatesReplySchema))
    .items;
}

/**
 * Saves one of the owner's templates.
 *
 * @param context - The request's collaborators.
 * @param request - Its id when it is not new, and the template, checked.
 * @returns It, saved.
 */
export async function saveModbusTemplate(
  context: IntegrationsContext,
  request: object,
): Promise<ModbusTemplateRecord> {
  return askModbus(context, HUB_MODBUS_TEMPLATE_SAVE_METHOD, request, modbusTemplateRecordSchema);
}

/**
 * Removes one of the owner's templates no device uses.
 *
 * @param context - The request's collaborators.
 * @param id - The template.
 * @throws {NotFoundError} When there is no such template.
 * @throws {ConflictError} While a device uses it.
 */
export async function removeModbusTemplate(
  context: IntegrationsContext,
  id: string,
): Promise<void> {
  const reply = await askModbus(
    context,
    HUB_MODBUS_TEMPLATE_REMOVE_METHOD,
    { id },
    modbusRemoveReplySchema,
  );

  if (!reply.isRemoved) {
    throw new NotFoundError('There is no such Modbus template', { details: { id } });
  }
}

/**
 * Saves the search's settings: a search starts at once when it is on.
 *
 * @param context - The request's collaborators.
 * @param settings - Them, checked.
 * @returns Where the broker stands then.
 */
export async function saveModbusSettings(
  context: IntegrationsContext,
  settings: ModbusSettings,
): Promise<ModbusStatus> {
  return askModbus(context, HUB_MODBUS_SETTINGS_METHOD, settings, modbusStatusSchema);
}

/**
 * Starts a search of the network now.
 *
 * @param context - The request's collaborators.
 * @returns Where the broker stands, searching.
 */
export async function searchModbus(context: IntegrationsContext): Promise<ModbusStatus> {
  return askModbus(context, HUB_MODBUS_SEARCH_METHOD, {}, modbusStatusSchema);
}

/**
 * The servers found that are not devices of the house, and those ignored.
 *
 * @param context - The request's collaborators.
 * @returns Both.
 */
export async function modbusFound(context: IntegrationsContext) {
  return askModbus(context, HUB_MODBUS_FOUND_METHOD, {}, modbusFoundReplySchema);
}

/**
 * Ignores a server found, or stops ignoring it.
 *
 * @param context - The request's collaborators.
 * @param request - The server, and whether it is ignored.
 * @returns How many are ignored.
 */
export async function ignoreModbus(context: IntegrationsContext, request: object) {
  return askModbus(context, HUB_MODBUS_IGNORE_METHOD, request, modbusIgnoreReplySchema);
}

/**
 * Asks a device whether it answers, and which integrations recognise it.
 *
 * @param context - The request's collaborators.
 * @param request - The device.
 * @returns What it said.
 */
export async function identifyModbus(context: IntegrationsContext, request: object) {
  return askModbus(context, HUB_MODBUS_IDENTIFY_METHOD, request, modbusIdentifyReplySchema);
}

/**
 * Reads one capability from a device, for the template editor.
 *
 * @param context - The request's collaborators.
 * @param request - The device and the read.
 * @returns What was sent and got back.
 */
export async function testModbusRead(context: IntegrationsContext, request: object) {
  return askModbus(context, HUB_MODBUS_TEST_READ_METHOD, request, modbusTestReadReplySchema);
}

/**
 * Sends one command to a device, for the template editor.
 *
 * @param context - The request's collaborators.
 * @param request - The device, the entity and the command.
 * @returns What was sent and got back.
 */
export async function testModbusWrite(context: IntegrationsContext, request: object) {
  return askModbus(context, HUB_MODBUS_TEST_WRITE_METHOD, request, modbusTestWriteReplySchema);
}

/**
 * Reads every entity of a template from a device once.
 *
 * @param context - The request's collaborators.
 * @param request - The device and the template.
 * @returns Each value.
 */
export async function testModbusTemplate(context: IntegrationsContext, request: object) {
  return askModbus(
    context,
    HUB_MODBUS_TEST_TEMPLATE_METHOD,
    request,
    modbusTestTemplateReplySchema,
  );
}
