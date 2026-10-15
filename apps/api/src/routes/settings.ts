/**
 * The settings an owner changes from the interface.
 *
 * Two routes, and the split between them is the one that matters: reading needs
 * `settings:read`, changing needs `settings:write`, and neither is scopable - half a permission
 * to shorten history retention is not a useful thing to express.
 *
 * A change is a partial map, so two people editing different settings at the same time do not
 * overwrite each other. It is also validated as a set: the retention keys constrain each other,
 * so a request that would leave a tier with nothing to roll up from is refused whole rather than
 * applied up to the offending key. Everything is written in one transaction for the same reason.
 */
import {
  BACKUP_METHODS,
  settingsResponseSchema,
  updateSettingsRequestSchema,
  type SettingView,
} from '@nebulahome/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import { syncHouseOnCore } from '../services/automations-core.js';
import { askBackup, BACKUP_REPLIES } from '../services/backup.js';
import {
  auditableChanges,
  readSettingValues,
  readSettings,
  validateSettingChanges,
  writeSettings,
} from '../services/settings.js';

/** How long the backup service has to read its settings again. */
const RELOAD_TIMEOUT_MS = 3000;

/**
 * Registers the settings endpoints.
 *
 * @param environment - The server, the registry and the version prefix.
 * @param context - The service context.
 */
export function registerSettingsRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/settings',
      summary: 'Read runtime settings',
      tag: 'System',
      permission: 'settings:read',
      response: settingsResponseSchema,
    },

    /**
     * Reads every setting.
     *
     * @param route - Who is asking.
     * @returns Each setting, its default, and who last changed it.
     */
    async (route): Promise<{ items: SettingView[] }> => {
      requirePermission(route.identity, 'settings:read');

      return { items: await readSettings(context.db) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'PATCH',
      url: '/settings',
      summary: 'Change runtime settings',
      tag: 'System',
      permission: 'settings:write',
      body: updateSettingsRequestSchema,
      response: settingsResponseSchema,
    },

    /**
     * Changes settings.
     *
     * The whole set is answered rather than only what changed. One key can be refused because
     * of another, and a client that patched its own copy from a partial response would be
     * showing a state the server never held.
     *
     * @param route - The body and who is asking.
     * @returns Every setting, as it now stands.
     */
    async (route): Promise<{ items: SettingView[] }> => {
      requirePermission(route.identity, 'settings:write');

      const current = await readSettingValues(context.db);
      const accepted = validateSettingChanges(current, route.body.changes);

      await writeSettings(context.db, accepted, route.identity.userId);

      // Recorded after the write, so the trail says what happened rather than what was asked
      // for. ARCHITECTURE.md 12.4 lists settings changes among the things that must be audited,
      // and retention is the setting where "who shortened this, and to what" is the whole
      // question somebody will be asking.
      await context.audit.record({
        action: 'settings.update',
        resourceType: 'settings',
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { changes: auditableChanges(accepted) },
      });

      // The backup schedule is the backup service's to run: it reads its settings again now, so
      // the next backup and the page that shows it agree at once. Best effort - a service that
      // does not answer reads them when it starts.
      if ([...accepted.keys()].some((key) => key.startsWith('backup.'))) {
        await askBackup(
          { bus: context.bus, traceId: route.request.traceId },
          BACKUP_METHODS.reload,
          {},
          BACKUP_REPLIES.acknowledgement,
          RELOAD_TIMEOUT_MS,
        ).catch((error: unknown) => {
          context.logger.warn({ err: error }, 'The backup service did not reload its settings');
        });
      }

      // The house's zone is what automations keep time by; `core` reads it again now.
      if (accepted.has('house.timezone')) {
        await syncHouseOnCore({
          bus: context.bus,
          traceId: route.request.traceId,
          timeoutMs: context.config.API_BUS_TIMEOUT_MS,
          logger: context.logger,
        });
      }

      return { items: await readSettings(context.db) };
    },
  );
}
