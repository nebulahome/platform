/**
 * What `/ui`'s hooks and links give, and the object the interface lends to implement them
 * ({@link UiHost}). The interface's implementation is type-checked against `UiHost`, so the SDK
 * and the interface cannot drift apart without one of them failing to build.
 */
import type { AnchorHTMLAttributes, ComponentType, ReactNode } from 'react';

import type {
  CapabilityCommands,
  CapabilityState,
  CommandableCapability,
} from '../capabilities.js';
import type {
  ArgsOf,
  CommandsOf,
  EntityTypeDefinition,
  ValuesOf,
} from '../definitions/entity-type.js';
import type { SettingsDefinition } from '../definitions/settings.js';
import type { EntityDomain, EntityId } from '../entities.js';
import type { FormValues, ValueOfField } from '../fields.js';
import type { JsonObject, JsonValue } from '../json.js';

/** The package drawn. */
export type PackageInfo = {
  readonly id: string;
  readonly version: string;
  readonly name: string;
};

/** One entity of the house, as the interface shows it. */
export type EntityView = {
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
export type EntitiesFilter = {
  /** Whose: the package's own (the default), anyone's, or another package's by id. */
  readonly owner?: 'self' | 'any' | (string & Record<never, never>);
  readonly domain?: EntityDomain;
  readonly entityIds?: readonly EntityId[];
};

/** One of the package's custom entities, live and typed. */
export type CustomEntityState<TType extends EntityTypeDefinition> = {
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
  readonly send: <TCommand extends CommandsOf<TType>>(
    command: TCommand,
    args: ArgsOf<TType, TCommand>,
  ) => Promise<void>;
};

/** What sending a command takes. */
export type SendCommand = <TName extends CommandableCapability>(
  entityId: EntityId,
  capability: TName,
  command: CapabilityCommands[TName],
) => Promise<void>;

/** A read of one of the package's methods. */
export type RpcState<TData> = {
  readonly data: TData | undefined;
  readonly error: Error | null;
  readonly isLoading: boolean;

  /** Reads it again. */
  readonly refetch: () => void;
};

/** How a read of a method is made. */
export type RpcOptions = {
  /** Reads it again every so often. */
  readonly refetchIntervalMs?: number;

  /** False holds the read back. */
  readonly isEnabled?: boolean;
};

/** A call of one of the package's methods, on demand. */
export type PackageCall = <TData = JsonValue>(method: string, input?: JsonValue) => Promise<TData>;

/** How a mutation is made. */
export type MutationOptions = {
  /** The methods whose reads it refreshes once done; all of the package's when not said. */
  readonly invalidates?: readonly string[];
};

/** A call that changes something, with its state. */
export type Mutation<TInput, TOutput> = {
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
type SecretKeys<TFields> = {
  [TKey in keyof TFields]: TFields[TKey] extends { readonly kind: 'secret' } ? TKey : never;
}[keyof TFields];

/** The settings as the interface reads them: a secret is whether one is saved. */
export type VisibleSettings<TSettings> =
  TSettings extends SettingsDefinition<infer TFields>
    ? Omit<FormValues<TFields>, SecretKeys<TFields>> &
        Readonly<Record<SecretKeys<TFields>, boolean>>
    : JsonObject;

/** Some of the settings to save: a secret as text. */
export type SettingsPatch<TSettings> =
  TSettings extends SettingsDefinition<infer TFields>
    ? { readonly [TKey in keyof TFields]?: ValueOfField<TFields[TKey]> }
    : JsonObject;

/** The package's settings, to show and change. */
export type PackageSettings<TSettings> = {
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
export type Viewer = {
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
export type Locale = {
  readonly locale: string;
  readonly timeZone: string;
};

/** A plural's English: the form for one, and the form for any other number. */
export type PluralEnglish = {
  readonly one: string;
  readonly other: string;
};

/** What fills a string's `{{placeholders}}`; `count` also picks a plural's form. */
export type TranslationValues = Readonly<Record<string, string | number>>;

/**
 * Says one of the package's strings in the viewer's language.
 *
 * The key is looked up in the package's catalogue for that language (`locales/it.json`); when it
 * is not there, the English given here is said instead. A plural takes its English as
 * `{ one, other }` and the number as `count`: each language's catalogue holds the forms it needs.
 */
export type Translate = (
  key: string,
  english: string | PluralEnglish,
  values?: TranslationValues,
) => string;

/** The package's strings, in the viewer's language. */
export type Translation = {
  readonly t: Translate;

  /** The language they are said in, `it`: the viewer's, whether or not the package has it. */
  readonly locale: string;
};

/** Which theme the interface draws in. */
export type Theme = {
  readonly scheme: 'light' | 'dark';
};

/** Where the package's page is: a path of its own, under the platform's address for it. */
export type PackageRoute = {
  /** `/clips/42`, `/` at the page's root. */
  readonly path: string;

  readonly segments: readonly string[];
  readonly query: URLSearchParams;
};

/** Goes to a path of the package's page. */
export type PackageNavigate = (to: string, options?: { readonly replace?: boolean }) => void;

/** A place of the platform, named by what it is: its address is the platform's. */
export type PlatformTarget =
  | { readonly kind: 'entity'; readonly entityId: EntityId }
  | { readonly kind: 'device'; readonly deviceId: string }
  | { readonly kind: 'package'; readonly packageId: string }
  | { readonly kind: 'dashboard'; readonly dashboardId?: string };

/** Goes to a place of the platform. */
export type PlatformNavigate = (target: PlatformTarget) => void;

/** What a link takes besides where it goes: an anchor's attributes, but its address. */
type LinkAttributes = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  readonly children?: ReactNode;
};

/** A link to a path of the package's page. */
export type PackageLinkProps = LinkAttributes & {
  readonly to: string;
  readonly replace?: boolean;
};

/** A link to a place of the platform. */
export type PlatformLinkProps = LinkAttributes & {
  readonly to: PlatformTarget;
};

/** What the interface lends to implement `/ui`. */
export type UiHost = {
  readonly usePackage: () => PackageInfo;
  readonly useEntity: (entityId: EntityId) => EntityView | undefined;
  readonly useEntities: (filter?: EntitiesFilter) => readonly EntityView[];
  readonly useCustomEntity: <TType extends EntityTypeDefinition>(
    type: TType,
    entityId: EntityId,
  ) => CustomEntityState<TType>;
  readonly useCommand: () => SendCommand;
  readonly usePackageRpc: <TData = JsonValue>(
    method: string,
    input?: JsonValue,
    options?: RpcOptions,
  ) => RpcState<TData>;
  readonly usePackageCall: () => PackageCall;
  readonly usePackageMutation: <TInput extends JsonValue | undefined, TOutput = JsonValue>(
    method: string,
    options?: MutationOptions,
  ) => Mutation<TInput, TOutput>;
  readonly usePackageSettings: <TSettings extends SettingsDefinition | undefined = undefined>(
    settings?: TSettings,
  ) => PackageSettings<TSettings>;
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
