/**
 * The machine the platform runs on.
 *
 * One route, read-only, behind a permission of its own: how busy the processor is and what is on
 * the disk is nobody's business but whoever looks after the installation, and a member who can
 * switch the lights on has no reason to see it. The system entities carry the same readings to
 * anybody an entity permission lets see them; this is the detail behind them.
 */
import { systemMonitorSnapshotSchema, type SystemMonitorSnapshot } from '@nebulahome/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import { readSystemMonitor } from '../services/system-monitor.js';

/**
 * Registers the system routes.
 *
 * @param environment - Where routes are defined.
 * @param context - The service's collaborators.
 */
export function registerSystemRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/system/monitor',
      summary: 'Read the processor, memory, disk and network of the machine',
      tag: 'System',
      permission: 'system:read',
      response: systemMonitorSnapshotSchema,
    },

    /**
     * Reads the system monitor from `core`.
     *
     * @param route - Who is asking.
     * @returns The host, the last quarter of an hour of samples, and the disk.
     */
    async (route): Promise<SystemMonitorSnapshot> => {
      requirePermission(route.identity, 'system:read');

      return readSystemMonitor({
        bus: context.bus,
        timeoutMs: context.config.API_BUS_TIMEOUT_MS,
        traceId: route.request.traceId,
      });
    },
  );
}
