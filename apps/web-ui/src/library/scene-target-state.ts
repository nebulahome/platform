/**
 * Seeding and narrowing the target state a scene member stores.
 *
 * A scene only asks for capabilities that can be commanded. Sensors and cameras are filtered out
 * of the picker; what lands in `targetState` is the writable subset of what the entity currently
 * reports, with defaults when a capability has never said anything.
 */
import {
  capabilityNameSchema,
  capabilityStateSchema,
  colorHsStateSchema,
  colorTempStateSchema,
  commandSchemaFor,
  coverStateSchema,
  levelStateSchema,
  lockStateSchema,
  mediaPlayerStateSchema,
  onOffStateSchema,
  thermostatStateSchema,
  THERMOSTAT_ACTIONS,
  THERMOSTAT_MODES,
  type CapabilityName,
  type CapabilityState,
  type EntityView,
  type JsonObject,
  type JsonValue,
} from '@nebula-home/contracts';

/** Playback values the scene editor offers; idle and buffering are not settable here. */
const EDITABLE_PLAYBACK = ['playing', 'paused', 'stopped'] as const;

/** A capability that reports only, or that a scene should never capture. */
const NON_SCENE_CAPABILITIES: ReadonlySet<CapabilityName> = new Set([
  'sensor_numeric',
  'sensor_binary',
  'sensor_text',
  'camera',
  'button',
  'update',
  // A mower's job is not a state a scene returns to, and a setting is not one it restores.
  'lawn_mower',
  'select',
  'number',
]);

/**
 * Whether a capability can be part of a scene member's target state.
 *
 * @param capability - The capability name.
 * @returns True when a scene may set it.
 */
export function isSceneWritable(capability: CapabilityName): boolean {
  if (NON_SCENE_CAPABILITIES.has(capability)) {
    return false;
  }

  return commandSchemaFor(capability) !== null;
}

/**
 * Whether an entity can be added to a scene.
 *
 * @param entity - The candidate.
 * @returns True when at least one of its capabilities is writable for a scene.
 */
export function isSceneEntity(entity: EntityView): boolean {
  return entity.capabilities.some((entry) => isSceneWritable(entry.capability));
}

/**
 * Reads a nested object out of a JSON value when that is what it is.
 *
 * @param value - Whatever was stored.
 * @returns The object, or undefined.
 */
function asObject(value: JsonValue | undefined): JsonObject | undefined {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value;
}

/**
 * Says whether a string is one of a fixed list.
 *
 * @param value - The candidate.
 * @param options - The allowed values.
 * @returns True when the candidate is in the list.
 */
function isOneOf<T extends string>(value: string, options: readonly T[]): value is T {
  return options.some((option) => option === value);
}

/**
 * Clamps a number into a closed range.
 *
 * @param value - The raw figure.
 * @param min - The lower bound.
 * @param max - The upper bound.
 * @returns The clamped figure.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Keeps only the writable fields of one capability's current reading.
 *
 * @param capability - Which capability.
 * @param current - What the entity reports for it, when anything.
 * @returns The fields a scene may set, or undefined when the capability is not scene-writable.
 */
