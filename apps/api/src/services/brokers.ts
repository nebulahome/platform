/**
 * The platform's brokers, read through and driven: the house's Matter fabric and its MQTT broker,
 * which `hub` holds (ARCHITECTURE.md 4.2).
 *
 * Everything here is a question to the hub. What it adds is what removing something means for the
 * house: a node's devices - or a mapping's - are removed the way any device is - `hub` lets go,
 * `core` deletes the rows - and then the node is taken off the fabric, or the mapping forgotten.
 * A node may refuse when it does not answer: the devices are gone either way, and the page offers
 * to try the fabric again.
 */
import { and, eq, sql } from 'drizzle-orm';

import {
  busSubjects,
  HUB_MATTER_ANSWER_METHOD,
  HUB_MATTER_CANCEL_METHOD,
  HUB_MATTER_COMMISSION_METHOD,
  HUB_MATTER_NODES_METHOD,
  HUB_MATTER_REMOVE_METHOD,
  HUB_MATTER_RESTART_METHOD,
  HUB_MATTER_RESTORE_METHOD,
  HUB_MATTER_STATUS_METHOD,
  HUB_MQTT_CLIENT_ADD_METHOD,
  HUB_MQTT_CLIENT_REMOVE_METHOD,
  HUB_MQTT_CLIENTS_METHOD,
  HUB_MQTT_DEVICES_METHOD,
  HUB_MQTT_MAPPING_REMOVE_METHOD,
  HUB_MQTT_MAPPING_SAVE_METHOD,
  HUB_MQTT_MAPPINGS_METHOD,
  HUB_MQTT_RESTART_METHOD,
  HUB_MQTT_RESTORE_METHOD,
  HUB_MQTT_SETTINGS_METHOD,
  HUB_MQTT_STATUS_METHOD,
  HUB_MQTT_TOPICS_METHOD,
  HUB_SERVICE,
  MATTER_GENERIC_KIND,
  MATTER_TRANSPORT,
  MATTER_VENDOR,
  matterCommissioningSchema,
  matterNodesReplySchema,
  matterRemoveReplySchema,
  matterRestoreReplySchema,
  matterStatusSchema,
  MQTT_GENERIC_KIND,
  MQTT_HOUSE_TRANSPORT,
  MQTT_VENDOR,
  mqttClientAddReplySchema,
  mqttClientRemoveReplySchema,
  mqttClientsReplySchema,
  mqttDevicesReplySchema,
  mqttMappingRemoveReplySchema,
  mqttMappingSchema,
  mqttMappingsReplySchema,
  mqttRestoreReplySchema,
  mqttStatusSchema,
  mqttTopicsReplySchema,
  NotFoundError,
  type BrokerSummary,
  type MatterAnswerRequest,
  type MatterCommissioning,
  type MatterNode,
  type MatterRestoreRequest,
  type MatterStatus,
  type MqttClientAddRequest,
  type MqttDevice,
  type MqttMapping,
  type MqttMappingInput,
  type MqttSettings,
  type MqttStatus,
} from '@nebulahome/contracts';
import { schema } from '@nebulahome/db';

import { deleteDevice, type DevicesContext, type RemovedDevice } from './devices.js';
import { busOf, listCatalogue, reloadOnHub, type IntegrationsContext } from './integrations.js';

/**
 * Where the Matter fabric stands.
 *
 * @param context - The request's collaborators.
 * @returns Its state.
 * @throws {DeviceUnavailableError} When the hub cannot be asked.
 */
export async function matterStatus(context: IntegrationsContext): Promise<MatterStatus> {
  return busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_MATTER_STATUS_METHOD),
    {},
    matterStatusSchema,
    { traceId: context.traceId },
  );
}

/**
 * Every node of the fabric, with the devices it is in the house.
 *
 * @param context - The request's collaborators.
 * @returns The nodes.
 * @throws {DeviceUnavailableError} When the hub cannot be asked.
 */
export async function matterNodes(context: IntegrationsContext): Promise<MatterNode[]> {
  const reply = await busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_MATTER_NODES_METHOD),
    {},
    matterNodesReplySchema,
    { traceId: context.traceId },
  );

  return reply.items;
}

/**
 * The brokers, for their cards.
 *
 * @param context - The request's collaborators.
 * @returns Each broker, how it stands and how many nodes answer.
 * @throws {DeviceUnavailableError} When the hub cannot be asked.
 */
