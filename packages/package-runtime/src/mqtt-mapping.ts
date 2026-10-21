/**
 * The platform's mapping of a device the house's MQTT broker hears onto entities: the one driver
 * every announced or mapped device can be run by, whoever's integration it is.
 *
 * An announcement describes its entity - a component, the topics it reports and is commanded on,
 * the payloads it speaks - so one mapping covers what any firmware announces, and a vendor whose
 * `driver.json` says `"kind": "mqtt"` gets it without writing code: its devices are its own, on
 * its page, and mapped here.
 *
 * **What is mapped.** A sensor (a number when it announces a unit or how its numbers add up,
 * text otherwise), a binary sensor, a switch, a light (on/off, brightness, white; plain or JSON),
 * a cover, a button, a number, a select and a lock. A number is registered in its class's unit -
 * a power in watts, however the device counts it - and converted on the way.
 *
 * **Pure throughout**, like every integration: what the transport hands over is the device whole
 * and the last text of every topic its entities read, with the topics that changed, so a state is
 * always computed from every topic it needs - a light's brightness with whether it is on, a
 * cover's position with its motion. An entity with no state topic is read from its command
 * topic: what the hub last published there is what it was told to be.
 */
import { z } from 'zod';

import {
  capabilityStateSchema,
  getSensorClass,
  jsonObjectSchema,
  MQTT_HOUSE_TRANSPORT,
  normalizeMac,
  resolveCanonicalUnit,
  resolveStateClass,
  sensorRegistrationIssue,
  toCanonical,
  ValidationError,
  type CapabilityName,
  type CapabilityState,
  type DeclaredCapabilities,
  type EntityDomain,
  type EntityStateClass,
  type JsonObject,
} from '@nebulahome/contracts';

import type {
  CommandTarget,
  DeviceDescriptor,
  EntityDescriptor,
  Integration,
  MappingContext,
  ReportedState,
} from './integration.js';
import {
  mqttDeviceSnapshotSchema,
  readTemplate,
  textOf,
  valueAt,
  type MqttDeviceSnapshot,
  type MqttEntitySnapshot,
  type ValuePath,
} from './mqtt-announcement.js';
import type { Discovered, TransportInbound, TransportRequest } from './transport.js';

/** What an entity is registered as. */
export type MqttEntityShape = {
  readonly domain: EntityDomain;
  readonly capabilities: DeclaredCapabilities;
  readonly unitOfMeasurement?: string;
  readonly deviceClass?: string;
  readonly stateClass?: EntityStateClass;
  readonly displayPrecision?: number;
};

/** One message a command publishes. */
export type MqttMessage = { readonly topic: string; readonly payload: string };

/**
 * What the transport delivers for one device: the device whole, the last text of every topic its
 * entities read, and the topics that changed - none to say everything is to be read again.
 */
export type MqttInbound = {
  readonly device: MqttDeviceSnapshot;
  readonly texts: Readonly<Record<string, string>>;
  readonly changed: readonly string[] | null;
};

/** Reads what the transport delivers. */
const inboundSchema = z.object({
  device: mqttDeviceSnapshotSchema,
  texts: z.record(z.string(), z.string()),
  changed: z.array(z.string()).nullable(),
});

/** How a sensor's numbers add up, as an announcement may say it. */
const STATE_CLASSES = ['measurement', 'total', 'total_increasing'] as const;

/**
 * One of an entity's settings, as text, with a default.
 *
 * @param entity - The entity.
 * @param key - The setting.
 * @param fallback - What it is when not announced.
 * @returns It.
 */
function textSetting(entity: MqttEntitySnapshot, key: string, fallback: string): string {
  const value = entity.config[key];

  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback;
}

/**
 * One of an entity's settings, as a number, with a default.
 *
 * @param entity - The entity.
 * @param key - The setting.
 * @param fallback - What it is when not announced.
 * @returns It.
 */
function numberSetting(entity: MqttEntitySnapshot, key: string, fallback: number): number {
  const value = entity.config[key];
  const number = typeof value === 'number' ? value : Number(value ?? Number.NaN);

  return Number.isFinite(number) ? number : fallback;
}

/**
 * A topic the entity names.
 *
 * @param entity - The entity.
 * @param key - Which: `state_topic`.
 * @returns It, when announced.
 */
function topicOf(entity: MqttEntitySnapshot, key: string): string | undefined {
  return textOf(entity.config[key]);
}

/**
 * Whether a light speaks JSON.
 *
 * @param entity - The light.
 * @returns True for `schema: json`.
 */
