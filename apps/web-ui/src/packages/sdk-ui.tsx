/**
 * The interface's implementation of `@nebulahome/package-sdk/ui` (PACKAGES_DOCS.md 6): what a
 * package's page, cards and entity views reach through the SDK's hooks and links.
 *
 * A package's component is drawn inside {@link PackageScope}, which says whose it is; every hook
 * reads that first, so `usePackageRpc('clients')` calls the package drawn and no other, and
 * `useEntities()` lists its own entities. The data is the interface's: the same query cache the
 * pages read, the same live readings the socket delivers - a package's card changes when the
 * dashboard around it does, from one socket, with nothing of its own polling.
 *
 * {@link UI_HOST} is checked against the SDK's `UiHost`, so a hook the SDK declares and the
 * interface does not implement fails this build, not a package at run time.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';

import {
  resolveDisplayLocale,
  type EntityView as ApiEntityView,
  type IntegrationSetup,
  type JsonObject,
  type JsonValue,
} from '@nebulahome/contracts';
import type {
  EntityTypeDefinition,
  JsonValue as SdkJsonValue,
  SettingsDefinition,
} from '@nebulahome/package-sdk';
import type {
  CustomEntityState,
  EntitiesFilter,
  EntityView,
  Locale,
  Mutation,
  MutationOptions,
  PackageCall,
  PackageInfo,
  PackageLinkProps,
  PackageNavigate,
  PackageRoute,
  PackageSettings,
  PlatformLinkProps,
  PlatformNavigate,
  RpcOptions,
  RpcState,
  SendCommand,
  Theme,
  UiHost,
  Viewer,
} from '@nebulahome/package-sdk/ui';

import { useSession } from '@/auth/session-store';
import { commandEntity, fetchEntities, LIBRARY_QUERY_KEYS } from '@/library/api';
import { useLive, type LiveReading } from '@/live/live-store';
import { callPackage, configurePackage, fetchPackage, PACKAGE_QUERY_KEYS } from '@/packages/api';
import { packageAppPath, packagePathOf, platformPath } from '@/packages/package-paths';
import { usePreferences } from '@/settings/preferences';

/** Whose component is being drawn. */
export type PackageScopeValue = PackageInfo;

/** The package whose component is being drawn; null outside one. */
const PackageScopeContext = createContext<PackageScopeValue | null>(null);

/** The node inside the package's scope its portals go to; null before it is there. */
const PortalContext = createContext<HTMLElement | null>(null);

/**
 * Says whose component the children are, and where their portals go.
 *
 * @param props - The package, the portal node, and the component.
 * @param props.value - The package.
 * @param props.portal - A node inside the package's scope.
 * @param props.children - Its component.
 * @returns The providers.
 */
export function PackageScope(props: {
  readonly value: PackageScopeValue;
  readonly portal: HTMLElement | null;
  readonly children: ReactNode;
}) {
  return (
    <PackageScopeContext value={props.value}>
      <PortalContext value={props.portal}>{props.children}</PortalContext>
    </PackageScopeContext>
  );
}

/**
 * Calls one of a package's methods with what a package's component hands it: the SDK's JSON,
 * read-only, which the API sends as it is.
 *
 * @param packageId - The package.
 * @param method - The method.
 * @param input - What it is handed.
 * @param signal - Cancels the request.
 * @returns What it answered.
 */
async function call(
  packageId: string,
  method: string,
  input: SdkJsonValue,
  signal?: AbortSignal,
): Promise<JsonValue> {
  return callPackage(packageId, method, input as JsonValue, signal);
}

/**
 * The package whose component is being drawn.
 *
 * @returns It.
 * @throws {Error} Outside a package's component, where the hooks have nobody to speak for.
 */
function usePackage(): PackageInfo {
  const { t } = useTranslation();

  const scope = useContext(PackageScopeContext);

  if (scope === null) {
    throw new Error(
      t(
        'packages.sdkUi.packageHookWasCalled',
        'A package hook was called outside a package’s component',
      ),
    );
  }

  return scope;
}

/**
 * An entity as a package sees it, with the newest reading laid over what the API answered.
 *
 * @param entity - As the API answered.
 * @param reading - What the socket said since, if anything.
 * @returns The entity as it stands.
 */
