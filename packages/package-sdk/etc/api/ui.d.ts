import { d as EntityTypeDefinition, ht as EntityId, i as SettingsDefinition, r as JsonValue } from "./chunks/json.js";
import { a as TelemetryResolution, i as TelemetryPoint, n as HistorySeries, r as StateHistoryPoint, t as ChangeCause } from "./chunks/history.js";
import { A as PlatformLinkProps, B as Theme, C as PackageLinkProps, D as PackageSettings, E as PackageSend, F as RpcState, G as TranslationValues, H as Toasts, I as SendCommand, J as VisibleSettings, K as UiHost, L as SettingsPatch, M as PlatformTarget, N as PluralEnglish, O as PageActionsProps, P as RpcOptions, R as Telemetry, S as PackageInfo, T as PackageRoute, U as Translate, V as ToastMessage, W as Translation, _ as Mutation, a as CustomEntityState, b as OutsideTarget, c as EntityPicture, d as History, f as HistoryQuery, g as Locale, h as LiveState, i as AreaView, j as PlatformNavigate, k as PictureOptions, l as EntityView, m as LiveOptions, n as AreaDraft, o as EntitiesFilter, p as HistoryWindow, q as Viewer, r as AreaKind, s as EntityCardView, t as AreaActions, u as FloatingProps, v as MutationOptions, w as PackageNavigate, x as PackageCall, y as OpenEntityCard, z as TelemetryQuery } from "./chunks/types.js";
import { n as CardProps, o as PageProps, r as EntityViewProps, t as BackgroundProps } from "./chunks/props.js";
import { ReactElement } from "react";
//#region src/ui/index.d.ts
/**
 * The package drawn.
 *
 * @returns Its id, release and name.
 */
export declare function usePackage(): PackageInfo;
/**
 * One entity of the house, live.
 *
 * @param entityId - The entity.
 * @returns It, or undefined while it is not known.
 */
export declare function useEntity(entityId: EntityId): EntityView | undefined;
/**
 * Entities of the house, live: the package's own unless the filter says otherwise.
 *
 * @param filter - Whose, of which domain, which ids.
 * @returns Them.
 */
export declare function useEntities(filter?: EntitiesFilter): readonly EntityView[];
/**
 * One of the package's custom entities, live and typed by its entity type.
 *
 * @param type - The entity type.
 * @param entityId - The entity.
 * @returns Its values, its availability, and a way to send it commands.
 */
export declare function useCustomEntity<TType extends EntityTypeDefinition>(type: TType, entityId: EntityId): CustomEntityState<TType>;
/**
 * Sends commands, as a control does, with the viewer's permissions.
 *
 * @returns What sends one.
 */
export declare function useCommand(): SendCommand;
/**
 * Reads one of the package's methods, again when the input changes.
 *
 * @param method - The method.
 * @param input - What it is handed.
 * @param options - How often, and whether at all.
 * @returns The data, the error, whether it loads, and a way to read it again.
 */
export declare function usePackageRpc<TData = JsonValue>(method: string, input?: JsonValue, options?: RpcOptions): RpcState<TData>;
/**
 * Calls the package's methods on demand.
 *
 * @returns What calls one.
 */
export declare function usePackageCall(): PackageCall;
/**
 * A method that changes something: its call, whether it runs, its error. Once done, the
 * package's reads are refreshed.
 *
 * @param method - The method.
 * @param options - Which reads it refreshes.
 * @returns The mutation.
 */
export declare function usePackageMutation<TInput extends JsonValue | undefined, TOutput = JsonValue>(method: string, options?: MutationOptions): Mutation<TInput, TOutput>;
/**
 * The package's settings, to show and - for whoever may configure it - to change.
 *
 * @param settings - Their declaration, for their types; plain JSON without it.
 * @returns Their values, a way to save some, and whether the viewer may.
 */
