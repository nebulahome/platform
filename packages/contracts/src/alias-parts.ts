/**
 * A part of an alias as it is stored: where its value comes from, and its own settings.
 *
 * One shape for the API, the file and `core`. A part is `{ from, ...source, ...settings }`:
 *
 * - `stored` keeps a `value` Nebula holds and commands change;
 * - `entity` reads one entity, and forwards commands to it;
 * - `entities` combines several by a `rule`, and forwards commands to all of them;
 * - `formula` evaluates an expression over entity ids;
 * - `code` returns what a function of the alias's code returns.
 *
 * A part may also hold actions (`alias-actions.ts`): what it does when a command reaches it or its
 * value changes. A command a part has an action for runs that action instead of being forwarded or
 * refused.
 *
 * The settings (`min`, `max`, `step`, `offered`, `options`…) belong to the part whatever its
 * source, because they become the alias's capability params - the range a card's dial allows, the
 * modes a thermostat offers - and those must not vanish when the value moves to another source.
 */
import { z } from 'zod';

import {
  aliasActionSchema,
  aliasStepFormulas,
  COMMAND_VALUE_PREFIX,
  MAX_ALIAS_ACTIONS,
} from './alias-actions.js';
import type { Expectation } from './alias-code/fit.js';
import { partCommands } from './alias-commands.js';
import { aliasExpressionNames } from './alias-expression.js';
import {
  ALIAS_RULES,
  ALIAS_RULES_BY_KIND,
  ALIAS_SOURCES_BY_KIND,
  aliasTypeParts,
  type AliasCustomField,
  type AliasPartDef,
  type AliasTypeDef,
} from './alias-types.js';
import {
  CAPABILITY_DEFINITIONS,
  LOCATION_SOURCES,
  NUMBER_MODES,
  THERMOSTAT_MODES,
  VACUUM_CLEAN_MODES,
  type CapabilityName,
} from './capabilities.js';
import { entityIdSchema } from './entity-id.js';
import { jsonObjectSchema, type JsonObject } from './json.js';

/** The key of a part: a capability field in snake case. */
export const aliasPartKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/u, 'Must be a part key in snake case');

/** A name a part offers (a preset, a source, a fan mode). */
const offeredNameSchema = z.string().trim().min(1).max(64);

/** A part's value as it is stored or returned: a scalar, a colour, a list, or nothing. */
export const aliasPartValueSchema = z.union([
  z.number(),
  z.boolean(),
  z.string().max(4_096),
  z.null(),
  z.object({ hue: z.number().min(0).max(360), saturation: z.number().min(0).max(100) }),
  z.array(z.unknown()).max(64),
]);

/** A part's value. */
export type AliasPartValue = z.output<typeof aliasPartValueSchema>;

/** The settings any part may carry, besides its source. Which apply depends on the part. */
const settingsShape = {
  /** For a number: the lowest it may be set to. */
  min: z.number().optional(),

  /** For a number: the highest it may be set to. */
  max: z.number().optional(),

  /** For a number: the step it is set in. */
  step: z.number().gt(0).optional(),

  /** For an enum whose list is the alias's own, or a mode subset: the names it offers. */
  offered: z.array(offeredNameSchema).max(64).optional(),

  /** For a select: its options, each with a label. */
  options: z
    .array(z.object({ value: offeredNameSchema, label: offeredNameSchema }))
    .min(1)
    .max(64)
    .optional(),

  /** For a number entity: a slider, a box, or whichever fits. */
  numberMode: z.enum(NUMBER_MODES).optional(),

  /** For a switch: its state is the last command, not a reading. */
  assumed: z.boolean().optional(),

  /** For a lock: whether a code is asked for, and how many digits it has. */
  code: z.object({ required: z.boolean(), length: z.int().min(1).max(16).optional() }).optional(),

  /** For a fan's speed: how many speeds it has (0: any percentage). */
  speeds: z.int().min(0).max(100).optional(),

  /** For a location: where it comes from. */
  locationSource: z.enum(LOCATION_SOURCES).optional(),

  /** What the part does when a command reaches it or its value changes. */
  actions: z.array(aliasActionSchema).max(MAX_ALIAS_ACTIONS).optional(),
};

