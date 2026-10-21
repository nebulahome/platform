//#region src/entities.d.ts
/**
 * Entity identifiers: `<domain>.<object id>`, as the platform writes them everywhere - in its
 * API, on its bus, in automations. A package never composes one by hand: the server's
 * `ctx.entityId` does, and these read one back.
 */
/** The kinds of thing an entity is. */
declare const ENTITY_DOMAINS: readonly ["light", "switch", "sensor", "binary_sensor", "cover", "lock", "climate", "media_player", "camera", "button", "update", "lawn_mower", "select", "number", "vacuum", "image", "custom", "alias"];
/** The kind of thing an entity is. */
type EntityDomain = (typeof ENTITY_DOMAINS)[number];
/** An entity's identifier: `sensor.weather_temperature`. */
type EntityId = string;
/** What an entity identifier is made of. */
type ParsedEntityId = {
  readonly domain: EntityDomain;
  readonly objectId: string;
};
/**
 * Reads an entity identifier.
 *
 * @param entityId - The identifier.
 * @returns Its domain and object id, or undefined when it is not one.
 */
declare function parseEntityId(entityId: string): ParsedEntityId | undefined;
/**
 * Says whether a value is an entity identifier.
 *
 * @param value - The value.
 * @returns True when it is a string the platform would take as one.
 */
