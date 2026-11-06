/**
 * The entity lab's model: one row per entity being tried out - its domain, the capabilities it
 * declares, each one's params and state, its class and unit, and whether it answers - and the
 * entity the dialog is drawn from, built from it.
 *
 * The rows come from the contracts: a domain's capabilities from `DOMAIN_CAPABILITIES`, each
 * capability's fields from its schemas. Whatever is built is checked against those same schemas,
 * so the lab says at once when a combination is one an adapter could not report.
 */
import {
  BINARY_SENSOR_CLASSES,
  CAPABILITY_DEFINITIONS,
  DOMAIN_CAPABILITIES,
  SENSOR_CLASS_LIST,
  entityIdSchema,
  type CapabilityName,
  type CapabilityState,
  type EntityDomain,
  type EntityStateClass,
  type EntityView,
  type JsonObject,
} from '@nebulahome/contracts';

import { sampleValue } from '@/testing/entity-lab/sample';
import { capabilityFields } from '@/testing/entity-lab/schema-fields';
import { anEntity } from '@/testing/fixtures';
import { LINKED_SAMPLE_ENTITIES } from '@/testing/linked-samples';

/** A capability's values in a row: its params and its state, field by field. */
export type LabValues = Readonly<Record<string, unknown>>;

/** One entity being tried out. */
export type LabRow = {
  /** Its key on the page. */
  readonly id: string;

  /** Its domain. */
  readonly domain: EntityDomain;

  /** The capabilities it declares. */
  readonly capabilities: readonly CapabilityName[];

  /** Each capability's params, field by field; a field absent is one not declared. */
  readonly params: Readonly<Partial<Record<CapabilityName, LabValues>>>;

  /** Each capability's state, field by field; a field absent is one not reported. */
  readonly state: Readonly<Partial<Record<CapabilityName, LabValues>>>;

  /** Its class, unit, state class and decimals. */
  readonly deviceClass: string | null;
  readonly unit: string | null;
  readonly stateClass: EntityStateClass | null;
  readonly precision: number | null;

  /** Whether it answers, whether a command is on its way, and whether it is enabled. */
  readonly isAvailable: boolean;
  readonly isSending: boolean;
  readonly isEnabled: boolean;

  /** Whether it is read two ways, and the battery of its device (null for none). */
  readonly isLinked: boolean;
  readonly battery: number | null;
};

/**
 * Starts a capability's values from its schema: required and defaulted fields filled in,
 * optional ones left out.
 *
 * @param capability - The capability.
 * @returns Its params and its state.
 */
export function initialValues(capability: CapabilityName): {
  params: Record<string, unknown>;
  state: Record<string, unknown>;
} {
  const { params, state } = capabilityFields(capability);
  /**
   * Fills in the fields that must be there or have a default.
   *
   * @param fields - The schema's fields.
   * @returns Their values.
   */
  const fill = (fields: typeof params): Record<string, unknown> =>
    Object.fromEntries(
      fields
        .filter((field) => field.isRequired || field.hasDefault)
        .map((field) => [field.key, sampleValue(field)]),
    );

  return { params: fill(params), state: fill(state) };
}

/**
 * The classes a domain's entity may have, from the contracts' catalogues: the binary classes,
 * the sensor classes; none for a domain whose class is free text.
 *
 * @param domain - The domain.
 * @returns The classes, or null when any text goes.
 */
export function deviceClassesOf(domain: EntityDomain): readonly string[] | null {
  if (domain === 'binary_sensor') {
    return BINARY_SENSOR_CLASSES;
  }

  if (domain === 'sensor') {
    return SENSOR_CLASS_LIST.map((entry) => entry.id);
  }

  return null;
}

/**
 * A row for each way a domain's entity may be: one per capability it must have one of, each with
 * nothing optional on.
 *
 * @param domain - The domain.
 * @returns The rows.
 */