export declare function usePackageSettings<TSettings extends SettingsDefinition | undefined = undefined>(settings?: TSettings): PackageSettings<TSettings>;
/**
 * Who is looking.
 *
 * @returns The viewer, and what they may do.
 */
export declare function useViewer(): Viewer;
/**
 * The viewer's language and time zone.
 *
 * @returns Them, for `Intl`.
 */
export declare function useLocale(): Locale;
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
export declare function useTranslation(): Translation;
/**
 * The recorded changes of some entities over a window, live as the window moves: what a chart of
 * an on/off thing, an activity list or a replay of a day is drawn from. Read with the viewer's
 * permissions: an entity they may not read has no points.
 *
 * @param query - Which entities (at most 64), which window, how often to read it again.
 * @returns Each entity's changes, oldest first, and whether the read is still on its way.
 */
export declare function useStateHistory(query: HistoryQuery): History<StateHistoryPoint>;
/**
 * The numeric readings of some entities over a window: what a sensor's chart is drawn from. A
 * long window is read in buckets of a minute, an hour or a day, each with its lowest and highest.
 *
 * @param query - Which entities (at most 64), which window, which resolution (`auto` by default).
 * @returns Each entity's readings, oldest first, and the resolution they were read at.
 */
export declare function useTelemetry(query: TelemetryQuery): Telemetry;
/**
 * The areas of the house: the house itself (with its position, when set), its floors and its
 * rooms, as the owner arranged them.
 *
 * @returns Them, in the owner's order.
 */
export declare function useAreas(): readonly AreaView[];
/**
 * Adds, renames and removes the house's floors and rooms, as the platform's areas page does, with
 * the viewer's permissions: `canEdit` says whether they hold them. Since 1.3.
 *
 * @returns What changes the areas.
 */
export declare function useAreaActions(): AreaActions;
/**
 * Shows the interface's toasts: the outcome of something the viewer just did - "Saved", "Couldn't
 * reach the printer" - from a handler, a mutation's `onError`, wherever. Since 1.4.
 *
 * @returns One function per kind: `success`, `warning`, `error`, `info`.
 */
export declare function useToast(): Toasts;
/**
 * Follows a live topic of the package's server (`ctx.live.publish`), over the interface's own
 * socket: the retained message at once, then every message as it is sent, with no polling and
 * no HTTP rate limit. Every component following one topic shares one subscription. Since 1.5.
 *
 * @param topic - The topic.
 * @param options - Whether to follow it.
 * @returns The last message, and whether the socket is open.
 */
export declare function usePackageLive<TData = JsonValue>(topic: string, options?: LiveOptions): LiveState<TData>;
/**
 * Sends the package's server messages over the interface's socket (`ctx.live.onMessage`): for
 * what goes often and wants no answer. A call that wants one stays `usePackageCall`. Since 1.5.
 *
 * @returns What sends one.
 */
export declare function usePackageSend(): PackageSend;
/**
 * A camera's latest still, fetched again every so often, or an image entity's picture, fetched
 * again when it changes: an address an `<img>` shows, let go of when a newer one replaces it.
 *
 * @param entityId - A `camera.*` or an `image.*` entity.
 * @param options - How often a still is fetched again, and whether at all.
 * @returns The address, or null before there is one.
 */
export declare function useEntityPicture(entityId: EntityId, options?: PictureOptions): EntityPicture;
/**
 * The theme the interface draws in, for what draws its own colours: a canvas, a chart.
 *
 * @returns Light or dark.
 */
export declare function useTheme(): Theme;
/**
 * A node inside the package's scope, for portals: what is drawn outside it is unstyled.
 *
 * @returns The node, or null before it is there.
 */
export declare function usePortalContainer(): HTMLElement | null;
/**
 * Where the package's page is.
 *
 * @returns Its path, segments and query.
 */
export declare function usePackageRoute(): PackageRoute;
/**
 * Goes to a path of the package's page.
 *
 * @returns What goes there.
 */