function isJsonLight(entity: MqttEntitySnapshot): boolean {
  return entity.component === 'light' && entity.config['schema'] === 'json';
}

/**
 * Whether a JSON light announces a feature: `brightness: true`, or a colour mode that has it.
 *
 * @param entity - The light.
 * @param flag - `brightness`, `color_temp`.
 * @returns True when it does.
 */
function jsonLightHas(entity: MqttEntitySnapshot, flag: 'brightness' | 'color_temp'): boolean {
  if (entity.config[flag] === true) {
    return true;
  }

  const modes = entity.config['supported_color_modes'];

  if (!Array.isArray(modes)) {
    return false;
  }

  return flag === 'color_temp'
    ? modes.includes('color_temp')
    : modes.some((mode) => mode !== 'onoff');
}

/**
 * Whether an entity reports nothing of its own: no state topic, so it is what it was told to be,
 * read from its command topic.
 *
 * @param entity - The entity.
 * @returns True for one.
 */
function isOptimistic(entity: MqttEntitySnapshot): boolean {
  return topicOf(entity, 'state_topic') === undefined && entity.component !== 'button';
}

/**
 * A sensor's measurement, as it is registered: in its class's unit, with the class's default
 * state class - or without the class, when its unit cannot be brought to the class's.
 *
 * @param entity - The sensor.
 * @returns What it is registered with, and the unit its numbers are converted from.
 */
function measurementOf(entity: MqttEntitySnapshot): {
  readonly fields: Pick<MqttEntityShape, 'unitOfMeasurement' | 'deviceClass' | 'stateClass'>;
  readonly conversion?: { readonly deviceClass: string; readonly unit: string };
} {
  const unit = textOf(entity.config['unit_of_measurement']);
  const deviceClass = textOf(entity.config['device_class']);
  const said = textOf(entity.config['state_class']);
  const stateClass = STATE_CLASSES.find((each) => each === said);
  const unitOnly = {
    ...(unit === undefined ? {} : { unitOfMeasurement: unit }),
    ...(stateClass === undefined ? {} : { stateClass }),
  };

  if (deviceClass === undefined || getSensorClass(deviceClass)?.valueKind !== 'number') {
    return { fields: unitOnly };
  }

  const canonical = resolveCanonicalUnit(deviceClass);
  const registered = canonical ?? unit;
  const isConvertible =
    unit === undefined ||
    canonical === undefined ||
    unit === canonical ||
    toCanonical(deviceClass, 1, unit) !== undefined;

  // A class whose unit cannot be brought to the class's is dropped: `core` refuses the pair.
  if (
    !isConvertible ||
    sensorRegistrationIssue({ deviceClass, unitOfMeasurement: registered }) !== undefined
  ) {
    return { fields: unitOnly };
  }

  const resolved = resolveStateClass(deviceClass, stateClass);

  return {
    fields: {
      deviceClass,
      ...(registered === undefined ? {} : { unitOfMeasurement: registered }),
      ...(resolved === undefined ? {} : { stateClass: resolved }),
    },
    ...(unit !== undefined && canonical !== undefined && unit !== canonical
      ? { conversion: { deviceClass, unit } }
      : {}),
  };
}

/**
 * What one entity is registered as.
 *
 * @param entity - The entity.
 * @returns Its shape.
 */
