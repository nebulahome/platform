/**
 * What a "Set entity" block can tell an entity to do, read from the capabilities it declares.
 *
 * Each capability's command schema is a union of commands, each with its own fields: `set_level`
 * takes a level and a fade, `set_mode` one of the thermostat's modes. Reading the choices and their
 * fields from the schema - rather than keeping a second list here - means a capability that grows
 * a command grows a choice in the editor, and the fields asked for are exactly the ones `core`
 * checks the command against.
 */
import type { z } from 'zod';

import {
  commandSchemaFor,
  type CapabilityName,
  type JsonObject,
  type JsonValue,
} from '@nebulahome/contracts';

/** How a command's field is asked for. */
export type CommandFieldKind =
  'number' | 'percent' | 'duration' | 'enum' | 'boolean' | 'text' | 'list';

/** One field of a command. */
export type CommandField = {
  /** Its name in the command body. */
  readonly key: string;

  readonly kind: CommandFieldKind;

  /** What it is called. */
  readonly label: string;

  readonly min?: number;
  readonly max?: number;

  /** The choices, for an enum. */
  readonly options?: readonly string[];

  /** Whether the command can go without it. */
  readonly isOptional: boolean;
};

/** One thing an entity can be told to do. */
export type CommandChoice = {
  readonly capability: CapabilityName;
  readonly command: string;

  /** How the choice reads: "Turn on", "Set level". */
  readonly label: string;

  /** What it needs besides its name. */
  readonly fields: readonly CommandField[];
};

/** Field names as a person reads them. */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  level: 'Level',
  transitionMs: 'Transition',
  hue: 'Hue',
  saturation: 'Saturation',
  mireds: 'Colour temperature',
  position: 'Position',
  tilt: 'Tilt',
  code: 'Code',
  temperature: 'Target temperature',
  mode: 'Mode',
  volume: 'Volume',
  isMuted: 'Muted',
  source: 'Source',
  positionSeconds: 'Position (s)',
  option: 'Option',
  value: 'Value',
  rooms: 'Rooms',
  durationSeconds: 'Length (s)',
};

/**
 * A word with its first letter raised and its underscores spaced.
 *
 * @param word - As the format names it.
 * @returns How it reads.
 */
export function humanise(word: string): string {
  const spaced = word.replaceAll('_', ' ');

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The pieces of a zod schema this file reads. Zod's own types say less than its objects carry. */
type Introspected = {
  readonly def: {
    readonly type: string;
    readonly innerType?: z.ZodType;
    readonly entries?: Readonly<Record<string, string>>;
    readonly values?: readonly unknown[];
  };
  readonly minValue?: number | null;
  readonly maxValue?: number | null;
  readonly options?: readonly z.ZodType[];
  readonly shape?: Readonly<Record<string, z.ZodType>>;
};

/**
 * Looks inside a schema.
 *
 * @param schema - The schema.
 * @returns What it carries.
 */
function inspect(schema: z.ZodType): Introspected {
  const introspected: unknown = schema;

  return introspected as Introspected;
}

/**
 * Reads one field of a command from its schema.
 *
 * @param key - Its name.
 * @param schema - Its schema.
 * @returns The field.
 */
function fieldOf(key: string, schema: z.ZodType): CommandField {
  let inner = inspect(schema);
  let isOptional = false;

  while (
    (inner.def.type === 'optional' ||
      inner.def.type === 'default' ||
      inner.def.type === 'nullable') &&
    inner.def.innerType !== undefined
  ) {
    isOptional = isOptional || inner.def.type !== 'nullable';
    inner = inspect(inner.def.innerType);
  }

  const label = FIELD_LABELS[key] ?? humanise(key);

  switch (inner.def.type) {
    case 'number': {
      const min = inner.minValue ?? undefined;
      const max = inner.maxValue ?? undefined;

      if (key.endsWith('Ms')) {
        return { key, kind: 'duration', label, isOptional };
      }

      return {
        key,
        kind: min === 0 && max === 100 ? 'percent' : 'number',
        label,
        isOptional,
        ...(min === undefined || !Number.isFinite(min) ? {} : { min }),
        ...(max === undefined || !Number.isFinite(max) ? {} : { max }),
      };
    }
    case 'enum': {
      return {
        key,
        kind: 'enum',
        label,
        isOptional,
        options: Object.values(inner.def.entries ?? {}),
      };
    }
    case 'boolean': {
      return { key, kind: 'boolean', label, isOptional };
    }
    case 'array': {
      return { key, kind: 'list', label, isOptional };
    }
    default: {
      return { key, kind: 'text', label, isOptional };
    }
  }
}

/**
 * The commands one capability takes.
 *
 * @param capability - The capability.
 * @returns Its commands, in the order the schema lists them; none for one that only reports.
 */
export function commandChoicesOf(capability: CapabilityName): CommandChoice[] {
  const schema = commandSchemaFor(capability);

  if (schema === null) {
    return [];
  }

  const root = inspect(schema);
  const variants = root.options ?? [schema];

  return variants.flatMap((variant): CommandChoice[] => {
    const shape = inspect(variant).shape;
    const name = shape?.['command'];
    const values = name === undefined ? [] : (inspect(name).def.values ?? []);
    const command = typeof values[0] === 'string' ? values[0] : undefined;

    if (shape === undefined || command === undefined) {
      return [];
    }

    return [
      {
        capability,
        command,
        label: humanise(command),
        fields: Object.entries(shape)
          .filter(([key]) => key !== 'command')
          .map(([key, field]) => fieldOf(key, field)),
      },
    ];
  });
}

/**
 * The commands an entity takes, across its capabilities.
 *
 * @param capabilities - What it declares.
 * @returns Its commands.
 */
export function commandChoicesFor(capabilities: readonly CapabilityName[]): CommandChoice[] {
  return capabilities.flatMap(commandChoicesOf);
}

/**
 * A field's value when nothing has been chosen yet.
 *
 * @param field - The field.
 * @returns A value the command accepts.
 */
function defaultValue(field: CommandField): JsonValue {
  switch (field.kind) {
    case 'percent': {
      return field.key === 'level' || field.key === 'position' ? 100 : 50;
    }
    case 'number': {
      return field.min ?? 0;
    }
    case 'duration': {
      return 0;
    }
    case 'enum': {
      return field.options?.[0] ?? '';
    }
    case 'boolean': {
      return false;
    }
    case 'list': {
      return [];
    }
    case 'text': {
      return '';
    }
  }
}

/**
 * The body of a command with its required fields at their defaults.
 *
 * @param choice - The command.
 * @returns `{ command, ...fields }`.
 */
export function defaultParams(choice: CommandChoice): JsonObject {
  const params: Record<string, JsonValue> = { command: choice.command };

  for (const field of choice.fields) {
    if (!field.isOptional) {
      params[field.key] = defaultValue(field);
    }
  }

  return params;
}

/**
 * The command a body is, among an entity's choices.
 *
 * @param choices - What the entity takes.
 * @param capability - The block's capability.
 * @param params - The block's command body.
 * @returns The choice, or undefined when the body names none of them.
 */
export function choiceOf(
  choices: readonly CommandChoice[],
  capability: string,
  params: Readonly<Record<string, unknown>>,
): CommandChoice | undefined {
  return choices.find(
    (choice) => choice.capability === capability && choice.command === params['command'],
  );
}