declare function isEntityId(value: unknown): value is EntityId;
//#endregion
//#region src/capabilities.d.ts
/** Every capability an entity may declare. */
type CapabilityName = 'on_off' | 'level' | 'color_hs' | 'color_temp' | 'cover' | 'lock' | 'thermostat' | 'sensor_numeric' | 'sensor_binary' | 'sensor_text' | 'media_player' | 'camera' | 'button' | 'update' | 'lawn_mower' | 'select' | 'number' | 'vacuum' | 'image' | 'custom';
/** How a sensor's readings add up, for statistics: a reading, a running total, or a meter. */
type EntityStateClass = 'measurement' | 'total' | 'total_increasing';
/** The modes a thermostat may be set to. */
type ThermostatMode = 'off' | 'heat' | 'cool' | 'auto' | 'fan_only' | 'dry';
/** What a thermostat is doing, which is not the mode it is set to. */
type ThermostatAction = 'off' | 'idle' | 'heating' | 'cooling' | 'drying' | 'fan';
/** What a player is doing. */
type PlaybackState = 'playing' | 'paused' | 'stopped' | 'idle' | 'buffering';
/** What a robot mower is doing. */
type LawnMowerActivity = 'mowing' | 'paused' | 'returning' | 'docked' | 'idle' | 'error';
/** What a robot vacuum is doing. */
type VacuumActivity = 'cleaning' | 'paused' | 'returning' | 'docked' | 'idle' | 'error';
/** One room of a robot's map. */
type VacuumRoom = {
  readonly id: string;
  readonly name: string;
};
/** One choice of a select. */
type SelectOption = {
  readonly value: string;
  readonly label: string;
};
/** The pictures an image entity may be. */
type ImageContentType = 'image/svg+xml' | 'image/png' | 'image/jpeg';
/** A value of a custom entity's field: a scalar, or nothing yet. */
type CustomValue = string | number | boolean | null;
/** Each capability's state, as the house reads it back: every field there. */
type CapabilityStates = {
  readonly on_off: {
    readonly isOn: boolean;
  };
  readonly level: {
    readonly level: number;
  };
  readonly color_hs: {
    readonly hue: number;
    readonly saturation: number;
  };
  readonly color_temp: {
    readonly mireds: number;
  };
  readonly cover: {
    readonly position: number;
    readonly tilt?: number;
    readonly motion: 'opening' | 'closing' | 'stopped';
  };
  readonly lock: {
    readonly lockState: 'locked' | 'unlocked' | 'jammed';
  };
  readonly thermostat: {
    readonly currentTemperature: number;
    readonly targetTemperature: number;
    readonly mode: ThermostatMode;
    readonly action: ThermostatAction;
    readonly humidity?: number;
  };
  readonly sensor_numeric: {
    readonly value: number;
  };
  readonly sensor_binary: {
    readonly isOn: boolean;
  };
  readonly sensor_text: {
    readonly value: string;
  };
  readonly media_player: {
    readonly playback: PlaybackState;
    readonly volume: number;
    readonly isMuted: boolean;
    readonly source?: string;
    readonly mediaTitle?: string;
    readonly mediaArtist?: string;
    readonly mediaDurationSeconds?: number;
    readonly mediaPositionSeconds?: number;
  };
  readonly camera: {
    readonly isStreamAvailable: boolean;
    readonly snapshotPath?: string;
    readonly isRecording: boolean;
  };
  readonly button: Readonly<Record<never, never>>;
  readonly update: {
    readonly installedVersion: string | null;
    readonly latestVersion: string | null;
    readonly isInstalling: boolean;
    readonly progress: number | null;
  };
  readonly lawn_mower: {
    readonly activity: LawnMowerActivity;
    readonly isResumable: boolean;
  };
  readonly select: {
    readonly option: string | null;
  };
  readonly number: {
    readonly value: number | null;
  };
  readonly vacuum: {
    readonly activity: VacuumActivity;
    readonly rooms: readonly VacuumRoom[];
    readonly isResumable: boolean;
  };
  readonly image: {
    readonly contentType: ImageContentType;
    readonly revision: string;
    readonly width?: number;
    readonly height?: number;
  };
  readonly custom: {
    readonly values: Readonly<Record<string, CustomValue>>;
  };
};
/** Each capability's state, as a package reports it: what has a default may be left out. */
type ReportedStates = Omit<CapabilityStates, 'camera' | 'update' | 'lawn_mower' | 'select' | 'number' | 'vacuum'> & {
  readonly camera: Omit<CapabilityStates['camera'], 'isRecording'> & {
    readonly isRecording?: boolean;
  };
  readonly update: Partial<CapabilityStates['update']>;
  readonly lawn_mower: Omit<CapabilityStates['lawn_mower'], 'isResumable'> & {
    readonly isResumable?: boolean;
  };
  readonly select: Partial<CapabilityStates['select']>;
  readonly number: Partial<CapabilityStates['number']>;
  readonly vacuum: Pick<CapabilityStates['vacuum'], 'activity'> & Partial<Omit<CapabilityStates['vacuum'], 'activity'>>;
};
/** An entity's state, read back: one entry per capability it declares. */
type CapabilityState = { readonly [TName in CapabilityName]?: CapabilityStates[TName]; };
/** An entity's state, as reported: one entry per capability it declares. */
type ReportedCapabilityState = { readonly [TName in CapabilityName]?: ReportedStates[TName]; };
/** Each capability's params: the device's own limits, as an entity declares them. */
type CapabilityParams = {
  readonly on_off: Readonly<Record<never, never>>;
  readonly level: {
    readonly hasTransition?: boolean;
  };
  readonly color_hs: Readonly<Record<never, never>>;
  readonly color_temp: {
    readonly minMireds: number;
    readonly maxMireds: number;
  };
  readonly cover: {
    readonly hasPosition?: boolean;
    readonly hasTilt?: boolean;
  };
  readonly lock: {
    readonly hasCode?: boolean;
  };
  readonly thermostat: {
    readonly supportedModes: readonly ThermostatMode[];
    readonly minTemperature: number;
    readonly maxTemperature: number;
    readonly temperatureStep?: number;
  };
  readonly sensor_numeric: Readonly<Record<never, never>>;
  readonly sensor_binary: Readonly<Record<never, never>>;
  readonly sensor_text: Readonly<Record<never, never>>;
  readonly media_player: {
    readonly supportedSources?: readonly string[];
    readonly hasSeek?: boolean;
    readonly hasVolume?: boolean;
  };
  readonly camera: {
    readonly hasSnapshot?: boolean;
    readonly hasStream?: boolean;
    readonly hasRecording?: boolean;
  };
  readonly button: Readonly<Record<never, never>>;
  readonly update: {
    readonly canInstall?: boolean;
    readonly hasProgress?: boolean;
  };
  readonly lawn_mower: {
    readonly canPause?: boolean;
    readonly canStop?: boolean;
    readonly canDock?: boolean;
    readonly canResume?: boolean;
  };
  readonly select: {
    readonly options: readonly SelectOption[];
  };
  readonly number: {
    readonly min: number;
    readonly max: number;
    readonly step?: number;
  };
  readonly vacuum: {
    readonly canPause?: boolean;
    readonly canStop?: boolean;
    readonly canDock?: boolean;
    readonly canLocate?: boolean;
    readonly canCleanRooms?: boolean;
    readonly canResume?: boolean;
  };
  readonly image: Readonly<Record<never, never>>;
  readonly custom: {
    readonly packageId: string;
    readonly type: string;
  };
};
/** What an entity declares it can do, with the device's own limits for each. */
type DeclaredCapabilities = { readonly [TName in CapabilityName]?: CapabilityParams[TName]; };
/** Each capability's commands, as the platform hands them over: checked, defaults applied. */
type CapabilityCommands = {
  readonly on_off: {
    readonly command: 'turn_on';
  } | {
    readonly command: 'turn_off';
  } | {
    readonly command: 'toggle';
  };
  readonly level: {
    readonly command: 'set_level';
    readonly level: number;
    readonly transitionMs?: number;
  };
  readonly color_hs: {
    readonly command: 'set_color';
    readonly hue: number;
    readonly saturation: number;
    readonly transitionMs?: number;
  };
  readonly color_temp: {
    readonly command: 'set_color_temp';
    readonly mireds: number;
    readonly transitionMs?: number;
  };
  readonly cover: {
    readonly command: 'open';
  } | {
    readonly command: 'close';
  } | {
    readonly command: 'stop';
  } | {
    readonly command: 'set_position';
    readonly position: number;
  } | {
    readonly command: 'set_tilt';
    readonly tilt: number;
  };
  readonly lock: {
    readonly command: 'lock';
    readonly code?: string;
  } | {
    readonly command: 'unlock';
    readonly code?: string;
  };
  readonly thermostat: {
    readonly command: 'set_target';
    readonly temperature: number;
  } | {
    readonly command: 'set_mode';
    readonly mode: ThermostatMode;
  };
  readonly media_player: {
    readonly command: 'play';
  } | {
    readonly command: 'pause';
  } | {
    readonly command: 'stop';
  } | {
    readonly command: 'next';
  } | {
    readonly command: 'previous';
  } | {
    readonly command: 'seek';
    readonly positionSeconds: number;
  } | {
    readonly command: 'set_volume';
    readonly volume: number;
  } | {
    readonly command: 'set_mute';
    readonly isMuted: boolean;
  } | {
    readonly command: 'set_source';
    readonly source: string;
  };
  readonly camera: {
    readonly command: 'snapshot';
  } | {
    readonly command: 'record';
    readonly durationSeconds: number;
  };
  readonly button: {
    readonly command: 'press';
  };
  readonly update: {
    readonly command: 'install';
  };
  readonly lawn_mower: {
    readonly command: 'start';
  } | {
    readonly command: 'pause';
  } | {
    readonly command: 'stop';
  } | {
    readonly command: 'dock';
  } | {
    readonly command: 'resume';
  };
  readonly select: {
    readonly command: 'select_option';
    readonly option: string;
  };
  readonly number: {
    readonly command: 'set_value';
    readonly value: number;
  };
  readonly vacuum: {
    readonly command: 'start';
  } | {
    readonly command: 'pause';
  } | {
    readonly command: 'stop';
  } | {
    readonly command: 'dock';
  } | {
    readonly command: 'locate';
  } | {
    readonly command: 'resume';
  } | {
    readonly command: 'clean_rooms';
    readonly rooms: readonly string[];
  };
  readonly custom: {
    readonly command: string;
    readonly args: Readonly<Record<string, CustomValue>>;
  };
};
/** The capabilities that take commands: the others report only. */
type CommandableCapability = keyof CapabilityCommands;
/** A command the platform routed to one of the package's entities, typed by its capability. */
type CapabilityCommand = { readonly [TName in CommandableCapability]: {
  readonly entityId: EntityId;
  readonly capability: TName;
  readonly command: CapabilityCommands[TName];
}; }[CommandableCapability];
//#endregion
//#region src/fields.d.ts
/**
 * The field builders: one set that describes a package's settings, a card's options, the state
 * of an entity type and the arguments of its commands (PACKAGES_DOCS.md 4.10).
 *
 * Not every kind fits every place - a secret is never a card option, a timestamp is never asked
 * in a form - and the places say which they take: `SettingField`, `OptionField`, `ValueField`.
 * Each builder keeps the literal options it was given, which is what lets `SettingsOf`,
 * `OptionsOf` and `ValuesOf` give a choice the union of its values and know which fields are
 * always there.
 */