function viewOf(entity: ApiEntityView, reading: LiveReading | undefined): EntityView {
  const lastChanged = reading?.changedAt ?? entity.lastChanged ?? entity.lastUpdated;
  const precision = entity.attributes['display_precision'];

  return {
    entityId: entity.entityId,
    domain: entity.domain as EntityView['domain'],
    name: entity.name,
    icon: entity.icon,
    deviceId: entity.deviceId,
    areaId: entity.areaKey,
    state: reading?.state ?? entity.state ?? {},
    attributes: reading?.attributes ?? entity.attributes,
    isAvailable: reading?.isAvailable ?? entity.isAvailable,
    lastChanged: lastChanged === null ? '' : new Date(lastChanged).toISOString(),
    unitOfMeasurement: entity.unitOfMeasurement,
    deviceClass: entity.deviceClass,
    displayPrecision: typeof precision === 'number' ? precision : null,
  };
}

/**
 * Every entity this person may read, live, with whose each is.
 *
 * @returns The entities, with the newest readings, and their owners.
 */
function useLiveEntities(): readonly { readonly view: EntityView; readonly source: string }[] {
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

  return (entities.data ?? []).map((entity) => ({
    view: viewOf(entity, readings[entity.entityId]),
    source: entity.source,
  }));
}

/**
 * One entity of the house, live.
 *
 * @param entityId - The entity.
 * @returns It, or undefined while it is not known.
 */
function useEntity(entityId: string): EntityView | undefined {
  return useLiveEntities().find((entity) => entity.view.entityId === entityId)?.view;
}

/**
 * Entities of the house, live: the drawn package's own unless the filter says otherwise.
 *
 * @param filter - Whose, of which domain, which ids.
 * @returns The entities.
 */
function useEntities(filter?: EntitiesFilter): readonly EntityView[] {
  const scope = usePackage();
  const owner = filter?.owner === undefined || filter.owner === 'self' ? scope.id : filter.owner;
  const ids = filter?.entityIds === undefined ? undefined : new Set(filter.entityIds);

  return useLiveEntities()
    .filter(
      (entity) =>
        (owner === 'any' || entity.source === owner) &&
        (filter?.domain === undefined || entity.view.domain === filter.domain) &&
        (ids === undefined || ids.has(entity.view.entityId)),
    )
    .map((entity) => entity.view);
}

/**
 * One of the drawn package's custom entities, live.
 *
 * @param type - Its entity type, for its values' types.
 * @param entityId - The entity.
 * @returns Its values, availability, and a way to send it its type's commands.
 */
function useCustomEntity<TType extends EntityTypeDefinition>(
  type: TType,
  entityId: string,
): CustomEntityState<TType> {
  const entity = useEntity(entityId);
  const values = entity?.state.custom?.values;

  /**
   * Sends one of the type's commands.
   *
   * @param command - The command's id.
   * @param args - Its arguments.
   * @returns Once the platform took it.
   */
  const send = useCallback(
    async (command: string, args: object): Promise<void> => {
      await commandEntity(entityId, 'custom', { command, args: args as JsonObject });
    },
    [entityId],
  );

  return {
    values: values as CustomEntityState<TType>['values'],
    isAvailable: entity?.isAvailable ?? false,
    lastChanged: entity === undefined || entity.lastChanged === '' ? null : entity.lastChanged,
    send: send,
  };
}

/**
 * Sends commands, as a control does.
 *
 * @returns The sender, which resolves once the command was accepted.
 */
function useCommand(): SendCommand {
  return useCallback(async (entityId, capability, command) => {
    await commandEntity(entityId, capability, command as JsonObject);
  }, []);
}

/**
 * Reads one of the drawn package's methods.
 *
 * @param method - The method.
 * @param input - What it is handed.
 * @param options - How often to ask again, and whether to ask at all.
 * @returns Its answer as it stands.
 */
