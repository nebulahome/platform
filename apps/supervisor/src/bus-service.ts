/**
 * What the supervisor answers on the bus: `nebula.v1.svc.supervisor.<method>`, the command
 * `core` routes to a container entity, and the resynchronisation `core` asks for at its start.
 *
 * Every call that could take long - an update, an install, a compose project brought up, a
 * declared container being pulled - answers at once and goes on after, so reading the list never waits behind one; the reads are served
 * several at a time for the same reason.
 */
import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  ADAPTER_COMMAND_METHOD,
  adapterCommandSchema,
  busSubjects,
  composeControlRequestSchema,
  composeDefinitionSchema,
  composeProjectRequestSchema,
  composeRemoveRequestSchema,
  containerControlRequestSchema,
  containerInstallRequestSchema,
  containerLogsRequestSchema,
  containerNameRequestSchema,
  containerRemoveRequestSchema,
  ensureRequestSchema,
  imageDescribeRequestSchema,
  imageSearchRequestSchema,
  imageTagsRequestSchema,
  managedRequestSchema,
  platformReleasesRequestSchema,
  platformServiceRequestSchema,
  reconcileRequestSchema,
  resyncRequestSchema,
  SUPERVISOR_METHODS,
  SUPERVISOR_SERVICE,
  supervisorEmptyRequestSchema,
  updatePlatformRequestSchema,
  volumesFolderRequestSchema,
} from '@nebulahome/contracts';

import type { SupervisorService } from './service.js';
import { controlPlatformService } from './services/platform-services.js';

/** How many reads are served at once. */
const READ_CONCURRENCY = 8;

/**
 * The subject of one method.
 *
 * @param method - The method.
 * @returns Its subject.
 */
function subject(method: (typeof SUPERVISOR_METHODS)[keyof typeof SUPERVISOR_METHODS]): string {
  return busSubjects.service(SUPERVISOR_SERVICE, method);
}

/**
 * Serves every method.
 *
 * @param client - The bus.
 * @param service - The service that answers.
 * @returns The subscriptions, to end on shutdown.
 */
