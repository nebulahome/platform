/**
 * Capabilities: what an entity can do and what it reports.
 *
 * State and commands are described by capabilities rather than by free-form attributes, and the
 * set is aligned with Matter clusters because Matter is the protocol the model has to represent
 * most faithfully - every other protocol maps onto it rather than the other way round.
 *
 * Each capability declares three schemas:
 *
 * - **state**, the values it reports, stored in `registry.entity_states.state`;
 * - **params**, the device's own limits, stored in `registry.entity_capabilities.params`, which
 *   let `core` reject an impossible command without a round trip to the device;
 * - **commands**, what may be sent to it, or `null` when the capability is read-only.
 *
 * Static metadata that never changes - unit, device class, display precision - lives on
 * `registry.entities` and deliberately not in state, so it is not repeated on every report of a
 * sensor that publishes twice a second.
 *
 * Defined in ARCHITECTURE.md 5.3. The names below mirror the `entity_capabilities_known` CHECK
 * constraint in DATABASE.md exactly; adding one is a migration plus a contracts release.
 */
import { z } from 'zod';

/** Every capability an entity may declare. */
export const CAPABILITIES = [
  'on_off',
  'level',
  'color_hs',
  'color_temp',
  'cover',
  'lock',
  'thermostat',
  'sensor_numeric',
  'sensor_binary',
  'sensor_text',
  'media_player',
  'camera',
  'button',
  'update',
  'lawn_mower',
  'select',
  'number',
] as const;

/** The name of a single capability. */
export type CapabilityName = (typeof CAPABILITIES)[number];

/** Validates a capability name. */
export const capabilityNameSchema = z.enum(CAPABILITIES);

/**
 * How long a device may take to reach a commanded value.
 *
 * Bounded at ten minutes: a longer transition is a scene or an automation, not a command, and an
 * unbounded value would hold a command slot open indefinitely.
 */
const transitionMsSchema = z.int().min(0).max(600_000).optional();

/** Capabilities that report only, and accept no commands at all. */
const NO_COMMANDS = null;

// --- on_off ------------------------------------------------------------------------------

/** Whether the entity is on. */
export const onOffStateSchema = z.object({ isOn: z.boolean() });

/** `on_off` has no device-specific limits. */
export const onOffParamsSchema = z.object({});

/** Turning an entity on, off, or to the opposite of what it is now. */
export const onOffCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('turn_on') }),
  z.object({ command: z.literal('turn_off') }),
  z.object({ command: z.literal('toggle') }),
]);

// --- level -------------------------------------------------------------------------------

/**
 * Brightness or position as a percentage.
 *
 * Normalised to 0-100 for every device. A lamp reporting 0-254 is converted by its adapter, so
 * that an automation written for one lamp works on another.
 */
export const levelStateSchema = z.object({ level: z.number().min(0).max(100) });

/** Whether the device can fade rather than jump to a new level. */
export const levelParamsSchema = z.object({ hasTransition: z.boolean().default(false) });

/** Setting the level, optionally over time. */
export const levelCommandSchema = z.discriminatedUnion('command', [
  z.object({
    command: z.literal('set_level'),
    level: z.number().min(0).max(100),
    transitionMs: transitionMsSchema,
  }),
]);

// --- color_hs ----------------------------------------------------------------------------

/** Colour as hue and saturation. */
export const colorHsStateSchema = z.object({
  hue: z.number().min(0).max(360),
  saturation: z.number().min(0).max(100),
});

/** `color_hs` has no device-specific limits: every hue and saturation is representable. */
export const colorHsParamsSchema = z.object({});

/** Setting the colour, optionally over time. */
export const colorHsCommandSchema = z.discriminatedUnion('command', [
  z.object({
    command: z.literal('set_color'),
    hue: z.number().min(0).max(360),
    saturation: z.number().min(0).max(100),
    transitionMs: transitionMsSchema,
  }),
]);

// --- color_temp --------------------------------------------------------------------------

/** Colour temperature in mireds, the reciprocal scale Matter and Zigbee both use. */
export const colorTempStateSchema = z.object({ mireds: z.int().min(1).max(1000) });

/**
 * The mired range this particular lamp supports.
 *
 * Required rather than optional: a lamp that does not report its range cannot be commanded
 * safely, and guessing a default would send warm-white lamps to a temperature they cannot reach.
 */
