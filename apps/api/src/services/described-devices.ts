/**
 * A device described again because it was set up differently: a Bot switched from press to
 * switch mode in its vendor's app.
 *
 * `core` removes the entities it no longer has and adds the new ones, and says so on the bus.
 * What follows here is what the house needs besides: a line in the device's Activity - kept in
 * the audit log, which the Activity reads beside the state history - and, on a linked device, the
 * new readings linked to the other ways' readings of the same key, as linking the two did.
 */
import { ulid, type BusClient, type BusSubscription } from '@nebulahome/bus';
import { busSubjects, deviceEventSchema, type DeviceEventPayload } from '@nebulahome/contracts';

import type { AuditLog } from './audit.js';
import type { DevicesContext } from './devices.js';
import { linkDescribedWay, syncLinksOnCore } from './links.js';

/** The audit action a device described again is recorded under. */
export const DESCRIBED_ACTION = 'device.describe';

/** What following described devices needs. */
export type DescribedDevicesOptions = {
  /**
   * The collaborators, for one device.
   *
   * @param traceId - The unit of work.
   * @returns The context.
   */
  readonly contextFor: (traceId: string) => DevicesContext;
  readonly audit: Pick<AuditLog, 'record'>;
};

/**
 * Records one device described again and links its new readings.
 *
 * @param options - See {@link DescribedDevicesOptions}.
 * @param event - What `core` said.
 * @returns Once done; a failure is logged, not thrown.
 */
export async function onDescribed(
  options: DescribedDevicesOptions,
  event: DeviceEventPayload,
): Promise<void> {
  const { described } = event;

  // Described again with the same entities: nothing happened that the Activity could say.
  if (described === undefined || described.added.length + described.removed.length === 0) {
    return;
  }

  const context = options.contextFor(ulid());

  try {
    await options.audit.record({
      action: DESCRIBED_ACTION,
      resourceType: 'device',
      resourceId: event.deviceId,
      result: 'success',
      isSystem: true,
      traceId: context.traceId,
      details: described,
    });
    await syncLinksOnCore(context, await linkDescribedWay(context, event.deviceId));
  } catch (error: unknown) {
    context.logger.warn(
      { err: error, deviceId: event.deviceId },
      'Could not follow a device described again',
    );
  }
}

/**
 * Follows the devices `core` describes again.
 *
 * @param client - The bus.
 * @param options - See {@link DescribedDevicesOptions}.
 * @returns The subscription.
 */
export function followDescribedDevices(
  client: BusClient,
  options: DescribedDevicesOptions,
): BusSubscription {
  return client.subscribe(busSubjects.deviceEvent('updated'), deviceEventSchema, (event) => {
    void onDescribed(options, event);
  });
}
