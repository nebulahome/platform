import { $ as PlaybackState, A as SecretOptions, B as field, C as ListField, D as NumberOptions, E as NumberField, F as TextOptions, G as CapabilityState, H as CapabilityCommands, I as TimestampField, J as CustomValue, K as CapabilityStates, L as TimestampOptions, M as ShownWhen, N as Simplify, O as OptionField, P as TextField, Q as LawnMowerActivity, R as ValueField, S as FormValues, T as NoFields, U as CapabilityName, V as CapabilityCommand, W as CapabilityParams, X as EntityStateClass, Y as DeclaredCapabilities, Z as ImageContentType, _ as ChoiceOption, a as SettingsOf, at as VacuumActivity, b as Field, c as CommandDeclaration, ct as EntityDomain, d as EntityTypeDefinition, dt as isEntityId, et as ReportedCapabilityState, f as ValuesOf, ft as parseEntityId, g as ChoiceField, h as BooleanOptions, i as SettingsDefinition, it as ThermostatMode, j as SettingField, k as SecretField, l as CommandDeclarations, lt as EntityId, m as BooleanField, n as JsonPrimitive, nt as SelectOption, o as defineSettings, ot as VacuumRoom, p as defineEntityType, q as CommandableCapability, r as JsonValue, rt as ThermostatAction, s as ArgsOf, st as ENTITY_DOMAINS, t as JsonObject, tt as ReportedStates, u as CommandsOf, ut as ParsedEntityId, v as ChoiceOptions, w as ListOptions, x as Fields, y as EntityValues, z as ValueOfField } from "./chunks/json.js";
import { a as PageProps, c as CardSize, d as defineCard, i as PackageComponent, l as OptionsOf, n as EntityViewProps, o as CardDefinition, r as Loader, s as CardPadding, t as CardProps, u as SizeOf } from "./chunks/props.js";
//#region src/definitions/containers.d.ts
/**
 * `defineContainer` and `defineCompose`: what a package runs beside or instead of its process
 * (PACKAGES_DOCS.md 4.7, 4.8). The supervisor runs them on the platform's network, keeps them up,
 * and removes them with the package.
 */
/** A value one of the package's settings gives: `{setup.webPort}`. */
type SettingPlaceholder = `{setup.${string}}`;
/** An entry kept only while one of the settings holds one of the values. */
type When = {
  readonly key: string;
  readonly equals: readonly (string | boolean)[];
};
/** A port: a number, or one of the settings. */
type ContainerPort = number | SettingPlaceholder;
/** How far a container must have come before one that depends on it starts. */
type ContainerCondition = 'started' | 'healthy';
/** A container, as declared. */
type ContainerDefinition<TId extends string = string> = {
  readonly kind: 'container';
  /** Names the container and its folder: `^[a-z][a-z0-9-]{1,31}$`. */
  readonly id: TId;
  readonly name: string;
  /** The image, without a tag: `koenkk/zigbee2mqtt`, `ghcr.io/owner/app`. */
  readonly image: string;
  /** The oldest release it works with: the newest of that major is installed. */
  readonly minVersion: string;
  /** Paths inside the container; where they live is the platform's, in its data directory. */
  readonly volumes?: readonly {
    readonly name: string;
    readonly path: string;
    /** Left out of backups: what can be made again. */
    readonly isCache?: boolean;
  }[];
  /** Its environment; `{setup.x}` and `{platform.…}` are filled in. */
  readonly env?: Readonly<Record<string, string | {
    readonly value: string;
    readonly when: When;
  }>>;
  /** Devices of the host it is given, under `/dev`. */
  readonly devices?: readonly {
    readonly host: string;
    readonly container: string;
    readonly when?: When;
  }[];
  /** Ports published when the platform is on a bridge network. */
  readonly ports?: readonly {
    readonly container: ContainerPort;
    readonly host: ContainerPort;
    readonly protocol?: 'tcp' | 'udp';
    readonly when?: When;
  }[];
  /** Files written into a volume once, when missing. */
  readonly seed?: readonly {
    readonly volume: string;
    readonly path: string;
    readonly content: string;
  }[];
  /** The topics it uses on the house's broker, which a username of its own is held to. */
  readonly mqttTopics?: readonly string[];
  /** The port of its own web page, which the interface links to. */
  readonly webPort?: ContainerPort;
  readonly webPortWhen?: When;
  /** The command, instead of the image's: each argument on its own. */
  readonly command?: readonly string[];
  /** How the platform knows it is ready: `test` is `CMD …` or `CMD-SHELL …`. */
  readonly healthcheck?: {
    readonly test: readonly string[];
    readonly intervalMs?: number;
    readonly timeoutMs?: number;
    readonly retries?: number;
    readonly startPeriodMs?: number;
  };
  /** Containers of the same package it starts after, and how far each must have come. */
  readonly dependsOn?: Readonly<Record<string, ContainerCondition>>;
};
/** A compose file, as declared. */
type ComposeDefinition = {
  readonly kind: 'compose';
  /** The file, next to the config: `./compose.yaml`. */
  readonly file: string;
};
/**
 * Declares a container the package runs.
 *
 * @param container - Its image, release, volumes, environment and the rest.
 * @returns The container, for `definePackage`'s `containers`.
 */
