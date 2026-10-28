/**
 * `/brokers`: the platform's brokers - the house's Matter fabric and its MQTT broker - for the
 * Brokers page.
 *
 * Reading them is reading devices (`device:read`); commissioning a node, saving a mapping or
 * bringing a device back adds devices (`device:write`), removing a node or a mapping removes them
 * (`device:delete`), and each is audited as what it does to the house. Who may connect to the MQTT
 * broker, how it is set up and restarting it, is configuring an integration
 * (`integration:configure`); a client's password is answered once and never written to the audit.
 * Restarting the Matter controller, or stopping a commissioning, is `device:write`. Commissioning
 * is answered at once, `202` with the job: a node takes longer than a request waits, and the page
 * reads the status until the job ends. The Wi-Fi a new device is given is configuring an
 * integration; its password is never answered, nor written to the audit.
 */
import { z } from 'zod';

import {
  brokersReplySchema,
  matterAnswerRequestSchema,
  matterCommissioningSchema,
  matterCommissionRequestSchema,
  matterNetworkSchema,
  matterNetworksSaveRequestSchema,
  matterNetworksSchema,
  matterNodeIdSchema,
  matterNodesReplySchema,
  matterRestoreReplySchema,
  matterStatusSchema,
  mqttClientAddReplySchema,
  mqttClientAddRequestSchema,
  mqttClientRemoveReplySchema,
  mqttClientsReplySchema,
  mqttDevicesReplySchema,
  mqttMappingInputSchema,
  mqttMappingSchema,
  mqttMappingsReplySchema,
  mqttRestoreReplySchema,
  mqttRestoreRequestSchema,
  mqttSettingsSchema,
  mqttStatusSchema,
  mqttTopicsReplySchema,
  type MatterCommissioning,
  type MatterNetwork,
  type MatterNetworks,
  type MatterStatus,
  type MqttStatus,
} from '@nebulahome/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import {
  answerMatter,
  cancelMatter,
  commissionMatter,
  listBrokers,
  matterNetwork,
  matterNetworks,
  matterNodes,
  matterStatus,
  removeMatterNode,
  restartMatter,
  restoreMatterDevice,
  saveMatterNetworks,
  addMqttClient,
  mqttClients,
  mqttDevices,
  mqttMappings,
  mqttStatus,
  mqttTopics,
  removeMqttClient,
  removeMqttMapping,
  restartMqtt,
  restoreMqttDevice,
  saveMqttMapping,
  saveMqttSettings,
} from '../services/brokers.js';

import { forRequest } from './devices.js';

/** The status commissioning is answered with: started, done later. */
const ACCEPTED_STATUS = 202;

/** Which node a request is about. */
const nodeParamsSchema = z.object({ nodeId: matterNodeIdSchema });

/** Which client of the MQTT broker a request is about. */
const clientParamsSchema = z.object({ username: z.string().min(1).max(64) });

/** The topics asked for, as a query string writes them. */
const topicsQuerySchema = z.object({
  prefix: z.string().max(256).default(''),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
});

/** Which mapping a request is about. */
const mappingParamsSchema = z.object({ id: z.string().min(1).max(64) });

/** Which device of a node is brought back: the node itself, or an endpoint behind it. */
const restoreBodySchema = z.object({ endpoint: z.int().min(0).max(65_535).nullable() });

/**
 * Registers the broker routes.
 *
 * @param environment - Where routes are registered and documented.
 * @param context - The service's collaborators.
 */