/** Where a part takes its value from, and its settings. */
export const aliasPartConfigSchema = z.discriminatedUnion('from', [
  z.object({
    from: z.literal('stored'),

    /** What it holds now; the type's starting value when absent. */
    value: aliasPartValueSchema.optional(),
    ...settingsShape,
  }),
  z.object({ from: z.literal('entity'), entity: entityIdSchema, ...settingsShape }),
  z.object({
    from: z.literal('entities'),
    entities: z.array(entityIdSchema).min(1).max(32),
    rule: z.enum(ALIAS_RULES),
    ...settingsShape,
  }),
  z.object({
    from: z.literal('formula'),
    formula: z.string().trim().min(1).max(2_000),
    ...settingsShape,
  }),
  z.object({
    from: z.literal('code'),
    function: z.string().regex(/^[a-z_][a-z0-9_]{0,63}$/u, 'Must be a function name'),
    ...settingsShape,
  }),
]);

/** One part, as stored. */
export type AliasPartConfig = z.output<typeof aliasPartConfigSchema>;

/** Every part of an alias, by key. */
export const aliasPartsSchema = z
  .record(aliasPartKeySchema, aliasPartConfigSchema)
  .refine((parts) => Object.keys(parts).length <= 64, 'At most 64 parts');

/** Every part of an alias, by key. */
export type AliasParts = z.output<typeof aliasPartsSchema>;

/** The settings of a part, without its source. */
export type AliasPartSettings = Omit<
  Extract<AliasPartConfig, { from: 'stored' }>,
  'from' | 'value'
>;

/** The default settings of a part, by `capability:key`, where the capability needs them. */
const DEFAULT_SETTINGS: Readonly<Record<string, AliasPartSettings>> = {
  'on_off:on': { assumed: false },
  'color_temp:color_temp': { min: 153, max: 500 },
  'effect:effect': { offered: ['Colour loop'] },
  'fan:speed': { speeds: 0 },
  'fan:preset': { offered: ['Auto', 'Sleep'] },
  'lock:lock_state': { code: { required: false } },
  'thermostat:target_temperature': { min: 5, max: 35, step: 0.5 },
  'thermostat:mode': { offered: [...THERMOSTAT_MODES] },
  'thermostat:target_humidity': { min: 30, max: 99 },
  'thermostat:preset': { offered: ['comfort', 'eco', 'away'] },
  'thermostat:fan_mode': { offered: ['auto', 'low', 'medium', 'high'] },
  'thermostat:swing_mode': { offered: ['off', 'on'] },
  'thermostat:swing_horizontal_mode': { offered: ['off', 'on'] },
  'media_player:source': { offered: ['Source 1', 'Source 2'] },
  'media_player:sound_mode': { offered: ['Normal'] },
  'vacuum:fan_speed': { offered: ['Quiet', 'Standard', 'Turbo'] },
  'vacuum:water_level': { offered: ['Low', 'Medium', 'High'] },
  'select:option': {
    options: [
      { value: 'option_1', label: 'Option 1' },
      { value: 'option_2', label: 'Option 2' },
    ],
  },
  'number:value': { min: 0, max: 100, step: 1, numberMode: 'auto' },
  'location:zone': { locationSource: 'gps' },
  'sensor_text:value': { offered: [] },
};

/**
 * A new part: Stored, holding the type's starting value, with the settings its capability needs.
 *
 * Every part starts Stored, so an alias works from the moment it is created.
 *
 * @param def - The part.
 * @returns Its stored configuration.
 */
export function defaultAliasPart(def: AliasPartDef): AliasPartConfig {
  const settings = DEFAULT_SETTINGS[`${def.capability}:${def.key}`] ?? {};

  if (def.kind === 'picture' || def.kind === 'rooms') {
    // Only another entity has a picture or a map: there is nothing to store.
    return { from: 'stored', value: null, ...settings };
  }

  return { from: 'stored', value: def.initial as AliasPartValue, ...settings };
}

/**
 * The parts a new alias starts with: every required part, Stored.
 *
 * @param type - The type.
 * @param customFields - For a custom type, its package entity type's fields.
 * @returns The parts, by key.
 */