export function mqttShapeOf(entity: MqttEntitySnapshot): MqttEntityShape {
  const deviceClass = textOf(entity.config['device_class']);
  const withClass = deviceClass === undefined ? {} : { deviceClass };
  const precision = entity.config['suggested_display_precision'];
  const withPrecision =
    typeof precision === 'number' && Number.isInteger(precision) && precision >= 0
      ? { displayPrecision: Math.min(precision, 10) }
      : {};

  switch (entity.component) {
    case 'sensor': {
      const { fields } = measurementOf(entity);

      // A unit or how its numbers add up says it is a number; anything else is text.
      return fields.unitOfMeasurement === undefined && fields.stateClass === undefined
        ? { domain: 'sensor', capabilities: { sensor_text: {} } }
        : { domain: 'sensor', capabilities: { sensor_numeric: {} }, ...fields, ...withPrecision };
    }
    case 'binary_sensor':
      return { domain: 'binary_sensor', capabilities: { sensor_binary: {} }, ...withClass };
    case 'switch':
      return { domain: 'switch', capabilities: { on_off: {} }, ...withClass };
    case 'light': {
      const json = isJsonLight(entity);
      const hasLevel = json
        ? jsonLightHas(entity, 'brightness')
        : topicOf(entity, 'brightness_command_topic') !== undefined;
      const hasWhite = json
        ? jsonLightHas(entity, 'color_temp')
        : topicOf(entity, 'color_temp_command_topic') !== undefined;

      return {
        domain: 'light',
        capabilities: {
          on_off: {},
          ...(hasLevel ? { level: { hasTransition: false } } : {}),
          ...(hasWhite
            ? {
                color_temp: {
                  minMireds: Math.round(numberSetting(entity, 'min_mireds', 153)),
                  maxMireds: Math.round(numberSetting(entity, 'max_mireds', 500)),
                },
              }
            : {}),
        },
      };
    }
    case 'cover':
      return {
        domain: 'cover',
        capabilities: {
          cover: {
            hasPosition:
              topicOf(entity, 'position_topic') !== undefined ||
              topicOf(entity, 'set_position_topic') !== undefined,
            hasTilt: false,
          },
        },
        ...withClass,
      };
    case 'button':
      return { domain: 'button', capabilities: { button: {} }, ...withClass };
    case 'number': {
      const min = numberSetting(entity, 'min', 1);
      const max = numberSetting(entity, 'max', 100);
      const unit = textOf(entity.config['unit_of_measurement']);

      return {
        domain: 'number',
        capabilities: {
          number: { min, max: max > min ? max : min + 1, step: numberSetting(entity, 'step', 1) },
        },
        ...(unit === undefined ? {} : { unitOfMeasurement: unit }),
      };
    }
    case 'select': {
      const options = Array.isArray(entity.config['options'])
        ? [...new Set(entity.config['options'].map(String))].filter(
            (option) => option !== '' && option.length <= 64,
          )
        : [];

      return {
        domain: 'select',
        capabilities: {
          select: {
            options: (options.length === 0 ? ['—'] : options)
              .slice(0, 64)
              .map((option) => ({ value: option, label: option })),
          },
        },
      };
    }
    case 'lock':
      return { domain: 'lock', capabilities: { lock: { hasCode: false } } };
  }
}

/** What a topic carries for an entity. */
type Reading = 'state' | 'availability' | 'brightness' | 'color_temp' | 'position';

/** One topic an entity is read from, what it carries, and where its value is. */
type Reader = { readonly topic: string; readonly reading: Reading; readonly path: ValuePath };

/**
 * The path a template of an entity names.
 *
 * @param entity - The entity.
 * @param key - The template's key.
 * @returns The path; the payload itself for none, or one that is not read.
 */
function pathOf(entity: MqttEntitySnapshot, key: string): ValuePath {
  const template = readTemplate(textOf(entity.config[key]));

  return template.kind === 'path' ? template.path : [];
}

/**
 * Which template reads an entity's state: its value template, a light's state value template, or
 * its state template, the first it announces.
 *
 * @param config - The announcement.
 * @returns The key.
 */
export function stateTemplateKeyOf(config: Readonly<Record<string, unknown>>): string {
  return (
    ['value_template', 'state_value_template', 'state_template'].find(
      (key) => textOf(config[key]) !== undefined,
    ) ?? 'value_template'
  );
}

/**
 * The availability topics of an entity, with the payloads that say it is and is not there.
 *
 * @param entity - The entity.
 * @returns The topics.
 */
function availabilityOf(
  entity: MqttEntitySnapshot,
): { topic: string; available: string; notAvailable: string; path: ValuePath }[] {
  const shared = {
    available: textSetting(entity, 'payload_available', 'online'),
    notAvailable: textSetting(entity, 'payload_not_available', 'offline'),
  };
  const single = topicOf(entity, 'availability_topic');
  const list = Array.isArray(entity.config['availability']) ? entity.config['availability'] : [];
  const topics = list.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const topic = textOf(record['topic']);
    const template = readTemplate(textOf(record['value_template']));

    return topic === undefined
      ? []
      : [
          {
            topic,
            available: textOf(record['payload_available']) ?? shared.available,
            notAvailable: textOf(record['payload_not_available']) ?? shared.notAvailable,
            path: template.kind === 'path' ? template.path : [],
          },
        ];
  });

  return single === undefined
    ? topics
    : [{ topic: single, ...shared, path: pathOf(entity, 'availability_template') }, ...topics];
}

/**
 * The topics one entity is read from: its state (its command topic, when it has none), its
 * availability, a plain light's brightness and white, a cover's position.
 *
 * @param entity - The entity.
 * @returns Them, each with what it carries.
 */
