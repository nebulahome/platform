/**
 * The Matter broker on the bus: what the Brokers page reads and asks, through `api`.
 *
 * `svc.hub.matter_status`, `matter_nodes` and `matter_network` read; `matter_commission` starts commissioning a node
 * and answers with the job at once, since a node takes longer than a request waits, and
 * `matter_cancel` stops it before the device joined; `matter_restart` opens the controller again;
 * `matter_remove` takes a node off the fabric; `matter_restore` brings back a device removed from
 * the house whose node is still on it. Removing the devices of a node from the house is `api`'s
 * ordinary device removal, which tells the broker through the hub's `forget`.
 */
import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  busSubjects,
  HUB_MATTER_ANSWER_METHOD,
  HUB_MATTER_CANCEL_METHOD,
  HUB_MATTER_COMMISSION_METHOD,
  HUB_MATTER_NETWORK_METHOD,
  HUB_MATTER_NODES_METHOD,
  HUB_MATTER_REMOVE_METHOD,
  HUB_MATTER_RESTART_METHOD,
  HUB_MATTER_RESTORE_METHOD,
  HUB_MATTER_STATUS_METHOD,
  HUB_SERVICE,
  matterAnswerRequestSchema,
  matterCancelRequestSchema,
  matterCommissionRequestSchema,
  matterNetworkRequestSchema,
  matterNodesRequestSchema,
  matterRemoveRequestSchema,
  matterRestartRequestSchema,
  matterRestoreRequestSchema,
  matterStatusRequestSchema,
  type MatterNode,
} from '@nebulahome/contracts';
import {
  deviceSnapshotOf,
  MATTER_MAPPED_CLUSTERS,
  matterDeviceKey,
  scopesOf,
  unmappedClustersOf,
} from '@nebulahome/package-runtime';

import type { TakenDevices } from '../domain/taken.js';
import type { MatterBroker } from '../matter/broker.js';

import type { DiscoveryService } from './discovery.js';

/** How many removals may wait on their nodes at once: a node that does not answer takes a while. */
const REMOVE_CONCURRENCY = 4;

/** What the Matter methods need. */
export type MatterManagementOptions = {
  readonly client: BusClient;
  readonly broker: MatterBroker;

  /** Discovery, for which vendors' rules take a device; undefined before it has started. */
  readonly discovery: () => DiscoveryService | undefined;

  /** Reads what is added, for the device each node is in the house. */
  readonly taken: () => Promise<TakenDevices>;
};

/**
 * Every node of the fabric, with the devices it is in the house.
 *
 * @param options - The broker, discovery and what is added.
 * @returns The nodes, as the Brokers page lists them.
 */
export async function matterNodesView(options: MatterManagementOptions): Promise<MatterNode[]> {
  const { broker } = options;
  const taken = await options.taken();
  const discovery = options.discovery();

  return broker.nodes().map((node) => ({
    nodeId: node.nodeId,
    isAvailable: node.isAvailable,
    commissionedAt: node.commissionedAt,
    offlineSince: broker.offlineSince(node.nodeId),
    devices: scopesOf(node.attributes).map((scope) => {
      const device = deviceSnapshotOf(node, scope);
      const key = matterDeviceKey(node.nodeId, scope.endpoint);
      const added = taken.matter.get(key);
      const claimedBy = (discovery?.brokerClaims('matter', device.identity) ?? []).map(
        ({ vendor }) => vendor.id,
      );

      return {
        identity: device.identity,
        mappedClusters: device.identity.clusters.filter((cluster) =>
          MATTER_MAPPED_CLUSTERS.has(cluster),
        ),
        unmappedClusters: unmappedClustersOf(device),
        deviceId: added?.instanceId ?? null,
        kind: added?.kind ?? null,
        claimedBy: claimedBy.slice(0, 16),
        isRemoved: broker.isRemoved(key),
      };
    }),
  }));
}

/**
 * Serves the Matter broker's methods.
 *
 * @param options - What they read and drive.
 * @returns The subscriptions, to drop on stop.
 */
export function serveMatter(options: MatterManagementOptions): BusSubscription[] {
  const { client, broker } = options;

  return [
    client.serve(
      busSubjects.service(HUB_SERVICE, HUB_MATTER_STATUS_METHOD),
      matterStatusRequestSchema,

      /**
       * Says where the broker stands, the job of a device being added up to date with the house.
       *
       * @returns Its state.
       */
      async () => {
        const taken = await options.taken();

        return broker.status((nodeId) => taken.matter.get(nodeId)?.instanceId);
      },
    ),

    client.serve(
      busSubjects.service(HUB_SERVICE, HUB_MATTER_NETWORK_METHOD),
      matterNetworkRequestSchema,

      /**
       * Says how the fabric's nodes reach the house, as they last reported it.
       *
       * @returns The network.
       */
      () => broker.network(),
    ),

    client.serve(
      busSubjects.service(HUB_SERVICE, HUB_MATTER_ANSWER_METHOD),
      matterAnswerRequestSchema,

      /**
       * Passes on whether to add a device with a test certificate anyway.
       *
       * @param request - The job and the answer.
       * @returns The job.
       */
      (request) => broker.answer(request.jobId, request.isAccepted),
    ),

    client.serve(
      busSubjects.service(HUB_SERVICE, HUB_MATTER_CANCEL_METHOD),
      matterCancelRequestSchema,

      /**
       * Stops a commissioning before its device joined.
       *
       * @param request - The job.
       * @returns The job, as it now stands.
       */
      (request) => broker.cancel(request.jobId),
    ),

    client.serve(
      busSubjects.service(HUB_SERVICE, HUB_MATTER_RESTART_METHOD),
      matterRestartRequestSchema,

      /**
       * Opens the controller again.
       *
       * @returns Where the broker stands then.
       */
      async () => {
        await broker.restart();

        const taken = await options.taken();

        return broker.status((nodeId) => taken.matter.get(nodeId)?.instanceId);
      },
    ),

    client.serve(
      busSubjects.service(HUB_SERVICE, HUB_MATTER_NODES_METHOD),
      matterNodesRequestSchema,

      /**
       * Lists the fabric's nodes.
       *
       * @returns Every node, with its devices.
       */
      async () => ({ items: await matterNodesView(options) }),
    ),

    client.serve(
      busSubjects.service(HUB_SERVICE, HUB_MATTER_COMMISSION_METHOD),
      matterCommissionRequestSchema,

      /**
       * Starts commissioning a node.
       *
       * @param request - Its pairing code.
       * @returns The job, running.
       */
      (request) => broker.commission(request.code),
    ),

    client.serve(
      busSubjects.service(HUB_SERVICE, HUB_MATTER_REMOVE_METHOD),
      matterRemoveRequestSchema,

      /**
       * Takes a node off the fabric.
       *
       * @param request - Which.
       * @returns Whether it was on it.
       */
      async (request) => ({ isRemoved: await broker.decommission(request.nodeId) }),
      { concurrency: REMOVE_CONCURRENCY },
    ),

    client.serve(
      busSubjects.service(HUB_SERVICE, HUB_MATTER_RESTORE_METHOD),
      matterRestoreRequestSchema,

      /**
       * Brings back a device removed from the house.
       *
       * @param request - Which node, and which endpoint behind it.
       * @returns Whether it was removed.
       */
      async (request) => ({
        isRestored: await broker.restore(matterDeviceKey(request.nodeId, request.endpoint)),
      }),
    ),
  ];
}
