import { G as CapabilityState, H as CapabilityCommands, S as FormValues, ct as EntityDomain, d as EntityTypeDefinition, f as ValuesOf, i as SettingsDefinition, lt as EntityId, q as CommandableCapability, r as JsonValue, s as ArgsOf, t as JsonObject, u as CommandsOf, z as ValueOfField } from "./chunks/json.js";
import { a as PageProps, n as EntityViewProps, t as CardProps } from "./chunks/props.js";
import { AnchorHTMLAttributes, ComponentType, ReactElement, ReactNode } from "react";
//#region src/ui/types.d.ts
/** The package drawn. */
type PackageInfo = {
  readonly id: string;
  readonly version: string;
  readonly name: string;
};
/** One entity of the house, as the interface shows it. */
type EntityView = {
  readonly entityId: EntityId;
  readonly domain: EntityDomain;
  readonly name: string;
  readonly icon: string | null;
  readonly deviceId: string | null;
  readonly areaId: string | null;
  readonly state: CapabilityState;
  readonly attributes: JsonObject;
  readonly isAvailable: boolean;
  readonly lastChanged: string;
  readonly unitOfMeasurement: string | null;
  readonly deviceClass: string | null;
  readonly displayPrecision: number | null;
};
/** Which entities `useEntities` reads. */
type EntitiesFilter = {
  /** Whose: the package's own (the default), anyone's, or another package's by id. */
  readonly owner?: 'self' | 'any' | (string & Record<never, never>);
  readonly domain?: EntityDomain;
  readonly entityIds?: readonly EntityId[];
};
/** One of the package's custom entities, live and typed. */
type CustomEntityState<TType extends EntityTypeDefinition> = {
  /** Its values, or undefined while it is not known. */
  readonly values: ValuesOf<TType> | undefined;
  readonly isAvailable: boolean;
  readonly lastChanged: string | null;
  /**
   * Sends it one of its type's commands.
   *
   * @param command - The command's id.
   * @param args - Its arguments.
   * @returns Once the platform took it.
   */
  readonly send: <TCommand extends CommandsOf<TType>>(command: TCommand, args: ArgsOf<TType, TCommand>) => Promise<void>;
};
/** What sending a command takes. */
type SendCommand = <TName extends CommandableCapability>(entityId: EntityId, capability: TName, command: CapabilityCommands[TName]) => Promise<void>;
/** A read of one of the package's methods. */
type RpcState<TData> = {
  readonly data: TData | undefined;
  readonly error: Error | null;
  readonly isLoading: boolean;
  /** Reads it again. */
  readonly refetch: () => void;
};
/** How a read of a method is made. */
type RpcOptions = {
  /** Reads it again every so often. */
  readonly refetchIntervalMs?: number;
  /** False holds the read back. */
  readonly isEnabled?: boolean;
};
/** A call of one of the package's methods, on demand. */
type PackageCall = <TData = JsonValue>(method: string, input?: JsonValue) => Promise<TData>;
/** How a mutation is made. */
type MutationOptions = {
  /** The methods whose reads it refreshes once done; all of the package's when not said. */
  readonly invalidates?: readonly string[];
};
/** A call that changes something, with its state. */
type Mutation<TInput, TOutput> = {
  /**
   * Calls the method.
   *
   * @param input - What it is handed.
   * @returns What it answered.
   */
  readonly mutate: (input: TInput) => Promise<TOutput>;
  readonly isPending: boolean;
  readonly error: Error | null;
  /** Forgets the last error. */
  readonly reset: () => void;
};
/** The keys of the settings whose field is a secret. */
type SecretKeys<TFields> = { [TKey in keyof TFields]: TFields[TKey] extends {
  readonly kind: 'secret';
} ? TKey : never; }[keyof TFields];
/** The settings as the interface reads them: a secret is whether one is saved. */
type VisibleSettings<TSettings> = TSettings extends SettingsDefinition<infer TFields> ? Omit<FormValues<TFields>, SecretKeys<TFields>> & Readonly<Record<SecretKeys<TFields>, boolean>> : JsonObject;
/** Some of the settings to save: a secret as text. */
type SettingsPatch<TSettings> = TSettings extends SettingsDefinition<infer TFields> ? { readonly [TKey in keyof TFields]?: ValueOfField<TFields[TKey]>; } : JsonObject;
/** The package's settings, to show and change. */
type PackageSettings<TSettings> = {
  /** Every setting; while they are being read, the declared defaults. */
  readonly values: VisibleSettings<TSettings>;
  /** Whether what was saved is still being read. */
  readonly isLoading: boolean;
  /**
   * Saves some of them; a change of a field that is not live restarts the package.
   *
   * @param patch - What changes.
   * @returns Once saved.
   */
  readonly update: (patch: SettingsPatch<TSettings>) => Promise<void>;
  readonly isUpdating: boolean;
  /** Whether the viewer may change them (`package:configure`). */
  readonly canEdit: boolean;
  readonly error: Error | null;
};
/** Who is looking. */
type Viewer = {
  readonly userId: string;
  readonly username: string;
  readonly role: string;
  /**
   * Says whether the viewer holds a permission.
   *
   * @param permission - Its name: `package:configure`, `entity:control`.
   * @returns True when they do.
   */
  readonly can: (permission: string) => boolean;
};
/** The viewer's language and time zone, for `Intl`. */
type Locale = {
  readonly locale: string;
  readonly timeZone: string;
};
/** A plural's English: the form for one, and the form for any other number. */
type PluralEnglish = {
  readonly one: string;
  readonly other: string;
};
/** What fills a string's `{{placeholders}}`; `count` also picks a plural's form. */
type TranslationValues = Readonly<Record<string, string | number>>;
/**
 * Says one of the package's strings in the viewer's language.
 *
 * The key is looked up in the package's catalogue for that language (`locales/it.json`); when it
 * is not there, the English given here is said instead. A plural takes its English as
 * `{ one, other }` and the number as `count`: each language's catalogue holds the forms it needs.
 */
