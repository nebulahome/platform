/**
 * Refusing a command before it reaches a device.
 *
 * `core` rejects a command targeting a capability the entity does not have (ARCHITECTURE.md 5.3)
 * and, where the capability declares the device's own limits, a command the device could not
 * execute. Both checks happen here rather than in the adapter, for the same reason validation
 * happens at any boundary: the answer is the same for every protocol, and an adapter that has to
 * ask the device what its own range is has already spent the round trip the check was meant to
 * save.
 */
import {
  CAPABILITY_DEFINITIONS,
  commandSchemaFor,
  jsonObjectSchema,
  ValidationError,
  type CapabilityName,
  type JsonObject,
} from '@nebulahome/contracts';

import type { EntityRecord } from './entity-directory.js';
import { customCommandProblem, type PackageTypes } from './package-types.js';

/**
 * Validates the device limits stored against a capability.
 *
 * @param capability - The capability being commanded.
 * @param record - The entity's configuration.
 * @returns The parsed parameters.
 * @throws {ValidationError} When what is stored does not match the capability's params schema,
 * which means the registry row is wrong rather than the command.
 */
function parseParams(capability: CapabilityName, record: EntityRecord): unknown {
  const stored = record.capabilities.get(capability) ?? {};
  const result = CAPABILITY_DEFINITIONS[capability].params.safeParse(stored);

  if (!result.success) {
    throw new ValidationError(
      `Stored parameters for ${record.entityId}.${capability} are not valid`,
      { cause: result.error, details: { entityId: record.entityId, capability } },
    );
  }

  return result.data;
}

/**
 * Rejects a command whose arguments fall outside what the device declared.
 *
 * Only the limits a capability actually declares are checked. There is no attempt to guess at
 * limits a device did not report: a lamp that never told us its mired range is a lamp whose
 * range we do not know, and inventing one would send warm-white lamps to a temperature they
 * cannot reach.
 *
 * @param capability - The capability being commanded.
 * @param params - The device's declared limits, already parsed.
 * @param command - The command, already validated against its own schema.
 * @param entityId - The entity being commanded, for the failure message.
 * @throws {ValidationError} When the command asks for something the device declared it cannot do.
 */
function checkAgainstParams(
  capability: CapabilityName,
  params: unknown,
  command: JsonObject,
  entityId: string,
): void {
  /**
   * Rejects the command with a readable explanation.
   *
   * @param reason - What is wrong with it.
   * @throws {ValidationError} Always.
   */
  const reject = (reason: string): never => {
    throw new ValidationError(`${entityId} cannot accept this command: ${reason}`, {
      details: { entityId, capability, command },
    });
  };

  if (capability === 'color_temp' && command['command'] === 'set_color_temp') {
    const { minMireds, maxMireds } = params as { minMireds: number; maxMireds: number };
    const mireds = Number(command['mireds']);

    if (mireds < minMireds || mireds > maxMireds) {
      reject(
        `colour temperature must be between ${String(minMireds)} and ${String(maxMireds)} mireds`,
      );
    }
  }

  if (capability === 'thermostat') {
    const parameters = params as {
      supportedModes: readonly string[];
      minTemperature: number;
      maxTemperature: number;
    };

    if (command['command'] === 'set_target') {
      const temperature = Number(command['temperature']);

      if (temperature < parameters.minTemperature || temperature > parameters.maxTemperature) {
        reject(
          `target must be between ${String(parameters.minTemperature)} and ${String(parameters.maxTemperature)}`,
        );
      }
    }

    const mode = command['mode'];

    if (
      command['command'] === 'set_mode' &&
      (typeof mode !== 'string' || !parameters.supportedModes.includes(mode))
    ) {
      reject(`mode must be one of ${parameters.supportedModes.join(', ')}`);
    }
  }

  if (capability === 'cover') {
    const { hasPosition, hasTilt } = params as { hasPosition: boolean; hasTilt: boolean };

    if (command['command'] === 'set_position' && !hasPosition) {
      reject('this cover cannot be moved to a position');
    }

    if (command['command'] === 'set_tilt' && !hasTilt) {
      reject('this cover has no tilt');
    }
  }

  if (capability === 'lawn_mower') {
    const { canPause, canStop, canDock, canResume } = params as {
      canPause: boolean;
      canStop: boolean;
      canDock: boolean;
      canResume: boolean;
    };
    const name = command['command'];

    if (name === 'pause' && !canPause) {
      reject('this mower cannot be paused');
    }

    if (name === 'stop' && !canStop) {
      reject('this mower cannot end a job from here');
    }

    if (name === 'dock' && !canDock) {
      reject('this mower cannot be sent back to its station');
    }

    if (name === 'resume' && !canResume) {
      reject('this mower cannot be told to carry on a job: start it again');
    }
  }

  if (capability === 'vacuum') {
    const { canPause, canStop, canDock, canLocate, canCleanRooms, canResume } = params as {
      canPause: boolean;
      canStop: boolean;
      canDock: boolean;
      canLocate: boolean;
      canCleanRooms: boolean;
      canResume: boolean;
    };
    const name = command['command'];

    if (name === 'pause' && !canPause) {
      reject('this robot cannot be paused');
    }

    if (name === 'stop' && !canStop) {
      reject('this robot cannot end a job from here');
    }

    if (name === 'dock' && !canDock) {
      reject('this robot cannot be sent back to its station');
    }

    if (name === 'locate' && !canLocate) {
      reject('this robot cannot say where it is');
    }

    if (name === 'clean_rooms' && !canCleanRooms) {
      reject('this robot cannot clean only some rooms');
    }

    if (name === 'resume' && !canResume) {
      reject('this robot cannot be told to carry on a job: start it again');
    }
  }

  if (capability === 'select' && command['command'] === 'select_option') {
    const { options } = params as { options: readonly { value: string }[] };
    const values = options.map((option) => option.value);
    const option = command['option'];

    if (typeof option !== 'string' || !values.includes(option)) {
      reject(`option must be one of ${values.join(', ')}`);
    }
  }

  if (capability === 'number' && command['command'] === 'set_value') {
    const { min, max, step } = params as { min: number; max: number; step: number };
    const value = Number(command['value']);
    // Counted in steps from the minimum, with room for the rounding a decimal step brings.
    const steps = (value - min) / step;

    if (value < min || value > max) {
      reject(`value must be between ${String(min)} and ${String(max)}`);
    }

    if (Math.abs(steps - Math.round(steps)) > 1e-9) {
      reject(`value must be ${String(min)} plus a whole number of steps of ${String(step)}`);
    }
  }

  if (capability === 'media_player') {
    const { supportedSources, hasSeek, hasVolume } = params as {
      supportedSources: readonly string[];
      hasSeek: boolean;
      hasVolume: boolean;
    };

    if (command['command'] === 'seek' && !hasSeek) {
      reject('this player cannot seek');
    }

    if ((command['command'] === 'set_volume' || command['command'] === 'set_mute') && !hasVolume) {
      reject('this player has no volume control');
    }

    const source = command['source'];

    if (
      command['command'] === 'set_source' &&
      supportedSources.length > 0 &&
      (typeof source !== 'string' || !supportedSources.includes(source))
    ) {
      reject(`source must be one of ${supportedSources.join(', ')}`);
    }
  }
}