export declare function defineContainer<const TId extends string>(container: Omit<ContainerDefinition<TId>, 'kind'>): ContainerDefinition<TId>;
/**
 * Declares a compose file the package runs instead of declared containers.
 *
 * @param compose - Where the file is.
 * @returns The compose file, for `definePackage`'s `compose`.
 */
export declare function defineCompose(compose: Omit<ComposeDefinition, 'kind'>): ComposeDefinition;
//#endregion
//#region src/definitions/bound-props.d.ts
/** The props of the component of the card with this id. */
type CardPropsFor<TCards extends readonly CardDefinition[], TId extends string> = CardProps<Extract<TCards[number], {
  readonly id: TId;
}>>;
/** The props of the view of the entity type with this id. */
type EntityViewPropsFor<TTypes extends readonly EntityTypeDefinition[], TId extends string> = EntityViewProps<Extract<TTypes[number], {
  readonly id: TId;
}>>;
//#endregion
//#region src/definitions/page.d.ts
/** An entry of the page in the interface's sidebar. */
type SidebarEntry = {
  /** What it says; the package's name when not given. At most 32 characters. */
  readonly label?: string;
  /** A catalogue icon id; the package's logo when not given. */
  readonly icon?: string;
};
/** The package's page, as declared. */
type PageDefinition = {
  readonly kind: 'page';
  readonly component: Loader<PageProps>;
  readonly sidebar?: SidebarEntry;
};
/**
 * Declares the package's page. A package has at most one: `ui.page` is a single field.
 *
 * @param page - Its component's loader, and its sidebar entry if any.
 * @returns The page, for `definePackage`'s `ui.page`.
 */
