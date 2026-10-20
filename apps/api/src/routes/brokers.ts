/**
 * `/brokers`: the platform's brokers - the house's Matter fabric today - for the Brokers page.
 *
 * Reading them is reading devices (`device:read`); commissioning a node adds devices
 * (`device:write`), removing one removes them (`device:delete`), and both are audited as what
 * they do to the house. Commissioning is answered at once, `202` with the job: a node takes
 * longer than a request waits, and the page reads the status until the job ends.
 */
import { z } from 'zod';

import {
  brokersReplySchema,
  matterCommissioningSchema,
  matterCommissionRequestSchema,
  matterNodeIdSchema,
  matterNodesReplySchema,
  matterRestoreReplySchema,
  matterStatusSchema,
  type MatterCommissioning,
  type MatterStatus,
} from '@nebulahome/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import {
  answerMatter,
  commissionMatter,
  listBrokers,
  matterNodes,
  matterStatus,
  removeMatterNode,
  restoreMatterDevice,
} from '../services/brokers.js';

import { forRequest } from './devices.js';

/** The status commissioning is answered with: started, done later. */
const ACCEPTED_STATUS = 202;

/** Which node a request is about. */
const nodeParamsSchema = z.object({ nodeId: matterNodeIdSchema });

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
      method: 'POST',
      url: '/brokers/matter/commission',
      summary: 'Add a Matter device shared by another app, with its pairing code',
      tag: 'Brokers',
      permission: 'device:write',
      body: matterCommissionRequestSchema,
      response: matterCommissioningSchema,
      successStatus: ACCEPTED_STATUS,
    },

    /**
     * Starts commissioning a node.
     *
     * @param route - The pairing code, and who is asking.
     * @returns The job, running.
     */
    async (route): Promise<MatterCommissioning> => {
      requirePermission(route.identity, 'device:write');

      const job = await commissionMatter(
        forRequest(context, route.request.traceId),
        route.body.code,
      );

      // Never the code: it opens the device to whoever holds it while its window is open.
      await context.audit.record({
        action: 'matter.commission',
        resourceType: 'matter',
        resourceId: job.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: {},
      });

      return job;
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/matter/commission/:jobId/answer',
      summary: 'Answer the question a commissioning stopped on: add a test device anyway, or not',
      tag: 'Brokers',
      permission: 'device:write',
      params: z.object({ jobId: z.string().min(1).max(64) }),
      body: z.object({ isAccepted: z.boolean() }),
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

      const job = await answerMatter(forRequest(context, route.request.traceId), {
        jobId: route.params.jobId,
        isAccepted: route.body.isAccepted,
      });

      await context.audit.record({
        action: 'matter.commission',
        resourceType: 'matter',
        resourceId: job.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { testCertificate: route.body.isAccepted ? 'accepted' : 'refused' },
      });

      return job;
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
}
