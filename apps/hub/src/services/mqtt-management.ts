/**
 * The MQTT broker on the bus: what the Brokers page reads and asks, through `api`, and the
 * usernames the supervisor asks for the containers it runs.
 *
 * `svc.hub.mqtt_status`, `mqtt_devices`, `mqtt_clients`, `mqtt_topics` and `mqtt_mappings` read;
 * `mqtt_settings` saves the owner's settings and starts the broker listening again with them;
 * `mqtt_client_add` and `mqtt_client_remove` add and remove a client; `mqtt_mapping_save` and
 * `mqtt_mapping_remove` keep the owner's mappings; `mqtt_restore` brings back a device removed
 * from the house. Removing a device from the house is `api`'s ordinary device removal, which tells
 * the broker through the hub's `forget`.
 *
 * `mqtt_credentials` answers the supervisor alone: a username that reaches a container's topics
 * is for the container the supervisor runs, and for nobody else on the bus.
 */
import { z } from 'zod';

import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  busSubjects,
  HUB_MQTT_CLIENT_ADD_METHOD,
  HUB_MQTT_CLIENT_REMOVE_METHOD,
  HUB_MQTT_CLIENTS_METHOD,
  HUB_MQTT_CREDENTIALS_METHOD,
  HUB_MQTT_DEVICES_METHOD,
  HUB_MQTT_MAPPING_REMOVE_METHOD,
  HUB_MQTT_MAPPING_SAVE_METHOD,
  HUB_MQTT_MAPPINGS_METHOD,
  HUB_MQTT_RESTORE_METHOD,
  HUB_MQTT_SETTINGS_METHOD,
  HUB_MQTT_STATUS_METHOD,
  HUB_MQTT_TOPICS_METHOD,
  HUB_SERVICE,
  mqttClientAddRequestSchema,
  mqttClientRemoveRequestSchema,
  mqttCredentialsRequestSchema,
  mqttMappingInputSchema,
  mqttMappingRemoveRequestSchema,
  mqttRestoreRequestSchema,
  mqttSettingsSchema,
  mqttTopicsRequestSchema,
  PermissionError,
  type MqttDevice,
} from '@nebulahome/contracts';

import type { TakenDevices } from '../domain/taken.js';
import type { MqttBroker } from '../mqtt/broker.js';

import type { DiscoveryService } from './discovery.js';

/** The one service a container's username is given to. */
const CREDENTIALS_CALLER = 'supervisor';

/** What the MQTT methods need. */
export type MqttManagementOptions = {
  readonly client: BusClient;
  readonly broker: MqttBroker;

  /** Discovery, for which vendors' rules take a device; undefined before it has started. */
  readonly discovery: () => DiscoveryService | undefined;

  /** Reads what is added, for the device each one the broker hears is in the house. */
  readonly taken: () => Promise<TakenDevices>;
};

/**
 * Every device the broker hears, with the device it is in the house.
 *
 * @param options - The broker, discovery and what is added.
 * @returns The devices, by name.
 */
export async function mqttDevicesView(options: MqttManagementOptions): Promise<MqttDevice[]> {
  const { broker } = options;
  const taken = await options.taken();
  const discovery = options.discovery();

  return broker
    .heard()
    .map((device) => {
      const added = taken.mqtt.get(device.deviceKey);
      const claimedBy = (discovery?.brokerClaims('mqtt', device.identity) ?? []).map(
        ({ vendor }) => vendor.id,
      );

      return {
        identity: device.identity,
        entityCount: device.entities.length,
        deviceId: added?.instanceId ?? null,
        kind: added?.kind ?? null,
        claimedBy: claimedBy.slice(0, 16),
        isRemoved: broker.isRemoved(device.deviceKey),
      };
    })
    .sort((left, right) => left.identity.name.localeCompare(right.identity.name));
}

/**
 * Serves the MQTT broker's methods.
 *
 * @param options - What they read and drive.
 * @returns The subscriptions, to drop on stop.
 */
