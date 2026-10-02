/**
 * `@nebulahome/package-sdk`: what a NebulaHome package is declared with, in its
 * `nebula.config.ts` (PACKAGES_DOCS.md 4).
 *
 * Everything here runs at build time, in Node, and is small and free of side effects: a package's
 * server and interface import its definitions for their types, and keep nothing else of it.
 */
export type {
  CapabilityCommand,
  CapabilityCommands,
  CapabilityName,
  CapabilityParams,
  CapabilityState,
  CapabilityStates,
  CommandableCapability,
  CustomValue,
  DeclaredCapabilities,
  EntityStateClass,
  ImageContentType,
  LawnMowerActivity,
  PlaybackState,
  ReportedCapabilityState,
  ReportedStates,
  SelectOption,
  ThermostatAction,
  ThermostatMode,
  VacuumActivity,
  VacuumRoom,
} from './capabilities.js';
export {
  defineCard,
  type CardDefinition,
  type CardPadding,
  type CardSize,
  type OptionsOf,
  type SizeOf,
} from './definitions/card.js';
export {
  defineCompose,
  defineContainer,
  type ComposeDefinition,
  type ContainerCondition,
  type ContainerDefinition,
  type ContainerPort,
  type SettingPlaceholder,
  type When,
} from './definitions/containers.js';
export {
  defineEntityType,
  type ArgsOf,
  type CommandDeclaration,
  type CommandDeclarations,
  type CommandsOf,
  type EntityTypeDefinition,
  type ValuesOf,
} from './definitions/entity-type.js';
export {
  definePackage,
  type PackageCategory,
  type PackageConfig,
  type PackageDefinition,
  type PackageRequires,
  type PackageUi,
} from './definitions/package.js';
export { definePage, type PageDefinition, type SidebarEntry } from './definitions/page.js';
export {
  defineSettings,
  type SettingsDefinition,
  type SettingsOf,
} from './definitions/settings.js';
export {
  ENTITY_DOMAINS,
  isEntityId,
  parseEntityId,
  type EntityDomain,
  type EntityId,
  type ParsedEntityId,
} from './entities.js';
export {
  field,
  type BooleanField,
  type BooleanOptions,
  type ChoiceField,
  type ChoiceOption,
  type ChoiceOptions,
  type EntityValues,
  type Field,
  type Fields,
  type FormValues,
  type ListField,
  type ListOptions,
  type NoFields,
  type NumberField,
  type NumberOptions,
  type OptionField,
  type SecretField,
  type SecretOptions,
  type SettingField,
  type ShownWhen,
  type Simplify,
  type TextField,
  type TextOptions,
  type TimestampField,
  type TimestampOptions,
  type ValueField,
  type ValueOfField,
} from './fields.js';
export type { JsonObject, JsonPrimitive, JsonValue } from './json.js';
export type { CardProps, EntityViewProps, Loader, PackageComponent, PageProps } from './props.js';
export { SDK_VERSION } from './version.js';
