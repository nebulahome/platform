/**
 * Loads what a package adds to the interface: its entry, its components and its stylesheet, from
 * the release installed (PACKAGES_DOCS.md 6.1).
 *
 * The entry is what the SDK's build generates - `{ kind: 'nebula.ui', sdk, page, cards,
 * entityViews }`, each component behind a loader of its own chunk - so a dashboard with one of a
 * package's cards loads that card and nothing else of it. Loaded when something of the package is
 * first drawn, and kept: every card of it on a dashboard shares one import. The release is in the
 * address, so an update is a new address - loaded fresh, its stylesheet put in place of the old
 * one - while the old module stays in memory until the next reload, where it does nothing.
 */
import type { ComponentType } from 'react';

import type { InstalledPackage, SupportedLocale } from '@nebulahome/contracts';
import { SDK_VERSION } from '@nebulahome/package-sdk';

import { addCatalogueSource, type CatalogueTree } from '@/i18n/language';
import { translate } from '@/i18n/messages';
import { packageFileUrl } from '@/packages/api';
import { importModule } from '@/packages/import-module';

/** What loading a package's interface needs of it. */
export type LoadablePackage = Pick<InstalledPackage, 'id' | 'build' | 'ui'>;

/** A loader of one of a package's components: its chunk, imported. */
type ComponentLoader = () => Promise<unknown>;

/** A package's interface, as its entry declares it. */
export type PackageUiEntry = {
  /** The SDK version it was built against. */
  readonly sdk: string;

  readonly page: ComponentLoader | undefined;

  /** What it draws on every page: none from a build before SDK 1.6. */
  readonly background: ComponentLoader | undefined;

  readonly cards: Readonly<Record<string, ComponentLoader>>;
  readonly entityViews: Readonly<Record<string, ComponentLoader>>;

  /** Its translation catalogues, by language: none from a build before SDK 1.1. */
  readonly locales: Readonly<Record<string, CatalogueModuleLoader>>;
};

/** A loader of one of a package's catalogues: its chunk, imported. */
type CatalogueModuleLoader = () => Promise<unknown>;

/**
 * The namespace a package's strings are in.
 *
 * @param packageId - The package.
 * @returns `package/<id>`.
 */
export function packageNamespace(packageId: string): string {
  return `package/${packageId}`;
}

/** Which of a package's components. */
export type PackageComponentTarget =
  | { readonly kind: 'page' }
  | { readonly kind: 'background' }
  | { readonly kind: 'card'; readonly cardId: string }
  | { readonly kind: 'entityView'; readonly type: string };

/** One of a package's components, ready to draw with the props its target is given. */
export type PackageComponent = ComponentType<never>;

/** The imports made so far, by package and release. */
const loaded = new Map<string, Promise<PackageUiEntry>>();

/**
 * Says whether a value is a record.
 *
 * @param value - The value.
 * @returns True for a non-null object.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

/**
 * Says whether every value of a record is a loader.
 *
 * @param value - The record.
 * @returns True when it is one, of loaders.
 */
function isLoaders(value: unknown): value is Readonly<Record<string, ComponentLoader>> {
  return isRecord(value) && Object.values(value).every((each) => typeof each === 'function');
}

/**
 * Says whether a value can be drawn: a function component, or one React wrapped (`memo`).
 *
 * @param value - The value.
 * @returns True when it is a component.
 */
function isComponent(value: unknown): value is PackageComponent {
  return typeof value === 'function' || (isRecord(value) && '$$typeof' in value);
}

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
 * Reads a package's entry, refusing what this interface cannot draw.
 *
 * @param packageId - Whose, for the sentences.
 * @param value - What its module exports by default.
 * @returns The entry.
 * @throws {Error} For a module that is no entry, or one built against a newer SDK major.
 */
