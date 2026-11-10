/**
 * Deciding when an alias's action starts, and filling in its formulas, without side effects.
 *
 * What `services/alias-actions.ts` asks each time a part's value changes or a command reaches it,
 * split from it so it can be tested on plain values.
 */
import { z } from 'zod';

import {
  COMMAND_VALUE_PREFIX,
  aliasExpressionNames,
  capabilityNameSchema,
  commandSchemaFor,
  compareNumbers,
  evaluateAliasExpression,
  isParamFormula,
  type AliasBinding,
  type EntityChange,
  type JsonObject,
  type JsonValue,
} from '@nebulahome/contracts';

import type { PartValue } from './alias-values.js';

/**
 * A part's value as a state token, the way a From / To names it: `on`, `off`, a mode, a number.
 *
 * @param value - The value.
 * @returns The token, or undefined when there is none.
 */
export function partToken(value: PartValue | undefined): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value ? 'on' : 'off';
  }

  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : JSON.stringify(value);
}

/**
 * Whether a part's change starts an action: a state left and entered, or a number crossed.
 *
 * @param change - What the action waits for.
 * @param before - The value before.
 * @param after - The value now.
 * @returns True on the change itself; false while the value only stays as it was.
 */
export function changeFires(
  change: EntityChange,
  before: PartValue | undefined,
  after: PartValue | undefined,
): boolean {
  if (change.kind === 'numeric') {
    const was = typeof before === 'number' && compareNumbers(change.operator, before, change.value);

    return (
      !was && typeof after === 'number' && compareNumbers(change.operator, after, change.value)
    );
  }

  const from = partToken(before);
  const to = partToken(after);

  return (
    from !== to &&
    (change.from === undefined || change.from === null || change.from === from) &&
    (change.to === undefined || change.to === null || change.to === to)
  );
}

/**
 * Whether a change an action waits on still holds: what a "for at least" checks while it waits.
 *
 * @param change - What the action waits for.
 * @param value - The value now.
 * @returns True while it holds.
 */
export function changeHolds(change: EntityChange, value: PartValue | undefined): boolean {
  if (change.kind === 'numeric') {
    return typeof value === 'number' && compareNumbers(change.operator, value, change.value);
  }

  return change.to === undefined || change.to === null || partToken(value) === change.to;
}

/** What a number param of a command allows: its range and whether it is whole. */
type NumberField = { readonly min: number; readonly max: number; readonly isInt: boolean };

/**
 * The range a command's number param allows, read from the capability's own schema.
 *
 * @param capability - The capability.
 * @param command - The command's name.
 * @param key - The param.
 * @returns Its range, or undefined when it is not a number the schema bounds.
 */
function numberField(capability: string, command: string, key: string): NumberField | undefined {
  const parsed = capabilityNameSchema.safeParse(capability);
  const schema: unknown = parsed.success ? commandSchemaFor(parsed.data) : null;

  if (!(schema instanceof z.ZodDiscriminatedUnion)) {
    return undefined;
  }

  for (const option of schema.options) {
    if (!(option instanceof z.ZodObject)) {
      continue;
    }

    const name: unknown = option.shape['command'];

    if (!(name instanceof z.ZodLiteral) || name.value !== command) {
      continue;
    }

    let field: unknown = option.shape[key];

    if (field instanceof z.ZodOptional || field instanceof z.ZodNullable) {
      field = field.unwrap();
    }

    return field instanceof z.ZodNumber
      ? {
          min: field.minValue ?? -Infinity,
          max: field.maxValue ?? Infinity,
          // A whole number's format is `safeint`, `int32`… (`isInt` is going).
          isInt: field.format?.includes('int') === true,
        }
      : undefined;
  }

  return undefined;
}

/**
 * A command's params with their formulas worked out: `command.*` from the command that started the
 * action, any other name an entity's reading. A number is fitted to the range its param allows.
 *
 * @param capability - The capability the params are for.
 * @param params - The params, some of them `{ formula }`.
 * @param command - The command that started the action, when one did.
 * @param bind - An entity's reading, for any other name.
 * @returns The params, plain.
 * @throws {Error} When a formula cannot be worked out: the step fails, saying why.
 */
export function resolveFormulas(
  capability: string,
  params: JsonObject,
  command: JsonObject | undefined,
  bind: (name: string) => AliasBinding,
): JsonObject {
  const resolved: Record<string, JsonValue> = {};
  const name = typeof params['command'] === 'string' ? params['command'] : '';

  for (const [key, value] of Object.entries(params)) {
    if (!isParamFormula(value)) {
      resolved[key] = value;
      continue;
    }

    const bindings = new Map<string, AliasBinding>();

    for (const read of aliasExpressionNames(value.formula)) {
      if (read.startsWith(COMMAND_VALUE_PREFIX)) {
        const given = command?.[read.slice(COMMAND_VALUE_PREFIX.length)];

        bindings.set(
          read,
          typeof given === 'number' || typeof given === 'boolean' || typeof given === 'string'
            ? given
            : null,
        );
      } else {
        bindings.set(read, bind(read));
      }
    }

    const result = evaluateAliasExpression(value.formula, bindings);

    if (!result.ok) {
      throw new Error(`${key}: ${result.error}`);
    }

    if (typeof result.value !== 'number') {
      resolved[key] = result.value;
      continue;
    }

    // Worked-out numbers carry float noise (72 × 0.6 is 43.199…): two decimals are what a command
    // means, and a whole-number param gets a whole number.
    const field = numberField(capability, name, key);
    const rounded =
      field?.isInt === true ? Math.round(result.value) : Math.round(result.value * 100) / 100;

    resolved[key] =
      field === undefined ? rounded : Math.min(field.max, Math.max(field.min, rounded));
  }

  return resolved;
}