function usePackageRpc<TData = SdkJsonValue>(
  method: string,
  input: SdkJsonValue = null,
  options?: RpcOptions,
): RpcState<TData> {
  const scope = usePackage();
  const query = useQuery({
    queryKey: PACKAGE_QUERY_KEYS.rpc(scope.id, method, input as JsonValue),
    enabled: options?.isEnabled ?? true,
    refetchInterval: options?.refetchIntervalMs ?? false,

    /**
     * Calls the method.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns What it answered, as the package's component expects it.
     */
    queryFn: async ({ signal }) => (await call(scope.id, method, input, signal)) as TData,
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
function usePackageCall(): PackageCall {
  const scope = usePackage();

  return useCallback(
    async <TData,>(method: string, input: SdkJsonValue = null): Promise<TData> =>
      (await call(scope.id, method, input)) as TData,
    [scope.id],
  );
}

/**
 * A method of the drawn package that changes something; once it is done, its reads are asked
 * again.
 *
 * @param method - The method.
 * @param options - Which reads it refreshes: every one of the package's when not said.
 * @returns The mutation.
 */
function usePackageMutation<TInput extends SdkJsonValue | undefined, TOutput = SdkJsonValue>(
  method: string,
  options?: MutationOptions,
): Mutation<TInput, TOutput> {
  const scope = usePackage();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    /**
     * Calls the method.
     *
     * @param input - What it is handed.
     * @returns What it answered.
     */
    mutationFn: async (input: TInput) => (await call(scope.id, method, input ?? null)) as TOutput,

    /** Asks the reads it changed again. */
    onSuccess: async () => {
      const methods = options?.invalidates;

      await (methods === undefined
        ? queryClient.invalidateQueries({ queryKey: PACKAGE_QUERY_KEYS.rpcOf(scope.id) })
        : Promise.all(
            methods.map(async (each) =>
              queryClient.invalidateQueries({
                queryKey: PACKAGE_QUERY_KEYS.rpcOf(scope.id, each),
              }),
            ),
          ));
    },
  });

  return {
    mutate: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
}

/**
 * The settings as a package's component reads them: every field's value, its default when none
 * was saved, and a secret as whether one is.
 *
 * @param config - What was saved, secrets masked.
 * @param setup - The settings' declaration.
 * @returns The values.
 */
export function visibleSettingsOf(config: JsonObject, setup: IntegrationSetup | null): JsonObject {
  const values: Record<string, JsonValue> = {};

  for (const field of [...(setup?.transport.fields ?? []), ...(setup?.options.fields ?? [])]) {
    const saved = config[field.key];

    if (field.type === 'secret') {
      values[field.key] = saved !== undefined && saved !== null && saved !== '';
    } else if (saved !== undefined) {
      values[field.key] = saved;
    } else if ('default' in field && field.default !== undefined) {
      values[field.key] = field.default;
    }
  }

  return values;
}

/**
 * The values a settings declaration gives before anything is read: each field's default, and a
 * secret as not saved.
 *
 * @param settings - The declaration, if the component passed it.
 * @returns The values.
 */
export function declaredSettingsOf(settings: SettingsDefinition | undefined): JsonObject {
  const values: Record<string, JsonValue> = {};

  for (const [key, declared] of Object.entries(settings?.fields ?? {})) {
    const field: Readonly<Record<string, unknown>> = declared;

    if (field['kind'] === 'secret') {
      values[key] = false;
    } else if (field['default'] !== undefined) {
      values[key] = field['default'] as JsonValue;
    }
  }

  return values;
}

/**
 * The drawn package's settings, to show and - for whoever may configure it - to change.
 *
 * @param settings - Their declaration, for their defaults while what was saved is read.
 * @returns Their values, a way to save some, and whether the viewer may.
 */
function usePackageSettings<TSettings extends SettingsDefinition | undefined = undefined>(
  settings?: TSettings,
): PackageSettings<TSettings> {
  const scope = usePackage();
  const queryClient = useQueryClient();
  const canEdit = useSession((state) => state.can('package:configure'));
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
  const save = useMutation({
    /**
     * Saves some of the settings; the API keeps the others.
     *
     * @param patch - What changes.
     * @returns The package, as it now is.
     */
    mutationFn: async (patch: JsonObject) => configurePackage(scope.id, { transportConfig: patch }),

    /** Reads the package again, with what was saved. */
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: PACKAGE_QUERY_KEYS.all });
    },
  });
  const values =
    detail.data === undefined
      ? declaredSettingsOf(settings)
      : visibleSettingsOf(detail.data.config, detail.data.setup);

  return {
    values: values as PackageSettings<TSettings>['values'],
    isLoading: detail.isPending,

    /**
     * Saves some of the settings.
     *
     * @param patch - What changes.
     */
    update: async (patch) => {
      await save.mutateAsync(patch as JsonObject);
    },
    isUpdating: save.isPending,
    canEdit,
    error: save.error,
  };
}

/**
 * Who is looking.
 *
 * @returns The viewer, and what they may do.
 */
