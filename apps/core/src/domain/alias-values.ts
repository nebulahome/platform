/**
 * Working out an alias's parts and putting its state together, without side effects.
 *
 * What the engine (`services/alias-engine.ts`) does each time an alias is worked out, split from
 * it so it can be tested on plain values: read a part from an entity's state, combine several,
 * fit a value to its part, assemble the capability states, and say which parts a command touches
 * and what it makes of a stored state.
 */
import {
  aliasEnumValues,
  aliasScalarFromState,
  aliasValueProblem,
  CAPABILITY_DEFINITIONS,
  ValidationError,
  type AliasPartConfig,
  type AliasPartDef,
  type AliasParts,
  type AliasRule,
  type CapabilityName,
  type CapabilityState,
  type JsonObject,
} from '@nebulahome/contracts';

/** A part's value while it is worked out. */
export type PartValue =
  | number
  | boolean
  | string
  | null
  | { readonly hue: number; readonly saturation: number }
  | readonly unknown[]
  | JsonObject;

/**
 * A camel-case field in snake case, and back: formulas name fields the way the file does.
 *
 * @param snake - A field in snake case (`current_temperature`).
 * @returns It in camel case (`currentTemperature`).
 */
export function camelCase(snake: string): string {
  return snake.replace(/_([a-z0-9])/gu, (match: string) => match.slice(1).toUpperCase());
}

/**
 * One state field of an entity, by its name in snake case, whatever capability holds it.
 *
 * @param state - The entity's capability states.
 * @param field - The field, in snake case.
 * @returns Its value, or undefined when no capability has it.
 */
export function stateField(state: CapabilityState | undefined, field: string): unknown {
  if (state === undefined) {
    return undefined;
  }

  const name = camelCase(field);

  for (const value of Object.values(state) as unknown[]) {
    if (typeof value === 'object' && value !== null && name in value) {
      return (value as Record<string, unknown>)[name];
    }
  }

  return undefined;
}

/**
 * What a part reads from one entity: the same field when the entity has the part's capability, or
 * its one reading (a sensor's value) when the part's kind can take it.
 *
 * @param def - The part.
 * @param state - The entity's capability states.
 * @returns The value, or undefined when the entity says nothing that fits.
 */
export function readPart(
  def: AliasPartDef,
  state: CapabilityState | undefined,
): PartValue | undefined {
  if (state === undefined) {
    return undefined;
  }

  const own = (state as Record<string, unknown>)[def.capability] as
    Record<string, unknown> | undefined;

  if (own !== undefined) {
    if (def.kind === 'color') {
      return typeof own['hue'] === 'number' && typeof own['saturation'] === 'number'
        ? { hue: own['hue'], saturation: own['saturation'] }
        : undefined;
    }

    if (def.kind === 'picture' && def.fields.length === 0) {
      return own as JsonObject;
    }

    if (def.fields.length === 0) {
      return null;
    }

    const value = own[def.fields[0] ?? ''];

    return value === undefined ? undefined : (value as PartValue);
  }

  // Another kind of entity: its one reading, when it is what the part takes.
  const scalar = aliasScalarFromState(state);

  switch (def.kind) {
    case 'number':
      return typeof scalar === 'number' ? scalar : undefined;
    case 'boolean':
      return typeof scalar === 'boolean' ? scalar : undefined;
    case 'text':
      return scalar === undefined ? undefined : String(scalar);
    case 'enum':
      return typeof scalar === 'string' ? scalar : undefined;
    default:
      return undefined;
  }
}

/**
 * Several entities' values made one by a rule.
 *
 * @param rule - How.
 * @param values - The values that are there (missing ones already left out).
 * @returns The value, or undefined when there is none to make it from.
 */
export function combine(rule: AliasRule, values: readonly PartValue[]): PartValue | undefined {
  if (values.length === 0) {
    return undefined;
  }

  const numbers = values.filter((value): value is number => typeof value === 'number');
  const booleans = values.filter((value): value is boolean => typeof value === 'boolean');

  switch (rule) {
    case 'any':
      return booleans.some(Boolean);
    case 'all':
      return booleans.length > 0 && booleans.every(Boolean);
    case 'average':
      return numbers.length === 0 ? undefined : numbers.reduce((a, b) => a + b, 0) / numbers.length;
    case 'min':
      return numbers.length === 0 ? undefined : Math.min(...numbers);
    case 'max':
      return numbers.length === 0 ? undefined : Math.max(...numbers);
    case 'sum':
      return numbers.length === 0 ? undefined : numbers.reduce((a, b) => a + b, 0);
    case 'first':
      return values[0];
  }
}

