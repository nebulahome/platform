/**
 * The one call the system monitor makes.
 *
 * As everywhere else, it names the contract schema its answer must satisfy rather than a
 * response type written here, so a server that changes the shape fails the parse instead of
 * drawing a chart out of whatever arrived.
 */
import { systemMonitorSnapshotSchema, type SystemMonitorSnapshot } from '@nebulahome/contracts';

import { apiRequest } from '@/lib/api-client';

/** Where the system monitor is cached. */
export const SYSTEM_QUERY_KEYS = {
  monitor: ['system', 'monitor'],
} as const;

/**
 * Reads everything the system monitor knows.
 *
 * @param signal - Cancels the request.
 * @returns The host, the last quarter of an hour of samples, the network and the disk.
 */
export async function fetchSystemMonitor(signal?: AbortSignal): Promise<SystemMonitorSnapshot> {
  return apiRequest('/system/monitor', systemMonitorSnapshotSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
}