export function registerBrokerRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/brokers',
      summary: "List the platform's brokers",
      tag: 'Brokers',
      permission: 'device:read',
      response: brokersReplySchema,
    },

    /**
     * Lists the brokers.
     *
     * @param route - Who is asking.
     * @returns Each broker, for its card.
     */
    async (route) => {
      requirePermission(route.identity, 'device:read');

      return { items: await listBrokers(forRequest(context, route.request.traceId)) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/brokers/matter',
      summary: "Read where the house's Matter fabric stands",
      tag: 'Brokers',
      permission: 'device:read',
      response: matterStatusSchema,
    },

    /**
     * Reads the fabric's state.
     *
     * @param route - Who is asking.
     * @returns The state, with the last commissioning.
     */
    async (route): Promise<MatterStatus> => {
      requirePermission(route.identity, 'device:read');

      return matterStatus(forRequest(context, route.request.traceId));
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/brokers/matter/nodes',
      summary: "List the nodes of the house's Matter fabric",
      tag: 'Brokers',
      permission: 'device:read',
      response: matterNodesReplySchema,
    },

    /**
     * Lists the nodes.
     *
     * @param route - Who is asking.
     * @returns Every node, with the devices it is in the house.
     */
    async (route) => {
      requirePermission(route.identity, 'device:read');

      return { items: await matterNodes(forRequest(context, route.request.traceId)) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/brokers/matter/network',
      summary: "Show how the nodes of the house's Matter fabric reach it",
      tag: 'Brokers',
      permission: 'device:read',
      response: matterNetworkSchema,
    },

    /**
     * Reads the network.
     *
     * @param route - Who is asking.
     * @returns The Thread meshes and Wi-Fi stars, as the nodes last reported them.
     */
    async (route): Promise<MatterNetwork> => {
      requirePermission(route.identity, 'device:read');

      return matterNetwork(forRequest(context, route.request.traceId));
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/matter/commission',
      summary: 'Add a Matter device shared by another app, or a new one, with its pairing code',
      tag: 'Brokers',
      permission: 'device:write',
      body: matterCommissionRequestSchema,
      response: matterCommissioningSchema,
      successStatus: ACCEPTED_STATUS,
    },

    /**
     * Starts commissioning a node.
     *
     * @param route - The pairing code, shared or new, and who is asking.
     * @returns The job, running.
     */
    async (route): Promise<MatterCommissioning> => {
      requirePermission(route.identity, 'device:write');

      const job = await commissionMatter(forRequest(context, route.request.traceId), route.body);

      // Never the code: it opens the device to whoever holds it while its window is open.
      await context.audit.record({
        action: 'matter.commission',
        resourceType: 'matter',
        resourceId: job.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { mode: route.body.mode },
      });

      return job;
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/matter/commission/:jobId/answer',
      summary:
        'Answer the question a commissioning stopped on: add a test device anyway, or its Wi-Fi',
      tag: 'Brokers',
      permission: 'device:write',
      params: z.object({ jobId: z.string().min(1).max(64) }),
      body: matterAnswerRequestSchema.omit({ jobId: true }),
      response: matterCommissioningSchema,
      successStatus: ACCEPTED_STATUS,
    },

    /**
     * Passes the owner's answer to the hub.
     *
     * @param route - The job, the answer, and who is asking.
     * @returns The job, as it now stands.
     */
    async (route): Promise<MatterCommissioning> => {
      requirePermission(route.identity, 'device:write');

      const { wifi, isAccepted } = route.body;
      const job = await answerMatter(forRequest(context, route.request.traceId), {
        ...route.body,
        jobId: route.params.jobId,
      });

      // The Wi-Fi by its name alone: its password is the house's.
      await context.audit.record({
        action: 'matter.commission',
        resourceType: 'matter',
        resourceId: job.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details:
          wifi === undefined
            ? { testCertificate: isAccepted ? 'accepted' : 'refused' }
            : { wifi: { ssid: wifi.ssid, isSaved: wifi.isSaved }, isAccepted },
      });

      return job;
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/brokers/matter/networks',
      summary: 'Read the networks a new Matter device is given: the Wi-Fi, never its password',
      tag: 'Brokers',
      permission: 'integration:configure',
      response: matterNetworksSchema,
    },

    /**
     * Reads the networks.
     *
     * @param route - Who is asking.
     * @returns The saved Wi-Fi's name and whether it has a password, and Thread's.
     */
    async (route): Promise<MatterNetworks> => {
      requirePermission(route.identity, 'integration:configure');

      return matterNetworks(forRequest(context, route.request.traceId));
    },
  );

  defineRoute(
    environment,
    {
      method: 'PUT',
      url: '/brokers/matter/networks',
      summary: 'Save the Wi-Fi a new Matter device is given, or forget it',
      tag: 'Brokers',
      permission: 'integration:configure',
      body: matterNetworksSaveRequestSchema,
      response: matterNetworksSchema,
    },

    /**
     * Saves the Wi-Fi: a password left out keeps the one saved.
     *
     * @param route - The network, and who is asking.
     * @returns The networks then.
     */
    async (route): Promise<MatterNetworks> => {
      requirePermission(route.identity, 'integration:configure');

      const networks = await saveMatterNetworks(
        forRequest(context, route.request.traceId),
        route.body,
      );
      const { wifi } = route.body;

      // Never the password: only whether one was sent.
      await context.audit.record({
        action: 'matter.networks.save',
        resourceType: 'matter',
        resourceId: 'networks',
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: {
          ssid: wifi?.ssid ?? null,
          isPasswordChanged: wifi?.password !== undefined,
        },
      });

      return networks;
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/matter/commission/:jobId/cancel',
      summary: 'Stop adding a Matter device before it joined the fabric',
      tag: 'Brokers',
      permission: 'device:write',
      params: z.object({ jobId: z.string().min(1).max(64) }),
      response: matterCommissioningSchema,
    },

    /**
     * Stops a commissioning; once the device joined, it carries on.
     *
     * @param route - The job, and who is asking.
     * @returns The job, as it now stands.
     */
    async (route): Promise<MatterCommissioning> => {
      requirePermission(route.identity, 'device:write');

      const job = await cancelMatter(
        forRequest(context, route.request.traceId),
        route.params.jobId,
      );

      await context.audit.record({
        action: 'matter.cancel',
        resourceType: 'matter',
        resourceId: job.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { state: job.state },
      });

      return job;
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/matter/restart',
      summary: "Restart the house's Matter controller",
      tag: 'Brokers',
      permission: 'device:write',
      response: matterStatusSchema,
    },

    /**
     * Closes the controller and opens it again.
     *
     * @param route - Who is asking.
     * @returns Where the fabric stands then.
     */
    async (route): Promise<MatterStatus> => {
      requirePermission(route.identity, 'device:write');

      const status = await restartMatter(forRequest(context, route.request.traceId));

      await context.audit.record({
        action: 'matter.restart',
        resourceType: 'matter',
        resourceId: 'controller',
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: {},
      });

      return status;
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/brokers/matter/nodes/:nodeId',
      summary: 'Remove a Matter device from the house and from its fabric',
      tag: 'Brokers',
      permission: 'device:delete',
      params: nodeParamsSchema,
      successStatus: 204,
    },

    /**
     * Removes a node: its devices from the house, then the node from the fabric.
     *
     * @param route - The node, and who is asking.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'device:delete');

      const removed = await removeMatterNode(
        forRequest(context, route.request.traceId),
        route.params.nodeId,
      );

      await context.audit.record({
        action: 'matter.remove',
        resourceType: 'matter',
        resourceId: route.params.nodeId,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { devices: removed.map((device) => device.name) },
      });
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/matter/nodes/:nodeId/restore',
      summary: 'Add back a Matter device removed from the house',
      tag: 'Brokers',
      permission: 'device:write',
      params: nodeParamsSchema,
      body: restoreBodySchema,
      response: matterRestoreReplySchema,
    },

    /**
     * Brings back a device removed from the house.
     *
     * @param route - The node, the endpoint, and who is asking.
     * @returns Whether it was removed.
     */
    async (route) => {
      requirePermission(route.identity, 'device:write');

      const isRestored = await restoreMatterDevice(forRequest(context, route.request.traceId), {
        nodeId: route.params.nodeId,
        endpoint: route.body.endpoint,
      });

      await context.audit.record({
        action: 'matter.restore',
        resourceType: 'matter',
        resourceId: route.params.nodeId,
        result: isRestored ? 'success' : 'failure',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { endpoint: route.body.endpoint },
      });

      return { isRestored };
    },
  );

  registerMqttRoutes(environment, context);
}

