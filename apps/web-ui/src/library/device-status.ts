/**
 * How a device stands, in a word: what its row's status says on the Devices page, and the order
 * the Status column sorts by.
 *
 * Disabled first - it was switched off on purpose; then a firmware update waiting, worth a look
 * even while it reports; then reporting; then failing - the hub could not start it - and silent,
 * reachable once but quiet now.
 *
 * Pure, so the row and the sort agree.
 */
import type { DeviceView } from '@nebulahome/contracts';
import type { PillTone } from '@nebulahome/ui';

import type { DeviceStanding } from '@/library/entity-reading';

/** Each standing, in the order the Status column sorts. */
export const DEVICE_STATUS_ORDER = [
  'unreachable',
  'silent',
  'update',
  'reporting',
  'disabled',
] as const;

/** One standing. */
export type DeviceStatusKind = (typeof DEVICE_STATUS_ORDER)[number];

/** How a device stands. */
export type DeviceStatus = {
  readonly kind: DeviceStatusKind;
  readonly label: string;
  readonly tone: PillTone;
};

/** What each standing says and looks like. */
const STATUSES: Readonly<Record<DeviceStatusKind, DeviceStatus>> = {
  unreachable: { kind: 'unreachable', label: 'Unreachable', tone: 'danger' },
  silent: { kind: 'silent', label: 'Silent', tone: 'warning' },
  update: { kind: 'update', label: 'Update ready', tone: 'cyan' },
  reporting: { kind: 'reporting', label: 'Reporting', tone: 'success' },
  disabled: { kind: 'disabled', label: 'Disabled', tone: 'neutral' },
};

/**
 * Says how a device stands.
 *
 * @param device - The device.
 * @param standing - Whether its entities report, from their readings.
 * @param hasUpdate - Whether a firmware update is offered on one of its entities.
 * @returns Its standing.
 */
export function deviceStatusOf(
  device: Pick<DeviceView, 'state'>,
  standing: Pick<DeviceStanding, 'isReporting'>,
  hasUpdate: boolean,
): DeviceStatus {
  if (device.state === 'disabled') {
    return STATUSES.disabled;
  }

  if (device.state === 'failed') {
    return STATUSES.unreachable;
  }

  if (!standing.isReporting) {
    return STATUSES.silent;
  }

  return hasUpdate ? STATUSES.update : STATUSES.reporting;
}
