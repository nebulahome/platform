/**
 * Turning a scene member's target state into the entity commands that produce it, and picking
 * what a rollback puts back.
 *
 * Pure, and shared: `core`'s scene engine sends these commands, and anything that wants to say
 * what applying a scene would do can ask the same functions. One mapper, so that a scene means
 * the same thing wherever it is applied from.
 */
import {
  capabilityStateSchema,
  type CapabilityName,
  type CapabilityState,
} from './capabilities.js';
import type { JsonObject } from './json.js';

/**
 * Capabilities whose commands accept a fade.
 *
 * Whether a particular device can fade is its `hasTransition` param, which this mapper does not
 * see: `core` drops the transition from a command to a device that cannot, so a scene can ask
 * for one on every member and each gets what it can do.
 */
export const TRANSITION_CAPABILITIES: ReadonlySet<CapabilityName> = new Set<CapabilityName>([
  'on_off',
  'level',
  'color_hs',
  'color_temp',
]);

/** One command produced from a target state. */
export type SceneTargetCommand = {
  readonly capability: CapabilityName;
  readonly command: JsonObject;
};

/**
 * Turns a scene member's target state into the commands that produce it.
 *
 * Only writable fields become commands: cover motion, thermostat readings, media titles and
 * positions are ignored. `transitionMs` is attached only when it is positive and the capability
 * accepts a fade. A light that is to be off is only switched off - a level or a colour sent
 * after the switch would turn most lamps straight back on - and one that is to be on is switched
 * on first. A thermostat that is to be off is only set to off.
 *
 * @param targetState - What the entity should become.
 * @param transitionMs - How long fades may take.
 * @returns One command per writable field, in the order they are to be sent.
 */
export function commandsForTargetState(
  targetState: CapabilityState,
  transitionMs: number,
): SceneTargetCommand[] {
  const commands: SceneTargetCommand[] = [];
  const isSwitchedOff = targetState.on_off?.isOn === false;

  if (targetState.on_off !== undefined) {
    commands.push({
      capability: 'on_off',
      command: withTransition(
        'on_off',
        { command: targetState.on_off.isOn ? 'turn_on' : 'turn_off' },
        transitionMs,
      ),
    });
  }

  if (targetState.level !== undefined && !isSwitchedOff) {
    commands.push({
      capability: 'level',
      command: withTransition(
        'level',
        { command: 'set_level', level: targetState.level.level },
        transitionMs,
      ),
    });
  }

  if (targetState.color_hs !== undefined && !isSwitchedOff) {
    commands.push({
      capability: 'color_hs',
      command: withTransition(
        'color_hs',
        {
          command: 'set_color',
          hue: targetState.color_hs.hue,
          saturation: targetState.color_hs.saturation,
        },
        transitionMs,
      ),
    });
  }

  if (targetState.color_temp !== undefined && !isSwitchedOff) {
    commands.push({
      capability: 'color_temp',
      command: withTransition(
        'color_temp',
        { command: 'set_color_temp', mireds: targetState.color_temp.mireds },
        transitionMs,
      ),
    });
  }

  if (targetState.cover !== undefined) {
    commands.push({
      capability: 'cover',
      command: { command: 'set_position', position: targetState.cover.position },
    });

    if (targetState.cover.tilt !== undefined) {
      commands.push({
        capability: 'cover',
        command: { command: 'set_tilt', tilt: targetState.cover.tilt },
      });
    }
  }

  if (targetState.lock?.lockState === 'locked') {
    commands.push({ capability: 'lock', command: { command: 'lock' } });
  } else if (targetState.lock?.lockState === 'unlocked') {
    commands.push({ capability: 'lock', command: { command: 'unlock' } });
  }

  if (targetState.thermostat !== undefined) {
    commands.push({
      capability: 'thermostat',
      command: { command: 'set_mode', mode: targetState.thermostat.mode },
    });

    if (targetState.thermostat.mode !== 'off') {
      commands.push({
        capability: 'thermostat',
        command: { command: 'set_target', temperature: targetState.thermostat.targetTemperature },
      });
    }
  }

  if (targetState.media_player !== undefined) {
    commands.push(...mediaCommands(targetState.media_player));
  }

  return commands;
}

/**
 * The commands that put a player where a target state says.
 *
 * @param media - The player's target.
 * @returns Transport first, then volume, mute and source.
 */
function mediaCommands(media: NonNullable<CapabilityState['media_player']>): SceneTargetCommand[] {
  const commands: SceneTargetCommand[] = [];

  if (media.playback === 'playing' || media.playback === 'paused' || media.playback === 'stopped') {
    const transport = { playing: 'play', paused: 'pause', stopped: 'stop' }[media.playback];

    commands.push({ capability: 'media_player', command: { command: transport } });
  }

  commands.push(
    { capability: 'media_player', command: { command: 'set_volume', volume: media.volume } },
    { capability: 'media_player', command: { command: 'set_mute', isMuted: media.isMuted } },
  );

  if (media.source !== undefined) {
    commands.push({
      capability: 'media_player',
      command: { command: 'set_source', source: media.source },
    });
  }

  return commands;
}

/**
 * The part of a member's earlier state the scene touched, to put back on a rollback.
 *
 * Only the capabilities the target names: a rollback restores what the scene changed, and
 * resending the rest - a volume, a colour nobody asked about - would be a change of its own.
 *
 * @param before - The member's state before the apply.
 * @param target - What the scene set.
 * @returns The earlier state of those capabilities; empty when there is none to restore.
 */
export function restoreStateFor(before: CapabilityState, target: CapabilityState): CapabilityState {
  const restore: Record<string, unknown> = {};

  for (const key of Object.keys(target)) {
    const earlier: unknown = before[key as keyof CapabilityState];

    if (earlier !== undefined) {
      restore[key] = earlier;
    }
  }

  const parsed = capabilityStateSchema.safeParse(restore);

  return parsed.success ? parsed.data : {};
}

/**
 * Attaches a transition when the capability accepts one and the duration is positive.
 *
 * @param capability - Which capability.
 * @param command - The command without a transition.
 * @param transitionMs - How long the fade may take.
 * @returns The command, possibly with `transitionMs`.
 */
export function withTransition(
  capability: CapabilityName,
  command: JsonObject,
  transitionMs: number,
): JsonObject {
  if (transitionMs > 0 && TRANSITION_CAPABILITIES.has(capability)) {
    return { ...command, transitionMs };
  }

  return command;
}

/**
 * The name of a command, as the audit log records it.
 *
 * @param command - The command body.
 * @returns Its `command` field.
 */
export function commandNameOf(command: JsonObject): string {
  const name = command['command'];

  return typeof name === 'string' ? name : '';
}
