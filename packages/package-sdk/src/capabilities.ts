/**
 * Capabilities: what an entity can do and what it reports, as the platform defines them
 * (ARCHITECTURE.md 5.3), written out for package authors.
 *
 * Each capability has three shapes: its **state** - what an entity reports, and what the house
 * reads back - its **params** - the device's own limits, declared once with the entity - and its
 * **commands**, for those that take any. A reported state may leave out what has a default; a
 * state read back has every field.
 *
 * These are written here rather than derived from the platform's schemas so that the SDK names
 * nothing private. `capabilities.test.ts` holds them equal to the platform's, field for field.
 */
import type { EntityId } from './entities.js';

/** Every capability an entity may declare. */
export type CapabilityName =
  | 'on_off'
  | 'level'
  | 'color_hs'
  | 'color_temp'
  | 'cover'
  | 'lock'
  | 'thermostat'
  | 'sensor_numeric'
  | 'sensor_binary'
  | 'sensor_text'
  | 'media_player'
  | 'camera'
  | 'button'
  | 'update'
  | 'lawn_mower'
  | 'select'
  | 'number'
  | 'vacuum'
  | 'image'
  | 'custom';

/** How a sensor's readings add up, for statistics: a reading, a running total, or a meter. */
export type EntityStateClass = 'measurement' | 'total' | 'total_increasing';

/** The modes a thermostat may be set to. */
export type ThermostatMode = 'off' | 'heat' | 'cool' | 'auto' | 'fan_only' | 'dry';

/** What a thermostat is doing, which is not the mode it is set to. */
export type ThermostatAction = 'off' | 'idle' | 'heating' | 'cooling' | 'drying' | 'fan';

/** What a player is doing. */
export type PlaybackState = 'playing' | 'paused' | 'stopped' | 'idle' | 'buffering';

/** What a robot mower is doing. */
export type LawnMowerActivity = 'mowing' | 'paused' | 'returning' | 'docked' | 'idle' | 'error';

/** What a robot vacuum is doing. */
export type VacuumActivity = 'cleaning' | 'paused' | 'returning' | 'docked' | 'idle' | 'error';

/** One room of a robot's map. */
export type VacuumRoom = { readonly id: string; readonly name: string };

/** One choice of a select. */
export type SelectOption = { readonly value: string; readonly label: string };

/** The pictures an image entity may be. */
export type ImageContentType = 'image/svg+xml' | 'image/png' | 'image/jpeg';

/** A value of a custom entity's field: a scalar, or nothing yet. */
export type CustomValue = string | number | boolean | null;

/** Each capability's state, as the house reads it back: every field there. */
export type CapabilityStates = {
  readonly on_off: { readonly isOn: boolean };
  readonly level: { readonly level: number };
  readonly color_hs: { readonly hue: number; readonly saturation: number };
  readonly color_temp: { readonly mireds: number };
  readonly cover: {
    readonly position: number;
    readonly tilt?: number;
    readonly motion: 'opening' | 'closing' | 'stopped';
  };
  readonly lock: { readonly lockState: 'locked' | 'unlocked' | 'jammed' };
  readonly thermostat: {
    readonly currentTemperature: number;
    readonly targetTemperature: number;
    readonly mode: ThermostatMode;
    readonly action: ThermostatAction;
    readonly humidity?: number;
  };
  readonly sensor_numeric: { readonly value: number };
  readonly sensor_binary: { readonly isOn: boolean };
  readonly sensor_text: { readonly value: string };
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
  readonly lawn_mower: { readonly activity: LawnMowerActivity; readonly isResumable: boolean };
  readonly select: { readonly option: string | null };
  readonly number: { readonly value: number | null };
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
  readonly custom: { readonly values: Readonly<Record<string, CustomValue>> };
};

/** Each capability's state, as a package reports it: what has a default may be left out. */
export type ReportedStates = Omit<
  CapabilityStates,
  'camera' | 'update' | 'lawn_mower' | 'select' | 'number' | 'vacuum'
> & {
  readonly camera: Omit<CapabilityStates['camera'], 'isRecording'> & {
    readonly isRecording?: boolean;
  };
  readonly update: Partial<CapabilityStates['update']>;
  readonly lawn_mower: Omit<CapabilityStates['lawn_mower'], 'isResumable'> & {
    readonly isResumable?: boolean;
  };
  readonly select: Partial<CapabilityStates['select']>;
  readonly number: Partial<CapabilityStates['number']>;
  readonly vacuum: Pick<CapabilityStates['vacuum'], 'activity'> &
    Partial<Omit<CapabilityStates['vacuum'], 'activity'>>;
};