export function initialRows(domain: EntityDomain): LabRow[] {
  return DOMAIN_CAPABILITIES[domain].oneOf.map((capability) => {
    const values = initialValues(capability);
    const sensor =
      domain === 'sensor' && capability === 'sensor_numeric'
        ? SENSOR_CLASS_LIST.find((entry) => entry.id === 'temperature')
        : undefined;

    return {
      id: `${domain}-${capability}`,
      domain,
      capabilities: [capability],
      params: { [capability]: values.params },
      state: { [capability]: values.state },
      deviceClass: sensor?.id ?? (domain === 'binary_sensor' ? 'door' : null),
      unit: sensor?.canonicalUnit ?? null,
      stateClass: sensor === undefined ? null : 'measurement',
      precision: sensor === undefined ? null : 1,
      isAvailable: true,
      isSending: false,
      isEnabled: true,
      isLinked: false,
      battery: null,
    };
  });
}

/**
 * Switches an optional capability on or off in a row.
 *
 * @param row - The row.
 * @param capability - The capability.
 * @param isOn - Whether it is declared.
 * @returns The row as it now is.
 */
export function withCapability(row: LabRow, capability: CapabilityName, isOn: boolean): LabRow {
  if (!isOn) {
    return { ...row, capabilities: row.capabilities.filter((each) => each !== capability) };
  }

  const values = initialValues(capability);

  return {
    ...row,
    capabilities: [...row.capabilities, capability],
    params: { ...row.params, [capability]: row.params[capability] ?? values.params },
    state: { ...row.state, [capability]: row.state[capability] ?? values.state },
  };
}

/**
 * Picks which of a domain's must-have capabilities a row declares: a sensor reads a number or a
 * text.
 *
 * @param row - The row.
 * @param capability - The one now declared.
 * @returns The row as it now is.
 */
export function withOneOf(row: LabRow, capability: CapabilityName): LabRow {
  const others = DOMAIN_CAPABILITIES[row.domain].oneOf;

  return withCapability(
    { ...row, capabilities: row.capabilities.filter((each) => !others.includes(each)) },
    capability,
    true,
  );
}

/** What a row builds to: the entity, its state, and what the contracts say is wrong with it. */
export type LabBuild = {
  readonly entity: EntityView;
  readonly state: CapabilityState;
  readonly issues: readonly string[];
};

/**
 * Builds the entity a row describes, and checks it against the contracts.
 *
 * @param row - The row.
 * @param now - The time now, for when it last spoke.
 * @returns The entity, its state as the dialog reads it, and the problems found.
 */
export function buildRow(row: LabRow, now: number): LabBuild {
  const issues: string[] = [];
  const state: Record<string, unknown> = {};
  const capabilities = row.capabilities.map((capability) => {
    const definition = CAPABILITY_DEFINITIONS[capability];
    const params = definition.params.safeParse(row.params[capability] ?? {});
    const reported = definition.state.safeParse(row.state[capability] ?? {});

    if (!params.success) {
      issues.push(
        ...params.error.issues.map(
          (issue) => `${capability} params ${issue.path.join('.')}: ${issue.message}`,
        ),
      );
    }

    if (reported.success) {
      state[capability] = reported.data;
    } else {
      issues.push(
        ...reported.error.issues.map(
          (issue) => `${capability} state ${issue.path.join('.')}: ${issue.message}`,
        ),
      );
    }

    return { capability, params: (row.params[capability] ?? {}) as JsonObject };
  });
  // Round-tripped through JSON, as the API delivers it: an optional field is absent, not undefined.
  const json = JSON.parse(JSON.stringify(state)) as JsonObject;
  const silentFor = row.isAvailable ? 4000 : 3 * 3_600_000;
  const linked = row.isLinked ? (LINKED_SAMPLE_ENTITIES[0]?.linked ?? null) : null;
  const entity = anEntity({
    entityId: entityIdSchema.parse(`${row.domain}.lab_${row.id.replaceAll('-', '_')}`),
    domain: row.domain,
    name: labName(row),
    areaKey: 'living_room',
    areaName: 'Living room',
    capabilities,
    state: json,
    deviceClass: row.deviceClass,
    unitOfMeasurement: row.unit,
    stateClass: row.stateClass,
    displayPrecision: row.precision,
    isAvailable: row.isAvailable,
    isEnabled: row.isEnabled,
    lastChanged: new Date(now - 42 * 60_000),
    lastUpdated: new Date(now - silentFor),
    linked,
    addresses: linked === null ? [] : (LINKED_SAMPLE_ENTITIES[0]?.addresses ?? []),
  });

  return { entity, state: state, issues };
}

