/**
 * The kinds of entity packages define, and checking what a `custom` entity says or is told
 * against them.
 *
 * A package's manifest lists its entity types - the fields of their state, the commands they take
 * (PACKAGES.md 6) - and an entity of one declares the `custom` capability, `{ packageId, type }`.
 * The capability's own schema only knows the shape every custom state has - a record of scalars -
 * so what one type's state may hold, and which commands it takes with which arguments, is checked
 * here, from the types `core` read out of the package's row when the package synced its devices.
 */
import type { PackageEntityField, PackageEntityType } from '@nebulahome/contracts';

/** The entity types of every package `core` has heard of, by package. */
export class PackageTypes {
  readonly #types = new Map<string, ReadonlyMap<string, PackageEntityType>>();

  /**
   * Keeps a package's entity types, replacing what was kept for it.
   *
   * @param packageId - The package.
   * @param types - Its entity types, as its manifest lists them.
   */
  public set(packageId: string, types: readonly PackageEntityType[]): void {
    this.#types.set(packageId, new Map(types.map((type) => [type.id, type])));
  }

  /**
   * Forgets a package's types, when it is removed.
   *
   * @param packageId - The package.
   */
  public forget(packageId: string): void {
    this.#types.delete(packageId);
  }

  /**
   * One entity type of a package.
   *
   * @param packageId - The package.
   * @param type - The type's id.
   * @returns It, or undefined when the package or the type is not known.
   */
  public get(packageId: string, type: string): PackageEntityType | undefined {
    return this.#types.get(packageId)?.get(type);
  }
}

/**
 * Says whether a value is what a field holds.
 *
 * @param field - The field.
 * @param value - The value.
 * @returns True when it fits.
 */
function fits(field: PackageEntityField, value: unknown): boolean {
  if (value === null) {
    return field.isOptional;
  }

  switch (field.type) {
    case 'text': {
      return typeof value === 'string' && value.length <= 512;
    }

    case 'number': {
      return typeof value === 'number' && Number.isFinite(value);
    }

    case 'boolean': {
      return typeof value === 'boolean';
    }

    case 'choice': {
      return (
        typeof value === 'string' && (field.choices ?? []).some((each) => each.value === value)
      );
    }

    case 'timestamp': {
      return typeof value === 'string' && !Number.isNaN(Date.parse(value));
    }
  }
}

/**
 * What is wrong with values for some fields, if anything.
 *
 * @param fields - The fields.
 * @param values - The values, by key.
 * @param isWhole - Whether every field that is not optional must be there: a command's arguments
 *   are whole, a state report may be partial.
 * @returns A sentence, or undefined when they fit.
 */
function valuesProblem(
  fields: readonly PackageEntityField[],
  values: Readonly<Record<string, unknown>>,
  isWhole: boolean,
): string | undefined {
  const byKey = new Map(fields.map((field) => [field.key, field]));

  for (const [key, value] of Object.entries(values)) {
    const field = byKey.get(key);

    if (field === undefined) {
      return `${key} is not one of its fields`;
    }

    if (!fits(field, value)) {
      return `${key} must be ${field.type === 'choice' ? `one of ${(field.choices ?? []).map((each) => each.value).join(', ')}` : `a ${field.type}`}`;
    }
  }

  if (isWhole) {
    const missing = fields.find((field) => !field.isOptional && !(field.key in values));

    if (missing !== undefined) {
      return `${missing.key} is missing`;
    }
  }

  return undefined;
}

/**
 * What is wrong with a custom entity's state report, if anything.
 *
 * @param type - The entity's type.
 * @param values - The values it reported.
 * @returns A sentence, or undefined when it fits.
 */
export function customStateProblem(
  type: PackageEntityType,
  values: Readonly<Record<string, unknown>>,
): string | undefined {
  return valuesProblem(type.state, values, false);
}

/**
 * What is wrong with a command to a custom entity, if anything.
 *
 * @param type - The entity's type.
 * @param command - The command's id.
 * @param args - Its arguments.
 * @returns A sentence, or undefined when the type takes it.
 */
export function customCommandProblem(
  type: PackageEntityType,
  command: string,
  args: Readonly<Record<string, unknown>>,
): string | undefined {
  const declared = type.commands.find((each) => each.id === command);

  if (declared === undefined) {
    return `A ${type.name} takes no command ${command}`;
  }

  return valuesProblem(declared.fields, args, true);
}