/** A condition on an earlier field of the same form: asked only while it holds one of these. */
type ShownWhen = {
  readonly key: string;
  readonly equals: readonly (string | boolean)[];
};
/** One choice of a choice field. */
type ChoiceOption = {
  readonly value: string;
  readonly label: string;
};
/** What every field says. */
type FieldBase = {
  /** Shown beside the control, or as the column of a value; at most 64 characters. */
  readonly label: string;
  /** Shown under it, for what the label cannot say. */
  readonly help?: string;
};
/** What a field says when a form asks it: in the settings, or a card's options. */
type InForm<TValue> = {
  /** What it holds until the owner says otherwise. */
  readonly default?: TValue;
  /** Whether the form may not be saved without it. */
  readonly isRequired?: boolean;
  /** Asked only after an earlier choice or switch. */
  readonly shownWhen?: ShownWhen;
  /** In the settings: a change reaches the running process instead of restarting it. */
  readonly isLive?: boolean;
};
/** What a field says as part of an entity type's state, or of a command's arguments. */
type InEntity = {
  /** Whether it may be missing, or null; required when not said. */
  readonly isOptional?: boolean;
};
/** A text's own limits. */
type TextLimits = {
  readonly pattern?: string;
  readonly patternMessage?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
};
/** What `field.text` takes. */
type TextOptions = FieldBase & InForm<string> & InEntity & TextLimits & {
  readonly placeholder?: string;
};
/** What `field.secret` takes: like text, with nothing a form could show back. */
type SecretOptions = FieldBase & Omit<InForm<string>, 'default'> & TextLimits;
/** What `field.number` takes. */
type NumberOptions = FieldBase & InForm<number> & InEntity & {
  readonly min?: number;
  readonly max?: number;
  readonly isInteger?: boolean;
  /** What it is counted in: `min`, `°C`, `MB`. */
  readonly unit?: string;
  /** In a form: below this it warns, without refusing. */
  readonly warnBelow?: number;
  /** What the warning says. */
  readonly warning?: string;
};
/** What `field.boolean` takes. */
type BooleanOptions = FieldBase & InForm<boolean> & InEntity;
/** What `field.choice` takes. */
type ChoiceOptions = FieldBase & InForm<string> & InEntity & {
  readonly choices: readonly ChoiceOption[];
};
/** What `field.list` takes: several texts, each held to the same pattern. */
type ListOptions = FieldBase & Omit<InForm<readonly string[]>, 'default'> & {
  readonly placeholder?: string;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly pattern?: string;
  readonly patternMessage?: string;
};
/** What `field.timestamp` takes: an instant, as ISO 8601 text. */
type TimestampOptions = FieldBase & InEntity;
/** A text field. */
type TextField<TOptions extends TextOptions = TextOptions> = TOptions & {
  readonly kind: 'text';
};
/** A secret field. */
type SecretField<TOptions extends SecretOptions = SecretOptions> = TOptions & {
  readonly kind: 'secret';
};
/** A number field. */
type NumberField<TOptions extends NumberOptions = NumberOptions> = TOptions & {
  readonly kind: 'number';
};
/** A boolean field. */
type BooleanField<TOptions extends BooleanOptions = BooleanOptions> = TOptions & {
  readonly kind: 'boolean';
};
/** A choice field. */
type ChoiceField<TOptions extends ChoiceOptions = ChoiceOptions> = TOptions & {
  readonly kind: 'choice';
};
/** A list field. */
type ListField<TOptions extends ListOptions = ListOptions> = TOptions & {
  readonly kind: 'list';
};
/** A timestamp field. */
type TimestampField<TOptions extends TimestampOptions = TimestampOptions> = TOptions & {
  readonly kind: 'timestamp';
};
/** Any field. */
type Field = TextField | SecretField | NumberField | BooleanField | ChoiceField | ListField | TimestampField;
/** A field the settings may hold: every kind a form asks. */
type SettingField = (TextField | SecretField | NumberField | BooleanField | ChoiceField | ListField) & {
  readonly isOptional?: never;
};
/** A field a card's inspector may ask: a form's kinds, no secret, nothing live. */
type OptionField = (TextField | NumberField | BooleanField | ChoiceField | ListField) & {
  readonly isOptional?: never;
  readonly isLive?: never;
};
/** A field of an entity type's state or of a command's arguments. */
type ValueField = (TextField | NumberField | BooleanField | ChoiceField | TimestampField) & {
  readonly isRequired?: never;
  readonly default?: never;
  readonly shownWhen?: never;
  readonly isLive?: never;
};
/** Fields by their keys: camelCase, a letter first. */
type Fields<TField extends Field = Field> = Readonly<Record<string, TField>>;
/** No fields. */
type NoFields = Readonly<Record<never, never>>;
/** The value a field holds: the union of its values for a choice. */
type ValueOfField<TField> = TField extends {
  readonly kind: 'choice';
  readonly choices: readonly {
    readonly value: infer TValue;
  }[];
} ? TValue : TField extends {
  readonly kind: 'number';
} ? number : TField extends {
  readonly kind: 'boolean';
} ? boolean : TField extends {
  readonly kind: 'list';
} ? readonly string[] : string;
/** Flattens an intersection, so what it holds reads as one object. */
type Simplify<TObject> = { [TKey in keyof TObject]: TObject[TKey]; };
/** The keys of a form whose value is always there: those with a default, and those required. */
type PresentKeys<TFields> = { [TKey in keyof TFields]: TFields[TKey] extends {
  readonly default: unknown;
} ? TKey : TFields[TKey] extends {
  readonly isRequired: true;
} ? TKey : never; }[keyof TFields];
/** The values a form holds: what has a default or is required always, anything else maybe. */
type FormValues<TFields> = Simplify<{ readonly [TKey in PresentKeys<TFields>]: ValueOfField<TFields[TKey]>; } & { readonly [TKey in Exclude<keyof TFields, PresentKeys<TFields>>]?: ValueOfField<TFields[TKey]> | undefined; }>;
/** The keys of an entity's fields that may be missing. */
type OptionalKeys<TFields> = { [TKey in keyof TFields]: TFields[TKey] extends {
  readonly isOptional: true;
} ? TKey : never; }[keyof TFields];
/** The values of an entity's fields, whole: an optional field may be missing, or null. */
type EntityValues<TFields> = Simplify<{ readonly [TKey in Exclude<keyof TFields, OptionalKeys<TFields>>]: ValueOfField<TFields[TKey]>; } & { readonly [TKey in OptionalKeys<TFields>]?: ValueOfField<TFields[TKey]> | null; }>;
/** The field builders. */
declare const field: {
  /**
   * A text: free, or held to a length and a pattern.
   *
   * @param options - Its label and limits.
   * @returns The field.
   */
  text: <const TOptions extends TextOptions>(options: TOptions) => TextField<TOptions>;
  /**
   * A secret: stored sealed, handed to the process open, never sent to a browser.
   *
   * @param options - Its label and limits.
   * @returns The field.
   */
  secret: <const TOptions extends SecretOptions>(options: TOptions) => SecretField<TOptions>;
  /**
   * A number, optionally whole and within a range.
   *
   * @param options - Its label, range and unit.
   * @returns The field.
   */
  number: <const TOptions extends NumberOptions>(options: TOptions) => NumberField<TOptions>;
  /**
   * On or off.
   *
   * @param options - Its label.
   * @returns The field.
   */
  boolean: <const TOptions extends BooleanOptions>(options: TOptions) => BooleanField<TOptions>;
  /**
   * One of a fixed list.
   *
   * @param options - Its label and its choices, 1 to 64.
   * @returns The field.
   */
  choice: <const TOptions extends ChoiceOptions>(options: TOptions) => ChoiceField<TOptions>;
  /**
   * Several texts - addresses, topics - each held to the same pattern.
   *
   * @param options - Its label and limits.
   * @returns The field.
   */
  list: <const TOptions extends ListOptions>(options: TOptions) => ListField<TOptions>;
  /**
   * An instant, as ISO 8601 text: an entity's state or a command's argument, never a form's.
   *
   * @param options - Its label.
   * @returns The field.
   */
  timestamp: <const TOptions extends TimestampOptions>(options: TOptions) => TimestampField<TOptions>;
};
//#endregion
//#region src/definitions/entity-type.d.ts
/** A command an entity type takes. */
type CommandDeclaration = {
  readonly name: string;
  /** Its arguments, at most 8. */
  readonly fields?: Fields<ValueField>;
};
/** Commands by their ids. */
type CommandDeclarations = Readonly<Record<string, CommandDeclaration>>;
/** An entity type, as declared. */
type EntityTypeDefinition<TId extends string = string, TState extends Fields<ValueField> = Fields<ValueField>, TCommands extends CommandDeclarations = CommandDeclarations> = {
  readonly kind: 'entityType';
  readonly id: TId;
  readonly name: string;
  /** A catalogue icon id. */
  readonly icon: string;
  /** What its state holds: 1 to 32 fields. */
  readonly state: TState;
  /** The commands it takes, at most 16. */
  readonly commands?: TCommands;
};
/** The values of an entity type's state, whole: an optional field may be missing, or null. */
type ValuesOf<TType> = TType extends EntityTypeDefinition<string, infer TState> ? EntityValues<TState> : never;
/** The ids of an entity type's commands. */
type CommandsOf<TType> = TType extends EntityTypeDefinition<string, Fields<ValueField>, infer TCommands> ? keyof TCommands & string : never;
/** The arguments of one of an entity type's commands. */
type ArgsOf<TType, TCommand extends CommandsOf<TType>> = TType extends EntityTypeDefinition<string, Fields<ValueField>, infer TCommands> ? TCommands[TCommand] extends {
  readonly fields: infer TFields;
} ? EntityValues<TFields> : NoFields : never;
/**
 * Declares an entity type.
 *
 * @param type - Its id, name, icon, state and commands.
 * @returns The type, for `definePackage`'s `entityTypes`, the server's `ctx.custom` and its view.
 */
