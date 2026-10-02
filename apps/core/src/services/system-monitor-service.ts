/**
 * The subject the API reads the system monitor on.
 *
 * Read-only, and answered from memory: the window of samples is `core`'s, and the API asks for
 * it every ten seconds per open page, so nothing here touches the database.
 */
import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  busSubjects,
  CORE_SERVICE,
  CORE_SYSTEM_MONITOR_METHOD,
  systemMonitorRequestSchema,
  type SystemMonitorSnapshot,
} from '@nebulahome/contracts';

import type { SystemMonitor } from './system-monitor.js';

/** What the system monitor service needs. */
export type SystemMonitorServiceOptions = {
  /** The bus client to serve on. */
  readonly client: BusClient;

  /** The monitor that holds the samples. */
  readonly monitor: SystemMonitor;
};

/**
 * Serves the subject the API reads the system monitor on.
 *
 * @param options - The bus client and the monitor.
 * @returns The subscription, to unsubscribe on shutdown.
 */
export function startSystemMonitorService(options: SystemMonitorServiceOptions): BusSubscription {
  return options.client.serve(
    busSubjects.service(CORE_SERVICE, CORE_SYSTEM_MONITOR_METHOD),
    systemMonitorRequestSchema,

    /**
     * Answers with everything the monitor knows.
     *
     * @returns The snapshot.
     */
    async (): Promise<SystemMonitorSnapshot> => Promise.resolve(options.monitor.snapshot()),
  );
}