function readersOf(entity: MqttEntitySnapshot): Reader[] {
  const optimistic = isOptimistic(entity);
  const readers: Reader[] = [];

  /**
   * Notes one topic, when the entity has it.
   *
   * @param topic - The topic.
   * @param reading - What it carries.
   * @param path - Where the value is.
   */
  const add = (topic: string | undefined, reading: Reading, path: ValuePath): void => {
    if (topic !== undefined) {
      readers.push({ topic, reading, path });
    }
  };

  add(
    topicOf(entity, optimistic ? 'command_topic' : 'state_topic'),
    'state',
    optimistic ? [] : pathOf(entity, stateTemplateKeyOf(entity.config)),
  );

  for (const availability of availabilityOf(entity)) {
    add(availability.topic, 'availability', availability.path);
  }

  if (entity.component === 'light' && !isJsonLight(entity)) {
    add(
      topicOf(entity, optimistic ? 'brightness_command_topic' : 'brightness_state_topic'),
      'brightness',
      optimistic ? [] : pathOf(entity, 'brightness_value_template'),
    );
    add(
      topicOf(entity, optimistic ? 'color_temp_command_topic' : 'color_temp_state_topic'),
      'color_temp',
      optimistic ? [] : pathOf(entity, 'color_temp_value_template'),
    );
  }

  if (entity.component === 'cover' && !optimistic) {
    add(topicOf(entity, 'position_topic'), 'position', pathOf(entity, 'position_template'));
  }

  return readers;
}

/**
 * Every topic an entity is read from.
 *
 * @param entity - The entity.
 * @returns The topics, each once.
 */
export function mqttTopicsOf(entity: MqttEntitySnapshot): string[] {
  return [...new Set(readersOf(entity).map((reader) => reader.topic))];
}

/**
 * A number from what a template read.
 *
 * @param value - What it read.
 * @returns The number, or undefined when it is not one.
 */
function numberOf(value: unknown): number | undefined {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;

  return Number.isFinite(number) ? number : undefined;
}

/**
 * Text from what a template read.
 *
 * @param value - What it read.
 * @returns The text, or undefined for nothing.
 */
function stringOf(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined;
}

/**
 * A brightness, as a level out of 100.
 *
 * @param value - The brightness, on the device's scale.
 * @param scale - The scale's top.
 * @returns The level, or undefined when it is not a number.
 */
function levelOf(value: unknown, scale: number): number | undefined {
  const brightness = numberOf(value);

  return brightness === undefined || scale <= 0
    ? undefined
    : Math.max(0, Math.min(100, (brightness / scale) * 100));
}

/**
 * A colour temperature, in mireds the platform takes.
 *
 * @param value - The temperature, in mireds.
 * @returns It, or undefined when it is not a number.
 */
function miredsOf(value: unknown): number | undefined {
  const mireds = numberOf(value);

  return mireds === undefined ? undefined : Math.max(1, Math.min(1000, Math.round(mireds)));
}

/**
 * Whether a text is the entity's "on" or "off", by its state payloads - or, read from its command
 * topic, by the payloads it is commanded with.
 *
 * @param entity - The entity.
 * @param text - What its state topic carried.
 * @returns True, false, or undefined for neither.
 */
function isOnOf(entity: MqttEntitySnapshot, text: string | undefined): boolean | undefined {
  const onPayload = textSetting(entity, 'payload_on', 'ON');
  const offPayload = textSetting(entity, 'payload_off', 'OFF');
  const on = isOptimistic(entity) ? onPayload : textSetting(entity, 'state_on', onPayload);
  const off = isOptimistic(entity) ? offPayload : textSetting(entity, 'state_off', offPayload);

  return text === on ? true : text === off ? false : undefined;
}

/**
 * A JSON light's state, from its state document, what the document leaves out kept as it was.
 *
 * @param entity - The light.
 * @param text - Its state topic's text.
 * @param previous - What it was.
 * @returns The capabilities it says, or nothing.
 */