export const colorTempParamsSchema = z
  .object({
    minMireds: z.int().min(1).max(1000),
    maxMireds: z.int().min(1).max(1000),
  })
  .refine((params) => params.minMireds <= params.maxMireds, {
    message: 'minMireds must not exceed maxMireds',
  });

/** Setting the colour temperature, optionally over time. */
export const colorTempCommandSchema = z.discriminatedUnion('command', [
  z.object({
    command: z.literal('set_color_temp'),
    mireds: z.int().min(1).max(1000),
    transitionMs: transitionMsSchema,
  }),
]);

// --- cover -------------------------------------------------------------------------------

/** How far a cover is open, how it is tilted, and whether it is moving. */
export const coverStateSchema = z.object({
  position: z.number().min(0).max(100),
  tilt: z.number().min(0).max(100).optional(),
  motion: z.enum(['opening', 'closing', 'stopped']),
});

/** Which of position and tilt this cover can actually be commanded to. */
export const coverParamsSchema = z.object({
  hasPosition: z.boolean().default(true),
  hasTilt: z.boolean().default(false),
});

/** Moving a cover, or stopping one mid-travel. */
export const coverCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('open') }),
  z.object({ command: z.literal('close') }),
  z.object({ command: z.literal('stop') }),
  z.object({ command: z.literal('set_position'), position: z.number().min(0).max(100) }),
  z.object({ command: z.literal('set_tilt'), tilt: z.number().min(0).max(100) }),
]);

// --- lock --------------------------------------------------------------------------------

/**
 * The bolt position.
 *
 * `jammed` is a first-class state rather than an error: a lock that failed to throw is a fact
 * about the house that the interface has to show, not a transient failure to retry.
 */
export const lockStateSchema = z.object({ lockState: z.enum(['locked', 'unlocked', 'jammed']) });

/** Whether the lock requires a code to be operated remotely. */
export const lockParamsSchema = z.object({ hasCode: z.boolean().default(false) });

/** Operating the bolt. */
export const lockCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('lock'), code: z.string().min(1).max(64).optional() }),
  z.object({ command: z.literal('unlock'), code: z.string().min(1).max(64).optional() }),
]);

// --- thermostat --------------------------------------------------------------------------

/** The operating modes a thermostat may be set to. */
export const THERMOSTAT_MODES = ['off', 'heat', 'cool', 'auto', 'fan_only', 'dry'] as const;

/** What a thermostat is currently doing, which is not the same as the mode it is set to. */
export const THERMOSTAT_ACTIONS = ['off', 'idle', 'heating', 'cooling', 'drying', 'fan'] as const;

/**
 * Measured and target temperature, the mode it is set to, and what it is doing.
 *
 * `mode` and `action` are distinct: a thermostat set to `auto` that has reached its target is
 * `idle`, and an interface showing only the mode could not explain why nothing is running.
 */
export const thermostatStateSchema = z.object({
  currentTemperature: z.number(),
  targetTemperature: z.number(),
  mode: z.enum(THERMOSTAT_MODES),
  action: z.enum(THERMOSTAT_ACTIONS),
  humidity: z.number().min(0).max(100).optional(),
});

/** The modes and the range this particular thermostat accepts. */
export const thermostatParamsSchema = z
  .object({
    supportedModes: z.array(z.enum(THERMOSTAT_MODES)).min(1),
    minTemperature: z.number(),
    maxTemperature: z.number(),
    temperatureStep: z.number().gt(0).default(0.5),
  })
  .refine((params) => params.minTemperature <= params.maxTemperature, {
    message: 'minTemperature must not exceed maxTemperature',
  });

/** Setting the target temperature or the mode. */
export const thermostatCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('set_target'), temperature: z.number() }),
  z.object({ command: z.literal('set_mode'), mode: z.enum(THERMOSTAT_MODES) }),
]);

// --- sensor_numeric ----------------------------------------------------------------------

/**
 * A single numeric reading.
 *
 * Only the value. Unit, device class and display precision are columns on `registry.entities`
 * because they are properties of the sensor rather than of the reading, and repeating them on
 * every report of a power meter that publishes each second would cost the highest-volume path
 * in the system for nothing.
 */
export const sensorNumericStateSchema = z.object({ value: z.number() });

/** `sensor_numeric` has no commandable limits; its metadata lives on the entity row. */
export const sensorNumericParamsSchema = z.object({});

