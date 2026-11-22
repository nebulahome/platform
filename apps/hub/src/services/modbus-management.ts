/**
 * The Modbus broker on the bus: what the Brokers page reads and asks, through `api`.
 *
 * `svc.hub.modbus_status`, `modbus_devices`, `modbus_templates` and `modbus_found` read;
 * `modbus_device_save` and `modbus_device_remove` keep the devices, `modbus_template_save` and
 * `modbus_template_remove` the owner's templates; `modbus_settings` saves the search's settings -
 * and searches at once when it is on - and `modbus_search` searches now; `modbus_ignore` ignores a
 * server found, or stops; `modbus_identify` and the `modbus_test_*` methods ask a device, for the
 * add dialog and the template editor. Removing a device from the house is `api`'s ordinary device
 * removal, which tells the broker through the hub's `forget`.
 */
import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  busSubjects,
  emptyRequestSchema,
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
  modbusDeviceInputSchema,
  modbusIdentifyRequestSchema,
  modbusIdRequestSchema,
  modbusIgnoreRequestSchema,
  modbusSettingsSchema,
  modbusTemplateSaveRequestSchema,
  modbusTestReadRequestSchema,
  modbusTestTemplateRequestSchema,
  modbusTestWriteRequestSchema,
  type ModbusDevice,
} from '@nebulahome/contracts';

import type { TakenDevices } from '../domain/taken.js';
import type { ModbusBroker } from '../modbus/broker.js';

import { told, type BrokerChanged } from './broker-events.js';

/** What the Modbus methods need. */
export type ModbusManagementOptions = {
  readonly client: BusClient;
  readonly broker: ModbusBroker;

  /** Reads what is added, for the device each one is in the house. */
  readonly taken: () => Promise<TakenDevices>;

  /** Told what a method that succeeded changed, for the page's live event. */
  readonly changed?: BrokerChanged;
};

/**
 * Serves the Modbus broker's methods.
 *
 * @param options - What they read and drive.
 * @returns The subscriptions, to drop on stop.
 */