export declare function usePackageNavigate(): PackageNavigate;
/**
 * Goes to a place of the platform.
 *
 * @returns What goes there.
 */
export declare function usePlatformNavigate(): PlatformNavigate;
/**
 * A link to a path of the package's page, from its page, a card or a view.
 *
 * @param props - Where it goes, and an anchor's attributes.
 * @returns The link.
 */
export declare function PackageLink(props: PackageLinkProps): ReactElement;
/**
 * A link to a place of the platform.
 *
 * @param props - Where it goes, and an anchor's attributes.
 * @returns The link.
 */
export declare function PlatformLink(props: PlatformLinkProps): ReactElement;
/**
 * Buttons and links drawn in the header of the package's page, in place of the platform's own:
 * the page's actions, beside its title. On a card or a view it draws nothing. Since 1.3.
 *
 * @param props - What the header shows.
 * @returns The actions.
 */
export declare function PageActions(props: PageActionsProps): ReactElement;
/**
 * A window floating over the interface's pages, from the package's background, page or card -
 * drawn while the component that draws it is, so a background's outlives every page. The
 * interface gives the frame, the throwing from corner to corner and the close button; what is
 * inside is the package's own. Since 1.6.
 *
 * @param props - Whether it is shown, what it is called, what closing it does, and what it holds.
 * @returns The window.
 */
export declare function Floating(props: FloatingProps): ReactElement;
/**
 * Opens entities' cards: the dialog the platform draws for every entity - its controls, its
 * history, its settings - over the page that is open, as a tap on an entity anywhere in the
 * interface does. Since 1.9.
 *
 * @returns What opens one, by the entity's id, optionally on its settings or its history.
 */
export declare function useEntityCard(): OpenEntityCard;
/**
 * Calls back on a press that lands outside an element - or outside every one of several, a panel
 * and the button that opens it: what closes a menu or a popover of the package's own. Since 1.10.
 *
 * @param target - The element's ref, or a list of refs.
 * @param onOutside - Called on a press outside.
 * @param isEnabled - Whether it listens; pass whether what it closes is open. True when not said.
 */
export declare function useClickOutside(target: OutsideTarget, onOutside: () => void, isEnabled?: boolean): void;
/**
 * Calls back when Escape is pressed anywhere in the page. Since 1.10.
 *
 * @param onEscape - Called on Escape.
 * @param isEnabled - Whether it listens; pass whether what it closes is open. True when not said.
 */
export declare function useEscape(onEscape: () => void, isEnabled?: boolean): void;
/**
 * The time, read again at an interval: for "3 min ago" and clocks, which nothing else redraws.
 * Since 1.10.
 *
 * @param everyMs - How often it is read again, in milliseconds; every second when not said.
 * @returns The time of the last reading, in milliseconds since the epoch.
 */
export declare function useNow(everyMs?: number): number;
//#endregion
export type { AreaActions, AreaDraft, AreaKind, AreaView, BackgroundProps, CardProps, ChangeCause, CustomEntityState, EntitiesFilter, EntityCardView, EntityPicture, EntityView, EntityViewProps, FloatingProps, History, HistoryQuery, HistorySeries, HistoryWindow, LiveOptions, LiveState, Locale, Mutation, MutationOptions, OpenEntityCard, OutsideTarget, PackageCall, PackageInfo, PackageLinkProps, PackageNavigate, PackageRoute, PackageSend, PackageSettings, PageActionsProps, PageProps, PictureOptions, PlatformLinkProps, PlatformNavigate, PlatformTarget, PluralEnglish, RpcOptions, RpcState, SendCommand, SettingsPatch, StateHistoryPoint, Telemetry, TelemetryPoint, TelemetryQuery, TelemetryResolution, Theme, ToastMessage, Toasts, Translate, Translation, TranslationValues, UiHost, Viewer, VisibleSettings };