/**
 * Fits a value worked out by a formula or code to its part: a number for a number, one of the
 * names for an enum, a text cut to 512 characters.
 *
 * @param def - The part.
 * @param config - Its configuration.
 * @param value - What was worked out.
 * @returns The value as the part holds it.
 * @throws {ValidationError} When it cannot be the part's value, saying why.
 */
export function fitPart(def: AliasPartDef, config: AliasPartConfig, value: unknown): PartValue {
  if (
    def.kind === 'text' &&
    (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
  ) {
    return String(value).slice(0, 512);
  }

  if (def.kind === 'number' && typeof value === 'number' && !Number.isFinite(value)) {
    throw new ValidationError(`${def.label} worked out to a number that is not one`);
  }

  const problem = aliasValueProblem(def, config, value);

  if (problem !== null) {
    throw new ValidationError(problem);
  }

  return value as PartValue;
}

/**
 * Puts an alias's state together from its parts' values.
 *
 * Every capability it declares gets the fields of its parts; a colour and a colour temperature
 * say which of the two the lamp shows by `active`. The result is checked against each
 * capability's state schema, so what is written is a state any card can draw.
 *
 * @param capabilities - The capabilities it declares.
 * @param defs - Its type's parts.
 * @param parts - The parts it has.
 * @param values - Each part's value, by key; a part with none is left out.
 * @param active - For a lamp with both, which one it shows.
 * @returns The state.
 * @throws {ValidationError} When a capability's state does not come out whole, naming it.
 */
export function assembleState(
  capabilities: readonly CapabilityName[],
  defs: readonly AliasPartDef[],
  parts: AliasParts,
  values: ReadonlyMap<string, PartValue>,
  active: 'color' | 'color_temp',
): CapabilityState {
  const state: CapabilityState = {};

  for (const capability of capabilities) {
    let fields: Record<string, unknown> = {};

    for (const def of defs) {
      if (def.capability !== capability || parts[def.key] === undefined) {
        continue;
      }

      const value = values.get(def.key);

      if (value === undefined) {
        continue;
      }

      if (def.kind === 'color' && typeof value === 'object' && value !== null && 'hue' in value) {
        fields = { ...fields, hue: value.hue, saturation: value.saturation };
      } else if (def.kind === 'picture' && def.fields.length === 0) {
        fields = { ...fields, ...(value as JsonObject) };
      } else if (def.kind !== 'press' && def.fields[0] !== undefined) {
        fields[def.fields[0]] = value;
      }
    }

    if (capability === 'color_hs' && capabilities.includes('color_temp')) {
      fields['isActive'] = active === 'color';
    }

    if (capability === 'color_temp' && capabilities.includes('color_hs')) {
      fields['isActive'] = active === 'color_temp';
    }

    if (capability === 'custom') {
      fields = { values: fields };
    }

    const parsed = CAPABILITY_DEFINITIONS[capability].state.safeParse(fields);

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ValidationError(
        `The ${capability.replace('_', ' ')} is not whole: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim(),
      );
    }

    (state as Record<string, unknown>)[capability] = parsed.data;
  }

  return state;
}

// The parts a command touches are worked out in contracts, where the editor and the API read them.
export { partsTouchedBy } from '@nebulahome/contracts';

/**
 * What a command makes of a stored state, capability by capability.
 *
 * @param previous - The alias's state now.
 * @param capability - Which capability was commanded.
 * @param command - The validated command.
 * @returns The state after it.
 */
export function applyCapabilityCommand(
  previous: CapabilityState,
  capability: CapabilityName,
  command: JsonObject,
): CapabilityState {
  const next: CapabilityState = { ...previous };
  const name = command['command'];
  const current =
    (previous as Record<string, Record<string, unknown> | undefined>)[capability] ?? {};

  /**
   * Sets fields of the commanded capability.
   *
   * @param fields - The fields to change.
   */
  const set = (fields: Record<string, unknown>): void => {
    (next as Record<string, unknown>)[capability] = { ...current, ...fields };
  };
  /**
   * A number the command carries.
   *
   * @param key - Its field.
   * @returns The number.
   */
  const number = (key: string): number => Number(command[key]);

  switch (capability) {
    case 'on_off':
      set({
        isOn: name === 'turn_on' ? true : name === 'turn_off' ? false : current['isOn'] !== true,
      });
      break;
    case 'level':
      set({ level: number('level') });
      break;
    case 'color_hs':
      set(
        name === 'set_white'
          ? { white: number('white') }
          : { hue: number('hue'), saturation: number('saturation') },
      );
      break;
    case 'color_temp':
      set({ mireds: number('mireds') });
      break;
    case 'effect':
      set({ effect: command['effect'] ?? null });
      break;
    case 'cover':
      set(
        name === 'open'
          ? { position: 100, motion: 'stopped' }
          : name === 'close'
            ? { position: 0, motion: 'stopped' }
            : name === 'set_position'
              ? { position: number('position'), motion: 'stopped' }
              : name === 'set_tilt'
                ? { tilt: number('tilt') }
                : { motion: 'stopped' },
      );
      break;
    case 'lock':
      set(
        name === 'lock'
          ? { lockState: 'locked', isOpen: false }
          : name === 'open'
            ? { lockState: 'unlocked', isOpen: true }
            : { lockState: 'unlocked' },
      );
      break;
    case 'thermostat':
      set(
        name === 'set_target'
          ? { targetTemperature: number('temperature') }
          : name === 'set_target_range'
            ? { targetTemperatureLow: number('low'), targetTemperatureHigh: number('high') }
            : name === 'set_humidity'
              ? { targetHumidity: number('humidity') }
              : name === 'set_mode'
                ? { mode: command['mode'] }
                : name === 'set_preset'
                  ? { preset: command['preset'] ?? null }
                  : name === 'set_fan_mode'
                    ? { fanMode: command['fanMode'] }
                    : name === 'set_swing'
                      ? { swingMode: command['swingMode'] }
                      : { swingHorizontalMode: command['swingMode'] },
      );
      break;
    case 'media_player': {
      const volume = typeof current['volume'] === 'number' ? current['volume'] : 0;
      const changes: Record<string, Record<string, unknown>> = {
        play: { playback: 'playing' },
        pause: { playback: 'paused' },
        stop: { playback: 'stopped' },
        seek: { mediaPositionSeconds: number('positionSeconds') },
        set_volume: { volume: number('volume') },
        volume_up: { volume: Math.min(100, volume + 5) },
        volume_down: { volume: Math.max(0, volume - 5) },
        set_mute: { isMuted: command['isMuted'] === true },
        set_source: { source: command['source'] },
        set_sound_mode: { soundMode: command['soundMode'] },
        set_shuffle: { isShuffled: command['isShuffled'] === true },
        set_repeat: { repeat: command['repeat'] },
      };
      set(typeof name === 'string' ? (changes[name] ?? {}) : {});
      break;
    }
    case 'camera':
      set(name === 'set_motion_detection' ? { isMotionDetectionOn: command['isOn'] === true } : {});
      break;
    case 'lawn_mower':
    case 'vacuum': {
      const working = capability === 'vacuum' ? 'cleaning' : 'mowing';
      const changes: Record<string, Record<string, unknown>> = {
        start: { activity: working },
        pause: { activity: 'paused', isResumable: true },
        stop: { activity: 'idle' },
        dock: { activity: 'docked' },
        resume: { activity: working, isResumable: false },
        clean_rooms: { activity: working },
        clean_spot: { activity: working },
        set_fan_speed: { fanSpeed: command['fanSpeed'] },
        set_clean_mode: { cleanMode: command['cleanMode'] },
        set_water_level: { waterLevel: command['waterLevel'] },
      };
      set(typeof name === 'string' ? (changes[name] ?? {}) : {});
      break;
    }
    case 'select':
      set({ option: command['option'] });
      break;
    case 'number':
      set({ value: number('value') });
      break;
    case 'fan':
      set(
        name === 'set_percentage'
          ? { percentage: number('percentage') }
          : name === 'set_preset'
            ? { preset: command['preset'] }
            : name === 'set_oscillating'
              ? { isOscillating: command['isOscillating'] === true }
              : { direction: command['direction'] },
      );
      break;
    default:
      // A press, an install, a custom command: nothing a stored state holds.
      break;
  }

  return next;
}

/**
 * A part's value in a state, as the parts hold it.
 *
 * @param def - The part.
 * @param state - The alias's state.
 * @returns Its value, or undefined when the state does not have it.
 */
export function partValueIn(
  def: AliasPartDef,
  state: CapabilityState | undefined,
): PartValue | undefined {
  return readPart(def, state);
}

/**
 * The names an enum part's command may set, to refuse one it does not offer.
 *
 * @param def - The part.
 * @param config - Its configuration.
 * @returns The names, or undefined when any is accepted.
 */
export function offeredNames(
  def: AliasPartDef,
  config: AliasPartConfig,
): readonly string[] | undefined {
  return aliasEnumValues(def, config);
}