export function serveModbus(options: ModbusManagementOptions): BusSubscription[] {
  const { client, broker } = options;
  const changed = options.changed ?? ((): void => undefined);

  /**
   * One method of the broker's.
   *
   * @param method - Its name.
   * @returns Its subject.
   */
  const subject = (method: string): string => busSubjects.service(HUB_SERVICE, method);

  /**
   * One device as the page lists it, once saved.
   *
   * @param id - Its row.
   * @returns It.
   */
  const viewOf = async (id: string): Promise<ModbusDevice | undefined> =>
    broker.deviceViews(await options.taken()).find((device) => device.id === id);

  return [
    client.serve(
      subject(HUB_MODBUS_STATUS_METHOD),
      emptyRequestSchema,

      /**
       * Says where the broker stands.
       *
       * @returns Its state.
       */
      () => broker.status(),
    ),

    client.serve(
      subject(HUB_MODBUS_DEVICES_METHOD),
      emptyRequestSchema,

      /**
       * Lists the devices.
       *
       * @returns Each, with how it answers and the device it is in the house.
       */
      async () => ({ items: broker.deviceViews(await options.taken()) }),
    ),

    client.serve(
      subject(HUB_MODBUS_DEVICE_SAVE_METHOD),
      modbusDeviceInputSchema,

      /**
       * Saves a device.
       *
       * @param input - The device.
       * @returns It, as the page lists it.
       */
      async (input) => {
        const saved = await broker.saveDevice(input);

        return told((await viewOf(saved.id)) ?? null, changed, {
          broker: 'modbus',
          part: 'devices',
        });
      },
    ),

    client.serve(
      subject(HUB_MODBUS_DEVICE_REMOVE_METHOD),
      modbusIdRequestSchema,

      /**
       * Removes a device.
       *
       * @param request - Which.
       * @returns Whether there was one.
       */
      async (request) =>
        told(
          { isRemoved: await broker.removeDevice(request.id) },
          changed,
          { broker: 'modbus', part: 'devices' },
          { broker: 'modbus', part: 'found' },
          { broker: 'modbus', part: 'status' },
        ),
    ),

    client.serve(
      subject(HUB_MODBUS_TEMPLATES_METHOD),
      emptyRequestSchema,

      /**
       * Lists the templates.
       *
       * @returns The owner's, then the integrations'.
       */
      () => ({ items: broker.templates() }),
    ),

    client.serve(
      subject(HUB_MODBUS_TEMPLATE_SAVE_METHOD),
      modbusTemplateSaveRequestSchema,

      /**
       * Saves one of the owner's templates.
       *
       * @param request - Its id, when it is not new, and the template.
       * @returns It, saved.
       */
      async (request) =>
        told(
          await broker.saveTemplate(request.id, request.document),
          changed,
          { broker: 'modbus', part: 'templates' },
          { broker: 'modbus', part: 'devices' },
        ),
    ),

    client.serve(
      subject(HUB_MODBUS_TEMPLATE_REMOVE_METHOD),
      modbusIdRequestSchema,

      /**
       * Removes one of the owner's templates.
       *
       * @param request - Which.
       * @returns Whether there was one.
       */
      async (request) =>
        told({ isRemoved: await broker.removeTemplate(request.id) }, changed, {
          broker: 'modbus',
          part: 'templates',
        }),
    ),

    client.serve(
      subject(HUB_MODBUS_SETTINGS_METHOD),
      modbusSettingsSchema,

      /**
       * Saves the settings, searching at once when it is on.
       *
       * @param settings - The settings.
       * @returns Where the broker stands.
       */
      async (settings) =>
        told(await broker.saveSettings(settings), changed, { broker: 'modbus', part: 'status' }),
    ),

    client.serve(
      subject(HUB_MODBUS_SEARCH_METHOD),
      emptyRequestSchema,

      /**
       * Searches the network now.
       *
       * @returns Where the broker stands, searching.
       */
      () => broker.search(),
    ),

    client.serve(
      subject(HUB_MODBUS_FOUND_METHOD),
      emptyRequestSchema,

      /**
       * Lists the servers found, and those ignored.
       *
       * @returns Both.
       */
      () => broker.found(),
    ),

    client.serve(
      subject(HUB_MODBUS_IGNORE_METHOD),
      modbusIgnoreRequestSchema,

      /**
       * Ignores a server found, or stops ignoring it.
       *
       * @param request - The server, and whether it is ignored.
       * @returns How many are ignored.
       */
      async (request) =>
        told(
          { count: await broker.ignore(request.host, request.port, request.isIgnored) },
          changed,
          { broker: 'modbus', part: 'found' },
        ),
    ),

    client.serve(
      subject(HUB_MODBUS_IDENTIFY_METHOD),
      modbusIdentifyRequestSchema,

      /**
       * Asks a device whether it answers, and who recognises it.
       *
       * @param request - The device.
       * @returns What it said.
       */
      (request) => broker.identify(request.target),
    ),

    client.serve(
      subject(HUB_MODBUS_TEST_READ_METHOD),
      modbusTestReadRequestSchema,

      /**
       * Reads one capability from a device.
       *
       * @param request - The device and the read.
       * @returns What was sent and got back.
       */
      (request) => broker.testRead(request.target, request.read, request.wordOrder),
    ),

    client.serve(
      subject(HUB_MODBUS_TEST_WRITE_METHOD),
      modbusTestWriteRequestSchema,

      /**
       * Sends one command to a device.
       *
       * @param request - The device, the entity and the command.
       * @returns What was sent and got back.
       */
      (request) =>
        broker.testWrite(
          request.target,
          request.entity,
          request.capability,
          request.command,
          request.wordOrder,
        ),
    ),

    client.serve(
      subject(HUB_MODBUS_TEST_TEMPLATE_METHOD),
      modbusTestTemplateRequestSchema,

      /**
       * Reads every entity of a template from a device once.
       *
       * @param request - The device and the template.
       * @returns Each value.
       */
      (request) => broker.testTemplate(request.target, request.document),
    ),
  ];
}
