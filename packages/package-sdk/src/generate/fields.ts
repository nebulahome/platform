/**
 * The field builders' output, written in the platform's grammars: a form's fields in the setup
 * grammar of `setup.json` and of a card's options, an entity's in the manifest's entity-field
 * grammar. What does not fit the place is a problem named in the declaration's terms; what the
 * grammars themselves refuse is left to the platform's schemas.
 */
import { pathOf, type Problems } from './problems.js';

/** A field, as the config gave it: the builders' output, or whatever a JavaScript author wrote. */
type RawField = Readonly<Record<string, unknown>>;

/** Where a form's field is asked. */
export type FormPlace = 'settings' | 'options';

/** The kinds a form asks, by place. */
const FORM_KINDS: Readonly<Record<FormPlace, readonly string[]>> = {
  settings: ['text', 'secret', 'number', 'boolean', 'choice', 'list'],
  options: ['text', 'number', 'boolean', 'choice', 'list'],
};

/** The kinds of an entity's field. */
const VALUE_KINDS = ['text', 'number', 'boolean', 'choice', 'timestamp'];

/** What only a form's field says. */
const FORM_ONLY = [
  'default',
  'isRequired',
  'shownWhen',
  'isLive',
  'placeholder',
  'pattern',
  'patternMessage',
  'minLength',
  'maxLength',
  'min',
  'max',
  'isInteger',
  'warnBelow',
  'warning',
  'minItems',
  'maxItems',
];

/**
 * Says whether a value is a record.
 *
 * @param value - The value.
 * @returns True for a non-null, non-array object.
 */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The entries of a record of fields, each checked to be a field.
 *
 * @param value - The record.
 * @param path - Where it is.
 * @param found - Where problems go.
 * @returns Each key and field.
 */
export function fieldEntries(
  value: unknown,
  path: readonly PropertyKey[],
  found: Problems,
): [string, RawField][] {
  if (value === undefined) {
    return [];
  }

  if (!isRecord(value)) {
    found.add(pathOf(path), 'must be fields by their keys, built with field');

    return [];
  }

  return Object.entries(value).flatMap(([key, raw]): [string, RawField][] => {
    if (!isRecord(raw) || typeof raw['kind'] !== 'string') {
      found.add(pathOf([...path, key]), 'must be a field, built with field');

      return [];
    }

    return [[key, raw]];
  });
}

/**
 * A form's field in the setup grammar.
 *
 * @param key - Its key.
 * @param raw - The field.
 * @param place - Where it is asked.
 * @param path - Where it is in the declaration.
 * @param found - Where problems go.
 * @returns The setup field, for the platform's schema to check.
 */
export function formField(
  key: string,
  raw: RawField,
  place: FormPlace,
  path: readonly PropertyKey[],
  found: Problems,
): Record<string, unknown> {
  const { kind, isOptional, isLive, ...rest } = raw;
  const where = pathOf(path);

  if (typeof kind === 'string' && !FORM_KINDS[place].includes(kind)) {
    found.add(
      where,
      kind === 'timestamp'
        ? 'a timestamp is never asked in a form'
        : `a card's options hold no ${kind}`,
    );
  }

  if (isOptional !== undefined) {
    found.add(where, 'a form field is required or not, never optional: use isRequired');
  }

  if (place === 'options' && isLive !== undefined) {
    found.add(where, 'only a setting is live');
  }

  return {
    key,
    type: kind,
    ...rest,
    ...(place === 'settings' && isLive !== undefined ? { isLive } : {}),
  };
}

/**
 * An entity's field in the manifest's grammar: of its state, or of a command's arguments.
 *
 * @param key - Its key.
 * @param raw - The field.
 * @param path - Where it is in the declaration.
 * @param found - Where problems go.
 * @returns The entity field, for the platform's schema to check.
 */
export function entityField(
  key: string,
  raw: RawField,
  path: readonly PropertyKey[],
  found: Problems,
): Record<string, unknown> {
  const { kind, label, unit, choices, isOptional, help, ...rest } = raw;
  const where = pathOf(path);

  if (typeof kind === 'string' && !VALUE_KINDS.includes(kind)) {
    found.add(where, `an entity's field is never a ${kind}`);
  }

  for (const name of Object.keys(rest)) {
    found.add(
      where,
      FORM_ONLY.includes(name)
        ? `${name} is for a form's field, not an entity's`
        : `${name} is not something a field says`,
    );
  }

  if (help !== undefined) {
    found.add(where, "an entity's field has a label and no help");
  }

  return {
    key,
    type: kind,
    label,
    ...(unit === undefined ? {} : { unit }),
    ...(choices === undefined ? {} : { choices }),
    ...(isOptional === undefined ? {} : { isOptional }),
  };
}