export function defaultAliasParts(
  type: AliasTypeDef,
  customFields?: readonly AliasCustomField[],
): AliasParts {
  const parts: AliasParts = {};

  for (const def of aliasTypeParts(type, customFields)) {
    if (def.isRequired) {
      parts[def.key] = defaultAliasPart(def);
    }
  }

  return parts;
}

/**
 * The parts a part is added and removed with: itself, or every part of its group.
 *
 * @param type - The type.
 * @param def - The part.
 * @param customFields - For a custom type, its fields.
 * @returns The parts of the group, in the type's order.
 */
export function aliasPartGroup(
  type: AliasTypeDef,
  def: AliasPartDef,
  customFields?: readonly AliasCustomField[],
): AliasPartDef[] {
  return def.group === undefined
    ? [def]
    : aliasTypeParts(type, customFields).filter((candidate) => candidate.group === def.group);
}

/**
 * The names an enum part may take: the capability's own list, or the alias's offered list.
 *
 * @param def - The part.
 * @param config - Its configuration.
 * @returns The names, or undefined when any text is accepted.
 */
export function aliasEnumValues(
  def: AliasPartDef,
  config: AliasPartConfig | undefined,
): readonly string[] | undefined {
  if (def.kind !== 'enum') {
    return undefined;
  }

  if (config?.options !== undefined) {
    return config.options.map((option) => option.value);
  }

  if (def.isOffered === true) {
    return config?.offered ?? [];
  }

  // A fixed list may be narrowed: a thermostat that only heats offers off and heat.
  if (config?.offered !== undefined && config.offered.length > 0) {
    return def.values?.filter((value) => config.offered?.includes(value));
  }

  return def.values;
}

/**
 * Whether a value fits a part, as a sentence when it does not.
 *
 * @param def - The part.
 * @param config - Its configuration (for the range and the offered names).
 * @param value - The value.
 * @returns Null when it fits, else why not.
 */
export function aliasValueProblem(
  def: AliasPartDef,
  config: AliasPartConfig | undefined,
  value: unknown,
): string | null {
  if (value === null) {
    return def.isNullable === true || def.kind === 'press' || def.kind === 'picture'
      ? null
      : `${def.label} needs a value`;
  }

  switch (def.kind) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return `${def.label} must be a number`;
      }

      const low = Math.max(config?.min ?? -Infinity, def.bounds?.min ?? -Infinity);
      const high = Math.min(config?.max ?? Infinity, def.bounds?.max ?? Infinity);

      return value < low || value > high
        ? `${def.label} must be between ${String(low)} and ${String(high)}`
        : null;
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : `${def.label} must be on or off`;
    case 'enum': {
      const values = aliasEnumValues(def, config);

      if (typeof value !== 'string') {
        return `${def.label} must be one of its names`;
      }

      return values === undefined || values.includes(value)
        ? null
        : `${def.label} must be one of ${values.join(', ')}`;
    }
    case 'text':
      return typeof value === 'string' && value.length <= 512
        ? null
        : `${def.label} must be a text of at most 512 characters`;
    case 'color':
      return typeof value === 'object' &&
        !Array.isArray(value) &&
        typeof (value as { hue?: unknown }).hue === 'number' &&
        typeof (value as { saturation?: unknown }).saturation === 'number'
        ? null
        : `${def.label} must be a hue and a saturation`;
    case 'rooms':
      return Array.isArray(value) ? null : `${def.label} must be a list of rooms`;
    case 'picture':
    case 'press':
      return null;
  }
}

/** One problem with an alias's parts: where, and what. */
export type AliasPartIssue = {
  /** The part's key, or null for the alias as a whole. */
  readonly part: string | null;
  readonly message: string;
};

/**
 * What is wrong with an alias's parts for its type.
 *
 * The shape of each part is the schema's; this checks them against the type: no part it does not
 * have, every required part there, a source the part's kind can take, a rule its kind combines
 * by, a stored value that fits, a range that is one, a group complete.
 *
 * @param type - The type.
 * @param parts - The parts.
 * @param customFields - For a custom type, its fields.
 * @returns The problems; empty when there is none.
 */