function jsonLightState(
  entity: MqttEntitySnapshot,
  text: string | undefined,
  previous: CapabilityState | undefined,
): Record<string, unknown> {
  let document: unknown;

  try {
    document = text === undefined ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return {};
  }

  if (typeof document !== 'object' || document === null) {
    return {};
  }

  const record = document as Record<string, unknown>;
  const shape = mqttShapeOf(entity);
  const state = stringOf(record['state']);
  const level = levelOf(record['brightness'], numberSetting(entity, 'brightness_scale', 255));
  const mireds = miredsOf(record['color_temp']);

  return {
    ...(state === undefined
      ? previous?.on_off === undefined
        ? {}
        : { on_off: previous.on_off }
      : { on_off: { isOn: state.toUpperCase() === 'ON' } }),
    ...(shape.capabilities.level === undefined
      ? {}
      : level === undefined
        ? previous?.level === undefined
          ? {}
          : { level: previous.level }
        : { level: { level } }),
    ...(shape.capabilities.color_temp === undefined
      ? {}
      : mireds === undefined
        ? previous?.color_temp === undefined
          ? {}
          : { color_temp: previous.color_temp }
        : { color_temp: { mireds } }),
  };
}

/**
 * A cover's state: its motion from its state topic, its position from its position topic - or,
 * for a cover with none, from where its state says it stopped.
 *
 * @param entity - The cover.
 * @param stateText - What its state topic carried.
 * @param position - What its position topic read, as a value.
 * @param previous - What it was.
 * @returns The cover's state.
 */
function coverState(
  entity: MqttEntitySnapshot,
  stateText: string | undefined,
  position: unknown,
  previous: CapabilityState | undefined,
): Record<string, unknown> {
  const current = previous?.cover ?? { position: 0, motion: 'stopped' as const };
  const states: Record<string, { motion: 'opening' | 'closing' | 'stopped'; position?: number }> = {
    [textSetting(entity, 'state_open', 'open')]: { motion: 'stopped', position: 100 },
    [textSetting(entity, 'state_closed', 'closed')]: { motion: 'stopped', position: 0 },
    [textSetting(entity, 'state_opening', 'opening')]: { motion: 'opening' },
    [textSetting(entity, 'state_closing', 'closing')]: { motion: 'closing' },
    [textSetting(entity, 'state_stopped', 'stopped')]: { motion: 'stopped' },
  };
  const said = stateText === undefined ? undefined : states[stateText];
  const raw = numberOf(position);
  const open = numberSetting(entity, 'position_open', 100);
  const closed = numberSetting(entity, 'position_closed', 0);
  const reported =
    raw === undefined || open === closed
      ? undefined
      : Math.max(0, Math.min(100, ((raw - closed) / (open - closed)) * 100));
  const hasPosition = topicOf(entity, 'position_topic') !== undefined;

  return {
    cover: {
      position: reported ?? (hasPosition ? current.position : (said?.position ?? current.position)),
      motion: said?.motion ?? current.motion,
    },
  };
}

/**
 * What one entity's topics say it is now.
 *
 * @param entity - The entity.
 * @param textOfTopic - The last text a topic carried.
 * @param previous - What it was last reported as; undefined before it ever was.
 * @returns Its state and whether it is there, or undefined while it has nothing to say.
 */