export declare function definePage(page: Omit<PageDefinition, 'kind'>): PageDefinition;
//#endregion
//#region src/definitions/package.d.ts
/** What the store files a package under. */
type PackageCategory = 'protocol' | 'media' | 'security' | 'energy' | 'climate' | 'visualisation' | 'automation' | 'other';
/** What a package needs besides itself. */
type PackageRequires = {
  /** The platform, by npm range. */
  readonly platform?: string;
  /** Packages, by id and range. */
  readonly packages?: Readonly<Record<string, string>>;
  /** Services, by name, whoever provides them. */
  readonly services?: readonly string[];
};
/** The components a package draws, bound to what it declares. */
type PackageUi<TCards extends readonly CardDefinition[], TTypes extends readonly EntityTypeDefinition[]> = {
  /** Its own page. */
  readonly page?: PageDefinition;
  /** A component for every declared card, by its id. */
  readonly cards?: { readonly [TId in TCards[number]['id']]: Loader<CardPropsFor<TCards, TId>>; };
  /** Views of the entity types it draws itself, by their ids. */
  readonly entityViews?: { readonly [TId in TTypes[number]['id']]?: Loader<EntityViewPropsFor<TTypes, TId>>; };
};
/** What every package says, whatever it runs. */
type PackageBase<TCards extends readonly CardDefinition[], TTypes extends readonly EntityTypeDefinition[]> = {
  /** `^[a-z][a-z0-9-]{1,63}$`, not one of the platform's names. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: PackageCategory;
  /** The NebulaHome versions it works with, as an npm range: `^1.4.0`. */
  readonly platform: string;
  /** Its colour in the store, `#RRGGBB`. */
  readonly color?: `#${string}`;
  /** A file next to the config: `./logo.svg`. */
  readonly logo?: string | {
    readonly path: string;
    readonly padding?: number;
  };
  readonly url?: string;
  /** `owner/name` on GitHub; read from `package.json` when not given. */
  readonly repository?: string;
  /** The server's entry module, next to the config: `./src/server/index.ts`. */
  readonly server?: string;
  readonly settings?: SettingsDefinition;
  readonly cards?: TCards;
  readonly entityTypes?: TTypes;
  readonly requires?: PackageRequires;
  readonly provides?: readonly string[];
  readonly ui?: PackageUi<TCards, TTypes>;
};
/** What `definePackage` takes: declared containers, or a compose file, or neither. */
type PackageConfig<TCards extends readonly CardDefinition[] = readonly CardDefinition[], TTypes extends readonly EntityTypeDefinition[] = readonly EntityTypeDefinition[]> = PackageBase<TCards, TTypes> & ({
  readonly containers?: readonly ContainerDefinition[];
  readonly compose?: never;
} | {
  readonly compose: ComposeDefinition;
  readonly containers?: never;
});
/** A package, as declared. */
type PackageDefinition<TCards extends readonly CardDefinition[] = readonly CardDefinition[], TTypes extends readonly EntityTypeDefinition[] = readonly EntityTypeDefinition[]> = PackageConfig<TCards, TTypes> & {
  readonly kind: 'package';
};
/**
 * Declares the package: `nebula.config.ts`'s default export.
 *
 * @param config - What it is, what it declares, and the components it draws.
 * @returns The package, which the build writes the manifest from.
 */
export declare function definePackage<const TCards extends readonly CardDefinition[] = readonly [], const TTypes extends readonly EntityTypeDefinition[] = readonly []>(config: PackageConfig<TCards, TTypes>): PackageDefinition<TCards, TTypes>;
//#endregion
//#region src/version.d.ts
/** The SDK's own version: `1.0.0`, or a prerelease of it. */
export declare const SDK_VERSION: string;
//#endregion
export { type ArgsOf, type BooleanField, type BooleanOptions, type CapabilityCommand, type CapabilityCommands, type CapabilityName, type CapabilityParams, type CapabilityState, type CapabilityStates, type CardDefinition, type CardPadding, type CardProps, type CardSize, type ChoiceField, type ChoiceOption, type ChoiceOptions, type CommandDeclaration, type CommandDeclarations, type CommandableCapability, type CommandsOf, type ComposeDefinition, type ContainerCondition, type ContainerDefinition, type ContainerPort, type CustomValue, type DeclaredCapabilities, ENTITY_DOMAINS, type EntityDomain, type EntityId, type EntityStateClass, type EntityTypeDefinition, type EntityValues, type EntityViewProps, type Field, type Fields, type FormValues, type ImageContentType, type JsonObject, type JsonPrimitive, type JsonValue, type LawnMowerActivity, type ListField, type ListOptions, type Loader, type NoFields, type NumberField, type NumberOptions, type OptionField, type OptionsOf, type PackageCategory, type PackageComponent, type PackageConfig, type PackageDefinition, type PackageRequires, type PackageUi, type PageDefinition, type PageProps, type ParsedEntityId, type PlaybackState, type ReportedCapabilityState, type ReportedStates, type SecretField, type SecretOptions, type SelectOption, type SettingField, type SettingPlaceholder, type SettingsDefinition, type SettingsOf, type ShownWhen, type SidebarEntry, type Simplify, type SizeOf, type TextField, type TextOptions, type ThermostatAction, type ThermostatMode, type TimestampField, type TimestampOptions, type VacuumActivity, type VacuumRoom, type ValueField, type ValueOfField, type ValuesOf, type When, defineCard, defineEntityType, defineSettings, field, isEntityId, parseEntityId };