// --- sensor_binary -----------------------------------------------------------------------

/** A single on/off reading, such as motion detected or a door open. */
export const sensorBinaryStateSchema = z.object({ isOn: z.boolean() });

/** `sensor_binary` has no commandable limits; its device class lives on the entity row. */
export const sensorBinaryParamsSchema = z.object({});

// --- sensor_text -------------------------------------------------------------------------

/**
 * A single text reading.
 *
 * Bounded at 512 characters so a calculated alias formula cannot fill history with an unbounded
 * string. Physical adapters that need longer text belong in attributes, not here.
 */
export const sensorTextStateSchema = z.object({ value: z.string().max(512) });

/** `sensor_text` has no commandable limits; its metadata lives on the entity row. */
export const sensorTextParamsSchema = z.object({});

// --- media_player ------------------------------------------------------------------------

/** What a player is doing right now. */
export const PLAYBACK_STATES = ['playing', 'paused', 'stopped', 'idle', 'buffering'] as const;

/** Playback position, volume, input and what is playing. */
export const mediaPlayerStateSchema = z.object({
  playback: z.enum(PLAYBACK_STATES),
  volume: z.number().min(0).max(100),
  isMuted: z.boolean(),
  source: z.string().max(128).optional(),
  mediaTitle: z.string().max(512).optional(),
  mediaArtist: z.string().max(512).optional(),
  mediaDurationSeconds: z.number().min(0).optional(),
  mediaPositionSeconds: z.number().min(0).optional(),
});

/** The inputs this player exposes and which transport controls it honours. */
export const mediaPlayerParamsSchema = z.object({
  supportedSources: z.array(z.string().max(128)).default([]),
  hasSeek: z.boolean().default(false),
  hasVolume: z.boolean().default(true),
});

/** Transport and volume control. */
export const mediaPlayerCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('play') }),
  z.object({ command: z.literal('pause') }),
  z.object({ command: z.literal('stop') }),
  z.object({ command: z.literal('next') }),
  z.object({ command: z.literal('previous') }),
  z.object({ command: z.literal('seek'), positionSeconds: z.number().min(0) }),
  z.object({ command: z.literal('set_volume'), volume: z.number().min(0).max(100) }),
  z.object({ command: z.literal('set_mute'), isMuted: z.boolean() }),
  z.object({ command: z.literal('set_source'), source: z.string().min(1).max(128) }),
]);

// --- camera ------------------------------------------------------------------------------

/**
 * Whether a stream is currently available, and where the last snapshot can be fetched.
 *
 * A path rather than an absolute URL: the caller reaching the camera may be on the LAN, behind
 * the proxy, or on another host, and only the caller knows which origin applies.
 */
export const cameraStateSchema = z.object({
  isStreamAvailable: z.boolean(),
  snapshotPath: z.string().max(1024).optional(),
  isRecording: z.boolean().default(false),
});

/** What this camera can produce. */
export const cameraParamsSchema = z.object({
  hasSnapshot: z.boolean().default(true),
  hasStream: z.boolean().default(true),
  hasRecording: z.boolean().default(false),
});

/** Taking a still, or recording a clip of bounded length. */
export const cameraCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('snapshot') }),
  z.object({ command: z.literal('record'), durationSeconds: z.int().min(1).max(3600) }),
]);

// --- button ------------------------------------------------------------------------------

/**
 * A button holds no state: pressing it is the whole of what it does.
 *
 * An empty object rather than a timestamp of the last press, because only the device knows when
 * it was pressed and a device that restarts to install firmware does not say. What a press
 * causes - the firmware sensor going back to up to date, a device going offline and coming back -
 * is recorded as the state changes it is.
 */
export const buttonStateSchema = z.object({});

/** `button` has no device-specific limits. */
export const buttonParamsSchema = z.object({});

/** Pressing the button. */
export const buttonCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('press') }),
]);

// --- update ------------------------------------------------------------------------------

/**
 * A device's firmware: what it runs, what it could run, and whether it is installing it now.
 *
 * One entity for the whole of it, as Home Assistant has, rather than a sensor saying an update
 * is there and a button installing it: the installing belongs to the same state as the offer,
 * and an automation that installs whatever is offered must be able to see that an install is
 * already under way - a device fetching its firmware still offers it until it reboots, and
 * asked again it may start over.
 *
 * `latestVersion` is null when nothing newer is on offer, and a version the device does not run
 * when something is. `progress` is a percentage, while installing, for a device that says.
 */
