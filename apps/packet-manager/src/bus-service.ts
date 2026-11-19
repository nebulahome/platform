/**
 * What `packet-manager` answers on the bus: `nebula.v1.svc.packet-manager.<method>`, asked by
 * `api` on the owner's behalf, and `package_announce`, by a package's own process once it runs.
 *
 * An install answers once the packages are unpacked and started - or the integration's bundle is
 * unpacked and `hub` has loaded it - which can be minutes on a slow connection: `api` waits for
 * it, with a timeout to match.
 */
import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  busSubjects,
  hubDetailRequestSchema,
  hubLogoRequestSchema,
  hubSearchRequestSchema,
  integrationInstallRequestSchema,
  integrationRemoveRequestSchema,
  integrationUpdatesRequestSchema,
  PACKET_MANAGER_METHODS,
  PACKET_MANAGER_SERVICE,
  packageAnnounceRequestSchema,
  packageAvailableRequestSchema,
  packageConfigureRequestSchema,
  packageIdRequestSchema,
  packageInstallRequestSchema,
  packageLogsRequestSchema,
  packagePlanRequestSchema,
  packageRemoveRequestSchema,
  packetManagerEmptyRequestSchema,
  runUpdatesRequestSchema,
} from '@nebulahome/contracts';

import type { IntegrationManager } from './integrations/integration-manager.js';
import type { PackageManager } from './packages/package-manager.js';
import type { UpdateRunner } from './services/update-runner.js';

/** What every acknowledged method answers. */
const ACKNOWLEDGED = { ok: true as const };

/**
 * The subject of one method.
 *
 * @param method - The method.
 * @returns Its subject.
 */
function subject(
  method: (typeof PACKET_MANAGER_METHODS)[keyof typeof PACKET_MANAGER_METHODS],
): string {
  return busSubjects.service(PACKET_MANAGER_SERVICE, method);
}

/**
 * Serves every method.
 *
 * @param client - The bus.
 * @param packages - The packages it installs and runs.
 * @param integrations - The integrations it installs.
 * @param updates - The rounds of updates.
 * @returns The subscriptions, to end on shutdown.
 */
export function servePacketManager(
  client: BusClient,
  packages: PackageManager,
  integrations: IntegrationManager,
  updates: UpdateRunner,
): BusSubscription[] {
  /** Reads may be answered side by side with a long install. */
  const reads = { concurrency: 8 };

  return [
    // --- packages ----------------------------------------------------------------------------
    client.serve(
      subject(PACKET_MANAGER_METHODS.packageList),
      packetManagerEmptyRequestSchema,
      async () => ({ items: await packages.list() }),
      reads,
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.packageGet),
      packageIdRequestSchema,
      async (request) => packages.get(request.packageId),
      reads,
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.packageAvailable),
      packageAvailableRequestSchema,
      async (request) => packages.available(request.check),
      reads,
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.packageSearch),
      hubSearchRequestSchema,
      async (request) => packages.search(request),
      reads,
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.packagePlan),
      packagePlanRequestSchema,
      async (request) => packages.plan(request.packageId, request.version),
      reads,
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.packageInstall),
      packageInstallRequestSchema,
      async (request) => ({
        installed: await packages.install(request.packageId, request.version, request.requestedBy),
      }),
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.packageUpdate),
      packageIdRequestSchema,
      async (request) => ({ package: await packages.update(request.packageId) }),
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.packageRemove),
      packageRemoveRequestSchema,
      async (request) => {
        await packages.remove(request.packageId, request.isDataRemoved);

        return ACKNOWLEDGED;
      },
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.packageStart),
      packageIdRequestSchema,
      async (request) => ({ package: await packages.startPackage(request.packageId) }),
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.packageStop),
      packageIdRequestSchema,
      async (request) => ({ package: await packages.stopPackage(request.packageId) }),
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.packageRestart),
      packageIdRequestSchema,
      async (request) => ({ package: await packages.restartPackage(request.packageId) }),
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.packageLogs),
      packageLogsRequestSchema,
      (request) => packages.logs(request.packageId, request.tail, request.since),
      reads,
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.packageConfigure),
      packageConfigureRequestSchema,
      async (request) => ({ package: await packages.configure(request.packageId, request.values) }),
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.packageAnnounce),
      packageAnnounceRequestSchema,
      async (request) => {
        await packages.announce(request);

        return ACKNOWLEDGED;
      },
      reads,
    ),

    // --- integrations ------------------------------------------------------------------------
    client.serve(
      subject(PACKET_MANAGER_METHODS.integrationSearch),
      hubSearchRequestSchema,
      async (request) => integrations.search(request),
      reads,
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.integrationInstall),
      integrationInstallRequestSchema,
      async (request) =>
        integrations.install(request.vendorId, request.version, request.requestedBy),
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.integrationRemove),
      integrationRemoveRequestSchema,
      async (request) => integrations.remove(request.vendorId),
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.integrationUpdates),
      integrationUpdatesRequestSchema,
      async (request) => integrations.updates(request.check),
      reads,
    ),

    // --- the Community Hub, for both -----------------------------------------------------------
    client.serve(
      subject(PACKET_MANAGER_METHODS.hubLogo),
      hubLogoRequestSchema,
      async (request) => packages.hubLogo(request.sha256),
      reads,
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.hubDetail),
      hubDetailRequestSchema,
      async (request) => packages.hubDetail(request.kind, request.id),
      reads,
    ),

    // --- rounds of updates, of both ----------------------------------------------------------
    client.serve(
      subject(PACKET_MANAGER_METHODS.runUpdates),
      runUpdatesRequestSchema,
      (request) => Promise.resolve({ round: updates.run(request.items, request.requestedBy) }),
      reads,
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.updateStatus),
      packetManagerEmptyRequestSchema,
      () => Promise.resolve({ round: updates.status() }),
      reads,
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.reloadUpdates),
      packetManagerEmptyRequestSchema,
      async () => {
        await updates.reload();

        return ACKNOWLEDGED;
      },
      reads,
    ),
  ];
}