type Translate = (key: string, english: string | PluralEnglish, values?: TranslationValues) => string;
/** The package's strings, in the viewer's language. */
type Translation = {
  readonly t: Translate;
  /** The language they are said in, `it`: the viewer's, whether or not the package has it. */
  readonly locale: string;
};
/** Which theme the interface draws in. */
type Theme = {
  readonly scheme: 'light' | 'dark';
};
/** Where the package's page is: a path of its own, under the platform's address for it. */
type PackageRoute = {
  /** `/clips/42`, `/` at the page's root. */
  readonly path: string;
  readonly segments: readonly string[];
  readonly query: URLSearchParams;
};
/** Goes to a path of the package's page. */
type PackageNavigate = (to: string, options?: {
  readonly replace?: boolean;
}) => void;
/** A place of the platform, named by what it is: its address is the platform's. */
type PlatformTarget = {
  readonly kind: 'entity';
  readonly entityId: EntityId;
} | {
  readonly kind: 'device';
  readonly deviceId: string;
} | {
  readonly kind: 'package';
  readonly packageId: string;
} | {
  readonly kind: 'dashboard';
  readonly dashboardId?: string;
};
/** Goes to a place of the platform. */
type PlatformNavigate = (target: PlatformTarget) => void;
/** What a link takes besides where it goes: an anchor's attributes, but its address. */
type LinkAttributes = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  readonly children?: ReactNode;
};
/** A link to a path of the package's page. */
type PackageLinkProps = LinkAttributes & {
  readonly to: string;
  readonly replace?: boolean;
};
/** A link to a place of the platform. */
type PlatformLinkProps = LinkAttributes & {
  readonly to: PlatformTarget;
};
/** What the interface lends to implement `/ui`. */
type UiHost = {
  readonly usePackage: () => PackageInfo;
  readonly useEntity: (entityId: EntityId) => EntityView | undefined;
  readonly useEntities: (filter?: EntitiesFilter) => readonly EntityView[];
  readonly useCustomEntity: <TType extends EntityTypeDefinition>(type: TType, entityId: EntityId) => CustomEntityState<TType>;
  readonly useCommand: () => SendCommand;
  readonly usePackageRpc: <TData = JsonValue>(method: string, input?: JsonValue, options?: RpcOptions) => RpcState<TData>;
  readonly usePackageCall: () => PackageCall;
  readonly usePackageMutation: <TInput extends JsonValue | undefined, TOutput = JsonValue>(method: string, options?: MutationOptions) => Mutation<TInput, TOutput>;
  readonly usePackageSettings: <TSettings extends SettingsDefinition | undefined = undefined>(settings?: TSettings) => PackageSettings<TSettings>;
  readonly useViewer: () => Viewer;
  readonly useLocale: () => Locale;
  /** Since 1.1. */
  readonly useTranslation: () => Translation;
  readonly useTheme: () => Theme;
  readonly usePortalContainer: () => HTMLElement | null;
  readonly usePackageRoute: () => PackageRoute;
  readonly usePackageNavigate: () => PackageNavigate;
  readonly usePlatformNavigate: () => PlatformNavigate;
  readonly PackageLink: ComponentType<PackageLinkProps>;
  readonly PlatformLink: ComponentType<PlatformLinkProps>;
};
//#endregion
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
//#endregion
export type { CardProps, CustomEntityState, EntitiesFilter, EntityView, EntityViewProps, Locale, Mutation, MutationOptions, PackageCall, PackageInfo, PackageLinkProps, PackageNavigate, PackageRoute, PackageSettings, PageProps, PlatformLinkProps, PlatformNavigate, PlatformTarget, PluralEnglish, RpcOptions, RpcState, SendCommand, SettingsPatch, Theme, Translate, Translation, TranslationValues, UiHost, Viewer, VisibleSettings };