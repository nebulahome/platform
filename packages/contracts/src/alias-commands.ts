/**
 * Which parts of an alias a command reaches, and so which commands a part takes.
 *
 * `core` uses it to route a command to its parts; the API and the editor use it to offer and check
 * the commands an alias's actions answer to.
 */
import type { AliasParts } from './alias-parts.js';
import type { AliasPartDef } from './alias-types.js';
import type { CapabilityName } from './capabilities.js';

/**
 * The fields each command sets, by capability: the parts a command touches are those holding
 * these fields. A command with none (a press, a skip) touches the capability's first part, which
 * stands for the whole of it.
 */
export const COMMAND_FIELDS: Readonly<
  Partial<Record<CapabilityName, Readonly<Record<string, readonly string[]>>>>
> = {
  on_off: { turn_on: ['isOn'], turn_off: ['isOn'], toggle: ['isOn'] },
  level: { set_level: ['level'] },
  color_hs: { set_color: ['hue', 'saturation'], set_white: ['white'] },
  color_temp: { set_color_temp: ['mireds'] },
  effect: { set_effect: ['effect'] },
  cover: {
    open: ['position', 'motion'],
    close: ['position', 'motion'],
    stop: ['motion'],
    set_position: ['position', 'motion'],
    set_tilt: ['tilt'],
  },
  lock: { lock: ['lockState'], unlock: ['lockState'], open: ['lockState', 'isOpen'] },
  thermostat: {
    set_target: ['targetTemperature'],
    set_target_range: ['targetTemperatureLow', 'targetTemperatureHigh'],
    set_humidity: ['targetHumidity'],
    set_mode: ['mode'],
    set_preset: ['preset'],
    set_fan_mode: ['fanMode'],
    set_swing: ['swingMode'],
    set_swing_horizontal: ['swingHorizontalMode'],
  },
  media_player: {
    play: ['playback'],
    pause: ['playback'],
    stop: ['playback'],
    next: [],
    previous: [],
    seek: ['mediaPositionSeconds'],
    set_volume: ['volume'],
    volume_up: ['volume'],
    volume_down: ['volume'],
    set_mute: ['isMuted'],
    set_source: ['source'],
    set_sound_mode: ['soundMode'],
    set_shuffle: ['isShuffled'],
    set_repeat: ['repeat'],
  },
  camera: { snapshot: [], record: [], set_motion_detection: ['isMotionDetectionOn'] },
  button: { press: [] },
  update: { install: [] },
  lawn_mower: {
    start: ['activity'],
    pause: ['activity', 'isResumable'],
    stop: ['activity'],
    dock: ['activity'],
    resume: ['activity', 'isResumable'],
  },
  vacuum: {
    start: ['activity'],
    pause: ['activity', 'isResumable'],
    stop: ['activity'],
    dock: ['activity'],
    locate: [],
    resume: ['activity', 'isResumable'],
    clean_rooms: ['activity'],
    clean_spot: ['activity'],
    set_fan_speed: ['fanSpeed'],
    set_clean_mode: ['cleanMode'],
    set_water_level: ['waterLevel'],
  },
  select: { select_option: ['option'] },
  number: { set_value: ['value'] },
  fan: {
    set_percentage: ['percentage'],
    set_preset: ['preset'],
    set_oscillating: ['isOscillating'],
    set_direction: ['direction'],
  },
};

/**
 * The parts a command touches.
 *
 * @param defs - The alias's parts.
 * @param parts - The parts it has.
 * @param capability - The capability commanded.
 * @param command - The command's name.
 * @returns The parts, by definition; for a custom command, every part it has.
 */
export function partsTouchedBy(
  defs: readonly AliasPartDef[],
  parts: AliasParts,
  capability: CapabilityName,
  command: string,
): AliasPartDef[] {
  const own = defs.filter((def) => def.capability === capability && parts[def.key] !== undefined);

  if (capability === 'custom') {
    return own;
  }

  const fields = COMMAND_FIELDS[capability]?.[command] ?? [];
  const touched = own.filter((def) => def.fields.some((field) => fields.includes(field)));

  return touched.length > 0 ? touched : own.slice(0, 1);
}

/**
 * The commands that reach a part: the ones an action of that part can answer to.
 *
 * A custom part takes its package's commands, which reach every part at once: it has none of its
 * own to answer to.
 *
 * @param defs - The alias's parts.
 * @param parts - The parts it has.
 * @param key - The part.
 * @returns The command names, in the capability's order.
 */
export function partCommands(
  defs: readonly AliasPartDef[],
  parts: AliasParts,
  key: string,
): string[] {
  const def = defs.find((candidate) => candidate.key === key);

  if (def === undefined || def.capability === 'custom' || parts[key] === undefined) {
    return [];
  }

  return Object.keys(COMMAND_FIELDS[def.capability] ?? {}).filter((command) =>
    partsTouchedBy(defs, parts, def.capability, command).some((touched) => touched.key === key),
  );
}