export const updateStateSchema = z.object({
  installedVersion: z.string().min(1).max(64).nullable().default(null),
  latestVersion: z.string().min(1).max(64).nullable().default(null),
  isInstalling: z.boolean().default(false),
  progress: z.number().min(0).max(100).nullable().default(null),
});

/** Whether the firmware can be installed from here, and whether its progress is reported. */
export const updateParamsSchema = z.object({
  canInstall: z.boolean().default(true),
  hasProgress: z.boolean().default(false),
});

/** Installing what is on offer. */
export const updateCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('install') }),
]);

/**
 * Whether a firmware state offers something the device does not run yet.
 *
 * @param state - The state.
 * @returns True when an update is on offer.
 */
export function isUpdateOffered(state: z.output<typeof updateStateSchema>): boolean {
  return state.latestVersion !== null && state.latestVersion !== state.installedVersion;
}

// --- lawn_mower --------------------------------------------------------------------------

/**
 * What a robot mower is doing: out mowing, paused in the middle of a job, on its way back to
 * its station, sitting in it, standing idle out of it, or stopped by a fault it cannot clear on
 * its own. Home Assistant's lawn mower activities, and `idle` beside them, which a mower that
 * ended a job away from its station reports.
 */
export const LAWN_MOWER_ACTIVITIES = [
  'mowing',
  'paused',
  'returning',
  'docked',
  'idle',
  'error',
] as const;

/** What a robot mower is doing. */
export type LawnMowerActivity = (typeof LAWN_MOWER_ACTIVITIES)[number];

/** A robot mower's activity. */
export const lawnMowerStateSchema = z.object({ activity: z.enum(LAWN_MOWER_ACTIVITIES) });

/** Which of the commands this mower takes. */
export const lawnMowerParamsSchema = z.object({
  canPause: z.boolean().default(true),
  canStop: z.boolean().default(true),
  canDock: z.boolean().default(true),
});

/**
 * Starting - or resuming a paused job - pausing, ending the job where it stands, and sending the
 * mower back to its station.
 */
export const lawnMowerCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('start') }),
  z.object({ command: z.literal('pause') }),
  z.object({ command: z.literal('stop') }),
  z.object({ command: z.literal('dock') }),
]);

// --- select ------------------------------------------------------------------------------

/** One choice of a select: what the device calls it, and what a person reads. */
export const selectOptionSchema = z.object({
  value: z.string().min(1).max(64),
  label: z.string().min(1).max(64),
});

/** One choice of a select. */
export type SelectOption = z.output<typeof selectOptionSchema>;

/**
 * One setting picked from a fixed list: a mower's cutting pattern, a vacuum's suction. The
 * value is null until the device says, and may be one the list does not have when the device
 * was set to it elsewhere - it is shown as it is rather than hidden.
 */
export const selectStateSchema = z.object({
  option: z.string().min(1).max(64).nullable().default(null),
});

/** The choices, in the order they are offered. */
export const selectParamsSchema = z
  .object({ options: z.array(selectOptionSchema).min(1).max(64) })
  .refine(
    (params) =>
      new Set(params.options.map((option) => option.value)).size === params.options.length,
    { message: 'Each option must be offered once', path: ['options'] },
  );

/** Picking one of the choices. */
export const selectCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('select_option'), option: z.string().min(1).max(64) }),
]);

// --- number ------------------------------------------------------------------------------

/**
 * One setting that is a number within limits: a delay after rain in minutes, the angle a mower
 * cuts at. Null until the device says. What the number measures is the unit on the entity row,
 * as a sensor's is.
 */
export const numberStateSchema = z.object({ value: z.number().nullable().default(null) });

/** How low and how high the setting goes, and in what steps. */
export const numberParamsSchema = z
  .object({
    min: z.number(),
    max: z.number(),
    step: z.number().positive().default(1),
  })
  .refine((params) => params.min < params.max, {
    message: 'min must be below max',
    path: ['max'],
  });

/** Setting the number. */
export const numberCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('set_value'), value: z.number() }),
]);

// --- the capability table ----------------------------------------------------------------