/**
 * The name a row's entity is called, from its domain: "Media player".
 *
 * @param row - The row.
 * @returns The name.
 */
function labName(row: Pick<LabRow, 'domain'>): string {
  const spoken = row.domain.replaceAll('_', ' ');

  return spoken.charAt(0).toUpperCase() + spoken.slice(1);
}

/**
 * What a command whose effect is not "copy the argument of the same name" does to a state.
 *
 * @param name - The command's name.
 * @param values - The capability's state.
 * @param args - The command's arguments.
 * @returns The state after it, or undefined for a command that only copies its arguments.
 */
function applyVerb(name: string, values: LabValues, args: LabValues): LabValues | undefined {
  const isVacuum = 'rooms' in values;

  switch (name) {
    case 'turn_on': {
      return { ...values, isOn: true };
    }
    case 'turn_off': {
      return { ...values, isOn: false };
    }
    case 'toggle': {
      return { ...values, isOn: values['isOn'] !== true };
    }
    case 'lock': {
      return { ...values, lockState: 'locked', isOpen: false };
    }
    case 'unlock': {
      return { ...values, lockState: 'unlocked', isOpen: false };
    }
    case 'open': {
      return 'lockState' in values
        ? { ...values, lockState: 'unlocked', isOpen: true }
        : { ...values, position: 100, motion: 'stopped' };
    }
    case 'close': {
      return { ...values, position: 0, motion: 'stopped' };
    }
    case 'stop': {
      return 'motion' in values
        ? { ...values, motion: 'stopped' }
        : 'playback' in values
          ? { ...values, playback: 'stopped' }
          : { ...values, activity: 'idle' };
    }
    case 'play': {
      return { ...values, playback: 'playing' };
    }
    case 'pause': {
      return 'playback' in values
        ? { ...values, playback: 'paused' }
        : { ...values, activity: 'paused' };
    }
    case 'start':
    case 'resume':
    case 'clean_rooms':
    case 'clean_spot': {
      return { ...values, activity: isVacuum ? 'cleaning' : 'mowing' };
    }
    case 'dock': {
      return { ...values, activity: 'returning' };
    }
    case 'set_target': {
      return { ...values, targetTemperature: args['temperature'] };
    }
    case 'set_target_range': {
      return { ...values, targetTemperatureLow: args['low'], targetTemperatureHigh: args['high'] };
    }
    case 'set_humidity': {
      return { ...values, targetHumidity: args['humidity'] };
    }
    case 'set_swing_horizontal': {
      return { ...values, swingHorizontalMode: args['swingMode'] };
    }
    case 'set_motion_detection': {
      return { ...values, isMotionDetectionOn: args['isOn'] };
    }
    case 'seek': {
      return { ...values, mediaPositionSeconds: args['positionSeconds'] };
    }
    case 'volume_up': {
      return { ...values, volume: Math.min(100, Number(values['volume'] ?? 0) + 5) };
    }
    case 'volume_down': {
      return { ...values, volume: Math.max(0, Number(values['volume'] ?? 0) - 5) };
    }
    case 'install': {
      return { ...values, isInstalling: true, progress: 0 };
    }
    default: {
      return undefined;
    }
  }
}

/**
 * What a command does to a row's state, as a device that obeys would report it.
 *
 * A command {@link applyVerb} knows does what it says; any other copies each of its arguments into
 * the state field of the same name - `set_level{level}`, `set_preset{preset}` - which is how a
 * command added to the contracts later works here with no edit.
 *
 * @param values - The capability's state.
 * @param command - The command.
 * @returns The state after it.
 */
export function applyCommand(values: LabValues, command: JsonObject): LabValues {
  const { command: name, ...args } = command;
  const verb = typeof name === 'string' ? applyVerb(name, values, args) : undefined;

  if (verb !== undefined) {
    return verb;
  }

  return {
    ...values,
    ...Object.fromEntries(
      Object.entries(args).filter(([key]) => key !== 'transitionMs' && key !== 'code'),
    ),
  };
}
