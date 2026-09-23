/**
 * Reading the system monitor, which `core` holds.
 *
 * `core` samples the machine and keeps the last quarter of an hour in memory; this asks it for
 * that, and nothing else. The API keeps no copy: a page open in two tabs asks twice, and each
 * answer is the same window read a moment apart.
 */
import type { BusClient } from '@nebula-home/bus';
import {
  busSubjects,
  CORE_SERVICE,
  CORE_SYSTEM_MONITOR_METHOD,
  DeviceUnavailableError,
  systemMonitorSnapshotSchema,
  type SystemMonitorSnapshot,
} from '@nebula-home/contracts';

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
  if (context.bus === undefined) {
    throw new DeviceUnavailableError('The message bus is not reachable', {
      details: { dependency: 'bus' },
    });
  }

  return context.bus.request(
    busSubjects.service(CORE_SERVICE, CORE_SYSTEM_MONITOR_METHOD),
    {},
    systemMonitorSnapshotSchema,
    { traceId: context.traceId, timeoutMs: context.timeoutMs },
  );
}