export async function listBrokers(context: IntegrationsContext): Promise<BrokerSummary[]> {
  const [status, linked, mqtt] = await Promise.all([
    matterStatus(context),
    // A count on a card: a database that cannot answer it leaves the card standing.
    linkedMatterDevices(context).catch((error: unknown) => {
      context.logger.warn({ err: error }, 'Could not count the linked Matter devices');

      return 0;
    }),
    mqttStatus(context),
  ]);
  const heard = mqtt.discovery.devices;

  return [
    { id: MATTER_VENDOR, state: status.state, devices: { ...status.nodes, linked } },
    { id: MQTT_VENDOR, state: mqtt.state, devices: { total: heard, online: heard, linked: 0 } },
  ];
}

/**
 * How many devices reached through Matter are also reached another way.
 *
 * @param context - The request's collaborators.
 * @returns The count.
 */
export async function linkedMatterDevices(context: IntegrationsContext): Promise<number> {
  const { devices, integrations } = schema.registry;
  const [row] = await context.db
    .select({ count: sql<number>`count(*)::int` })
    .from(devices)
    .innerJoin(integrations, eq(integrations.id, devices.integrationId))
    .where(
      and(
        eq(integrations.transport, MATTER_TRANSPORT),
        sql`(${devices.linkedTo} IS NOT NULL OR EXISTS (
          SELECT 1 FROM registry.devices c WHERE c.linked_to = ${devices.id}))`,
      ),
    );

  return row?.count ?? 0;
}

/**
 * Starts commissioning a node shared by another app.
 *
 * @param context - The request's collaborators.
 * @param code - Its pairing code, already checked.
 * @returns The job, running: the page reads the status until it ends.
 * @throws {ConflictError} When Matter is off, or a commissioning runs already.
 */
export async function commissionMatter(
  context: IntegrationsContext,
  code: string,
): Promise<MatterCommissioning> {
  return busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_MATTER_COMMISSION_METHOD),
    { code },
    matterCommissioningSchema,
    { traceId: context.traceId },
  );
}

/**
 * Answers the question a commissioning stopped on: whether to add a device whose certificate is a
 * test one.
 *
 * @param context - The request's collaborators.
 * @param answer - The job, and the owner's answer.
 * @returns The job, as it now stands.
 * @throws {DeviceUnavailableError} When the hub cannot be asked.
 */
export async function answerMatter(
  context: IntegrationsContext,
  answer: MatterAnswerRequest,
): Promise<MatterCommissioning> {
  return busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_MATTER_ANSWER_METHOD),
    answer,
    matterCommissioningSchema,
    { traceId: context.traceId, timeoutMs: context.timeoutMs },
  );
}

/**
 * Stops a commissioning before its device joined the fabric.
 *
 * @param context - The request's collaborators.
 * @param jobId - The job.
 * @returns The job, as it now stands.
 * @throws {ConflictError} When that job is not the one under way.
 */
export async function cancelMatter(
  context: IntegrationsContext,
  jobId: string,
): Promise<MatterCommissioning> {
  return busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_MATTER_CANCEL_METHOD),
    { jobId },
    matterCommissioningSchema,
    { traceId: context.traceId, timeoutMs: context.timeoutMs },
  );
}

/**
 * Closes the Matter controller and opens it again.
 *
 * @param context - The request's collaborators.
 * @returns Where the fabric stands then.
 * @throws {ConflictError} While a device is being added.
 */
export async function restartMatter(context: IntegrationsContext): Promise<MatterStatus> {
  return busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_MATTER_RESTART_METHOD),
    {},
    matterStatusSchema,
    { traceId: context.traceId, timeoutMs: context.timeoutMs },
  );
}

/**
 * Removes a node from the house: its devices, then the node from the fabric.
 *
 * @param context - The request's collaborators.
 * @param nodeId - The node.
 * @returns The devices removed.
 * @throws {NotFoundError} When the fabric has no such node.
 * @throws {DeviceUnavailableError} When the node did not leave the fabric; its devices are
 * removed all the same.
 */
export async function removeMatterNode(
  context: DevicesContext,
  nodeId: string,
): Promise<RemovedDevice[]> {
  const node = (await matterNodes(context)).find((each) => each.nodeId === nodeId);

  if (node === undefined) {
    throw new NotFoundError('The Matter fabric has no such node', { details: { nodeId } });
  }

  const removed: RemovedDevice[] = [];

  for (const device of node.devices) {
    if (device.deviceId !== null) {
      // One after another: each is a hub forget and a core release, in that order.
      // eslint-disable-next-line no-await-in-loop -- see above
      removed.push(await deleteDevice(context, device.deviceId));
    }
  }

  await busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_MATTER_REMOVE_METHOD),
    { nodeId },
    matterRemoveReplySchema,
    { traceId: context.traceId },
  );

  return removed;
}

