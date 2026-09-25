/**
 * What a bundle asks for when an owner sets up an instance of it - `setup.json`.
 *
 * `driver.json` says what a driver is and `profile.json` says how it maps a device; this
 * file says what the form asks. It is JSON rather than code for the same reason a package's
 * `configSchema` is: it has to be served to the web UI, which cannot execute a bundle, and
 * validated by the API, which does not load one. The grammar is deliberately small - a handful of
 * field types and the checks a form can show as it is typed - because anything a profile cannot
 * express in JSON belongs in a code bundle, not in a richer form language.
 *
 * Two groups, one per column of `registry.integrations`: `transport` becomes `transport_config`,
 * the settings the transport opens a connection with, and `options` becomes `options`, whatever
 * the integration itself takes. Each group may also carry `constants`: values the bundle fixes
 * and the owner never sees - a printer that only ever logs in as `bblp` says so here, and the
 * form has one field fewer.
 */
import { z } from 'zod';

import type { JsonObject, JsonValue } from './json.js';

/** A field key: an identifier, so it can be a JSON key and a profile path segment. */
const KEY_PATTERN = /^[a-z][A-Za-z0-9]{0,63}$/u;

/** How many fields one group may ask for. A form longer than this is a wizard, not a form. */
const MAXIMUM_FIELDS = 32;

/** Validates a field key. */
const keySchema = z.string().regex(KEY_PATTERN, 'Must be a camelCase identifier');

/**
 * A regular expression source, checked to compile so a typo in a bundle fails at load rather
 * than on the first form.
 */
const patternSchema = z
  .string()
  .min(1)
  .max(256)
  .refine(
    (source) => {
      try {
        new RegExp(source, 'u');

        return true;
      } catch {
        return false;
      }
    },
    { message: 'Must be a valid regular expression' },
  );

/** What every field carries, whatever its type. */
const fieldBase = {
  key: keySchema,

  /** Shown beside the control. */
  label: z.string().min(1).max(64),

  /** Shown under it, for the thing the label cannot say. */
  help: z.string().max(256).optional(),

  /** Whether the form may be submitted without it. */
  isRequired: z.boolean().default(false),
};

/**
 * What a form says when a value does not match the field's `pattern`.
 *
 * Without one the report is the pattern itself, which tells a person nothing about what to type.
 * A bundle that holds an address to `^mqtts://` should say "the printer only speaks TLS" here.
 */
const patternMessageSchema = z.string().min(1).max(160);

/** Free text, held to a length and optionally to a pattern. */
const textFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('text'),
  placeholder: z.string().max(128).optional(),
  pattern: patternSchema.optional(),
  patternMessage: patternMessageSchema.optional(),
  minLength: z.int().min(0).max(4096).optional(),
  maxLength: z.int().min(1).max(4096).default(512),
  default: z.string().optional(),
});

/**
 * A value that is stored sealed and never shown back. Like text, but with nothing a form could
 * prefill: a default secret is a published one.
 */
const secretFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('secret'),
  pattern: patternSchema.optional(),
  patternMessage: patternMessageSchema.optional(),
  minLength: z.int().min(0).max(4096).optional(),
  maxLength: z.int().min(1).max(4096).default(512),
});

/** A number, optionally whole and within a range. */
const numberFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('number'),
  min: z.number().optional(),
  max: z.number().optional(),
  isInteger: z.boolean().default(false),

  /** Shown after the control: `ms`, `°C`. */
  unit: z.string().max(16).optional(),
  default: z.number().optional(),

  /**
   * Below this the form warns, without refusing: a value that works but costs something, like
   * asking a device for its state every second.
   */
  warnBelow: z.number().optional(),

  /** What the warning says. Without one the form says the value is lower than advised. */
  warning: z.string().min(1).max(160).optional(),
});

/** On or off. */
const booleanFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('boolean'),
  default: z.boolean().optional(),
});

/** One of a fixed list. */
const choiceFieldSchema = z
  .strictObject({
    ...fieldBase,
    type: z.literal('choice'),
    choices: z
      .array(z.strictObject({ value: z.string().min(1).max(64), label: z.string().min(1).max(64) }))
      .min(1)
      .max(64),
    default: z.string().optional(),
  })
  .refine(
    (field) =>
      field.default === undefined || field.choices.some((choice) => choice.value === field.default),
    { message: 'The default must be one of the choices', path: ['default'] },
  );

/** Several strings - addresses, topics - each held to the same pattern. */
const listFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('list'),
  placeholder: z.string().max(128).optional(),
  minItems: z.int().min(0).max(64).default(0),
  maxItems: z.int().min(1).max(64).default(64),
  pattern: patternSchema.optional(),
  patternMessage: patternMessageSchema.optional(),
});

/** Validates one field of a group. */
export const setupFieldSchema = z.discriminatedUnion('type', [
  textFieldSchema,
  secretFieldSchema,
  numberFieldSchema,
  booleanFieldSchema,
  choiceFieldSchema,
  listFieldSchema,
]);