export function aliasPartIssues(
  type: AliasTypeDef,
  parts: AliasParts,
  customFields?: readonly AliasCustomField[],
): AliasPartIssue[] {
  const issues: AliasPartIssue[] = [];
  const defs = aliasTypeParts(type, customFields);

  for (const key of Object.keys(parts)) {
    if (!defs.some((def) => def.key === key)) {
      issues.push({ part: key, message: `A ${type.label.toLowerCase()} has no part ${key}` });
    }
  }

  for (const def of defs) {
    const config = parts[def.key];

    if (config === undefined) {
      if (def.isRequired) {
        issues.push({ part: def.key, message: `${def.label} is required` });
      }

      continue;
    }

    if (def.group !== undefined) {
      for (const other of defs.filter((candidate) => candidate.group === def.group)) {
        if (parts[other.key] === undefined) {
          issues.push({ part: other.key, message: `${other.label} goes with ${def.label}` });
        }
      }
    }

    if (!ALIAS_SOURCES_BY_KIND[def.kind].includes(config.from)) {
      issues.push({ part: def.key, message: `${def.label} cannot come from ${config.from}` });
      continue;
    }

    if (config.from === 'entities' && !ALIAS_RULES_BY_KIND[def.kind].includes(config.rule)) {
      issues.push({
        part: def.key,
        message: `${def.label} combines by ${ALIAS_RULES_BY_KIND[def.kind].join(' or ')}`,
      });
    }

    if (config.min !== undefined && config.max !== undefined && config.min > config.max) {
      issues.push({ part: def.key, message: `${def.label}: the lowest is above the highest` });
    }

    if (config.from === 'stored' && config.value !== undefined) {
      const problem = aliasValueProblem(def, config, config.value);

      if (problem !== null) {
        issues.push({ part: def.key, message: problem });
      }
    }

    issues.push(...actionIssues(defs, parts, def));
  }

  return dedupe(issues);
}

/**
 * What is wrong with the actions of a part: a command it does not take, a number compared on a part
 * that is not one, an action with nothing to do, a command value read where there is no command.
 *
 * @param defs - The alias's parts.
 * @param parts - The parts it has.
 * @param def - The part.
 * @returns The problems.
 */
function actionIssues(
  defs: readonly AliasPartDef[],
  parts: AliasParts,
  def: AliasPartDef,
): AliasPartIssue[] {
  const issues: AliasPartIssue[] = [];
  const actions = parts[def.key]?.actions ?? [];
  const commands = partCommands(defs, parts, def.key);
  const ids = new Set<string>();

  for (const action of actions) {
    if (ids.has(action.id)) {
      issues.push({ part: def.key, message: `${def.label}: two actions are both ${action.id}` });
    }

    ids.add(action.id);

    if (action.when.kind === 'command' && !commands.includes(action.when.command)) {
      issues.push({ part: def.key, message: `${def.label} takes no ${action.when.command}` });
    }

    if (
      action.when.kind === 'change' &&
      action.when.change.kind === 'numeric' &&
      def.kind !== 'number'
    ) {
      issues.push({ part: def.key, message: `${def.label} is not a number to compare` });
    }

    if (action.then.length === 0) {
      issues.push({ part: def.key, message: `${def.label}: an action has nothing to do` });
    }

    const readsCommand = aliasStepFormulas(action.then).some((formula) =>
      aliasExpressionNames(formula).some((name) => name.startsWith(COMMAND_VALUE_PREFIX)),
    );

    if (readsCommand && action.when.kind !== 'command') {
      issues.push({
        part: def.key,
        message: `${def.label}: command values are read only by an action on a command`,
      });
    }
  }

  return issues;
}

/**
 * The same problem said once.
 *
 * @param issues - The problems.
 * @returns Them, without repeats.
 */