export function mqttStateOf(
  entity: MqttEntitySnapshot,
  textOfTopic: (topic: string) => string | undefined,
  previous: CapabilityState | undefined,
): { readonly state: CapabilityState; readonly isAvailable: boolean } | undefined {
  const readers = readersOf(entity);

  /**
   * What one reading's topic carries, at its path.
   *
   * @param reading - Which.
   * @returns The value, or undefined.
   */
  const read = (reading: Reading): unknown => {
    const reader = readers.find((each) => each.reading === reading);
    const text = reader === undefined ? undefined : textOfTopic(reader.topic);

    return reader === undefined || text === undefined ? undefined : valueAt(text, reader.path);
  };

  const stateValue = read('state');
  const stateText = stringOf(stateValue);
  let state: Record<string, unknown>;

  switch (entity.component) {
    case 'sensor': {
      const shape = mqttShapeOf(entity);

      if (shape.capabilities.sensor_text !== undefined) {
        state = stateText === undefined ? {} : { sensor_text: { value: stateText.slice(0, 512) } };
        break;
      }

      const number = numberOf(stateValue);
      const { conversion } = measurementOf(entity);
      const value =
        number === undefined || conversion === undefined
          ? number
          : toCanonical(conversion.deviceClass, number, conversion.unit);

      state = value === undefined ? {} : { sensor_numeric: { value } };
      break;
    }
    case 'binary_sensor': {
      const isOn =
        stateText === textSetting(entity, 'payload_on', 'ON')
          ? true
          : stateText === textSetting(entity, 'payload_off', 'OFF')
            ? false
            : undefined;

      state = isOn === undefined ? {} : { sensor_binary: { isOn } };
      break;
    }
    case 'switch': {
      const isOn = isOnOf(entity, stateText);

      state = isOn === undefined ? {} : { on_off: { isOn } };
      break;
    }
    case 'lock': {
      const states: Record<string, 'locked' | 'unlocked' | 'jammed'> = isOptimistic(entity)
        ? {
            [textSetting(entity, 'payload_lock', 'LOCK')]: 'locked',
            [textSetting(entity, 'payload_unlock', 'UNLOCK')]: 'unlocked',
          }
        : {
            [textSetting(entity, 'state_locked', 'LOCKED')]: 'locked',
            [textSetting(entity, 'state_unlocked', 'UNLOCKED')]: 'unlocked',
            [textSetting(entity, 'state_jammed', 'JAMMED')]: 'jammed',
          };
      const lockState = stateText === undefined ? undefined : states[stateText];

      state = lockState === undefined ? {} : { lock: { lockState } };
      break;
    }
    case 'select':
      state = {
        select: {
          option: stateText === undefined || stateText === '' ? null : stateText.slice(0, 64),
        },
      };
      break;
    case 'number':
      state = { number: { value: numberOf(stateValue) ?? null } };
      break;
    case 'button':
      state = { button: {} };
      break;
    case 'cover':
      state = coverState(entity, stateText, read('position'), previous);
      break;
    case 'light': {
      if (isJsonLight(entity)) {
        state = jsonLightState(entity, stateText, previous);
        break;
      }

      const shape = mqttShapeOf(entity);
      const isOn = isOnOf(entity, stateText);
      const level = levelOf(read('brightness'), numberSetting(entity, 'brightness_scale', 255));
      const mireds = miredsOf(read('color_temp'));

      state = {
        ...(isOn === undefined ? {} : { on_off: { isOn } }),
        ...(level === undefined || shape.capabilities.level === undefined
          ? {}
          : { level: { level } }),
        ...(mireds === undefined || shape.capabilities.color_temp === undefined
          ? {}
          : { color_temp: { mireds } }),
      };
      break;
    }
  }

  // A light that has said nothing of whether it is on has nothing to report yet.
  if (
    Object.keys(state).length === 0 ||
    (entity.component === 'light' && state['on_off'] === undefined)
  ) {
    return undefined;
  }

  const parsed = capabilityStateSchema.safeParse(state);

  return parsed.success
    ? { state: parsed.data, isAvailable: isAvailableOf(entity, textOfTopic) }
    : undefined;
}

/**
 * Whether an entity's device says it is there: always, for one with no availability topic;
 * otherwise once one of its topics said so and none says it is not.
 *
 * @param entity - The entity.
 * @param textOfTopic - The last text a topic carried.
 * @returns True when it is there.
 */
function isAvailableOf(
  entity: MqttEntitySnapshot,
  textOfTopic: (topic: string) => string | undefined,
): boolean {
  const entries = availabilityOf(entity);

  if (entries.length === 0) {
    return true;
  }

  const said = entries.flatMap((entry) => {
    const text = textOfTopic(entry.topic);
    const value = text === undefined ? undefined : stringOf(valueAt(text, entry.path));

    return value === entry.available ? [true] : value === entry.notAvailable ? [false] : [];
  });

  return said.includes(true) && !said.includes(false);
}

/**
 * One field of a command, as text.
 *
 * @param value - The field.
 * @returns It as text; empty for anything that is not a string or a number.
 */