/** The three schemas that together define one capability. */
export type CapabilityDefinition = {
  /** What the entity reports for this capability. */
  readonly state: z.ZodType;

  /** The device's own limits, validated before a command is dispatched. */
  readonly params: z.ZodType;

  /** What may be commanded, or `null` when the capability reports only. */
  readonly commands: z.ZodType | null;
};

/**
 * Every capability, with its state, params and command schemas.
 *
 * This table is what `core` consults to reject a command targeting a capability an entity does
 * not have, and what an adapter declares against when it registers an entity.
 */
export const CAPABILITY_DEFINITIONS = {
  on_off: { state: onOffStateSchema, params: onOffParamsSchema, commands: onOffCommandSchema },
  level: { state: levelStateSchema, params: levelParamsSchema, commands: levelCommandSchema },
  color_hs: {
    state: colorHsStateSchema,
    params: colorHsParamsSchema,
    commands: colorHsCommandSchema,
  },
  color_temp: {
    state: colorTempStateSchema,
    params: colorTempParamsSchema,
    commands: colorTempCommandSchema,
  },
  cover: { state: coverStateSchema, params: coverParamsSchema, commands: coverCommandSchema },
  lock: { state: lockStateSchema, params: lockParamsSchema, commands: lockCommandSchema },
  thermostat: {
    state: thermostatStateSchema,
    params: thermostatParamsSchema,
    commands: thermostatCommandSchema,
  },
  sensor_numeric: {
    state: sensorNumericStateSchema,
    params: sensorNumericParamsSchema,
    commands: NO_COMMANDS,
  },
  sensor_binary: {
    state: sensorBinaryStateSchema,
    params: sensorBinaryParamsSchema,
    commands: NO_COMMANDS,
  },
  sensor_text: {
    state: sensorTextStateSchema,
    params: sensorTextParamsSchema,
    commands: NO_COMMANDS,
  },
  media_player: {
    state: mediaPlayerStateSchema,
    params: mediaPlayerParamsSchema,
    commands: mediaPlayerCommandSchema,
  },
  camera: { state: cameraStateSchema, params: cameraParamsSchema, commands: cameraCommandSchema },
  button: { state: buttonStateSchema, params: buttonParamsSchema, commands: buttonCommandSchema },
  update: { state: updateStateSchema, params: updateParamsSchema, commands: updateCommandSchema },
  lawn_mower: {
    state: lawnMowerStateSchema,
    params: lawnMowerParamsSchema,
    commands: lawnMowerCommandSchema,
  },
  select: { state: selectStateSchema, params: selectParamsSchema, commands: selectCommandSchema },
  number: { state: numberStateSchema, params: numberParamsSchema, commands: numberCommandSchema },
} as const satisfies Record<CapabilityName, CapabilityDefinition>;

/**
 * The composite state of an entity: one entry per capability it declares.
 *
 * An entity is rarely one capability. A dimmable colour bulb is `on_off` plus `level` plus
 * `color_hs`, and its state carries all three, which is why this is a partial record rather
 * than a discriminated union - a union could only ever describe one of them at a time.
 */
export const capabilityStateSchema = z.object({
  on_off: onOffStateSchema.optional(),
  level: levelStateSchema.optional(),
  color_hs: colorHsStateSchema.optional(),
  color_temp: colorTempStateSchema.optional(),
  cover: coverStateSchema.optional(),
  lock: lockStateSchema.optional(),
  thermostat: thermostatStateSchema.optional(),
  sensor_numeric: sensorNumericStateSchema.optional(),
  sensor_binary: sensorBinaryStateSchema.optional(),
  sensor_text: sensorTextStateSchema.optional(),
  media_player: mediaPlayerStateSchema.optional(),
  camera: cameraStateSchema.optional(),
  button: buttonStateSchema.optional(),
  update: updateStateSchema.optional(),
  lawn_mower: lawnMowerStateSchema.optional(),
  select: selectStateSchema.optional(),
  number: numberStateSchema.optional(),
});

/** The composite state of an entity, keyed by capability. */
export type CapabilityState = z.output<typeof capabilityStateSchema>;

/**
 * Returns the command schema for a capability.
 *
 * @param capability - The capability being commanded.
 * @returns Its command schema, or `null` when the capability reports only. A `null` result is
 * the answer to "may this be commanded at all?", so callers must handle it rather than assume
 * every capability is writable.
 */
export function commandSchemaFor(capability: CapabilityName): z.ZodType | null {
  return CAPABILITY_DEFINITIONS[capability].commands;
}