function dedupe(issues: AliasPartIssue[]): AliasPartIssue[] {
  const seen = new Set<string>();

  return issues.filter((issue) => {
    const key = `${issue.part ?? ''}\u0000${issue.message}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

/**
 * Every entity a part reads directly, by its source (formula and code are read by their
 * scanners).
 *
 * @param config - The part.
 * @returns The entity ids.
 */
export function aliasPartEntities(config: AliasPartConfig): string[] {
  switch (config.from) {
    case 'entity':
      return [config.entity];
    case 'entities':
      return [...config.entities];
    default:
      return [];
  }
}

/**
 * What a code part's function must return: one answer for the API's checker and `core`'s runs.
 *
 * @param def - The part.
 * @param config - Its configuration.
 * @returns The expectation the function is held to.
 */
export function aliasCodeExpectation(def: AliasPartDef, config: AliasPartConfig): Expectation {
  if (def.kind === 'enum') {
    const values = config.options?.map((option) => option.value) ?? config.offered ?? def.values;

    return values === undefined ? { kind: 'text' } : { kind: 'enum', values };
  }

  return {
    kind:
      def.kind === 'number' || def.kind === 'boolean' || def.kind === 'color' ? def.kind : 'text',
  };
}

/** Looks up an entity's params for one capability, when the caller knows them. */
export type AliasEntityParams = (entityId: string, capability: CapabilityName) => JsonObject | null;

/**
 * Whether a part is there and, if so, its configuration.
 *
 * @param parts - The parts.
 * @param key - The part's key.
 * @returns The configuration, or undefined.
 */
const get = (parts: AliasParts, key: string): AliasPartConfig | undefined => parts[key];

/**
 * The offered names of a part, or an empty list.
 *
 * @param parts - The parts.
 * @param key - The part's key.
 * @returns The names.
 */
const offered = (parts: AliasParts, key: string): string[] => [...(get(parts, key)?.offered ?? [])];

/** The package entity type a custom alias is, for its `custom` params. */
type CustomRef = { readonly packageId: string; readonly type: string };

/**
 * The params each capability of an alias declares, worked out from its parts.
 *
 * What a card draws and what `core` checks a command against: the range of the target dial, the
 * modes offered, whether a cover tilts. A capability whose every part comes from one entity takes
 * that entity's own params instead, so a thermostat bound to a real one offers what it offers.
 * Every result is checked against the capability's params schema; one that does not fit falls
 * back to the schema's own defaults.
 *
 * @param capabilities - The capabilities the alias declares.
 * @param parts - Its parts.
 * @param defs - Its type's parts.
 * @param entityParams - The params of the entities it reads, when known.
 * @param custom - For a custom alias, its package entity type.
 * @returns The params, by capability.
 */
export function aliasCapabilityParams(
  capabilities: readonly CapabilityName[],
  parts: AliasParts,
  defs: readonly AliasPartDef[],
  entityParams?: AliasEntityParams,
  custom?: CustomRef,
): Record<string, JsonObject> {
  const result: Record<string, JsonObject> = {};

  /**
   * Whether the alias has a part.
   *
   * @param key - The part's key.
   * @returns True when it is there.
   */
  const has = (key: string): boolean => parts[key] !== undefined;

  for (const capability of capabilities) {
    const own = ownParams(capability, parts, has, custom);
    const keys = defs.filter((def) => def.capability === capability && has(def.key));
    const entities = new Set(
      keys.flatMap((def) => {
        const config = parts[def.key];
        return config?.from === 'entity' ? [config.entity] : ['\u0000'];
      }),
    );
    const [only] = entities;
    const borrowed =
      entities.size === 1 && only !== undefined && only !== '\u0000' && entityParams !== undefined
        ? entityParams(only, capability)
        : null;
    const schema: z.ZodType = CAPABILITY_DEFINITIONS[capability].params;
    const parsed = schema.safeParse(borrowed ?? own);
    const fallback = schema.safeParse(own);
    const chosen = parsed.success ? parsed.data : fallback.success ? fallback.data : {};
    const json = jsonObjectSchema.safeParse(chosen);

    result[capability] = json.success ? json.data : {};
  }

  return result;
}

/**
 * The params of one capability from the alias's own parts.
 *
 * @param capability - The capability.
 * @param parts - The parts.
 * @param has - Whether a part is there.
 * @param custom - For a custom alias, its package entity type.
 * @returns The params, before the schema's check.
 */
function ownParams(
  capability: CapabilityName,
  parts: AliasParts,
  has: (key: string) => boolean,
  custom?: CustomRef,
): JsonObject {
  switch (capability) {
    case 'on_off':
      return { isAssumed: get(parts, 'on')?.assumed ?? false };
    case 'color_hs':
      return { hasWhiteChannel: has('white') };
    case 'color_temp':
      return {
        minMireds: Math.round(get(parts, 'color_temp')?.min ?? 153),
        maxMireds: Math.round(get(parts, 'color_temp')?.max ?? 500),
      };
    case 'effect':
      return { effects: offered(parts, 'effect') };
    case 'cover':
      return { hasPosition: true, hasTilt: has('tilt') };
    case 'lock': {
      const code = get(parts, 'lock_state')?.code;

      return {
        hasCode: code?.required ?? false,
        ...(code?.length === undefined ? {} : { codeLength: code.length }),
        canOpen: has('is_open'),
      };
    }
    case 'thermostat': {
      const target = get(parts, 'target_temperature');
      const humidity = get(parts, 'target_humidity');
      const modes = offered(parts, 'mode');

      return {
        supportedModes: modes.length > 0 ? modes : [...THERMOSTAT_MODES],
        minTemperature: target?.min ?? 5,
        maxTemperature: target?.max ?? 35,
        temperatureStep: target?.step ?? 0.5,
        hasTargetRange: has('target_temperature_low'),
        hasTargetHumidity: has('target_humidity'),
        minHumidity: humidity?.min ?? 30,
        maxHumidity: humidity?.max ?? 99,
        presets: has('preset') ? offered(parts, 'preset') : [],
        fanModes: has('fan_mode') ? offered(parts, 'fan_mode') : [],
        swingModes: has('swing_mode') ? offered(parts, 'swing_mode') : [],
        swingHorizontalModes: has('swing_horizontal_mode')
          ? offered(parts, 'swing_horizontal_mode')
          : [],
      };
    }
    case 'sensor_text':
      return { options: offered(parts, 'value') };
    case 'media_player':
      return {
        supportedSources: has('source') ? offered(parts, 'source') : [],
        soundModes: has('sound_mode') ? offered(parts, 'sound_mode') : [],
        hasSeek: has('media_position'),
        hasVolume: true,
        hasVolumeStep: false,
        canStop: true,
        canSkip: true,
        hasShuffle: has('shuffled'),
        hasRepeat: has('repeat'),
      };
    case 'camera':
      return {
        hasSnapshot: has('snapshot'),
        hasStream: true,
        hasRecording: true,
        hasMotionDetection: has('motion_detection'),
      };
    case 'update':
      return { canInstall: true, hasProgress: has('progress') };
    case 'lawn_mower':
      return { canPause: true, canStop: true, canDock: true, canResume: true };
    case 'vacuum':
      return {
        canPause: true,
        canStop: true,
        canDock: true,
        canLocate: true,
        canCleanRooms: has('rooms'),
        canResume: true,
        canCleanSpot: true,
        fanSpeeds: has('fan_speed') ? offered(parts, 'fan_speed') : [],
        cleanModes: has('clean_mode') ? [...VACUUM_CLEAN_MODES] : [],
        waterLevels: has('water_level') ? offered(parts, 'water_level') : [],
      };
    case 'select':
      return {
        options: get(parts, 'option')?.options ?? [{ value: 'option_1', label: 'Option 1' }],
      };
    case 'number': {
      const value = get(parts, 'value');

      return {
        min: value?.min ?? 0,
        max: value?.max ?? 100,
        step: value?.step ?? 1,
        mode: value?.numberMode ?? 'auto',
      };
    }
    case 'fan':
      return {
        speedCount: get(parts, 'speed')?.speeds ?? 0,
        presets: has('preset') ? offered(parts, 'preset') : [],
        canOscillate: has('oscillating'),
        canReverse: has('direction'),
      };
    case 'location':
      return { source: get(parts, 'zone')?.locationSource ?? 'gps' };
    case 'custom':
      return custom === undefined ? {} : { packageId: custom.packageId, type: custom.type };
    default:
      return {};
  }
}