/**
 * Brings back a device removed from the house whose node is still on the fabric: discovery adds
 * it again.
 *
 * @param context - The request's collaborators.
 * @param request - The node, and which endpoint behind it.
 * @returns Whether it was removed.
 */
export async function restoreMatterDevice(
  context: IntegrationsContext,
  request: MatterRestoreRequest,
): Promise<boolean> {
  const reply = await busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_MATTER_RESTORE_METHOD),
    request,
    matterRestoreReplySchema,
    { traceId: context.traceId },
  );

  return reply.isRestored;
}

/** A broker's device handed from the platform to the integration that takes it. */
export type RehomedDevice = { readonly deviceId: string; readonly kind: string };

/**
 * Hands each device of the platform's brokers that the platform holds to the integration whose
 * rules now take it alone: one installed after the device was added. The device's id and its
 * entities stay, since both drivers run the platform's mapping of the broker: only whose device it
 * is changes.
 *
 * @param context - The request's collaborators.
 * @returns The devices handed over, with their new kind.
 */
export async function rehomeBrokerDevices(context: DevicesContext): Promise<RehomedDevice[]> {
  const [nodes, heard] = await Promise.all([matterNodes(context), mqttDevices(context)]);
  const held = [
    ...nodes
      .flatMap((node) => node.devices)
      .filter((device) => device.kind === MATTER_GENERIC_KIND)
      .map((device) => ({ ...device, generic: MATTER_GENERIC_KIND, transport: MATTER_TRANSPORT })),
    ...heard
      .filter((device) => device.kind === MQTT_GENERIC_KIND)
      .map((device) => ({
        ...device,
        generic: MQTT_GENERIC_KIND,
        transport: MQTT_HOUSE_TRANSPORT,
      })),
  ].filter((device) => device.claimedBy.length === 1);

  if (held.length === 0) {
    return [];
  }

  const catalogue = await listCatalogue(context);
  const rehomed: RehomedDevice[] = [];

  for (const { deviceId, claimedBy, generic, transport } of held) {
    const vendor = catalogue.find((each) => each.id === claimedBy[0]);
    // shortcut: only a vendor with one driver on the broker listing no models takes its devices
    // over; choose by model the way discovery does once a vendor ships more than one.
    const [driver, other] = (vendor?.drivers ?? []).filter((each) => each.transport === transport);

    if (
      deviceId === null ||
      vendor === undefined ||
      driver === undefined ||
      other !== undefined ||
      driver.models.length > 0
    ) {
      continue;
    }

    const { integrations } = schema.registry;
    // eslint-disable-next-line no-await-in-loop -- one device at a time, each then reloaded
    const changed = await context.db
      .update(integrations)
      .set({
        kind: driver.id,
        kindVersion: vendor.version,
        model: driver.name,
        updatedAt: new Date(),
      })
      .where(and(eq(integrations.id, deviceId), eq(integrations.kind, generic)))
      .returning({ id: integrations.id });

    if (changed.length > 0) {
      // eslint-disable-next-line no-await-in-loop -- see above
      await reloadOnHub(context, deviceId);
      rehomed.push({ deviceId, kind: driver.id });
    }
  }

  return rehomed;
}

/**
 * Where the MQTT broker stands.
 *
 * @param context - The request's collaborators.
 * @returns Its state.
 * @throws {DeviceUnavailableError} When the hub cannot be asked.
 */
export async function mqttStatus(context: IntegrationsContext): Promise<MqttStatus> {
  return busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_MQTT_STATUS_METHOD),
    {},
    mqttStatusSchema,
    { traceId: context.traceId },
  );
}

/**
 * The devices the MQTT broker hears, with the device each is in the house.
 *
 * @param context - The request's collaborators.
 * @returns The devices.
 * @throws {DeviceUnavailableError} When the hub cannot be asked.
 */
export async function mqttDevices(context: IntegrationsContext): Promise<MqttDevice[]> {
  const reply = await busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_MQTT_DEVICES_METHOD),
    {},
    mqttDevicesReplySchema,
    { traceId: context.traceId },
  );

  return reply.items;
}

/**
 * Brings back a device removed from the house that the broker still hears: discovery adds it again.
 *
 * @param context - The request's collaborators.
 * @param deviceKey - The device.
 * @returns Whether it was removed.
 */
export async function restoreMqttDevice(
  context: IntegrationsContext,
  deviceKey: string,
): Promise<boolean> {
  const reply = await busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_MQTT_RESTORE_METHOD),
    { deviceKey },
    mqttRestoreReplySchema,
    { traceId: context.traceId },
  );

  return reply.isRestored;
}

