/**
 * The platform's brokers, as the Brokers pages read and drive them: today the house's Matter
 * fabric (`/api/v1/brokers`).
 */
import { z } from 'zod';

import {
  brokersReplySchema,
  matterCommissioningSchema,
  matterNodesReplySchema,
  matterRestoreReplySchema,
  matterStatusSchema,
  type BrokerSummary,
  type MatterCommissioning,
  type MatterNode,
  type MatterStatus,
} from '@nebulahome/contracts';

import { apiRequest } from '@/lib/api-client';

/** The keys the brokers are cached under. */
export const BROKER_QUERY_KEYS = {
  brokers: ['brokers'] as const,
  matterStatus: ['brokers', 'matter', 'status'] as const,
  matterNodes: ['brokers', 'matter', 'nodes'] as const,
};

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
