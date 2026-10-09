/**
 * An entity's state as one word, which is what an automation compares.
 *
 * A state is one entry per capability - `{ on_off: { isOn: true }, level: { level: 60 } }` - and
 * a trigger that says "turns on", a condition that says "is locked" or a switch with a case for
 * "docked" each need one short token to compare against. This is that token, read from the
 * entity's primary capability: the one that says what the thing is doing rather than how much
 * of it. A light is `on` or `off`, never `60`; a cover is `open` or `closing`; a thermostat is
 * the mode it is set to.
 *
 * One function for the engine in `core` and the editor's dropdowns, so that what a person picks
 * is what the engine compares. `unavailable` is a token of its own: a device that cannot be
 * reached is in no state at all, and "from unavailable" is how an automation asks about one that
 * came back.
 */
import {
  LAWN_MOWER_ACTIVITIES,
  PLAYBACK_STATES,
  THERMOSTAT_MODES,
  VACUUM_ACTIVITIES,
  type CapabilityName,
  type CapabilityState,
} from './capabilities.js';

/** The token of an entity its adapter cannot reach. */
export const STATE_TOKEN_UNAVAILABLE = 'unavailable';

/** The two tokens of anything that is on or off. */
const ON_OFF_TOKENS = ['on', 'off'] as const;

/** The tokens of a cover: moving, or at rest open or shut. */
export const COVER_TOKENS = ['open', 'closed', 'opening', 'closing'] as const;

/** The tokens of a lock. */
export const LOCK_TOKENS = ['locked', 'unlocked', 'jammed'] as const;

/**
 * The capabilities a token is read from, in the order they are tried.
 *
 * The ones that say what a thing is doing come before the ones that say how much: a dimmable
 * light has both `on_off` and `level`, and its token is `on`.
 */
export const STATE_TOKEN_CAPABILITIES = [
  'sensor_binary',
  'on_off',
  'lock',
  'cover',
  'thermostat',
  'media_player',
  'vacuum',
  'lawn_mower',
  'select',
  'sensor_text',
  'number',
  'sensor_numeric',
  'level',
] as const satisfies readonly CapabilityName[];

/**
 * The capability an entity's token is read from.
 *
 * @param capabilities - What the entity declares.
 * @returns The first of {@link STATE_TOKEN_CAPABILITIES} it has, or null when none.
 */
export function tokenCapabilityOf(
  capabilities: readonly CapabilityName[],
): (typeof STATE_TOKEN_CAPABILITIES)[number] | null {
  return STATE_TOKEN_CAPABILITIES.find((capability) => capabilities.includes(capability)) ?? null;
}

/**
 * Formats a number the way a token holds it: no exponent, no trailing zeros.
 *
 * @param value - The number.
 * @returns Its token.
 */
function numberToken(value: number): string {
  return String(Number(value.toFixed(6)));
}

/**
 * An entity's state as one word.
 *
 * @param state - The capability state, or undefined when it never reported.
 * @param isAvailable - Whether the adapter can reach the device.
 * @returns The token, `unavailable`, or undefined when nothing usable was ever reported.
 */
export function stateTokenOf(
  state: CapabilityState | undefined,
  isAvailable = true,
): string | undefined {
  if (!isAvailable) {
    return STATE_TOKEN_UNAVAILABLE;
  }

  if (state === undefined) {
    return undefined;
  }

  if (state.sensor_binary !== undefined) {
    return state.sensor_binary.isOn ? 'on' : 'off';
  }

  if (state.on_off !== undefined) {
    return state.on_off.isOn ? 'on' : 'off';
  }

  if (state.lock !== undefined) {
    return state.lock.lockState;
  }

  if (state.cover !== undefined) {
    if (state.cover.motion === 'opening' || state.cover.motion === 'closing') {
      return state.cover.motion;
    }

    return state.cover.position === 0 ? 'closed' : 'open';
  }

  if (state.thermostat !== undefined) {
    return state.thermostat.mode;
  }

  if (state.media_player !== undefined) {
    return state.media_player.playback;
  }

  if (state.vacuum !== undefined) {
    return state.vacuum.activity;
  }

  if (state.lawn_mower !== undefined) {
    return state.lawn_mower.activity;
  }

  if (state.select !== undefined) {
    return state.select.option ?? undefined;
  }

  if (state.sensor_text !== undefined) {
    return state.sensor_text.value;
  }

  if (state.number !== undefined) {
    return state.number.value === null ? undefined : numberToken(state.number.value);
  }

  if (state.sensor_numeric !== undefined) {
    return numberToken(state.sensor_numeric.value);
  }

  if (state.level !== undefined) {
    return numberToken(state.level.level);
  }

  return undefined;
}

/**
 * An entity's reading as one number, which is what a numeric trigger or condition compares.
 *
 * Not the alias scalar: that one reads `isOn` first for a light, and "the light is above 50"
 * means its level, not whether it is on.
 *
 * @param state - The capability state, or undefined when it never reported.
 * @returns The number, or undefined when the entity has none.
 */
export function numericReadingOf(state: CapabilityState | undefined): number | undefined {
  if (state === undefined) {
    return undefined;
  }

  if (state.sensor_numeric !== undefined) {
    return state.sensor_numeric.value;
  }

  if (state.number !== undefined) {
    return state.number.value ?? undefined;
  }

  if (state.level !== undefined) {
    return state.level.level;
  }

  if (state.cover !== undefined) {
    return state.cover.position;
  }

  if (state.thermostat !== undefined) {
    return state.thermostat.currentTemperature;
  }

  if (state.media_player !== undefined) {
    return state.media_player.volume;
  }

  return undefined;
}

/**
 * The tokens an entity can be in, for a dropdown.
 *
 * Only the capabilities with a closed set of states offer any; a number or a text is typed.
 * `unavailable` closes every non-empty list, since any device can be out of reach.
 *
 * @param capabilities - What the entity declares.
 * @param selectOptions - The options of a `select`, by value, when the entity is one.
 * @returns The tokens, or an empty list when the state is open-ended.
 */
export function stateTokenChoices(
  capabilities: readonly CapabilityName[],
  selectOptions: readonly string[] = [],
): string[] {
  const capability = tokenCapabilityOf(capabilities);
  const closed = ((): readonly string[] => {
    switch (capability) {
      case 'sensor_binary':
      case 'on_off': {
        return ON_OFF_TOKENS;
      }
      case 'lock': {
        return LOCK_TOKENS;
      }
      case 'cover': {
        return COVER_TOKENS;
      }
      case 'thermostat': {
        return THERMOSTAT_MODES;
      }
      case 'media_player': {
        return PLAYBACK_STATES;
      }
      case 'vacuum': {
        return VACUUM_ACTIVITIES;
      }
      case 'lawn_mower': {
        return LAWN_MOWER_ACTIVITIES;
      }
      case 'select': {
        return selectOptions;
      }
      case 'sensor_text':
      case 'number':
      case 'sensor_numeric':
      case 'level':
      case null: {
        return [];
      }
    }
  })();

  return closed.length === 0 ? [] : [...closed, STATE_TOKEN_UNAVAILABLE];
}
