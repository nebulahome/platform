/**
 * Where a package's own page is, and the places of the platform a package may link to
 * (PACKAGES_DOCS.md 6.6).
 *
 * A package names a path of its page - `/clips/42` - and a place of the platform by what it is -
 * an entity, a device - never by address: the interface's addresses are its own, and may change
 * without a package noticing.
 */
import type { PlatformTarget } from '@nebulahome/package-sdk/ui';

import { devicePath } from '@/routes/library/device/device-path';
import { entityPath } from '@/routes/library/entity/entity-path';

/**
 * The address of a package's page, at the root or at one of its paths.
 *
 * @param packageId - The package.
 * @param to - A path of its page: `/clips/42`, `clips?day=3`; its root when not given.
 * @returns The address.
 */
export function packageAppPath(packageId: string, to = '/'): string {
  const base = `/packages/${encodeURIComponent(packageId)}/app`;

  if (to === '' || to === '/') {
    return base;
  }

  return to.startsWith('/') || to.startsWith('?') ? `${base}${to}` : `${base}/${to}`;
}

/**
 * The path of a package's page an address is at.
 *
 * @param packageId - The package.
 * @param pathname - The address's path.
 * @returns The path inside its page, `/` at the root; `/` too for an address outside it.
 */
export function packagePathOf(packageId: string, pathname: string): string {
  const base = packageAppPath(packageId);

  if (pathname !== base && !pathname.startsWith(`${base}/`)) {
    return '/';
  }

  const rest = pathname.slice(base.length);

  return rest === '' ? '/' : rest;
}

/**
 * The address of a place of the platform.
 *
 * @param target - What it is.
 * @returns Its address.
 */
export function platformPath(target: PlatformTarget): string {
  switch (target.kind) {
    case 'entity':
      return entityPath(target.entityId);
    case 'device':
      return devicePath(target.deviceId);
    case 'package':
      return `/packages/${encodeURIComponent(target.packageId)}`;
    case 'dashboard':
      return target.dashboardId === undefined
        ? '/dashboards'
        : `/dashboards/${encodeURIComponent(target.dashboardId)}`;
  }
}
