/**
 * Loads what a package adds to the interface: its module and its stylesheet, from the release
 * installed (PACKAGES.md 5).
 *
 * Loaded when something of the package is first drawn, and kept: every card of it on a
 * dashboard shares one import. The release is in the address, so an update is a new address -
 * loaded fresh, its stylesheet put in place of the old one - while the old module stays in memory
 * until the next reload, where it does nothing.
 */
import type { InstalledPackage } from '@nebula-home/contracts';
import type { PackageUiDefinition } from '@nebula-home/package-ui';

import { packageFileUrl } from '@/packages/api';
import { importModule } from '@/packages/import-module';

/** What loading a package's interface needs of it. */
export type LoadablePackage = Pick<InstalledPackage, 'id' | 'version' | 'ui'>;

/** The imports made so far, by package and release. */
const loaded = new Map<string, Promise<PackageUiDefinition>>();

/**
 * Puts a package's stylesheet in the page, in place of an older release's.
 *
 * @param found - The package.
 * @param entry - Its interface's entry, which the stylesheet is named beside.
 * @param styles - Its stylesheet, as the manifest names it.
 */
function placeStylesheet(found: LoadablePackage, entry: string, styles: string): void {
  const href = packageFileUrl(found, entry, styles);
  const selector = `link[data-package="${CSS.escape(found.id)}"]`;
  const existing = document.head.querySelector<HTMLLinkElement>(selector);

  if (existing !== null) {
    if (existing.getAttribute('href') !== href) {
      existing.setAttribute('href', href);
    }

    return;
  }

  const link = document.createElement('link');

  link.rel = 'stylesheet';
  link.href = href;
  link.dataset['package'] = found.id;
  document.head.append(link);
}

/**
 * Whether what a module exports by default is a package's interface.
 *
 * @param value - The default export.
 * @returns True for an object: what `definePackageUi` returns.
 */
function isDefinition(value: unknown): value is PackageUiDefinition {
  return typeof value === 'object' && value !== null;
}

/**
 * Imports a package's module, once per release.
 *
 * @param found - The package, at the release installed.
 * @returns What it adds.
 * @throws {Error} For a package that adds nothing to the interface, or a module that is not one.
 */
export async function loadPackageUi(found: LoadablePackage): Promise<PackageUiDefinition> {
  const { ui } = found;

  if (ui === null) {
    throw new Error(`The ${found.id} package adds nothing to the interface`);
  }

  const key = `${found.id}@${found.version}`;
  const cached = loaded.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const loading = (async (): Promise<PackageUiDefinition> => {
    // The shared modules first: the package's module reads them as it is evaluated.
    const { installPackageHost } = await import('@/packages/shared-modules');

    installPackageHost();

    if (ui.styles !== undefined) {
      placeStylesheet(found, ui.entry, ui.styles);
    }

    const module = await importModule(packageFileUrl(found, ui.entry, ui.entry));

    if (!isDefinition(module['default'])) {
      throw new Error(`The ${found.id} package's interface does not export definePackageUi(…)`);
    }

    return module['default'];
  })();

  loaded.set(key, loading);
  // A failed import is tried again next time rather than remembered.
  loading.catch(() => {
    loaded.delete(key);
  });

  return loading;
}