/**
 * Registers the MQTT broker's routes.
 *
 * @param environment - Where routes are registered and documented.
 * @param context - The service's collaborators.
 */
function registerMqttRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/brokers/mqtt',
      summary: "Read where the house's MQTT broker stands",
      tag: 'Brokers',
      permission: 'device:read',
      response: mqttStatusSchema,
    },

    /**
     * Reads the broker's state.
     *
     * @param route - Who is asking.
     * @returns The state, its settings and what it makes of what it carries.
     */
    async (route): Promise<MqttStatus> => {
      requirePermission(route.identity, 'device:read');

      return mqttStatus(forRequest(context, route.request.traceId));
    },
  );

  defineRoute(
    environment,
    {
      method: 'PUT',
      url: '/brokers/mqtt/settings',
      summary: "Change the house's MQTT broker's settings, which starts it again",
      tag: 'Brokers',
      permission: 'integration:configure',
      body: mqttSettingsSchema,
      response: mqttStatusSchema,
    },

    /**
     * Saves the settings.
     *
     * @param route - The settings, and who is asking.
     * @returns Where the broker stands then.
     */
    async (route): Promise<MqttStatus> => {
      requirePermission(route.identity, 'integration:configure');

      const status = await saveMqttSettings(forRequest(context, route.request.traceId), route.body);

      await context.audit.record({
        action: 'mqtt.settings',
        resourceType: 'mqtt',
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
      method: 'POST',
      url: '/brokers/mqtt/restart',
      summary: "Restart the house's MQTT broker",
      tag: 'Brokers',
      permission: 'integration:configure',
      response: mqttStatusSchema,
    },

    /**
     * Stops the broker and starts it again.
     *
     * @param route - Who is asking.
     * @returns Where the broker stands then.
     */
    async (route): Promise<MqttStatus> => {
      requirePermission(route.identity, 'integration:configure');

      const status = await restartMqtt(forRequest(context, route.request.traceId));

      await context.audit.record({
        action: 'mqtt.restart',
        resourceType: 'mqtt',
        resourceId: 'broker',
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: {},
      });

      return status;
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/brokers/mqtt/devices',
      summary: "List the devices the house's MQTT broker hears",
      tag: 'Brokers',
      permission: 'device:read',
      response: mqttDevicesReplySchema,
    },

    /**
     * Lists the devices.
     *
     * @param route - Who is asking.
     * @returns Each, with the device it is in the house.
     */
    async (route) => {
      requirePermission(route.identity, 'device:read');

      return { items: await mqttDevices(forRequest(context, route.request.traceId)) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/mqtt/restore',
      summary: 'Add back a device the MQTT broker hears that was removed from the house',
      tag: 'Brokers',
      permission: 'device:write',
      body: mqttRestoreRequestSchema,
      response: mqttRestoreReplySchema,
    },

    /**
     * Brings back a device removed from the house.
     *
     * @param route - The device, and who is asking.
     * @returns Whether it was removed.
     */
    async (route) => {
      requirePermission(route.identity, 'device:write');

      const isRestored = await restoreMqttDevice(
        forRequest(context, route.request.traceId),
        route.body.deviceKey,
      );

      await context.audit.record({
        action: 'mqtt.restore',
        resourceType: 'mqtt',
        resourceId: route.body.deviceKey,
        result: isRestored ? 'success' : 'failure',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
      });

      return { isRestored };
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/brokers/mqtt/clients',
      summary: "List who may connect to the house's MQTT broker, and who is connected",
      tag: 'Brokers',
      permission: 'device:read',
      response: mqttClientsReplySchema,
    },

    /**
     * Lists the clients.
     *
     * @param route - Who is asking.
     * @returns The usernames, with their connections, and the connections without one.
     */
    async (route) => {
      requirePermission(route.identity, 'device:read');

      return mqttClients(forRequest(context, route.request.traceId));
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/mqtt/clients',
      summary: "Add a client to the house's MQTT broker; its password is answered once",
      tag: 'Brokers',
      permission: 'integration:configure',
      body: mqttClientAddRequestSchema,
      response: mqttClientAddReplySchema,
      successStatus: 201,
    },

    /**
     * Adds a client.
     *
     * @param route - Its username, label and reach, and who is asking.
     * @returns Its username and password.
     */
    async (route) => {
      requirePermission(route.identity, 'integration:configure');

      const added = await addMqttClient(forRequest(context, route.request.traceId), route.body);

      // The password is the client's alone: it is never written down here.
      await context.audit.record({
        action: 'mqtt.client.add',
        resourceType: 'mqtt',
        resourceId: added.username,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { access: route.body.access },
      });

      return added;
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/brokers/mqtt/clients/:username',
      summary: "Remove a client of the house's MQTT broker, and close its connections",
      tag: 'Brokers',
      permission: 'integration:configure',
      params: clientParamsSchema,
      response: mqttClientRemoveReplySchema,
    },

    /**
     * Removes a client.
     *
     * @param route - The client, and who is asking.
     * @returns Whether there was one.
     */
    async (route) => {
      requirePermission(route.identity, 'integration:configure');

      const isRemoved = await removeMqttClient(
        forRequest(context, route.request.traceId),
        route.params.username,
      );

      await context.audit.record({
        action: 'mqtt.client.remove',
        resourceType: 'mqtt',
        resourceId: route.params.username,
        result: isRemoved ? 'success' : 'failure',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
      });

      return { isRemoved };
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/brokers/mqtt/topics',
      summary: "Read the last message of the topics the house's MQTT broker carries",
      tag: 'Brokers',
      permission: 'device:read',
      query: topicsQuerySchema,
      response: mqttTopicsReplySchema,
    },

    /**
     * Reads the topics.
     *
     * @param route - The prefix, how many, and who is asking.
     * @returns Them, the most recent first, and how many there are.
     */
    async (route) => {
      requirePermission(route.identity, 'device:read');

      return mqttTopics(forRequest(context, route.request.traceId), route.query);
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/brokers/mqtt/mappings',
      summary: 'List the devices mapped by hand on the house’s MQTT broker',
      tag: 'Brokers',
      permission: 'device:read',
      response: mqttMappingsReplySchema,
    },

    /**
     * Lists the mappings.
     *
     * @param route - Who is asking.
     * @returns Them.
     */
    async (route) => {
      requirePermission(route.identity, 'device:read');

      return { items: await mqttMappings(forRequest(context, route.request.traceId)) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/mqtt/mappings',
      summary: 'Map a device that does not announce itself, from the topic it publishes on',
      tag: 'Brokers',
      permission: 'device:write',
      body: mqttMappingInputSchema,
      response: mqttMappingSchema,
    },

    /**
     * Saves a mapping, new or changed: one with an id replaces it.
     *
     * @param route - The mapping, and who is asking.
     * @returns It, with its id.
     */
    async (route) => {
      requirePermission(route.identity, 'device:write');

      const saved = await saveMqttMapping(forRequest(context, route.request.traceId), route.body);

      await context.audit.record({
        action: 'mqtt.mapping.save',
        resourceType: 'mqtt',
        resourceId: saved.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { name: saved.name, stateTopic: saved.stateTopic },
      });

      return saved;
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/brokers/mqtt/mappings/:id',
      summary: 'Remove a mapping, and the device it made from the house',
      tag: 'Brokers',
      permission: 'device:delete',
      params: mappingParamsSchema,
      successStatus: 204,
    },

    /**
     * Removes a mapping: its device from the house, then the mapping.
     *
     * @param route - The mapping, and who is asking.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'device:delete');

      const removed = await removeMqttMapping(
        forRequest(context, route.request.traceId),
        route.params.id,
      );

      await context.audit.record({
        action: 'mqtt.mapping.remove',
        resourceType: 'mqtt',
        resourceId: route.params.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { device: removed?.name ?? null },
      });
    },
  );
}
