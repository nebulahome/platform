/**
 * What a package's components reach through `@nebulahome/package-ui`: the interface's own
 * implementation of the hooks (PACKAGES.md 5).
 *
 * A package's component is drawn inside {@link PackageScope}, which says whose it is; every hook
 * reads that first, so `usePackageRpc('clients')` calls the package drawn and no other, and
 * `useEntities()` lists its own entities. The data is the interface's: the same query cache the
 * pages read, the same live readings the socket delivers - a package's card changes when the
 * dashboard around it does, from one socket, with nothing of its own polling.
 */
import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, type ReactNode } from 'react';

import type {
  CapabilityName,
  EntityId,
  EntityView,
  JsonObject,
  JsonValue,
} from '@nebulahome/contracts';
import type { PackageUiDefinition, PackageUiHost, RpcState } from '@nebulahome/package-ui';

import { commandEntity, fetchEntities, LIBRARY_QUERY_KEYS } from '@/library/api';
import { useLive, type LiveReading } from '@/live/live-store';
import { callPackage, fetchPackage, PACKAGE_QUERY_KEYS } from '@/packages/api';

/** Whose component is being drawn. */
export type PackageScopeValue = {
  readonly id: string;
  readonly version: string;
  readonly name: string;
};

/** The package whose component is being drawn; null outside one. */
const PackageScopeContext = createContext<PackageScopeValue | null>(null);

/**
 * Says whose component the children are.
 *
 * @param props - The package, and the component.
 * @param props.value - The package.
 * @param props.children - Its component.
 * @returns The provider.
 */
export function PackageScope(props: {
  readonly value: PackageScopeValue;
  readonly children: ReactNode;
}) {
  return <PackageScopeContext value={props.value}>{props.children}</PackageScopeContext>;
}

/**
 * The package whose component is being drawn.
 *
 * @returns It.
 * @throws {Error} Outside a package's component, where the hooks have nobody to speak for.
 */
function usePackage(): PackageScopeValue {
  const scope = useContext(PackageScopeContext);

  if (scope === null) {
    throw new Error('A package hook was called outside a package’s component');
  }

  return scope;
}

/**
 * An entity with the newest reading laid over what the API answered, as every page shows it.
 *
 * @param entity - As the API answered.
 * @param reading - What the socket said since, if anything.
 * @returns The entity as it stands.
 */
function withReading(entity: EntityView, reading: LiveReading | undefined): EntityView {
  return reading === undefined
    ? entity
    : {
        ...entity,
        state: reading.state,
        attributes: reading.attributes,
        isAvailable: reading.isAvailable,
        lastChanged: reading.changedAt,
      };
}

/**
 * Every entity this person may read, live.
 *
 * @returns The entities, with the newest readings.
 */
function useLiveEntities(): readonly EntityView[] {
  const readings = useLive((state) => state.readings);
  const entities = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.entities,

    /**
     * Reads the entities.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns The entities.
     */
    queryFn: async ({ signal }) => fetchEntities(signal),
  });

  return (entities.data ?? []).map((entity) => withReading(entity, readings[entity.entityId]));
}

/**
 * One entity, live.
 *
 * @param entityId - The entity.
 * @returns It, or undefined while it is not known.
 */
function useEntity(entityId: EntityId): EntityView | undefined {
  return useLiveEntities().find((entity) => entity.entityId === entityId);
}

/**
 * Entities, live: the drawn package's own unless another is named.
 *
 * @param filter - Whose, and which domain.
 * @param filter.packageId - The package whose entities.
 * @param filter.domain - Only this domain.
 * @returns The entities.
 */
function useEntities(filter?: {
  readonly packageId?: string;
  readonly domain?: string;
}): readonly EntityView[] {
  const scope = usePackage();
  const owner = filter?.packageId ?? scope.id;

  return useLiveEntities().filter(
    (entity) =>
      entity.source === owner && (filter?.domain === undefined || entity.domain === filter.domain),
  );
}

/**
 * Sends commands, as a control does.
 *
 * @returns The sender, which resolves once the command was accepted.
 */
function useCommand(): (
  entityId: EntityId,
  capability: CapabilityName,
  command: JsonObject,
) => Promise<void> {
  return useCallback(async (entityId, capability, command) => {
    await commandEntity(entityId, capability, command);
  }, []);
}

/**
 * Reads one of the drawn package's methods.
 *
 * @param method - The method.
 * @param input - What it is handed.
 * @param options - How often to ask again, and whether to ask at all.
 * @param options.refetchIntervalMs - Asked again this often.
 * @param options.isEnabled - Asked only while true.
 * @returns Its answer as it stands.
 */
function usePackageRpc<T = JsonValue>(
  method: string,
  input: JsonValue = null,
  options?: { readonly refetchIntervalMs?: number; readonly isEnabled?: boolean },
): RpcState<T> {
  const scope = usePackage();
  const query = useQuery({
    queryKey: PACKAGE_QUERY_KEYS.rpc(scope.id, method, input),
    enabled: options?.isEnabled ?? true,
    refetchInterval: options?.refetchIntervalMs ?? false,

    /**
     * Calls the method.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns What it answered, as the package's component expects it.
     */
    queryFn: async ({ signal }) => (await callPackage(scope.id, method, input, signal)) as T,
  });

  return {
    data: query.data,
    error: query.error,
    isLoading: query.isPending && query.fetchStatus !== 'idle',

    /** Asks again. */
    refetch: (): void => {
      void query.refetch();
    },
  };
}

/**
 * Calls the drawn package's methods on demand.
 *
 * @returns The caller.
 */
function usePackageCall(): <T = JsonValue>(method: string, input?: JsonValue) => Promise<T> {
  const scope = usePackage();

  return useCallback(
    async <T,>(method: string, input: JsonValue = null): Promise<T> =>
      (await callPackage(scope.id, method, input)) as T,
    [scope.id],
  );
}

/**
 * What the owner saved for the drawn package, secrets masked.
 *
 * @returns The settings; none while they are being read.
 */
function usePackageSettings(): JsonObject {
  const scope = usePackage();
  const detail = useQuery({
    queryKey: PACKAGE_QUERY_KEYS.one(scope.id),

    /**
     * Reads the package.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns The package.
     */
    queryFn: async ({ signal }) => fetchPackage(scope.id, signal),
  });

  return detail.data?.config ?? {};
}

/**
 * Declares what a package adds to the interface: the same identity the SDK's is.
 *
 * @param definition - The page, the cards, the entity views.
 * @returns The same.
 */
function definePackageUi(definition: PackageUiDefinition): PackageUiDefinition {
  return definition;
}

/** The interface's `@nebulahome/package-ui`, as a package's build reads it. */
export const PACKAGE_UI_RUNTIME: PackageUiHost & {
  readonly definePackageUi: typeof definePackageUi;
} = {
  definePackageUi,
  usePackage,
  useEntity,
  useEntities,
  useCommand,
  usePackageRpc,
  usePackageCall,
  usePackageSettings,
};
