/**
 * `@nebulahome/package-sdk/ui`: what a package's page, cards and entity views are written with
 * (PACKAGES_DOCS.md 6).
 *
 * Every hook and link here forwards to the interface's own implementation, which it lends the
 * package at run time ({@link UiHost}): the package draws with the interface's React, its data
 * and its session. What a package bundles of this module is these forwarders.
 */
import { createElement, type ReactElement } from 'react';

import type { EntityTypeDefinition } from '../definitions/entity-type.js';
import type { SettingsDefinition } from '../definitions/settings.js';
import type { EntityId } from '../entities.js';
import { hostMember, lentMember, UI_MODULE } from '../host.js';
import type { JsonValue } from '../json.js';

import { ENGLISH } from './english.js';
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
  Translation,
  UiHost,
  Viewer,
} from './types.js';

export type {
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
  PlatformTarget,
  PluralEnglish,
  RpcOptions,
  RpcState,
  SendCommand,
  SettingsPatch,
  Theme,
  Translate,
  Translation,
  TranslationValues,
  UiHost,
  Viewer,
  VisibleSettings,
} from './types.js';
export type { CardProps, EntityViewProps, PageProps } from '../props.js';

/**
 * The interface's implementation of one member of `/ui`.
 *
 * @param name - The member.
 * @param since - The SDK version that added it.
 * @returns The implementation.
 */
function ui<TName extends keyof UiHost>(name: TName, since: string): UiHost[TName] {
  return hostMember(UI_MODULE, name, since);
}

/**
 * The package drawn.
 *
 * @returns Its id, release and name.
 */
export function usePackage(): PackageInfo {
  return ui('usePackage', '1.0')();
}

/**
 * One entity of the house, live.
 *
 * @param entityId - The entity.
 * @returns It, or undefined while it is not known.
 */
export function useEntity(entityId: EntityId): EntityView | undefined {
  return ui('useEntity', '1.0')(entityId);
}

/**
 * Entities of the house, live: the package's own unless the filter says otherwise.
 *
 * @param filter - Whose, of which domain, which ids.
 * @returns Them.
 */
export function useEntities(filter?: EntitiesFilter): readonly EntityView[] {
  return ui('useEntities', '1.0')(filter);
}

/**
 * One of the package's custom entities, live and typed by its entity type.
 *
 * @param type - The entity type.
 * @param entityId - The entity.
 * @returns Its values, its availability, and a way to send it commands.
 */
export function useCustomEntity<TType extends EntityTypeDefinition>(
  type: TType,
  entityId: EntityId,
): CustomEntityState<TType> {
  return ui('useCustomEntity', '1.0')(type, entityId);
}

/**
 * Sends commands, as a control does, with the viewer's permissions.
 *
 * @returns What sends one.
 */
export function useCommand(): SendCommand {
  return ui('useCommand', '1.0')();
}

/**
 * Reads one of the package's methods, again when the input changes.
 *
 * @param method - The method.
 * @param input - What it is handed.
 * @param options - How often, and whether at all.
 * @returns The data, the error, whether it loads, and a way to read it again.
 */
export function usePackageRpc<TData = JsonValue>(
  method: string,
  input?: JsonValue,
  options?: RpcOptions,
): RpcState<TData> {
  return ui('usePackageRpc', '1.0')<TData>(method, input, options);
}

/**
 * Calls the package's methods on demand.
 *
 * @returns What calls one.
 */
export function usePackageCall(): PackageCall {
  return ui('usePackageCall', '1.0')();
}

/**
 * A method that changes something: its call, whether it runs, its error. Once done, the
 * package's reads are refreshed.
 *
 * @param method - The method.
 * @param options - Which reads it refreshes.
 * @returns The mutation.
 */
export function usePackageMutation<TInput extends JsonValue | undefined, TOutput = JsonValue>(
  method: string,
  options?: MutationOptions,
): Mutation<TInput, TOutput> {
  return ui('usePackageMutation', '1.0')<TInput, TOutput>(method, options);
}

/**
 * The package's settings, to show and - for whoever may configure it - to change.
 *
 * @param settings - Their declaration, for their types; plain JSON without it.
 * @returns Their values, a way to save some, and whether the viewer may.
 */
export function usePackageSettings<TSettings extends SettingsDefinition | undefined = undefined>(
  settings?: TSettings,
): PackageSettings<TSettings> {
  return ui('usePackageSettings', '1.0')<TSettings>(settings);
}

/**
 * Who is looking.
 *
 * @returns The viewer, and what they may do.
 */
export function useViewer(): Viewer {
  return ui('useViewer', '1.0')();
}

/**
 * The viewer's language and time zone.
 *
 * @returns Them, for `Intl`.
 */
export function useLocale(): Locale {
  return ui('useLocale', '1.0')();
}

/**
 * The package's strings in the viewer's language, from the catalogues in its `locales` folder
 * (PACKAGES_DOCS.md 6.5).
 *
 * `t('clients.title', 'Clients')` says the key from the viewer's catalogue, and its English when
 * the catalogue lacks it; outside an interface that lends this - a component's unit test - every
 * string is its English.
 *
 * @returns `t`, and the language it speaks.
 */
export function useTranslation(): Translation {
  const lent = lentMember(UI_MODULE, 'useTranslation');

  return lent === undefined ? ENGLISH : lent();
}

/**
 * The theme the interface draws in, for what draws its own colours: a canvas, a chart.
 *
 * @returns Light or dark.
 */
export function useTheme(): Theme {
  return ui('useTheme', '1.0')();
}

/**
 * A node inside the package's scope, for portals: what is drawn outside it is unstyled.
 *
 * @returns The node, or null before it is there.
 */
export function usePortalContainer(): HTMLElement | null {
  return ui('usePortalContainer', '1.0')();
}

/**
 * Where the package's page is.
 *
 * @returns Its path, segments and query.
 */
export function usePackageRoute(): PackageRoute {
  return ui('usePackageRoute', '1.0')();
}

/**
 * Goes to a path of the package's page.
 *
 * @returns What goes there.
 */
export function usePackageNavigate(): PackageNavigate {
  return ui('usePackageNavigate', '1.0')();
}

/**
 * Goes to a place of the platform.
 *
 * @returns What goes there.
 */
export function usePlatformNavigate(): PlatformNavigate {
  return ui('usePlatformNavigate', '1.0')();
}

/**
 * A link to a path of the package's page, from its page, a card or a view.
 *
 * @param props - Where it goes, and an anchor's attributes.
 * @returns The link.
 */
export function PackageLink(props: PackageLinkProps): ReactElement {
  return createElement(ui('PackageLink', '1.0'), props);
}

/**
 * A link to a place of the platform.
 *
 * @param props - Where it goes, and an anchor's attributes.
 * @returns The link.
 */
export function PlatformLink(props: PlatformLinkProps): ReactElement {
  return createElement(ui('PlatformLink', '1.0'), props);
}