/** An entity's state, read back: one entry per capability it declares. */
export type CapabilityState = { readonly [TName in CapabilityName]?: CapabilityStates[TName] };

/** An entity's state, as reported: one entry per capability it declares. */
export type ReportedCapabilityState = {
  readonly [TName in CapabilityName]?: ReportedStates[TName];
};

/** Each capability's params: the device's own limits, as an entity declares them. */
export type CapabilityParams = {
  readonly on_off: Readonly<Record<never, never>>;
  readonly level: { readonly hasTransition?: boolean };
  readonly color_hs: Readonly<Record<never, never>>;
  readonly color_temp: { readonly minMireds: number; readonly maxMireds: number };
  readonly cover: { readonly hasPosition?: boolean; readonly hasTilt?: boolean };
  readonly lock: { readonly hasCode?: boolean };
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
  readonly update: { readonly canInstall?: boolean; readonly hasProgress?: boolean };
  readonly lawn_mower: {
    readonly canPause?: boolean;
    readonly canStop?: boolean;
    readonly canDock?: boolean;
    readonly canResume?: boolean;
  };
  readonly select: { readonly options: readonly SelectOption[] };
  readonly number: { readonly min: number; readonly max: number; readonly step?: number };
  readonly vacuum: {
    readonly canPause?: boolean;
    readonly canStop?: boolean;
    readonly canDock?: boolean;
    readonly canLocate?: boolean;
    readonly canCleanRooms?: boolean;
    readonly canResume?: boolean;
  };
  readonly image: Readonly<Record<never, never>>;
  readonly custom: { readonly packageId: string; readonly type: string };
};

/** What an entity declares it can do, with the device's own limits for each. */
export type DeclaredCapabilities = {
  readonly [TName in CapabilityName]?: CapabilityParams[TName];
};

/** Each capability's commands, as the platform hands them over: checked, defaults applied. */
export type CapabilityCommands = {
  readonly on_off:
    | { readonly command: 'turn_on' }
    | { readonly command: 'turn_off' }
    | { readonly command: 'toggle' };
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
  readonly cover:
    | { readonly command: 'open' }
    | { readonly command: 'close' }
    | { readonly command: 'stop' }
    | { readonly command: 'set_position'; readonly position: number }
    | { readonly command: 'set_tilt'; readonly tilt: number };
  readonly lock:
    | { readonly command: 'lock'; readonly code?: string }
    | { readonly command: 'unlock'; readonly code?: string };
  readonly thermostat:
    | { readonly command: 'set_target'; readonly temperature: number }
    | { readonly command: 'set_mode'; readonly mode: ThermostatMode };
  readonly media_player:
    | { readonly command: 'play' }
    | { readonly command: 'pause' }
    | { readonly command: 'stop' }
    | { readonly command: 'next' }
    | { readonly command: 'previous' }
    | { readonly command: 'seek'; readonly positionSeconds: number }
    | { readonly command: 'set_volume'; readonly volume: number }
    | { readonly command: 'set_mute'; readonly isMuted: boolean }
    | { readonly command: 'set_source'; readonly source: string };
  readonly camera:
    | { readonly command: 'snapshot' }
    | { readonly command: 'record'; readonly durationSeconds: number };
  readonly button: { readonly command: 'press' };
  readonly update: { readonly command: 'install' };
  readonly lawn_mower:
    | { readonly command: 'start' }
    | { readonly command: 'pause' }
    | { readonly command: 'stop' }
    | { readonly command: 'dock' }
    | { readonly command: 'resume' };
  readonly select: { readonly command: 'select_option'; readonly option: string };
  readonly number: { readonly command: 'set_value'; readonly value: number };
  readonly vacuum:
    | { readonly command: 'start' }
    | { readonly command: 'pause' }
    | { readonly command: 'stop' }
    | { readonly command: 'dock' }
    | { readonly command: 'locate' }
    | { readonly command: 'resume' }
    | { readonly command: 'clean_rooms'; readonly rooms: readonly string[] };
  readonly custom: {
    readonly command: string;
    readonly args: Readonly<Record<string, CustomValue>>;
  };
};

/** The capabilities that take commands: the others report only. */
export type CommandableCapability = keyof CapabilityCommands;

/** A command the platform routed to one of the package's entities, typed by its capability. */
export type CapabilityCommand = {
  readonly [TName in CommandableCapability]: {
    readonly entityId: EntityId;
    readonly capability: TName;
    readonly command: CapabilityCommands[TName];
  };
}[CommandableCapability];
