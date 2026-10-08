/**
 * The health strip of an integration's page: Runtime, Connection, Devices, Updates - each a
 * standing, a word and one line, read from what the page already has.
 *
 * What is not known is not said: the hub does not tell how long a vendor has been loaded, so
 * Runtime says how it stands without an uptime; a vendor nobody installed - a copy under
 * development, read from the hub's development folder - is updated by rebuilding it, and says so.
 *
 * Pure, so the page draws what a test can hold it to.
 */
import type { DeviceView, IntegrationVendorView } from '@nebulahome/contracts';
import type { HealthTone } from '@nebulahome/ui';

import { vendorStatusOf } from '@/library/vendor-status';

/** One card of the strip, before it is drawn. */
export type HealthLine = {
  readonly tone: HealthTone;
  readonly value: string;
  readonly detail: string;
};

/**
 * How the vendor itself stands.
 *
 * @param vendor - The vendor.
 * @param deviceCount - How many devices the page found under it: newer than the vendor's count.
 * @returns The Runtime card.
 */
export function runtimeHealth(vendor: IntegrationVendorView, deviceCount: number): HealthLine {
  const status = vendorStatusOf({ ...vendor, deviceCount });

  return {
    tone: status.kind === 'running' ? 'success' : status.kind === 'idle' ? 'neutral' : 'warning',
    value: status.label,
    // The package's own sentence is the Connection card's: said once, where it breaks.
    detail: vendor.needsPackage ? 'Waiting for a package it needs' : status.detail,
  };
}

/**
 * How the vendor reaches its devices, and whether it can.
 *
 * @param vendor - The vendor.
 * @returns The Connection card.
 */
export function connectionHealth(vendor: IntegrationVendorView): HealthLine {
  if (vendor.needsPackage) {
    return {
      tone: 'danger',
      value: 'Not connected',
      detail: vendor.packageProblems[0] ?? 'A package it needs is not running',
    };
  }

  if (vendor.needsAccount) {
    return {
      tone: 'warning',
      value: 'Signed out',
      detail: `No ${vendor.account?.name ?? 'account'} signed in`,
    };
  }

  const detail = vendor.discoverySources.includes('mdns')
    ? 'Discovery over mDNS'
    : vendor.discoverySources.includes('module')
      ? 'Finds its devices by its own scan'
      : vendor.adoption === 'automatic'
        ? 'Its devices are paired on the bridge'
        : 'Each device added by its address';

  return vendor.internetRequired
    ? { tone: 'success', value: 'Cloud', detail: `Through the internet · ${detail.toLowerCase()}` }
    : { tone: 'success', value: 'Local network', detail };
}

/**
 * How the vendor's devices are doing, and whether more were found.
 *
 * @param vendor - The vendor.
 * @param devices - The devices added under it.
 * @param foundCount - How many of its devices were found on the network and not added.
 * @returns The Devices card.
 */
export function devicesHealth(
  vendor: Pick<IntegrationVendorView, 'adoption'>,
  devices: readonly Pick<DeviceView, 'state'>[],
  foundCount: number,
): HealthLine {
  const found = foundCount === 0 ? null : `${String(foundCount)} more found on the network`;

  if (devices.length === 0) {
    return {
      tone: foundCount === 0 ? 'neutral' : 'info',
      value: 'None yet',
      detail:
        found ??
        (vendor.adoption === 'automatic'
          ? 'A device paired on the bridge appears here'
          : 'Add one by its address'),
    };
  }

  const failing = devices.filter((device) => device.state === 'failed').length;
  const reporting = devices.filter((device) => device.state === 'running').length;
  const total = String(devices.length);

  if (failing > 0) {
    return {
      tone: 'warning',
      value: `${String(failing)} of ${total} failing`,
      detail: found ?? `${String(reporting)} reporting`,
    };
  }

  return {
    tone: foundCount === 0 ? 'success' : 'info',
    value: `${String(reporting)} of ${total} reporting`,
    detail: found ?? (reporting === devices.length ? 'Every device answers' : 'Some are starting'),
  };
}

/**
 * Whether a newer release of the vendor is waiting.
 *
 * @param vendor - The vendor.
 * @returns The Updates card.
 */
export function updatesHealth(vendor: IntegrationVendorView): HealthLine {
  if (vendor.origin === 'development') {
    return { tone: 'neutral', value: 'In development', detail: 'Updated by rebuilding it' };
  }

  if (vendor.update?.hasUpdate === true && vendor.update.latestVersion !== null) {
    return {
      tone: 'info',
      value: `${vendor.update.latestVersion} ready`,
      detail: `Installed ${vendor.version}`,
    };
  }

  if (vendor.update?.hasNewBuild === true) {
    return { tone: 'info', value: 'New build', detail: 'Another build of the same version' };
  }

  if (vendor.update === null) {
    return { tone: 'neutral', value: `v${vendor.version}`, detail: 'The index cannot be asked' };
  }

  return { tone: 'success', value: 'Up to date', detail: `${vendor.version} is the latest` };
}
