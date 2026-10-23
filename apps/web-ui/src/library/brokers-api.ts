/**
 * The platform's brokers, as the Brokers pages read and drive them: the house's Matter fabric and
 * its MQTT broker (`/api/v1/brokers`).
 */
import { z } from 'zod';

import {
  brokersReplySchema,
  matterCommissioningSchema,
  matterNodesReplySchema,
  matterRestoreReplySchema,
  matterStatusSchema,
  mqttClientAddReplySchema,
  mqttClientRemoveReplySchema,
  mqttClientsReplySchema,
  mqttDevicesReplySchema,
  mqttMappingSchema,
  mqttMappingsReplySchema,
  mqttRestoreReplySchema,
  mqttStatusSchema,
  mqttTopicsReplySchema,
  type BrokerSummary,
  type MatterCommissioning,
  type MatterNode,
  type MatterStatus,
  type MqttClientAddRequest,
  type MqttDevice,
  type MqttMapping,
  type MqttMappingInput,
  type MqttSettings,
  type MqttStatus,
} from '@nebulahome/contracts';

import { apiRequest } from '@/lib/api-client';

/** The keys the brokers are cached under. */
export const BROKER_QUERY_KEYS = {
  brokers: ['brokers'] as const,
  matterStatus: ['brokers', 'matter', 'status'] as const,
  matterNodes: ['brokers', 'matter', 'nodes'] as const,
  mqttStatus: ['brokers', 'mqtt', 'status'] as const,
  mqttDevices: ['brokers', 'mqtt', 'devices'] as const,
  mqttClients: ['brokers', 'mqtt', 'clients'] as const,
  mqttMappings: ['brokers', 'mqtt', 'mappings'] as const,
  mqttTopics: ['brokers', 'mqtt', 'topics'] as const,
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
 * Lists the brokers.
 *
 * @param signal - Cancels the request.
 * @returns Each broker, for its card.
 */
export async function fetchBrokers(signal?: AbortSignal): Promise<BrokerSummary[]> {
  const { items } = await apiRequest('/brokers', brokersReplySchema, {
    ...(signal === undefined ? {} : { signal }),
  });

  return items;
}

/**
 * Reads where the Matter fabric stands.
 *
 * @param signal - Cancels the request.
 * @returns Its state, with the last commissioning.
 */
export async function fetchMatterStatus(signal?: AbortSignal): Promise<MatterStatus> {
  return apiRequest('/brokers/matter', matterStatusSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
}

/**
 * Lists the Matter fabric's nodes.
 *
 * @param signal - Cancels the request.
 * @returns Every node, with the devices it is in the house.
 */
export async function fetchMatterNodes(signal?: AbortSignal): Promise<MatterNode[]> {
  const { items } = await apiRequest('/brokers/matter/nodes', matterNodesReplySchema, {
    ...(signal === undefined ? {} : { signal }),
  });

  return items;
}

/**
 * Starts commissioning a Matter device another app shared.
 *
 * @param code - Its pairing code, as written.
 * @returns The job, running.
 */
export async function commissionMatter(code: string): Promise<MatterCommissioning> {
  return apiRequest('/brokers/matter/commission', matterCommissioningSchema, {
    method: 'POST',
    body: { code },
  });
}

/**
 * Answers the question a commissioning stopped on: add a device with a test certificate anyway.
 *
 * @param jobId - The job.
 * @param isAccepted - Whether to add it.
 * @returns The job, as it now stands.
 */
export async function answerMatter(
  jobId: string,
  isAccepted: boolean,
): Promise<MatterCommissioning> {
  return apiRequest(`/brokers/matter/commission/${jobId}/answer`, matterCommissioningSchema, {
    method: 'POST',
    body: { isAccepted },
  });
}

/**
 * Stops adding a Matter device before it joined the fabric.
 *
 * @param jobId - The job.
 * @returns The job, as it now stands.
 */
export async function cancelMatter(jobId: string): Promise<MatterCommissioning> {
  return apiRequest(`/brokers/matter/commission/${jobId}/cancel`, matterCommissioningSchema, {
    method: 'POST',
  });
}

/**
 * Restarts the house's Matter controller.
 *
 * @returns Where the fabric stands then.
 */
export async function restartMatter(): Promise<MatterStatus> {
  return apiRequest('/brokers/matter/restart', matterStatusSchema, { method: 'POST' });
}

/**
 * Removes a Matter node from the house and from the fabric.
 *
 * @param nodeId - The node.
 */
export async function removeMatterNode(nodeId: string): Promise<void> {
  await apiRequest(`/brokers/matter/nodes/${nodeId}`, z.undefined(), { method: 'DELETE' });
}

/**
 * Adds back a Matter device removed from the house.
 *
 * @param nodeId - Its node.
 * @param endpoint - The endpoint behind a bridge; null for the node itself.
 * @returns Whether it was removed.
 */
export async function restoreMatterDevice(
  nodeId: string,
  endpoint: number | null,
): Promise<boolean> {
  const reply = await apiRequest(
    `/brokers/matter/nodes/${nodeId}/restore`,
    matterRestoreReplySchema,
    {
      method: 'POST',
      body: { endpoint },
    },
  );

  return reply.isRestored;
}

/**
 * Reads where the MQTT broker stands.
 *
 * @param signal - Cancels the request.
 * @returns Its state, its settings and what it makes of what it carries.
 */
export async function fetchMqttStatus(signal?: AbortSignal): Promise<MqttStatus> {
  return apiRequest('/brokers/mqtt', mqttStatusSchema, readOptions(signal));
}

/**
 * Restarts the house's MQTT broker.
 *
 * @returns Where the broker stands then.
 */
export async function restartMqtt(): Promise<MqttStatus> {
  return apiRequest('/brokers/mqtt/restart', mqttStatusSchema, { method: 'POST' });
}

/**
 * Saves the MQTT broker's settings, which starts it listening again.
 *
 * @param settings - Them.
 * @returns Where the broker stands then.
 */
export async function saveMqttSettings(settings: MqttSettings): Promise<MqttStatus> {
  return apiRequest('/brokers/mqtt/settings', mqttStatusSchema, { method: 'PUT', body: settings });
}

/**
 * Lists the devices the MQTT broker hears.
 *
 * @param signal - Cancels the request.
 * @returns Each, with the device it is in the house.
 */
export async function fetchMqttDevices(signal?: AbortSignal): Promise<MqttDevice[]> {
  const { items } = await apiRequest(
    '/brokers/mqtt/devices',
    mqttDevicesReplySchema,
    readOptions(signal),
  );

  return items;
}

/**
 * Adds back a device the MQTT broker hears that was removed from the house.
 *
 * @param deviceKey - The device.
 * @returns Whether it was removed.
 */
export async function restoreMqttDevice(deviceKey: string): Promise<boolean> {
  const reply = await apiRequest('/brokers/mqtt/restore', mqttRestoreReplySchema, {
    method: 'POST',
    body: { deviceKey },
  });

  return reply.isRestored;
}

/**
 * Lists who may connect to the MQTT broker, and who is connected.
 *
 * @param signal - Cancels the request.
 * @returns The usernames, with their connections, and the connections without one.
 */
export async function fetchMqttClients(signal?: AbortSignal) {
  return apiRequest('/brokers/mqtt/clients', mqttClientsReplySchema, readOptions(signal));
}

/**
 * Adds a client to the MQTT broker.
 *
 * @param request - Its username, label and reach.
 * @returns Its username and password, shown once.
 */
export async function addMqttClient(request: MqttClientAddRequest) {
  return apiRequest('/brokers/mqtt/clients', mqttClientAddReplySchema, {
    method: 'POST',
    body: request,
  });
}

/**
 * Removes a client of the MQTT broker, and closes its connections.
 *
 * @param username - Which.
 * @returns Whether there was one.
 */
export async function removeMqttClient(username: string): Promise<boolean> {
  const reply = await apiRequest(
    `/brokers/mqtt/clients/${encodeURIComponent(username)}`,
    mqttClientRemoveReplySchema,
    { method: 'DELETE' },
  );

  return reply.isRemoved;
}

/**
 * Reads the last message of the topics under a prefix.
 *
 * @param prefix - Only those under it.
 * @param limit - At most this many.
 * @param signal - Cancels the request.
 * @returns Them, the most recent first, and how many there are.
 */
export async function fetchMqttTopics(prefix: string, limit: number, signal?: AbortSignal) {
  const query = new URLSearchParams({ prefix, limit: String(limit) });

  return apiRequest(
    `/brokers/mqtt/topics?${query.toString()}`,
    mqttTopicsReplySchema,
    readOptions(signal),
  );
}

/**
 * Lists the devices mapped by hand.
 *
 * @param signal - Cancels the request.
 * @returns The mappings.
 */
export async function fetchMqttMappings(signal?: AbortSignal): Promise<MqttMapping[]> {
  const { items } = await apiRequest(
    '/brokers/mqtt/mappings',
    mqttMappingsReplySchema,
    readOptions(signal),
  );

  return items;
}

/**
 * Saves a mapping, new or changed.
 *
 * @param mapping - It.
 * @returns It, with its id.
 */
export async function saveMqttMapping(mapping: MqttMappingInput): Promise<MqttMapping> {
  return apiRequest('/brokers/mqtt/mappings', mqttMappingSchema, { method: 'POST', body: mapping });
}

/**
 * Removes a mapping, and the device it made from the house.
 *
 * @param id - Which.
 */
export async function removeMqttMapping(id: string): Promise<void> {
  await apiRequest(`/brokers/mqtt/mappings/${encodeURIComponent(id)}`, z.undefined(), {
    method: 'DELETE',
  });
}
