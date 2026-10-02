/**
 * The package UI SDK: how a package's page, dashboard cards and entity views are written
 * (PACKAGES.md 5).
 *
 * A package's `ui/index.js` default-exports {@link definePackageUi}. The interface imports it when
 * something of the package is first drawn, and draws its components inside its own tree: the same
 * React, the same design system (`@nebulahome/ui`), the same live data. That is what the hooks
 * here reach - the host's implementation of them, which the interface installs as
 * `globalThis.__nebula.modules['@nebulahome/package-ui']`, so a package built with the Vite preset
 * (`@nebulahome/package-ui/vite`) never bundles React or this module: it uses the interface's.
 */
import type { ComponentType } from 'react';

import type {
  CapabilityName,
  EntityId,
  EntityView,
  JsonObject,
  JsonValue,
  PackageCardSize,
} from '@nebulahome/contracts';

export { SHARED_MODULES, type SharedModule } from './shared.js';

/** What a package's page is drawn with. */
export type PackagePageProps = {
  readonly packageId: string;
};

/** What a package's dashboard card is drawn with. */
export type PackageCardProps = {
  readonly packageId: string;

  /** Which of the package's cards: its id in the manifest. */
  readonly cardId: string;

  /** What the card's inspector asked, in the card's own grammar. */
  readonly options: JsonObject;

  /** The size it is drawn at. */
  readonly size: PackageCardSize;

  /** The owner's title for it, or null for the card's own. */
  readonly title: string | null;
};

/** What one of the package's entity views is drawn with. */
export type PackageEntityViewProps = {
  readonly entityId: EntityId;
};

/** What a package adds to the interface. */
export type PackageUiDefinition = {
  /** Its page, when its manifest says it has one. */
  readonly page?: ComponentType<PackagePageProps>;

  /** Its dashboard cards, by the ids its manifest declares. */
  readonly cards?: Readonly<Record<string, ComponentType<PackageCardProps>>>;

  /** Its entity views, by the entity types its manifest lists. */
  readonly entityViews?: Readonly<Record<string, ComponentType<PackageEntityViewProps>>>;
};

/**
 * Declares what a package adds to the interface. The identity function: what it adds is the type.
 *
 * @param definition - The page, the cards, the entity views.
 * @returns The same.
 */
export function definePackageUi(definition: PackageUiDefinition): PackageUiDefinition {
  return definition;
}

/** A call to one of the package's methods, as a hook holds it. */
export type RpcState<T> = {
  readonly data: T | undefined;
  readonly error: Error | null;
  readonly isLoading: boolean;

  /** Asks again. */
  readonly refetch: () => void;
};

/** What the interface implements for the hooks. */
export type PackageUiHost = {
  readonly usePackage: () => {
    readonly id: string;
    readonly version: string;
    readonly name: string;
  };
  readonly useEntity: (entityId: EntityId) => EntityView | undefined;
  readonly useEntities: (filter?: {
    readonly packageId?: string;
    readonly domain?: string;
  }) => readonly EntityView[];
  readonly useCommand: () => (
    entityId: EntityId,
    capability: CapabilityName,
    command: JsonObject,
  ) => Promise<void>;
  readonly usePackageRpc: <T = JsonValue>(
    method: string,
    input?: JsonValue,
    options?: { readonly refetchIntervalMs?: number; readonly isEnabled?: boolean },
  ) => RpcState<T>;
  readonly usePackageCall: () => <T = JsonValue>(method: string, input?: JsonValue) => Promise<T>;
  readonly usePackageSettings: () => JsonObject;
};

/** Where the interface puts what it shares with the packages. */
type NebulaGlobal = { readonly modules?: Readonly<Record<string, unknown>> };

/**
 * The interface's implementation of the hooks.
 *
 * @returns It.
 * @throws {Error} Outside the interface: the hooks have nothing to reach there.
 */
function host(): PackageUiHost {
  const nebula = (globalThis as { __nebula?: NebulaGlobal }).__nebula;
  const found = nebula?.modules?.['@nebulahome/package-ui'] as Partial<PackageUiHost> | undefined;

  if (found?.usePackage === undefined) {
    throw new Error('A package’s interface is drawn by the NebulaHome interface, and only there');
  }

  return found as PackageUiHost;
}

/**
 * The package whose component is being drawn.
 *
 * @returns Its id, release and name.
 */
export function usePackage(): ReturnType<PackageUiHost['usePackage']> {
  return host().usePackage();
}

/**
 * One entity, live.
 *
 * @param entityId - The entity.
 * @returns It, or undefined while it is not known.
 */
export function useEntity(entityId: EntityId): EntityView | undefined {
  return host().useEntity(entityId);
}

/**
 * Entities, live: the package's own by default.
 *
 * @param filter - Whose, and which domain.
 * @param filter.packageId - The package whose entities; the one drawn when not said.
 * @param filter.domain - Only this domain.
 * @returns The entities.
 */
export function useEntities(filter?: {
  readonly packageId?: string;
  readonly domain?: string;
}): readonly EntityView[] {
  return host().useEntities(filter);
}

/**
 * Sends commands, as a control does.
 *
 * @returns The sender.
 */
export function useCommand(): ReturnType<PackageUiHost['useCommand']> {
  return host().useCommand();
}

/**
 * Reads one of the package's methods, asked again when its input changes.
 *
 * @param method - The method.
 * @param input - What it is handed.
 * @param options - How often to ask again, and whether to ask at all.
 * @param options.refetchIntervalMs - Asked again this often.
 * @param options.isEnabled - Asked only while true.
 * @returns Its answer as it stands.
 */
export function usePackageRpc<T = JsonValue>(
  method: string,
  input?: JsonValue,
  options?: { readonly refetchIntervalMs?: number; readonly isEnabled?: boolean },
): RpcState<T> {
  return host().usePackageRpc<T>(method, input, options);
}

/**
 * Calls the package's methods on demand: a button's.
 *
 * @returns The caller.
 */
export function usePackageCall(): ReturnType<PackageUiHost['usePackageCall']> {
  return host().usePackageCall();
}

/**
 * What the owner saved on the package's Configure, secrets masked.
 *
 * @returns The settings.
 */
export function usePackageSettings(): JsonObject {
  return host().usePackageSettings();
}
