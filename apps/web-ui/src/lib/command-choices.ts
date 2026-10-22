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

import { defineMessage, text, type Message } from '@/i18n/messages';

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
const FIELD_LABELS: Readonly<Record<string, Message>> = {
  level: defineMessage('commands.fields.level', 'Level'),
  transitionMs: defineMessage('commands.fields.transitionMs', 'Transition'),
  hue: defineMessage('commands.fields.hue', 'Hue'),
  saturation: defineMessage('commands.fields.saturation', 'Saturation'),
  mireds: defineMessage('commands.fields.mireds', 'Colour temperature'),
  position: defineMessage('commands.fields.position', 'Position'),
  tilt: defineMessage('commands.fields.tilt', 'Tilt'),
  code: defineMessage('commands.fields.code', 'Code'),
  temperature: defineMessage('commands.fields.temperature', 'Target temperature'),
  mode: defineMessage('commands.fields.mode', 'Mode'),
  volume: defineMessage('commands.fields.volume', 'Volume'),
  isMuted: defineMessage('commands.fields.isMuted', 'Muted'),
  source: defineMessage('commands.fields.source', 'Source'),
  positionSeconds: defineMessage('commands.fields.positionSeconds', 'Position (s)'),
  option: defineMessage('commands.fields.option', 'Option'),
  value: defineMessage('commands.fields.value', 'Value'),
  rooms: defineMessage('commands.fields.rooms', 'Rooms'),
  durationSeconds: defineMessage('commands.fields.durationSeconds', 'Length (s)'),
};

/** The one choice that stands for a package's own commands. */
const CUSTOM_COMMAND = defineMessage('commands.names.custom', 'Command of its package');

/** The platform's commands as a person reads them; another reads as its name, humanised. */
const COMMAND_LABELS: Readonly<Record<string, Message>> = {
  clean_rooms: defineMessage('commands.names.cleanRooms', 'Clean rooms'),
  close: defineMessage('commands.names.close', 'Close'),
  dock: defineMessage('commands.names.dock', 'Dock'),
  install: defineMessage('commands.names.install', 'Install'),
  locate: defineMessage('commands.names.locate', 'Locate'),
  lock: defineMessage('commands.names.lock', 'Lock'),
  next: defineMessage('commands.names.next', 'Next'),
  open: defineMessage('commands.names.open', 'Open'),
  pause: defineMessage('commands.names.pause', 'Pause'),
  play: defineMessage('commands.names.play', 'Play'),
  press: defineMessage('commands.names.press', 'Press'),
  previous: defineMessage('commands.names.previous', 'Previous'),
  record: defineMessage('commands.names.record', 'Record'),
  resume: defineMessage('commands.names.resume', 'Resume'),
  seek: defineMessage('commands.names.seek', 'Seek'),
  select_option: defineMessage('commands.names.selectOption', 'Select option'),
  set_color: defineMessage('commands.names.setColor', 'Set color'),
  set_color_temp: defineMessage('commands.names.setColorTemp', 'Set color temp'),
  set_level: defineMessage('commands.names.setLevel', 'Set level'),
  set_mode: defineMessage('commands.names.setMode', 'Set mode'),
  set_mute: defineMessage('commands.names.setMute', 'Set mute'),
  set_position: defineMessage('commands.names.setPosition', 'Set position'),
  set_source: defineMessage('commands.names.setSource', 'Set source'),
  set_target: defineMessage('commands.names.setTarget', 'Set target'),
  set_tilt: defineMessage('commands.names.setTilt', 'Set tilt'),
  set_value: defineMessage('commands.names.setValue', 'Set value'),
  set_volume: defineMessage('commands.names.setVolume', 'Set volume'),
  snapshot: defineMessage('commands.names.snapshot', 'Snapshot'),
  start: defineMessage('commands.names.start', 'Start'),
  stop: defineMessage('commands.names.stop', 'Stop'),
  toggle: defineMessage('commands.names.toggle', 'Toggle'),
  turn_off: defineMessage('commands.names.turnOff', 'Turn off'),
  turn_on: defineMessage('commands.names.turnOn', 'Turn on'),
  unlock: defineMessage('commands.names.unlock', 'Unlock'),
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

/**
 * A command as a person reads it: "Turn on".
 *
 * @param command - Its name: `turn_on`.
 * @returns How it reads.
 */
export function commandLabel(command: string): string {
  const known = COMMAND_LABELS[command];

  return known === undefined ? humanise(command) : text(known);
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

  const known = FIELD_LABELS[key];
  const label = known === undefined ? humanise(key) : text(known);

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

  // A package's own entity type names its commands in its manifest, not in a schema here: one
  // choice stands for all of them, and the command and its arguments are written in.
  if (capability === 'custom') {
    return [{ capability, command: '', label: text(CUSTOM_COMMAND), fields: [] }];
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
        label: commandLabel(command),
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
    (choice) =>
      choice.capability === capability &&
      (choice.capability === 'custom' || choice.command === params['command']),
  );
}

/**
 * The capabilities among an entity's choices, each with its commands, in the order they come:
 * what the Command field lists, and what its Do offers once one is picked.
 *
 * @param choices - What the entity takes.
 * @returns One entry per capability.
 */
export function choicesByCapability(
  choices: readonly CommandChoice[],
): { capability: CapabilityName; commands: CommandChoice[] }[] {
  const groups = new Map<CapabilityName, CommandChoice[]>();

  for (const choice of choices) {
    groups.set(choice.capability, [...(groups.get(choice.capability) ?? []), choice]);
  }

  return [...groups].map(([capability, commands]) => ({ capability, commands }));
}
