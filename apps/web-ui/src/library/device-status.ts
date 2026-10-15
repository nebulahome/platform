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

import { defineMessage, type Message, text } from '@/i18n/messages';
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
const STATUSES: Readonly<
  Record<DeviceStatusKind, Omit<DeviceStatus, 'label'> & { readonly label: Message }>
> = {
  unreachable: {
    kind: 'unreachable',
    label: defineMessage('library.deviceStatus.unreachable', 'Unreachable'),
    tone: 'danger',
  },
  silent: {
    kind: 'silent',
    label: defineMessage('library.deviceStatus.silent', 'Silent'),
    tone: 'warning',
  },
  update: {
    kind: 'update',
    label: defineMessage('library.deviceStatus.updateReady', 'Update ready'),
    tone: 'cyan',
  },
  reporting: {
    kind: 'reporting',
    label: defineMessage('library.deviceStatus.reporting', 'Reporting'),
    tone: 'success',
  },
  disabled: {
    kind: 'disabled',
    label: defineMessage('library.deviceStatus.disabled', 'Disabled'),
    tone: 'neutral',
  },
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
    return statusOf('disabled');
  }

  if (device.state === 'failed') {
    return statusOf('unreachable');
  }

  if (!standing.isReporting) {
    return statusOf('silent');
  }

  return statusOf(hasUpdate ? 'update' : 'reporting');
}

/**
 * One standing, in the reader's language.
 *
 * @param kind - The standing.
 * @returns What it says and looks like.
 */
function statusOf(kind: DeviceStatusKind): DeviceStatus {
  const status = STATUSES[kind];

  return { ...status, label: text(status.label) };
}