/** One field of a group. */
export type SetupField = z.output<typeof setupFieldSchema>;

/** The types a field may have. */
export type SetupFieldType = SetupField['type'];

/** Validates one group: what the bundle fixes and what it asks. */
export const setupGroupSchema = z
  .strictObject({
    /** Values the bundle sets and the form never shows. */
    constants: z.record(keySchema, z.union([z.string(), z.number(), z.boolean()])).default({}),

    /** What the form asks, in this order. */
    fields: z.array(setupFieldSchema).max(MAXIMUM_FIELDS).default([]),
  })
  .superRefine((group, context) => {
    const seen = new Set<string>();

    for (const [index, field] of group.fields.entries()) {
      if (seen.has(field.key)) {
        context.addIssue({
          code: 'custom',
          message: `Field ${field.key} is declared twice`,
          path: ['fields', index, 'key'],
        });
      }

      if (field.key in group.constants) {
        context.addIssue({
          code: 'custom',
          message: `${field.key} is both a constant and a field`,
          path: ['fields', index, 'key'],
        });
      }

      seen.add(field.key);
    }
  });

/** One group of a declaration. */
export type SetupGroup = z.output<typeof setupGroupSchema>;

/** The option `polling` becomes: how many seconds pass between two reads of a device. */
export const POLL_INTERVAL_KEY = 'pollInterval';

/** The longest a device may go unread, in seconds: a day. */
const MAXIMUM_POLL_SECONDS = 86_400;

/** A number of seconds between two reads. Whole, and never 0: 0 would mean "as fast as you can". */
const pollSecondsSchema = z.int().min(1).max(MAXIMUM_POLL_SECONDS);

/**
 * How often a device that is asked rather than told is read, and what the owner may change it to.
 *
 * A bundle states it once, and the platform turns it into an option the owner sees on the
 * device's form - "Update every … s" - with the bounds and the warning below. The profile's
 * `everyMs` stays the read the device gets before anyone has chosen; the chosen interval replaces
 * it in every subscription that has one.
 */
export const setupPollingSchema = z
  .strictObject({
    /** The interval a new device gets, in seconds. */
    default: pollSecondsSchema,

    /** The shortest the owner may choose. */
    min: pollSecondsSchema.default(1),

    /** The longest the owner may choose. */
    max: pollSecondsSchema.default(MAXIMUM_POLL_SECONDS),

    /** Below this the form warns that the device and the network pay for it. */
    warnBelow: pollSecondsSchema.optional(),
  })
  .refine((polling) => polling.min <= polling.default && polling.default <= polling.max, {
    message: 'The default must lie between min and max',
    path: ['default'],
  });

/** How often a polled device is read, parsed. */
export type SetupPolling = z.output<typeof setupPollingSchema>;

/** Validates a whole `setup.json`. */
export const integrationSetupSchema = z
  .strictObject({
    /** Becomes `registry.integrations.transport_config`. */
    transport: setupGroupSchema,

    /** Becomes `registry.integrations.options`. Most bundles have nothing to put here. */
    options: setupGroupSchema.default({ constants: {}, fields: [] }),

    /** For a device that is polled: how often, and within what the owner may change it. */
    polling: setupPollingSchema.optional(),
  })
  .superRefine((setup, context) => {
    if (setup.polling === undefined) {
      return;
    }

    for (const group of ['transport', 'options'] as const) {
      const taken =
        setup[group].fields.some((field) => field.key === POLL_INTERVAL_KEY) ||
        POLL_INTERVAL_KEY in setup[group].constants;

      if (taken) {
        context.addIssue({
          code: 'custom',
          message: `${POLL_INTERVAL_KEY} is what polling asks for; do not declare it as well`,
          path: [group],
        });
      }
    }
  });

/** A whole `setup.json`, parsed. */
export type IntegrationSetup = z.output<typeof integrationSetupSchema>;

/**
 * The field `polling` puts on a device's form.
 *
 * @param polling - The bundle's statement.
 * @returns A whole number of seconds, required, within the bundle's bounds.
 */
function pollIntervalField(polling: SetupPolling): SetupField {
  return {
    key: POLL_INTERVAL_KEY,
    type: 'number',
    label: 'Update every',
    help: 'How often the hub asks the device for its state.',
    isRequired: true,
    isInteger: true,
    unit: 's',
    min: polling.min,
    max: polling.max,
    default: polling.default,
    ...(polling.warnBelow === undefined
      ? {}
      : {
          warnBelow: polling.warnBelow,
          warning: `More often than every ${String(polling.warnBelow)} s loads the device and the network.`,
        }),
  };
}

/**
 * Turns a declaration's `polling` into the option it stands for.
 *
 * What the hub serves: the interval is then an ordinary field of `options`, validated, stored and
 * changed by the path every other option takes, and a client never has to know `polling` exists.
 *
 * @param setup - The declaration, as `setup.json` says it.
 * @returns The same declaration with `pollInterval` last among the options and no `polling`, or
 * the declaration itself when it has none.
 */
