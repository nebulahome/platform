/**
 * Reading the system monitor, which `core` holds.
 *
 * `core` samples the machine and keeps the last quarter of an hour in memory; this asks it for
 * that, and nothing else. The API keeps no copy: a page open in two tabs asks twice, and each
 * answer is the same window read a moment apart.
 */
import type { BusClient } from '@nebulahome/bus';
import {
  busSubjects,
  CORE_SERVICE,
  CORE_SYSTEM_MONITOR_METHOD,
  systemMonitorSnapshotSchema,
  type SystemMonitorSnapshot,
} from '@nebulahome/contracts';

import { requireBus } from './ask-service.js';

/** What reading the system monitor needs. */
export type SystemMonitorContext = {
  /** The bus, or undefined while the broker is unreachable. */
  readonly bus: BusClient | undefined;

  /** How long `core` has to answer. */
  readonly timeoutMs: number;

  /** The request's trace id. */
  readonly traceId: string;
};

/**
 * Asks `core` for everything the system monitor knows.
 *
 * @param context - The bus, the time limit and the trace id.
 * @returns The host, the recent samples, the network totals and the disk.
 * @throws {DeviceUnavailableError} When the bus is away or `core` does not answer.
 */
export async function readSystemMonitor(
  context: SystemMonitorContext,
): Promise<SystemMonitorSnapshot> {
  return requireBus(context, { dependency: 'bus' }).request(
    busSubjects.service(CORE_SERVICE, CORE_SYSTEM_MONITOR_METHOD),
    {},
    systemMonitorSnapshotSchema,
    { traceId: context.traceId, timeoutMs: context.timeoutMs },
  );
}
