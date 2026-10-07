/**
 * The health strip of a device's page: Connection, Signal, Firmware, Integration - each a
 * standing, a word and one line, read from the device and its entities.
 *
 * What is not known is not said: a device with no signal entity says so rather than inventing a
 * strength, and the radio it is reached over is the transport's word ("HTTP"), not a guess of
 * "Wi-Fi".
 *
 * Pure, so the page draws what a test can hold it to.
 */
import {
  isUpdateOffered,
  pollIntervalMsOf,
  type CapabilityState,
  type DeviceView,
  type EntityView,
  type IntegrationVendorView,
} from '@nebulahome/contracts';
import type { HealthTone } from '@nebulahome/ui';

import { relativeTime } from '@/lib/format-time';
import type { DeviceStanding } from '@/library/entity-reading';
import { vendorStatusOf } from '@/library/vendor-status';

/** One card of the strip, before it is drawn. */
export type DeviceHealthLine = {
  readonly tone: HealthTone;
  readonly value: string;
  readonly detail: string;
};

/** What the strip reads of each entity. */
type EntityState = { readonly entity: EntityView; readonly state: CapabilityState };

/**
 * A polling interval in short words: "Every 5 s", "Every 2 min".
 *
 * @param ms - The interval.
 * @returns The words.
 */
function everyText(ms: number): string {
  return ms < 60_000
    ? `Every ${String(Math.round(ms / 1000))} s`
    : `Every ${String(Math.round(ms / 60_000))} min`;
}

/**
 * Whether the device is heard from, and how often it is asked.
 *
 * @param device - The device.
 * @param standing - Whether its entities report, and when it was last heard from.
 * @returns The Connection card.
 */
export function deviceConnectionHealth(
  device: Pick<DeviceView, 'state' | 'options' | 'lastError'>,
  standing: DeviceStanding,
): DeviceHealthLine {
  const seen =
    standing.lastSeenAt === null ? 'never seen' : `seen ${relativeTime(standing.lastSeenAt)}`;

  if (device.state === 'disabled') {
    return { tone: 'neutral', value: 'Disabled', detail: 'Switched off: the hub leaves it be' };
  }

  if (device.state === 'failed') {
    return { tone: 'danger', value: 'Unreachable', detail: device.lastError ?? seen };
  }

  if (!standing.isReporting) {
    return { tone: 'warning', value: 'Silent', detail: seen };
  }

  const every = pollIntervalMsOf(device.options);

  return {
    tone: 'success',
    value: 'Reporting',
    detail: every === undefined ? `On every change · ${seen}` : `${everyText(every)} · ${seen}`,
  };
}

/**
 * How strong the device's radio is, from its signal entity.
 *
 * @param lines - The device's entities and their states.
 * @param transport - How it is reached, in the transport's own word.
 * @returns The Signal card.
 */
export function deviceSignalHealth(
  lines: readonly EntityState[],
  transport: string,
): DeviceHealthLine {
  const signal = lines.find((line) => line.entity.deviceClass === 'signal_strength');
  const value = signal?.state.sensor_numeric?.value;

  if (value === undefined) {
    return { tone: 'neutral', value: 'Not reported', detail: `Reached over ${transport}` };
  }

  const strength = value >= -67 ? 'Good' : value >= -80 ? 'Fair' : 'Weak';

  return {
    tone: strength === 'Good' ? 'success' : strength === 'Fair' ? 'neutral' : 'warning',
    value: strength,
    detail: `${String(Math.round(value))} dBm over ${transport}`,
  };
}

/** The Firmware card, and the entity whose page installs it. */
export type FirmwareHealth = DeviceHealthLine & {
  /** The update entity, when there is an update to install. */
  readonly updateEntityId: string | null;
};

/**
 * Whether newer firmware is waiting.
 *
 * @param lines - The device's entities and their states.
 * @param swVersion - The firmware the device reported, when no update entity says more.
 * @returns The Firmware card.
 */
export function deviceFirmwareHealth(
  lines: readonly EntityState[],
  swVersion: string | null,
): FirmwareHealth {
  const firmware = lines.find((line) => line.state.update !== undefined);
  const update = firmware?.state.update;

  if (firmware === undefined || update === undefined) {
    return {
      tone: 'neutral',
      value: swVersion ?? 'Not reported',
      detail: swVersion === null ? 'The device says no version' : 'Installed',
      updateEntityId: null,
    };
  }

  const installed = update.installedVersion ?? swVersion;

  if (update.isInstalling) {
    return {
      tone: 'info',
      value: 'Installing',
      detail: update.latestVersion ?? 'The newer firmware',
      updateEntityId: null,
    };
  }

  if (isUpdateOffered(update)) {
    return {
      tone: 'info',
      value: `${update.latestVersion ?? 'Newer'} ready`,
      detail: installed === null ? 'Newer firmware is out' : `Installed ${installed}`,
      updateEntityId: firmware.entity.entityId,
    };
  }

  return {
    tone: 'success',
    value: 'Up to date',
    detail: installed === null ? 'The latest' : `${installed} is the latest`,
    updateEntityId: null,
  };
}

/**
 * How what brings the device in stands: its integration, or the package or container it is.
 *
 * @param device - The device.
 * @param vendor - Its integration, for a device an integration brings.
 * @param vendorName - The integration's name, or its id.
 * @returns The Integration card.
 */
export function deviceIntegrationHealth(
  device: Pick<DeviceView, 'origin' | 'driverName' | 'externalId' | 'name'>,
  vendor: IntegrationVendorView | undefined,
  vendorName: string,
): DeviceHealthLine {
  if (device.origin === 'package') {
    return { tone: 'neutral', value: device.driverName, detail: 'Kept by its package' };
  }

  if (device.origin === 'container') {
    return { tone: 'neutral', value: device.externalId ?? device.name, detail: 'A container' };
  }

  if (device.origin === 'system') {
    return { tone: 'neutral', value: vendorName, detail: 'Part of Nebula Home' };
  }

  if (vendor === undefined) {
    return { tone: 'neutral', value: vendorName, detail: 'The hub did not say how it stands' };
  }

  const status = vendorStatusOf(vendor);

  return {
    tone: status.kind === 'running' || status.kind === 'idle' ? 'success' : 'warning',
    value:
      status.kind === 'running' || status.kind === 'idle' ? `${vendor.name} running` : status.label,
    detail:
      status.kind === 'running' || status.kind === 'idle' ? `v${vendor.version}` : status.detail,
  };
}