function useViewer(): Viewer {
  const user = useSession((state) => state.user);
  const can = useSession((state) => state.can);

  return {
    userId: user?.id ?? '',
    username: user?.username ?? '',
    role: user?.role ?? '',

    /**
     * Says whether the viewer holds a permission.
     *
     * @param permission - Its name.
     * @returns True when they do.
     */
    can: (permission) => can(permission),
  };
}

/**
 * The viewer's language and time zone.
 *
 * The language is the one the interface speaks to them - their own choice, else the house's -
 * so what a package formats agrees with the words around it.
 *
 * @returns Them; the browser's time zone where the profile says nothing.
 */
function useLocale(): Locale {
  const user = useSession((state) => state.user);
  const browser = Intl.DateTimeFormat().resolvedOptions();

  return {
    locale: resolveDisplayLocale(user?.locale, user?.houseLocale),
    timeZone:
      user?.timezone === undefined || user.timezone === '' ? browser.timeZone : user.timezone,
  };
}

/** The query of the system's dark scheme. */
const DARK_SCHEME = '(prefers-color-scheme: dark)';

/**
 * Follows the system's scheme.
 *
 * @param onChange - Called when it changes.
 * @returns What stops following it.
 */
function subscribeScheme(onChange: () => void): () => void {
  const query = globalThis.matchMedia(DARK_SCHEME);

  query.addEventListener('change', onChange);

  return () => {
    query.removeEventListener('change', onChange);
  };
}

/**
 * Whether the system draws dark.
 *
 * @returns True when it does.
 */
function isSystemDark(): boolean {
  return globalThis.matchMedia(DARK_SCHEME).matches;
}

/**
 * The theme the interface draws in: the viewer's choice, or the system's.
 *
 * @returns Light or dark.
 */
function useTheme(): Theme {
  const choice = usePreferences((state) => state.theme);
  const isDark = useSyncExternalStore(subscribeScheme, isSystemDark, () => false);

  return { scheme: choice === 'system' ? (isDark ? 'dark' : 'light') : choice };
}

/**
 * The node inside the drawn package's scope, for its portals.
 *
 * @returns It, or null before it is there.
 */
function usePortalContainer(): HTMLElement | null {
  return useContext(PortalContext);
}

/**
 * Where the drawn package's page is.
 *
 * @returns Its path, segments and query; the root outside its page.
 */
function usePackageRoute(): PackageRoute {
  const scope = usePackage();
  const location = useLocation();
  const path = packagePathOf(scope.id, location.pathname);

  return {
    path,
    segments: path.split('/').filter((segment) => segment !== ''),
    query: new URLSearchParams(location.search),
  };
}

/**
 * Goes to a path of the drawn package's page.
 *
 * @returns What goes there.
 */
function usePackageNavigate(): PackageNavigate {
  const scope = usePackage();
  const navigate = useNavigate();

  return useCallback(
    (to, options) => {
      void navigate(packageAppPath(scope.id, to), { replace: options?.replace ?? false });
    },
    [navigate, scope.id],
  );
}

/**
 * Goes to a place of the platform.
 *
 * @returns What goes there.
 */
function usePlatformNavigate(): PlatformNavigate {
  const navigate = useNavigate();

  return useCallback(
    (target) => {
      void navigate(platformPath(target));
    },
    [navigate],
  );
}

/**
 * A link to a path of the drawn package's page.
 *
 * @param props - Where it goes, and an anchor's attributes.
 * @returns The link.
 */
function PackageLink(props: PackageLinkProps) {
  const { to, replace, children, ...rest } = props;
  const scope = usePackage();

  return (
    <Link {...rest} to={packageAppPath(scope.id, to)} replace={replace ?? false}>
      {children}
    </Link>
  );
}

/**
 * A link to a place of the platform.
 *
 * @param props - Where it goes, and an anchor's attributes.
 * @returns The link.
 */
function PlatformLink(props: PlatformLinkProps) {
  const { to, children, ...rest } = props;

  return (
    <Link {...rest} to={platformPath(to)}>
      {children}
    </Link>
  );
}

/** The interface's `@nebulahome/package-sdk/ui`, as a package's build reads it. */
export const UI_HOST = {
  usePackage,
  useEntity,
  useEntities,
  useCustomEntity,
  useCommand,
  usePackageRpc,
  usePackageCall,
  usePackageMutation,
  usePackageSettings,
  useViewer,
  useLocale,
  useTheme,
  usePortalContainer,
  usePackageRoute,
  usePackageNavigate,
  usePlatformNavigate,
  PackageLink,
  PlatformLink,
} satisfies UiHost;