export function serveMqtt(options: MqttManagementOptions): BusSubscription[] {
  const { client, broker } = options;

  /**
   * One method of the broker's.
   *
   * @param method - Its name.
   * @returns Its subject.
   */
  const subject = (method: string): string => busSubjects.service(HUB_SERVICE, method);

  return [
    client.serve(
      subject(HUB_MQTT_STATUS_METHOD),
      z.object({}),

      /**
       * Says where the broker stands.
       *
       * @returns Its state.
       */
      () => broker.status(),
    ),

    client.serve(
      subject(HUB_MQTT_DEVICES_METHOD),
      z.object({}),

      /**
       * Lists the devices the broker hears.
       *
       * @returns Each, with the device it is in the house.
       */
      async () => ({ items: await mqttDevicesView(options) }),
    ),

    client.serve(
      subject(HUB_MQTT_RESTORE_METHOD),
      mqttRestoreRequestSchema,

      /**
       * Brings back a device removed from the house.
       *
       * @param request - Which.
       * @returns Whether it was removed.
       */
      (request) => ({ isRestored: broker.restore(request.deviceKey) }),
    ),

    client.serve(
      subject(HUB_MQTT_SETTINGS_METHOD),
      mqttSettingsSchema,

      /**
       * Saves the owner's settings, and starts listening again with them.
       *
       * @param settings - Them.
       * @returns Where the broker stands then.
       */
      async (settings) => broker.saveSettings(settings),
    ),

    client.serve(
      subject(HUB_MQTT_CLIENTS_METHOD),
      z.object({}),

      /**
       * Lists who may connect, and who is connected.
       *
       * @returns The usernames, with their connections, and the connections without one.
       */
      () => {
        const { items, anonymous } = broker.clients();

        return {
          items: items.map((principal) => ({
            username: principal.username,
            kind: principal.kind,
            label: principal.label,
            publish: [...principal.access.publish],
            subscribe: [...principal.access.subscribe],
            createdAt: principal.createdAt,
            sessions: [...principal.sessions],
          })),
          anonymous,
        };
      },
    ),

    client.serve(
      subject(HUB_MQTT_CLIENT_ADD_METHOD),
      mqttClientAddRequestSchema,

      /**
       * Adds a client.
       *
       * @param request - Its username, label and reach.
       * @returns Its username and password, this once.
       */
      async (request) => ({
        username: request.username,
        password: await broker.addClient(request),
      }),
    ),

    client.serve(
      subject(HUB_MQTT_CLIENT_REMOVE_METHOD),
      mqttClientRemoveRequestSchema,

      /**
       * Removes a client, and closes its connections.
       *
       * @param request - Which.
       * @returns Whether there was one.
       */
      (request) => ({ isRemoved: broker.removeClient(request.username) }),
    ),

    client.serve(
      subject(HUB_MQTT_TOPICS_METHOD),
      mqttTopicsRequestSchema,

      /**
       * Lists the last message of the topics under a prefix.
       *
       * @param request - The prefix, and how many.
       * @returns Them, and how many there are.
       */
      (request) => broker.topics(request.prefix, request.limit),
    ),

    client.serve(
      subject(HUB_MQTT_MAPPINGS_METHOD),
      z.object({}),

      /**
       * Lists the owner's mappings.
       *
       * @returns Them.
       */
      () => ({ items: broker.mappings() }),
    ),

    client.serve(
      subject(HUB_MQTT_MAPPING_SAVE_METHOD),
      mqttMappingInputSchema,

      /**
       * Saves a mapping.
       *
       * @param mapping - It.
       * @returns It, with its id.
       */
      (mapping) => broker.saveMapping(mapping),
    ),

    client.serve(
      subject(HUB_MQTT_MAPPING_REMOVE_METHOD),
      mqttMappingRemoveRequestSchema,

      /**
       * Removes a mapping.
       *
       * @param request - Which.
       * @returns Whether there was one.
       */
      (request) => ({ isRemoved: broker.removeMapping(request.id) }),
    ),

    client.serve(
      subject(HUB_MQTT_CREDENTIALS_METHOD),
      mqttCredentialsRequestSchema,

      /**
       * Makes a container a username of its own, for the supervisor that runs it.
       *
       * @param request - Whose container, and its topics.
       * @param context - Who asks.
       * @returns The username, its password and the port.
       * @throws {PermissionError} When anyone but the supervisor asks.
       */
      async (request, context) => {
        if (context.header.source !== CREDENTIALS_CALLER) {
          throw new PermissionError(
            `${context.header.source} may not ask for a container's MQTT username`,
          );
        }

        return broker.containerCredentials(request.owner, request.topics);
      },
    ),
  ];
}