function entryOf(packageId: string, value: unknown): PackageUiEntry {
  if (
    !isRecord(value) ||
    value['kind'] !== 'nebula.ui' ||
    typeof value['sdk'] !== 'string' ||
    (value['page'] !== undefined && typeof value['page'] !== 'function') ||
    (value['background'] !== undefined && typeof value['background'] !== 'function') ||
    !isLoaders(value['cards']) ||
    !isLoaders(value['entityViews']) ||
    (value['locales'] !== undefined && !isLoaders(value['locales']))
  ) {
    throw new Error(
      translate(
        'packages.loader.packageidPackageSInterface',
        "The {{packageId}} package's interface was not built with @nebulahome/package-sdk",
        { packageId },
      ),
    );
  }

  /**
   * A version's major.
   *
   * @param version - `1.2.0`.
   * @returns `1`.
   */
  const major = (version: string): number => Number(version.split('.')[0]);

  if (major(value['sdk']) > major(SDK_VERSION)) {
    throw new Error(
      translate(
        'packages.loader.packageidPackageNeedsPackage',
        'The {{packageId}} package needs package SDK {{needed}}; this interface implements {{version}}',
        { packageId, needed: value['sdk'], version: SDK_VERSION },
      ),
    );
  }

  return {
    sdk: value['sdk'],
    page: typeof value['page'] === 'function' ? (value['page'] as ComponentLoader) : undefined,
    background:
      typeof value['background'] === 'function'
        ? (value['background'] as ComponentLoader)
        : undefined,
    cards: value['cards'],
    entityViews: value['entityViews'],
    locales: isLoaders(value['locales']) ? value['locales'] : {},
  };
}

/**
 * Reads a package's catalogue for a language.
 *
 * @param entry - The package's entry.
 * @param locale - The language.
 * @returns The catalogue, or undefined when the package has none for it.
 */
async function catalogueOf(
  entry: PackageUiEntry,
  locale: SupportedLocale,
): Promise<CatalogueTree | undefined> {
  const load = entry.locales[locale];

  if (load === undefined) {
    return undefined;
  }

  const module = await load();
  const catalogue = isRecord(module) ? module['default'] : undefined;

  // The build checked it: an object of strings, nested.
  return isRecord(catalogue) ? (catalogue as CatalogueTree) : undefined;
}

/**
 * Imports a package's entry, once per build.
 *
 * @param found - The package, at the build installed.
 * @returns What it adds.
 * @throws {Error} For a package that adds nothing to the interface, or a module that is not one.
 */
export async function loadPackageUi(found: LoadablePackage): Promise<PackageUiEntry> {
  const { ui } = found;

  if (ui === null) {
    throw new Error(
      translate(
        'packages.loader.idPackageAddsNothing',
        'The {{id}} package adds nothing to the interface',
        { id: found.id },
      ),
    );
  }

  const key = `${found.id}@${found.build}`;
  const cached = loaded.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const loading = (async (): Promise<PackageUiEntry> => {
    // What the interface lends first: the package's module reads it as it is evaluated.
    const { installPackageHost } = await import('@/packages/shared-modules');

    installPackageHost();

    if (ui.styles !== undefined) {
      placeStylesheet(found, ui.entry, ui.styles);
    }

    const module = await importModule(packageFileUrl(found, ui.entry, ui.entry));
    const entry = entryOf(found.id, module['default']);

    // Before anything of it is drawn, so its first strings are already in the reader's language.
    await addCatalogueSource(packageNamespace(found.id), async (locale) =>
      catalogueOf(entry, locale),
    );

    return entry;
  })();

  loaded.set(key, loading);
  // A failed import is tried again next time rather than remembered.
  loading.catch(() => {
    loaded.delete(key);
  });

  return loading;
}

/**
 * Loads one of a package's components.
 *
 * @param found - The package, at the release installed.
 * @param target - Which component.
 * @returns It; null when the package draws none by that name.
 * @throws {Error} When its entry or its chunk cannot be loaded, or the chunk holds no component.
 */
export async function loadPackageComponent(
  found: LoadablePackage,
  target: PackageComponentTarget,
): Promise<PackageComponent | null> {
  const entry = await loadPackageUi(found);
  let loader: ComponentLoader | undefined;

  switch (target.kind) {
    case 'page':
      loader = entry.page;
      break;
    case 'background':
      loader = entry.background;
      break;
    case 'card':
      loader = entry.cards[target.cardId];
      break;
    case 'entityView':
      loader = entry.entityViews[target.type];
      break;
  }

  if (loader === undefined) {
    return null;
  }

  const module = await loader();
  const component = isRecord(module) && 'default' in module ? module['default'] : module;

  if (!isComponent(component)) {
    throw new Error(
      translate(
        'packages.loader.idPackageSModule',
        "The {{id}} package's module for this is not a component",
        { id: found.id },
      ),
    );
  }

  return component;
}