function seedCapability(capability: CapabilityName, current: unknown): unknown {
  switch (capability) {
    case 'on_off': {
      const parsed = onOffStateSchema.safeParse(current);

      return parsed.success ? parsed.data : { isOn: false };
    }
    case 'level': {
      const parsed = levelStateSchema.safeParse(current);

      return { level: parsed.success ? clamp(parsed.data.level, 0, 100) : 100 };
    }
    case 'color_hs': {
      const parsed = colorHsStateSchema.safeParse(current);

      return parsed.success
        ? {
            hue: clamp(parsed.data.hue, 0, 360),
            saturation: clamp(parsed.data.saturation, 0, 100),
          }
        : { hue: 0, saturation: 0 };
    }
    case 'color_temp': {
      const parsed = colorTempStateSchema.safeParse(current);

      return {
        mireds: parsed.success ? Math.round(clamp(parsed.data.mireds, 1, 1000)) : 300,
      };
    }
    case 'cover': {
      const parsed = coverStateSchema.safeParse(current);
      const position = parsed.success ? clamp(parsed.data.position, 0, 100) : 100;

      if (parsed.success && parsed.data.tilt !== undefined) {
        return { position, tilt: clamp(parsed.data.tilt, 0, 100), motion: 'stopped' as const };
      }

      return { position, motion: 'stopped' as const };
    }
    case 'lock': {
      const parsed = lockStateSchema.safeParse(current);

      return {
        lockState: parsed.success && parsed.data.lockState === 'unlocked' ? 'unlocked' : 'locked',
      };
    }
    case 'thermostat': {
      const parsed = thermostatStateSchema.safeParse(current);
      const target = parsed.success ? parsed.data.targetTemperature : 21;
      const seeded = {
        currentTemperature: parsed.success ? parsed.data.currentTemperature : target,
        targetTemperature: target,
        mode:
          parsed.success && isOneOf(parsed.data.mode, THERMOSTAT_MODES) ? parsed.data.mode : 'heat',
        action:
          parsed.success && isOneOf(parsed.data.action, THERMOSTAT_ACTIONS)
            ? parsed.data.action
            : 'idle',
      };

      if (parsed.success && parsed.data.humidity !== undefined) {
        return { ...seeded, humidity: clamp(parsed.data.humidity, 0, 100) };
      }

      return seeded;
    }
    case 'media_player': {
      const parsed = mediaPlayerStateSchema.safeParse(current);
      const playback =
        parsed.success && isOneOf(parsed.data.playback, EDITABLE_PLAYBACK)
          ? parsed.data.playback
          : 'paused';

      return {
        playback,
        volume: parsed.success ? clamp(parsed.data.volume, 0, 100) : 30,
        isMuted: parsed.success ? parsed.data.isMuted : false,
      };
    }
    default:
      return undefined;
  }
}

/**
 * Folds one capability's seeded fields into a validated target state.
 *
 * @param target - The state so far.
 * @param capability - Which capability.
 * @param seeded - Its fields, or undefined when it is not writable.
 * @returns The state with that capability included, once it still validates.
 */
function include(
  target: CapabilityState,
  capability: CapabilityName,
  seeded: unknown,
): CapabilityState {
  if (seeded === undefined) {
    return target;
  }

  return capabilityStateSchema.parse({ ...target, [capability]: seeded });
}

/**
 * Seeds a scene member's target state from an entity's current reading.
 *
 * Only capabilities the entity declares and that a scene may set are kept. Missing values fall
 * back to a sensible default so the editor always has something to show.
 *
 * @param entity - The entity being added.
 * @returns The target state to store on the member.
 */
export function seedTargetState(entity: EntityView): CapabilityState {
  const current = entity.state ?? {};
  let target: CapabilityState = {};

  for (const entry of entity.capabilities) {
    if (!isSceneWritable(entry.capability)) {
      continue;
    }

    target = include(
      target,
      entry.capability,
      seedCapability(entry.capability, asObject(current[entry.capability])),
    );
  }

  return target;
}

/**
 * Narrows a stored target state to the writable fields the editor understands.
 *
 * Used when opening an existing scene so leftover sensor readings or media metadata do not
 * appear as editable controls.
 *
 * @param targetState - What the scene member stores.
 * @param capabilities - The entity's declared capabilities, when known.
 * @returns A cleaned target state.
 */
export function narrowTargetState(
  targetState: JsonValue,
  capabilities?: readonly { readonly capability: CapabilityName }[],
): CapabilityState {
  const stored = asObject(targetState);

  if (stored === undefined) {
    return {};
  }

  const names =
    capabilities === undefined
      ? Object.keys(stored).flatMap((key) => {
          const parsed = capabilityNameSchema.safeParse(key);

          return parsed.success ? [parsed.data] : [];
        })
      : capabilities.map((entry) => entry.capability);
  let next: CapabilityState = {};

  for (const name of names) {
    if (!isSceneWritable(name)) {
      continue;
    }

    next = include(next, name, seedCapability(name, asObject(stored[name])));
  }

  return next;
}
