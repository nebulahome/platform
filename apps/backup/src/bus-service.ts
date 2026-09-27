/**
 * What `backup` answers on the bus: `nebula.v1.svc.backup.<method>`, asked by `api`.
 *
 * Run and restore answer at once with the run's id - the work goes on after - so no request
 * waits longer than trying a location or listing the archives takes.
 */
import type { BusClient, BusSubscription } from '@nebula-home/bus';
import {
  BACKUP_METHODS,
  BACKUP_SERVICE,
  backupBrowseRequestSchema,
  backupCancelRequestSchema,
  backupEmptyRequestSchema,
  backupRestoreBusRequestSchema,
  backupRunRequestSchema,
  backupTestRequestSchema,
  busSubjects,
} from '@nebula-home/contracts';

import type { BackupService } from './service.js';

/**
 * The subject of one method.
 *
 * @param method - The method.
 * @returns Its subject.
 */
function subject(method: (typeof BACKUP_METHODS)[keyof typeof BACKUP_METHODS]): string {
  return busSubjects.service(BACKUP_SERVICE, method);
}

/**
 * Serves every method.
 *
 * @param client - The bus.
 * @param service - The service that answers.
 * @returns The subscriptions, to end on shutdown.
 */
export function serveBackup(client: BusClient, service: BackupService): BusSubscription[] {
  return [
    client.serve(subject(BACKUP_METHODS.status), backupEmptyRequestSchema, async () =>
      service.status(),
    ),
    client.serve(subject(BACKUP_METHODS.reload), backupEmptyRequestSchema, async () => {
      await service.reload();

      return { ok: true as const };
    }),
    client.serve(subject(BACKUP_METHODS.run), backupRunRequestSchema, async (request) => ({
      runId: await service.run(request.requestedBy),
    })),
    client.serve(subject(BACKUP_METHODS.cancel), backupCancelRequestSchema, async (request) => {
      service.cancel(request.runId);

      return Promise.resolve({ ok: true as const });
    }),
    client.serve(subject(BACKUP_METHODS.testLocation), backupTestRequestSchema, async (request) =>
      service.testLocation(request),
    ),
    client.serve(subject(BACKUP_METHODS.browse), backupBrowseRequestSchema, async (request) =>
      service.browse(request.path),
    ),
    client.serve(subject(BACKUP_METHODS.archives), backupEmptyRequestSchema, async () =>
      service.archives(),
    ),
    client.serve(
      subject(BACKUP_METHODS.restore),
      backupRestoreBusRequestSchema,
      async (request) => ({
        runId: await service.restore(request),
      }),
    ),
    client.serve(subject(BACKUP_METHODS.key), backupEmptyRequestSchema, async () =>
      Promise.resolve({ sealed: service.sealedKeyFile() }),
    ),
  ];
}