/**
 * Saves the owner's settings of the broker, which starts it listening again with them.
 *
 * @param context - The request's collaborators.
 * @param settings - Them, checked.
 * @returns Where the broker stands then.
 */
export async function saveMqttSettings(
  context: IntegrationsContext,
  settings: MqttSettings,
): Promise<MqttStatus> {
  return busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_MQTT_SETTINGS_METHOD),
    settings,
    mqttStatusSchema,
    { traceId: context.traceId, timeoutMs: context.timeoutMs },
  );
}

/**
 * Stops the MQTT broker and starts it again.
 *
 * @param context - The request's collaborators.
 * @returns Where the broker stands then.
 */
export async function restartMqtt(context: IntegrationsContext): Promise<MqttStatus> {
  return busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_MQTT_RESTART_METHOD),
    {},
    mqttStatusSchema,
    { traceId: context.traceId, timeoutMs: context.timeoutMs },
  );
}

/**
 * Who may connect to the broker, and who is connected.
 *
 * @param context - The request's collaborators.
 * @returns The usernames, with their connections, and the connections without one.
 */
export async function mqttClients(context: IntegrationsContext) {
  return busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_MQTT_CLIENTS_METHOD),
    {},
    mqttClientsReplySchema,
    { traceId: context.traceId },
  );
}

/**
 * Adds a client to the broker.
 *
 * @param context - The request's collaborators.
 * @param request - Its username, label and reach.
 * @returns Its username and password, this once.
 * @throws {ConflictError} When the username is taken.
 */
export async function addMqttClient(context: IntegrationsContext, request: MqttClientAddRequest) {
  return busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_MQTT_CLIENT_ADD_METHOD),
    request,
    mqttClientAddReplySchema,
    { traceId: context.traceId },
  );
}

/**
 * Removes a client from the broker, and closes its connections.
 *
 * @param context - The request's collaborators.
 * @param username - Which.
 * @returns Whether there was one.
 */
export async function removeMqttClient(
  context: IntegrationsContext,
  username: string,
): Promise<boolean> {
  const reply = await busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_MQTT_CLIENT_REMOVE_METHOD),
    { username },
    mqttClientRemoveReplySchema,
    { traceId: context.traceId },
  );

  return reply.isRemoved;
}

/**
 * The last message of the topics under a prefix.
 *
 * @param context - The request's collaborators.
 * @param request - The prefix, and how many.
 * @param request.prefix - Only those under it.
 * @param request.limit - At most this many.
 * @returns Them, the most recent first, and how many there are.
 */
export async function mqttTopics(
  context: IntegrationsContext,
  request: { readonly prefix: string; readonly limit: number },
) {
  return busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_MQTT_TOPICS_METHOD),
    request,
    mqttTopicsReplySchema,
    { traceId: context.traceId },
  );
}

/**
 * The owner's mappings.
 *
 * @param context - The request's collaborators.
 * @returns Them.
 */
export async function mqttMappings(context: IntegrationsContext): Promise<MqttMapping[]> {
  const reply = await busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_MQTT_MAPPINGS_METHOD),
    {},
    mqttMappingsReplySchema,
    { traceId: context.traceId },
  );

  return reply.items;
}

/**
 * Saves a mapping, new or changed: the broker hears it at once, and discovery adds its device.
 *
 * @param context - The request's collaborators.
 * @param mapping - It, checked.
 * @returns It, with its id.
 */
export async function saveMqttMapping(
  context: IntegrationsContext,
  mapping: MqttMappingInput,
): Promise<MqttMapping> {
  return busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_MQTT_MAPPING_SAVE_METHOD),
    mapping,
    mqttMappingSchema,
    { traceId: context.traceId },
  );
}

/**
 * Removes a mapping: the device it made from the house, then the mapping.
 *
 * @param context - The request's collaborators.
 * @param id - Which.
 * @returns The device removed, if one was added.
 * @throws {NotFoundError} When there is no such mapping.
 */
export async function removeMqttMapping(
  context: DevicesContext,
  id: string,
): Promise<RemovedDevice | null> {
  const device = (await mqttDevices(context)).find(
    (each) => each.identity.deviceKey === `mapping-${id}`,
  );
  const removed =
    device?.deviceId === null || device === undefined
      ? null
      : await deleteDevice(context, device.deviceId);
  const reply = await busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_MQTT_MAPPING_REMOVE_METHOD),
    { id },
    mqttMappingRemoveReplySchema,
    { traceId: context.traceId },
  );

  if (!reply.isRemoved) {
    throw new NotFoundError('The MQTT broker has no such mapping', { details: { id } });
  }

  return removed;
}