export function withPollingField(setup: IntegrationSetup): IntegrationSetup {
  if (setup.polling === undefined) {
    return setup;
  }

  const { polling, ...rest } = setup;

  return {
    ...rest,
    options: { ...rest.options, fields: [...rest.options.fields, pollIntervalField(polling)] },
  };
}

/**
 * The interval an instance's options ask for, in milliseconds.
 *
 * @param options - The instance's options.
 * @returns The chosen interval, or undefined when the options hold none - a device added before
 * its bundle said it could be polled, or one that is not polled at all.
 */
export function pollIntervalMsOf(options: JsonObject): number | undefined {
  const seconds = options[POLL_INTERVAL_KEY];

  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 1
    ? seconds * 1000
    : undefined;
}

/**
 * Whether a value schema describes a whole configuration or a change to one.
 *
 * `complete` is a create: required fields must be there and declared defaults fill the rest.
 * `partial` is a `PATCH`: every field is optional and nothing is filled in, because the API
 * merges the change over the stored row and a default here would overwrite a chosen value.
 */
export type SetupValueMode = 'complete' | 'partial';

/**
 * Builds the schema for one field's value.
 *
 * @param field - The declaration.
 * @returns A schema for the value the form collects for it.
 */
function valueOf(field: SetupField): z.ZodType<JsonValue> {
  switch (field.type) {
    case 'text':
    case 'secret': {
      let text = z
        .string()
        .min(field.minLength ?? (field.isRequired ? 1 : 0))
        .max(field.maxLength);

      if (field.pattern !== undefined) {
        text = text.regex(new RegExp(field.pattern, 'u'), field.patternMessage);
      }

      return text;
    }
    case 'number': {
      let number = field.isInteger ? z.int() : z.number();

      if (field.min !== undefined) {
        number = number.min(field.min);
      }

      if (field.max !== undefined) {
        number = number.max(field.max);
      }

      return number;
    }
    case 'boolean':
      return z.boolean();
    case 'choice':
      return z.enum(field.choices.map((choice) => choice.value));
    case 'list': {
      const item =
        field.pattern === undefined
          ? z.string().min(1).max(512)
          : z.string().min(1).max(512).regex(new RegExp(field.pattern, 'u'), field.patternMessage);

      return z.array(item).min(field.minItems).max(field.maxItems);
    }
  }
}

/**
 * The declared default of a field, when it has one.
 *
 * @param field - The declaration.
 * @returns The default, or undefined for a field without one - secrets and lists never have one.
 */
function defaultOf(field: SetupField): JsonValue | undefined {
  switch (field.type) {
    case 'text':
    case 'number':
    case 'boolean':
    case 'choice':
      return field.default;
    case 'secret':
    case 'list':
      return undefined;
  }
}

/**
 * Builds the schema the values of one group must satisfy.
 *
 * Strict: a key the bundle did not declare is refused, and that includes its constants. A client
 * that could send a constant could send `shouldVerifyCertificate: true` to a printer that only
 * works without it, and the instance would look configured while never connecting.
 *
 * @param group - The declaration.
 * @param mode - Whole configuration or change.
 * @returns The schema. Its output holds only the keys that were present or defaulted.
 */
export function setupValueSchema(group: SetupGroup, mode: SetupValueMode): z.ZodType<JsonObject> {
  const shape: Record<string, z.ZodType<JsonValue | undefined>> = {};

  for (const field of group.fields) {
    const value = valueOf(field);
    const fallback = defaultOf(field);

    if (mode === 'partial') {
      shape[field.key] = value.optional();
    } else if (fallback !== undefined) {
      shape[field.key] = value.default(fallback);
    } else {
      shape[field.key] = field.isRequired ? value : value.optional();
    }
  }

  return z.strictObject(shape).transform((values): JsonObject => {
    const present: JsonObject = {};

    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) {
        present[key] = value;
      }
    }

    return present;
  });
}

/**
 * The keys of a group whose values are secrets.
 *
 * @param group - The declaration.
 * @returns The keys, in declaration order.
 */
export function secretKeysOf(group: SetupGroup): string[] {
  return group.fields.filter((field) => field.type === 'secret').map((field) => field.key);
}

/**
 * Whether a declaration has anything the owner must answer before it is complete.
 *
 * What decides whether a vendor needs setting up before a device of theirs can be added: a
 * vendor whose fields are all optional, or all constants, never does. Constants are the
 * bundle's answers, not the owner's, so they never count.
 *
 * @param setup - The declaration.
 * @returns True when either group has a required field.
 */
export function asksAnythingRequired(setup: IntegrationSetup): boolean {
  return [...setup.transport.fields, ...setup.options.fields].some((field) => field.isRequired);
}