/**
 * Validates a command against the entity and the capability it targets.
 *
 * @param record - The entity's configuration, from the directory.
 * @param capability - The capability the command targets, taken from the subject.
 * @param command - The command as it arrived, of unvalidated shape.
 * @param packageTypes - The packages' entity types, for a command to a `custom` entity.
 * @returns The validated command, ready to forward to the owning adapter.
 * @throws {ValidationError} When the entity is disabled, does not declare the capability, the
 * capability reports only, the command does not match the capability's schema, it asks for
 * something outside the device's declared limits, or - for a `custom` entity - its type does not
 * take it.
 */
export function validateCommand(
  record: EntityRecord,
  capability: CapabilityName,
  command: JsonObject,
  packageTypes?: PackageTypes,
): JsonObject {
  if (!record.isEnabled) {
    throw new ValidationError(`Entity ${record.entityId} is disabled`, {
      details: { entityId: record.entityId },
    });
  }

  if (!record.capabilities.has(capability)) {
    throw new ValidationError(`Entity ${record.entityId} has no ${capability} capability`, {
      details: {
        entityId: record.entityId,
        capability,
        declared: [...record.capabilities.keys()],
      },
    });
  }

  const schema = commandSchemaFor(capability);

  if (schema === null) {
    throw new ValidationError(`Capability ${capability} reports only and accepts no commands`, {
      details: { entityId: record.entityId, capability },
    });
  }

  const parsed = schema.safeParse(command);

  if (!parsed.success) {
    throw new ValidationError(`Command for ${record.entityId}.${capability} is not valid`, {
      cause: parsed.error,
      details: {
        entityId: record.entityId,
        capability,
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
  }

  // Back through the JSON schema so the value forwarded to the adapter is a plain object again
  // rather than whatever the capability's own schema produced.
  const validated = jsonObjectSchema.parse(parsed.data);

  const params = parseParams(capability, record);

  checkAgainstParams(capability, params, validated, record.entityId);

  if (capability === 'custom' && packageTypes !== undefined) {
    const { packageId, type } = params as { packageId: string; type: string };
    const declared = packageTypes.get(packageId, type);
    const problem =
      declared === undefined
        ? `The ${packageId} package's ${type} is not known: the package is not installed`
        : customCommandProblem(
            declared,
            typeof validated['command'] === 'string' ? validated['command'] : '',
            (validated['args'] ?? {}) as Readonly<Record<string, unknown>>,
          );

    if (problem !== undefined) {
      throw new ValidationError(`Command for ${record.entityId}.custom is not valid: ${problem}`, {
        details: { entityId: record.entityId, capability, packageId, type },
      });
    }
  }

  return validated;
}
