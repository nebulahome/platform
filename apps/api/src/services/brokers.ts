/**
 * The platform's brokers, read through and driven: today the house's Matter fabric, which `hub`
 * holds (ARCHITECTURE.md 4.2).
 *
 * Everything here is a question to the hub. The one thing it adds is what removing a node means
 * for the house: its devices are removed the way any device is - `hub` lets go, `core` deletes the
 * rows - and then the node is taken off the fabric, which it may refuse when it does not answer:
 * the devices are gone either way, and the page offers to try the fabric again.
 */
import { and, eq } from 'drizzle-orm';

import {
  busSubjects,
  HUB_MATTER_COMMISSION_METHOD,
  HUB_MATTER_NODES_METHOD,
  HUB_MATTER_REMOVE_METHOD,
  HUB_MATTER_RESTORE_METHOD,
  HUB_MATTER_STATUS_METHOD,
  HUB_SERVICE,
  MATTER_GENERIC_KIND,
  MATTER_TRANSPORT,
  MATTER_VENDOR,
  matterCommissioningSchema,
  matterNodesReplySchema,
  matterRemoveReplySchema,
  matterRestoreReplySchema,
  matterStatusSchema,
  NotFoundError,
  type BrokerSummary,
  type MatterCommissioning,
  type MatterNode,
  type MatterRestoreRequest,
  type MatterStatus,
} from '@nebulahome/contracts';
import { schema } from '@nebulahome/db';

import { deleteDevice, type DevicesContext, type RemovedDevice } from './devices.js';
import { busOf, listCatalogue, reloadOnHub, type IntegrationsContext } from './integrations.js';

/**
 * Where the Matter fabric stands.
 *
 * @param context - The request's collaborators.
 * @returns Its state.
 * @throws {DeviceUnavailableError} When the hub cannot be asked.
 */
export async function matterStatus(context: IntegrationsContext): Promise<MatterStatus> {
  return busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_MATTER_STATUS_METHOD),
    {},
    matterStatusSchema,
    { traceId: context.traceId },
  );
}

/**
 * Every node of the fabric, with the devices it is in the house.
 *
 * @param context - The request's collaborators.
 * @returns The nodes.
 * @throws {DeviceUnavailableError} When the hub cannot be asked.
 */
export async function matterNodes(context: IntegrationsContext): Promise<MatterNode[]> {
  const reply = await busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_MATTER_NODES_METHOD),
    {},
    matterNodesReplySchema,
    { traceId: context.traceId },
  );

  return reply.items;
}

/**
 * The brokers, for their cards.
 *
 * @param context - The request's collaborators.
 * @returns Each broker, how it stands and how many nodes answer.
 * @throws {DeviceUnavailableError} When the hub cannot be asked.
 */
export async function listBrokers(context: IntegrationsContext): Promise<BrokerSummary[]> {
  const status = await matterStatus(context);

  return [{ id: MATTER_VENDOR, state: status.state, devices: status.nodes }];
}

/**
 * Starts commissioning a node shared by another app.
 *
 * @param context - The request's collaborators.
 * @param code - Its pairing code, already checked.
 * @returns The job, running: the page reads the status until it ends.
 * @throws {ConflictError} When Matter is off, or a commissioning runs already.
 */
export async function commissionMatter(
  context: IntegrationsContext,
  code: string,
): Promise<MatterCommissioning> {
  return busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_MATTER_COMMISSION_METHOD),
    { code },
    matterCommissioningSchema,
    { traceId: context.traceId },
  );
}

/**
 * Removes a node from the house: its devices, then the node from the fabric.
 *
 * @param context - The request's collaborators.
 * @param nodeId - The node.
 * @returns The devices removed.
 * @throws {NotFoundError} When the fabric has no such node.
 * @throws {DeviceUnavailableError} When the node did not leave the fabric; its devices are
 * removed all the same.
 */
export async function removeMatterNode(
  context: DevicesContext,
  nodeId: string,
): Promise<RemovedDevice[]> {
  const node = (await matterNodes(context)).find((each) => each.nodeId === nodeId);

  if (node === undefined) {
    throw new NotFoundError('The Matter fabric has no such node', { details: { nodeId } });
  }

  const removed: RemovedDevice[] = [];

  for (const device of node.devices) {
    if (device.deviceId !== null) {
      // One after another: each is a hub forget and a core release, in that order.
      // eslint-disable-next-line no-await-in-loop -- see above
      removed.push(await deleteDevice(context, device.deviceId));
    }
  }

  await busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_MATTER_REMOVE_METHOD),
    { nodeId },
    matterRemoveReplySchema,
    { traceId: context.traceId },
  );

  return removed;
}

/**
 * Brings back a device removed from the house whose node is still on the fabric: discovery adds
 * it again.
 *
 * @param context - The request's collaborators.
 * @param request - The node, and which endpoint behind it.
 * @returns Whether it was removed.
 */
export async function restoreMatterDevice(
  context: IntegrationsContext,
  request: MatterRestoreRequest,
): Promise<boolean> {
  const reply = await busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_MATTER_RESTORE_METHOD),
    request,
    matterRestoreReplySchema,
    { traceId: context.traceId },
  );

  return reply.isRestored;
}

/** A Matter device handed from the platform to the integration that takes it. */
export type RehomedDevice = { readonly deviceId: string; readonly kind: string };

/**
 * Hands each Matter device the platform holds to the integration whose rules now take it alone:
 * one installed after the device was added. The node, the device's id and its entities stay, since
 * both drivers run the platform's Matter mapping: only whose device it is changes.
 *
 * @param context - The request's collaborators.
 * @returns The devices handed over, with their new kind.
 */
export async function rehomeMatterDevices(context: DevicesContext): Promise<RehomedDevice[]> {
  const held = (await matterNodes(context))
    .flatMap((node) => node.devices)
    .filter((device) => device.kind === MATTER_GENERIC_KIND && device.claimedBy.length === 1);

  if (held.length === 0) {
    return [];
  }

  const catalogue = await listCatalogue(context);
  const rehomed: RehomedDevice[] = [];

  for (const { deviceId, claimedBy } of held) {
    const vendor = catalogue.find((each) => each.id === claimedBy[0]);
    // shortcut: only a vendor with one Matter driver listing no models takes its devices over;
    // choose by product id the way discovery does once a vendor ships more than one.
    const [driver, other] = (vendor?.drivers ?? []).filter(
      (each) => each.transport === MATTER_TRANSPORT,
    );

    if (
      deviceId === null ||
      vendor === undefined ||
      driver === undefined ||
      other !== undefined ||
      driver.models.length > 0
    ) {
      continue;
    }

    const { integrations } = schema.registry;
    // eslint-disable-next-line no-await-in-loop -- one device at a time, each then reloaded
    const changed = await context.db
      .update(integrations)
      .set({
        kind: driver.id,
        kindVersion: vendor.version,
        model: driver.name,
        updatedAt: new Date(),
      })
      .where(and(eq(integrations.id, deviceId), eq(integrations.kind, MATTER_GENERIC_KIND)))
      .returning({ id: integrations.id });

    if (changed.length > 0) {
      // eslint-disable-next-line no-await-in-loop -- see above
      await reloadOnHub(context, deviceId);
      rehomed.push({ deviceId, kind: driver.id });
    }
  }

  return rehomed;
}