declare function defineEntityType<const TId extends string, const TState extends Fields<ValueField>, const TCommands extends CommandDeclarations = NoFields>(type: Omit<EntityTypeDefinition<TId, TState, TCommands>, 'kind'>): EntityTypeDefinition<TId, TState, TCommands>;
//#endregion
//#region src/definitions/settings.d.ts
/** A package's settings. */
type SettingsDefinition<TFields extends Fields<SettingField> = Fields<SettingField>> = {
  readonly kind: 'settings';
  readonly fields: TFields;
};
/** The values of a package's settings: what has a default or is required is always there. */
type SettingsOf<TSettings> = TSettings extends SettingsDefinition<infer TFields> ? FormValues<TFields> : never;
/**
 * Declares a package's settings, at most 32 fields, by their keys.
 *
 * @param fields - The fields, built with `field`.
 * @returns The settings, for `definePackage` and for the types of `ctx.settings`.
 */
declare function defineSettings<const TFields extends Fields<SettingField>>(fields: TFields): SettingsDefinition<TFields>;
//#endregion
//#region src/json.d.ts
/**
 * JSON, as the platform passes it between a package and everything else: settings, attributes,
 * the input and output of a method.
 */
/** A JSON scalar. */
type JsonPrimitive = string | number | boolean | null;
/** Any JSON value. */
type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;
/** A JSON object. */
type JsonObject = {
  readonly [key: string]: JsonValue;
};
//#endregion
export { PlaybackState as $, SecretOptions as A, field as B, ListField as C, NumberOptions as D, NumberField as E, TextOptions as F, CapabilityState as G, CapabilityCommands as H, TimestampField as I, CustomValue as J, CapabilityStates as K, TimestampOptions as L, ShownWhen as M, Simplify as N, OptionField as O, TextField as P, LawnMowerActivity as Q, ValueField as R, FormValues as S, NoFields as T, CapabilityName as U, CapabilityCommand as V, CapabilityParams as W, EntityStateClass as X, DeclaredCapabilities as Y, ImageContentType as Z, ChoiceOption as _, SettingsOf as a, VacuumActivity as at, Field as b, CommandDeclaration as c, EntityDomain as ct, EntityTypeDefinition as d, isEntityId as dt, ReportedCapabilityState as et, ValuesOf as f, parseEntityId as ft, ChoiceField as g, BooleanOptions as h, SettingsDefinition as i, ThermostatMode as it, SettingField as j, SecretField as k, CommandDeclarations as l, EntityId as lt, BooleanField as m, JsonPrimitive as n, SelectOption as nt, defineSettings as o, VacuumRoom as ot, defineEntityType as p, CommandableCapability as q, JsonValue as r, ThermostatAction as rt, ArgsOf as s, ENTITY_DOMAINS as st, JsonObject as t, ReportedStates as tt, CommandsOf as u, ParsedEntityId as ut, ChoiceOptions as v, ListOptions as w, Fields as x, EntityValues as y, ValueOfField as z };