export function serveSupervisor(client: BusClient, service: SupervisorService): BusSubscription[] {
  const reads = { concurrency: READ_CONCURRENCY };
  const ok = { ok: true as const };

  return [
    client.serve(subject(SUPERVISOR_METHODS.status), supervisorEmptyRequestSchema, () =>
      service.status(),
    ),
    client.serve(
      subject(SUPERVISOR_METHODS.list),
      supervisorEmptyRequestSchema,
      () => service.list(),
      reads,
    ),
    client.serve(
      subject(SUPERVISOR_METHODS.inspect),
      containerNameRequestSchema,
      async (request) => service.inspect(request.name),
      reads,
    ),
    client.serve(
      subject(SUPERVISOR_METHODS.logs),
      containerLogsRequestSchema,
      async (request) => service.logs(request.name, request.tail, request.since),
      reads,
    ),
    client.serve(
      subject(SUPERVISOR_METHODS.control),
      containerControlRequestSchema,
      async (request) => service.control(request.name, request.action),
      reads,
    ),
    client.serve(subject(SUPERVISOR_METHODS.update), containerNameRequestSchema, (request) => {
      service.update(request.name);

      return ok;
    }),
    client.serve(
      subject(SUPERVISOR_METHODS.platformReleases),
      platformReleasesRequestSchema,
      async (request) => service.platform.releases(request.check),
      reads,
    ),
    client.serve(
      subject(SUPERVISOR_METHODS.platformState),
      supervisorEmptyRequestSchema,
      async () => service.platform.state(),
      reads,
    ),
    client.serve(
      subject(SUPERVISOR_METHODS.updatePlatform),
      updatePlatformRequestSchema,
      async (request) => {
        await service.platform.update(request.version, request.backupBytes);

        return ok;
      },
    ),
    client.serve(subject(SUPERVISOR_METHODS.restartPlatform), supervisorEmptyRequestSchema, () => {
      service.platform.restart();

      return ok;
    }),
    client.serve(subject(SUPERVISOR_METHODS.shutdownPlatform), supervisorEmptyRequestSchema, () => {
      service.platform.shutdown();

      return ok;
    }),
    client.serve(
      subject(SUPERVISOR_METHODS.platformService),
      platformServiceRequestSchema,
      async (request) => {
        await controlPlatformService(request);

        return ok;
      },
    ),
    client.serve(subject(SUPERVISOR_METHODS.checkUpdates), supervisorEmptyRequestSchema, () => {
      service.checkUpdatesNow();

      return ok;
    }),
    client.serve(subject(SUPERVISOR_METHODS.reconcile), reconcileRequestSchema, (request) =>
      service.reconcile(request),
    ),
    client.serve(subject(SUPERVISOR_METHODS.ensure), ensureRequestSchema, (request) =>
      service.ensure(request),
    ),
    client.serve(
      subject(SUPERVISOR_METHODS.managed),
      managedRequestSchema,
      (request) => service.managedStatuses(request.vendorId, request.ownerKind),
      reads,
    ),
    client.serve(
      subject(SUPERVISOR_METHODS.suspendManaged),
      supervisorEmptyRequestSchema,
      async () => {
        await service.suspendManaged();

        return ok;
      },
    ),
    client.serve(
      subject(SUPERVISOR_METHODS.resumeManaged),
      supervisorEmptyRequestSchema,
      async () => {
        await service.resumeManaged();

        return ok;
      },
    ),
    client.serve(
      subject(SUPERVISOR_METHODS.exportVolumes),
      volumesFolderRequestSchema,
      async (request) => service.exportVolumes(request.folder),
    ),
    client.serve(
      subject(SUPERVISOR_METHODS.importVolumes),
      volumesFolderRequestSchema,
      async (request) => service.importVolumes(request.folder),
    ),
    client.serve(
      subject(SUPERVISOR_METHODS.searchImages),
      imageSearchRequestSchema,
      async (request) => service.searchImages(request.query),
      reads,
    ),
    client.serve(
      subject(SUPERVISOR_METHODS.imageTags),
      imageTagsRequestSchema,
      async (request) => service.imageTags(request.image),
      reads,
    ),
    client.serve(
      subject(SUPERVISOR_METHODS.describeImage),
      imageDescribeRequestSchema,
      async (request) => service.describeImage(request.image, request.tag),
      reads,
    ),
    client.serve(subject(SUPERVISOR_METHODS.install), containerInstallRequestSchema, (request) => {
      service.install(request);

      return ok;
    }),
    client.serve(
      subject(SUPERVISOR_METHODS.dismissInstall),
      containerNameRequestSchema,
      (request) => {
        service.dismissInstall(request.name);

        return ok;
      },
    ),
    client.serve(
      subject(SUPERVISOR_METHODS.remove),
      containerRemoveRequestSchema,
      async (request) => {
        await service.remove(request.name, request.removeVolumes);

        return ok;
      },
    ),
    client.serve(
      subject(SUPERVISOR_METHODS.composeValidate),
      composeDefinitionSchema,
      async (request) => service.composeValidate(request),
      reads,
    ),
    client.serve(
      subject(SUPERVISOR_METHODS.composeDeploy),
      composeDefinitionSchema,
      async (request) => {
        await service.composeDeploy(request);

        return ok;
      },
    ),
    client.serve(
      subject(SUPERVISOR_METHODS.composeGet),
      composeProjectRequestSchema,
      async (request) => service.composeGet(request.project),
      reads,
    ),
    client.serve(
      subject(SUPERVISOR_METHODS.composeControl),
      composeControlRequestSchema,
      (request) => {
        service.composeControl(request.project, request.action);

        return ok;
      },
    ),
    client.serve(
      subject(SUPERVISOR_METHODS.composeRemove),
      composeRemoveRequestSchema,
      (request) => {
        service.composeRemove(request.project, request.removeVolumes, request.removeFiles);

        return ok;
      },
    ),
    client.serve(
      busSubjects.service(SUPERVISOR_SERVICE, ADAPTER_COMMAND_METHOD),
      adapterCommandSchema,
      (command) => service.command(command),
    ),
    client.serve(busSubjects.stateResync(SUPERVISOR_SERVICE), resyncRequestSchema, () =>
      service.resync(),
    ),
  ];
}
