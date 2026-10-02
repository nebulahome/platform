/**
 * What `packet-manager` answers on the bus: `nebula.v1.svc.packet-manager.<method>`, asked by
 * `api` on the owner's behalf, and `announce`, by a package's own process once it runs.
 *
 * An install answers once the packages are unpacked and started, which can be minutes on a slow
 * connection: `api` waits for it, with a timeout to match.
 */
import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  busSubjects,
  PACKET_MANAGER_METHODS,
  PACKET_MANAGER_SERVICE,
  packageAnnounceRequestSchema,
  packageConfigureRequestSchema,
  packageIdRequestSchema,
  packageInstallRequestSchema,
  packageLogsRequestSchema,
  packageRemoveRequestSchema,
  packetManagerEmptyRequestSchema,
} from '@nebulahome/contracts';

import type { PacketManager } from './service.js';

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
 * @param service - The packet-manager.
 * @returns The subscriptions, to end on shutdown.
 */
export function servePacketManager(client: BusClient, service: PacketManager): BusSubscription[] {
  /** Reads may be answered side by side with a long install. */
  const reads = { concurrency: 8 };

  return [
    client.serve(
      subject(PACKET_MANAGER_METHODS.list),
      packetManagerEmptyRequestSchema,
      async () => ({ items: await service.list() }),
      reads,
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.get),
      packageIdRequestSchema,
      async (request) => service.get(request.packageId),
      reads,
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.available),
      packetManagerEmptyRequestSchema,
      async () => service.available(),
      reads,
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.plan),
      packageInstallRequestSchema,
      async (request) => service.plan(request.packageId, request.version),
      reads,
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.logs),
      packageLogsRequestSchema,
      (request) => service.logs(request.packageId, request.tail, request.since),
      reads,
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.install),
      packageInstallRequestSchema,
      async (request) => ({
        installed: await service.install(request.packageId, request.version),
      }),
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.update),
      packageIdRequestSchema,
      async (request) => ({
        package: await service.update(request.packageId),
      }),
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.remove),
      packageRemoveRequestSchema,
      async (request) => {
        await service.remove(request.packageId, request.isDataRemoved);

        return { ok: true as const };
      },
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.start),
      packageIdRequestSchema,
      async (request) => ({
        package: await service.startPackage(request.packageId),
      }),
    ),
    client.serve(subject(PACKET_MANAGER_METHODS.stop), packageIdRequestSchema, async (request) => ({
      package: await service.stopPackage(request.packageId),
    })),
    client.serve(
      subject(PACKET_MANAGER_METHODS.restart),
      packageIdRequestSchema,
      async (request) => ({
        package: await service.restartPackage(request.packageId),
      }),
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.configure),
      packageConfigureRequestSchema,
      async (request) => ({ package: await service.configure(request.packageId, request.values) }),
    ),
    client.serve(
      subject(PACKET_MANAGER_METHODS.announce),
      packageAnnounceRequestSchema,
      async (request) => {
        await service.announce(request);

        return { ok: true as const };
      },
      reads,
    ),
  ];
}