function textOfCommand(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

/**
 * What a command publishes.
 *
 * @param entity - The entity.
 * @param capability - Which capability.
 * @param command - The command, as the contract has it.
 * @param current - What the entity is now, for a toggle.
 * @returns The messages, in order.
 * @throws {ValidationError} When the entity takes no such command, or fills its payloads with a
 *   template the platform cannot render.
 */
export function mqttCommandOf(
  entity: MqttEntitySnapshot,
  capability: CapabilityName,
  command: JsonObject,
  current: CapabilityState | undefined,
): MqttMessage[] {
  const name = textOfCommand(command['command']);

  /**
   * A refusal.
   *
   * @param message - Why.
   * @returns The error.
   */
  const refusal = (message: string): ValidationError =>
    new ValidationError(message, { details: { entity: entity.key, capability, command: name } });

  if (textOf(entity.config['command_template']) !== undefined) {
    throw refusal(`${entity.name} announces a command template, which the platform cannot fill`);
  }

  /**
   * A topic the entity is commanded on.
   *
   * @param key - Which.
   * @param what - What it is, for the refusal.
   * @returns The topic.
   * @throws {ValidationError} When the entity announces none.
   */
  const commandTopic = (key = 'command_topic', what = 'command topic'): string => {
    const topic = topicOf(entity, key);

    if (topic === undefined) {
      throw refusal(`${entity.name} announces no ${what}`);
    }

    return topic;
  };

  const isOn = current?.on_off?.isOn === true;

  if (isJsonLight(entity)) {
    const scale = numberSetting(entity, 'brightness_scale', 255);
    const document: Record<string, unknown> | undefined =
      name === 'turn_on'
        ? { state: 'ON' }
        : name === 'turn_off'
          ? { state: 'OFF' }
          : name === 'toggle'
            ? { state: isOn ? 'OFF' : 'ON' }
            : name === 'set_level'
              ? { state: 'ON', brightness: Math.round((Number(command['level']) / 100) * scale) }
              : name === 'set_color_temp'
                ? { state: 'ON', color_temp: Number(command['mireds']) }
                : undefined;

    if (document === undefined) {
      throw refusal(`${entity.name} takes no ${name}`);
    }

    return [{ topic: commandTopic(), payload: JSON.stringify(document) }];
  }

  switch (capability) {
    case 'on_off': {
      const wantsOn = name === 'turn_on' || (name === 'toggle' && !isOn);

      return [
        {
          topic: commandTopic(),
          payload: wantsOn
            ? textSetting(entity, 'payload_on', 'ON')
            : textSetting(entity, 'payload_off', 'OFF'),
        },
      ];
    }
    case 'level': {
      const scale = numberSetting(entity, 'brightness_scale', 255);

      return [
        {
          topic: commandTopic('brightness_command_topic', 'brightness topic'),
          payload: String(Math.round((Number(command['level']) / 100) * scale)),
        },
      ];
    }
    case 'color_temp':
      return [
        {
          topic: commandTopic('color_temp_command_topic', 'colour temperature topic'),
          payload: String(Math.round(Number(command['mireds']))),
        },
      ];
    case 'cover': {
      if (name === 'set_position') {
        const open = numberSetting(entity, 'position_open', 100);
        const closed = numberSetting(entity, 'position_closed', 0);

        return [
          {
            topic: commandTopic('set_position_topic', 'position topic'),
            payload: String(
              Math.round(closed + (Number(command['position']) / 100) * (open - closed)),
            ),
          },
        ];
      }

      const payloads: Record<string, string> = {
        open: textSetting(entity, 'payload_open', 'OPEN'),
        close: textSetting(entity, 'payload_close', 'CLOSE'),
        stop: textSetting(entity, 'payload_stop', 'STOP'),
      };
      const payload = payloads[name];

      if (payload === undefined) {
        throw refusal(`${entity.name} takes no ${name}`);
      }

      return [{ topic: commandTopic(), payload }];
    }
    case 'button':
      return [{ topic: commandTopic(), payload: textSetting(entity, 'payload_press', 'PRESS') }];
    case 'number':
      return [{ topic: commandTopic(), payload: textOfCommand(command['value']) }];
    case 'select':
      return [{ topic: commandTopic(), payload: textOfCommand(command['option']) }];
    case 'lock':
      return [
        {
          topic: commandTopic(),
          payload:
            name === 'lock'
              ? textSetting(entity, 'payload_lock', 'LOCK')
              : textSetting(entity, 'payload_unlock', 'UNLOCK'),
        },
      ];
    default:
      throw refusal(`${entity.name} takes no ${capability} command`);
  }
}

/**
 * A device, read from what identification or a claim holds.
 *
 * @param value - What it holds.
 * @returns The device, or undefined when it is not one.
 */
function deviceOf(value: unknown): MqttDeviceSnapshot | undefined {
  const parsed = mqttDeviceSnapshotSchema.safeParse(value);

  return parsed.success ? parsed.data : undefined;
}

/**
 * One entity, as the device describes it.
 *
 * @param entity - The entity.
 * @returns Its descriptor.
 */
function entityDescriptorOf(entity: MqttEntitySnapshot): EntityDescriptor {
  return { ...mqttShapeOf(entity), objectId: entity.objectId, name: entity.name };
}

/**
 * Builds the MQTT driver of a vendor: the platform's own, or one whose `driver.json` says
 * `"kind": "mqtt"`.
 *
 * @param manifest - The driver's.
 * @param manifest.id - Its kind, `vendor/driver`.
 * @returns The integration.
 */
export function createMqttIntegration(manifest: { readonly id: string }): Integration {
  /**
   * The device a claim was made for.
   *
   * @param context - The instance's mapping context.
   * @returns The device.
   * @throws {ValidationError} When the claim holds no device - which identification never makes.
   */
  const claimed = (context: MappingContext): MqttDeviceSnapshot => {
    const device = deviceOf(context.claim.descriptor);

    if (device === undefined) {
      throw new ValidationError(`${manifest.id} holds a claim that is not an MQTT device`, {
        details: { integration: manifest.id },
      });
    }

    return device;
  };

  return {
    id: manifest.id,
    transport: MQTT_HOUSE_TRANSPORT,
    optionsSchema: jsonObjectSchema,
    discovery: {},

    /**
     * Claims a device the broker hears.
     *
     * @param discovered - What the transport handed over.
     * @returns The claim, or null for anything that is not one.
     */
    claim: (discovered: Discovered) => {
      const device = deviceOf(discovered.payload);

      return device === undefined
        ? null
        : { deviceKey: discovered.deviceKey, externalId: device.deviceKey, descriptor: device };
    },

    /**
     * Subscribes to nothing: the broker hands over every topic its devices read.
     *
     * @returns Nothing.
     */
    subscriptions: () => [],

    /**
     * Describes the device and its entities.
     *
     * @param claim - The claim.
     * @returns The device.
     * @throws {ValidationError} When the claim holds no MQTT device.
     */
    describe: (claim): DeviceDescriptor => {
      const device = deviceOf(claim.descriptor);

      if (device === undefined) {
        throw new ValidationError(`${manifest.id} cannot describe a claim with no MQTT device`, {
          details: { integration: manifest.id },
        });
      }

      const { identity } = device;
      const mac = identity.macAddresses.map(normalizeMac).find((each) => each !== null);

      return {
        externalId: claim.externalId,
        name: identity.name.slice(0, 128),
        ...(mac === undefined ? {} : { mac }),
        ...(identity.serialNumber === null ? {} : { serialNumber: identity.serialNumber }),
        ...(identity.manufacturer === null ? {} : { manufacturer: identity.manufacturer }),
        ...(identity.model === null ? {} : { model: identity.model }),
        ...(identity.swVersion === null ? {} : { swVersion: identity.swVersion.slice(0, 64) }),
        ...(identity.hwVersion === null ? {} : { hwVersion: identity.hwVersion.slice(0, 64) }),
        ...(identity.viaDevice === null ? {} : { viaExternalId: identity.viaDevice }),
        entities: device.entities.map(entityDescriptorOf),
      };
    },

    /**
     * Turns what the topics say into reports, one per entity a changed topic is read for.
     *
     * @param message - What the transport delivered.
     * @param context - The identifiers the hub assigned, and the last states.
     * @returns The reports.
     */
    toState: (message: TransportInbound, context: MappingContext): ReportedState[] => {
      const parsed = inboundSchema.safeParse(message.payload);

      if (!parsed.success) {
        return [];
      }

      const { device, texts, changed } = parsed.data;

      /**
       * The last text of a topic.
       *
       * @param topic - The topic.
       * @returns It, if the topic carried text.
       */
      const textOfTopic = (topic: string): string | undefined => texts[topic];

      return device.entities.flatMap((entity): ReportedState[] => {
        const entityId = context.entities.get(entity.objectId);

        if (
          entityId === undefined ||
          (changed !== null && !mqttTopicsOf(entity).some((topic) => changed.includes(topic)))
        ) {
          return [];
        }

        const read = mqttStateOf(entity, textOfTopic, context.lastState(entityId));

        return read === undefined
          ? []
          : [{ entityId, state: read.state, attributes: {}, isAvailable: read.isAvailable }];
      });
    },

    /**
     * Turns a command into the messages it publishes.
     *
     * @param target - The entity, the capability and the command.
     * @param context - The claim and the last states.
     * @returns The request.
     * @throws {ValidationError} When the entity does not take the command.
     */
    toCommand: (target: CommandTarget, context: MappingContext): TransportRequest => {
      const device = claimed(context);
      const entity = device.entities.find(
        (candidate) => context.entities.get(candidate.objectId) === target.entityId,
      );

      if (entity === undefined) {
        throw new ValidationError(`${manifest.id} has no entity ${target.entityId}`, {
          details: { integration: manifest.id, entityId: target.entityId },
        });
      }

      const messages = mqttCommandOf(
        entity,
        target.capability,
        target.command,
        context.lastState(target.entityId),
      );

      return {
        deviceKey: context.claim.deviceKey,
        op: 'publish',
        args: { messages: messages.map(({ topic, payload }) => ({ topic, payload })) },
      };
    },
  };
}
