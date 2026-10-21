/**
 * What a device says of itself on the house's MQTT broker, read: the MQTT discovery convention.
 *
 * A device announces each of its entities with a retained JSON document on
 * `<prefix>/<component>/[<node_id>/]<object_id>/config` - its name, the topics it reports and is
 * commanded on, the device it belongs to, the firmware that sent it - and takes it back with an
 * empty one. Tasmota, ESPHome, OpenMQTTGateway and most others speak it, under the prefix
 * `homeassistant` unless told otherwise. This module reads one announcement into an
 * {@link MqttEntity}: the abbreviations expanded, `~` put in place of the base topic, the device
 * and its origin found. A device the owner maps by hand is read into the same entity, so one
 * mapping (`mqtt-mapping.ts`) draws, reads and commands both.
 *
 * **Value templates are read as paths.** Announcements carry Jinja templates; the platform does
 * not render Jinja and does not pretend to. The templates nearly every device announces are a
 * value itself or one key of its JSON - `{{ value }}`, `{{ value_json.temperature }}`,
 * `{{ value_json['temperature'] }}`, `{{ value_json.a.b }}` - and those are read as the path they
 * name. Anything else - a filter, arithmetic, a condition - is skipped, and the Brokers page says
 * why, rather than showing a wrong value.
 */
import { z } from 'zod';

import {
  MQTT_COMPONENTS,
  mqttIdentitySchema,
  normalizeMac,
  type MqttComponent,
  type MqttIdentity,
  type MqttMapping,
} from '@nebulahome/contracts';

/** A template, read: the path into the payload's JSON, or the payload itself when empty. */
export type ValuePath = readonly string[];

/** What a template came to: a path, or why it cannot be read. */
export type TemplateReading =
  | { readonly kind: 'path'; readonly path: ValuePath }
  | { readonly kind: 'unsupported'; readonly template: string };

/** One step of a path: `.key`, `['key']`, `["key"]` or `[0]`. */
const STEP =
  /^(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*'([^']*)'\s*\]|\[\s*"([^"]*)"\s*\]|\[\s*(\d+)\s*\])/u;

/**
 * Reads a template as a path.
 *
 * @param template - The template the device announced; none is the value itself.
 * @returns The path, or that it is not supported.
 */
export function readTemplate(template: string | undefined): TemplateReading {
  if (template === undefined || template.trim() === '') {
    return { kind: 'path', path: [] };
  }

  const inner = /^\s*\{\{\s*(.*?)\s*\}\}\s*$/su.exec(template)?.[1];

  if (inner === undefined) {
    return { kind: 'unsupported', template };
  }

  if (inner === 'value') {
    return { kind: 'path', path: [] };
  }

  if (!inner.startsWith('value_json')) {
    return { kind: 'unsupported', template };
  }

  const path: string[] = [];
  let rest = inner.slice('value_json'.length);

  while (rest !== '') {
    const step = STEP.exec(rest);

    if (step === null) {
      return { kind: 'unsupported', template };
    }

    path.push(step[1] ?? step[2] ?? step[3] ?? step[4] ?? '');
    rest = rest.slice(step[0].length);
  }

  return path.length === 0 ? { kind: 'unsupported', template } : { kind: 'path', path };
}

/**
 * Reads a value from a payload along a path.
 *
 * @param payload - What was published, as text.
 * @param path - Where the value is; none for the payload itself.
 * @returns The value, or undefined when the payload has nothing there.
 */
export function valueAt(payload: string, path: ValuePath): unknown {
  if (path.length === 0) {
    return payload;
  }

  let value: unknown;

  try {
    value = JSON.parse(payload) as unknown;
  } catch {
    return undefined;
  }

  for (const key of path) {
    if (typeof value !== 'object' || value === null) {
      return undefined;
    }

    value = (value as Record<string, unknown>)[key];
  }

  return value;
}

/** Where an entity comes from: an announcement, the owner's mapping, the broker itself. */
export type MqttEntityOrigin = 'discovery' | 'mapping' | 'broker';

/** The device an entity belongs to, as its announcement says it. */
export type MqttAnnouncedDevice = {
  /** Its first identifier, or its first connection: what tells it from every other. */
  readonly id: string;
  readonly name: string;
  readonly manufacturer?: string;
  readonly model?: string;
  readonly modelId?: string;
  readonly swVersion?: string;
  readonly hwVersion?: string;
  readonly serialNumber?: string;
  readonly identifiers: readonly string[];
  readonly macAddresses: readonly string[];
  readonly viaDevice?: string;

  /** The firmware or program that announced it, and its version. */
  readonly originName?: string;
  readonly originSwVersion?: string;
};

/** One entity a device announced, the owner mapped by hand, or the broker reports of itself. */
export type MqttEntity = {
  /** What finds it again: its unique id, or its announcement's topic. */
  readonly key: string;
  readonly origin: MqttEntityOrigin;
  readonly component: MqttComponent;

  /** Its name, the device's own when it announced none. */
  readonly name: string;

  /** What tells it from its device's other entities: lower-case, digits and underscores. */
  readonly objectId: string;

  readonly device: MqttAnnouncedDevice;

  /** The announcement, abbreviations expanded and `~` put in place: JSON throughout. */
  readonly config: Readonly<Record<string, unknown>>;
};

/** Why an announcement was not taken. */
export type MqttSkipped = { readonly topic: string; readonly reason: string };

/** What reading one announcement came to. */
export type AnnouncementReading =
  | { readonly kind: 'entity'; readonly entity: MqttEntity }
  | { readonly kind: 'removed'; readonly key: string }
  | { readonly kind: 'skipped'; readonly skipped: MqttSkipped }
  | { readonly kind: 'ignored' };

/** The abbreviations the convention accepts, for the keys the platform reads. */
const ABBREVIATIONS: Readonly<Record<string, string>> = {
  avty: 'availability',
  avty_mode: 'availability_mode',
  avty_t: 'availability_topic',
  avty_tpl: 'availability_template',
  bri_cmd_t: 'brightness_command_topic',
  bri_scl: 'brightness_scale',
  bri_stat_t: 'brightness_state_topic',
  bri_val_tpl: 'brightness_value_template',
  clr_temp_cmd_t: 'color_temp_command_topic',
  clr_temp_stat_t: 'color_temp_state_topic',
  clr_temp_val_tpl: 'color_temp_value_template',
  cmd_t: 'command_topic',
  cmd_tpl: 'command_template',
  dev: 'device',
  dev_cla: 'device_class',
  ic: 'icon',
  json_attr_t: 'json_attributes_topic',
  max_mirs: 'max_mireds',
  min_mirs: 'min_mireds',
  o: 'origin',
  obj_id: 'object_id',
  ops: 'options',
  pl_avail: 'payload_available',
  pl_cls: 'payload_close',
  pl_lock: 'payload_lock',
  pl_not_avail: 'payload_not_available',
  pl_off: 'payload_off',
  pl_on: 'payload_on',
  pl_open: 'payload_open',
  pl_prs: 'payload_press',
  pl_stop: 'payload_stop',
  pl_unlk: 'payload_unlock',
  pos_clsd: 'position_closed',
  pos_open: 'position_open',
  pos_t: 'position_topic',
  pos_tpl: 'position_template',
  set_pos_t: 'set_position_topic',
  stat_cla: 'state_class',
  stat_clsd: 'state_closed',
  stat_closing: 'state_closing',
  stat_jam: 'state_jammed',
  stat_locked: 'state_locked',
  stat_off: 'state_off',
  stat_on: 'state_on',
  stat_open: 'state_open',
  stat_opening: 'state_opening',
  stat_stopped: 'state_stopped',
  stat_t: 'state_topic',
  stat_tpl: 'state_template',
  stat_unlocked: 'state_unlocked',
  stat_val_tpl: 'state_value_template',
  sug_dsp_prc: 'suggested_display_precision',
  sup_clrm: 'supported_color_modes',
  uniq_id: 'unique_id',
  unit_of_meas: 'unit_of_measurement',
  val_tpl: 'value_template',
};

/** The abbreviations of a device's keys. */
const DEVICE_ABBREVIATIONS: Readonly<Record<string, string>> = {
  cns: 'connections',
  hw: 'hw_version',
  ids: 'identifiers',
  mdl: 'model',
  mdl_id: 'model_id',
  mf: 'manufacturer',
  sa: 'suggested_area',
  sn: 'serial_number',
  sw: 'sw_version',
};

/** The abbreviations of an origin's keys. */
const ORIGIN_ABBREVIATIONS: Readonly<Record<string, string>> = {
  sw: 'sw_version',
  url: 'support_url',
};

/** The abbreviations of an availability entry's keys. */
const AVAILABILITY_ABBREVIATIONS: Readonly<Record<string, string>> = {
  t: 'topic',
  pl_avail: 'payload_available',
  pl_not_avail: 'payload_not_available',
  val_tpl: 'value_template',
};

/**
 * A document with its abbreviated keys spelled out.
 *
 * @param document - The document.
 * @param table - The abbreviations.
 * @returns A copy with full keys.
 */
function expand(
  document: Readonly<Record<string, unknown>>,
  table: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const expanded: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(document)) {
    expanded[table[key] ?? key] = value;
  }

  return expanded;
}

/**
 * Whether a value is a plain object.
 *
 * @param value - The value.
 * @returns True for one.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A text value, or nothing.
 *
 * @param value - The value.
 * @returns It, when it is non-empty text.
 */
export function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** How long an object id may be: what is left of an entity id once its device has some room. */
const OBJECT_ID_MAXIMUM = 40;

/**
 * What an entity's object id is made of, from anything.
 *
 * @param text - A unique id, a topic.
 * @returns Lower-case letters, digits and single underscores, at most 40 of them - the end kept,
 *   since it is what tells a device's entities apart.
 */
export function slugOf(text: string): string {
  const slug = text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '_')
    .replaceAll(/^_+|_+$/gu, '');
  const kept = slug.slice(-OBJECT_ID_MAXIMUM).replace(/^_+/u, '');

  return kept === '' ? 'entity' : kept;
}

/**
 * An entity's object id: its unique id - or its announcement's - without the device's own
 * identifier in front, which every entity of the device repeats.
 *
 * @param base - The unique id, or what the topic says.
 * @param identifiers - The device's identifiers.
 * @returns The object id.
 */
function objectIdOf(base: string, identifiers: readonly string[]): string {
  const lower = base.toLowerCase();
  const prefix = [...identifiers]
    .sort((left, right) => right.length - left.length)
    .find((identifier) => identifier !== '' && lower.startsWith(identifier.toLowerCase()));
  const rest = prefix === undefined ? base : base.slice(prefix.length);

  return slugOf(/[A-Za-z0-9]/u.test(rest) ? rest : base);
}

/**
 * Puts the base topic in place of `~` in every `*_topic` key, availability entries included.
 *
 * @param config - The announcement, expanded.
 * @returns A copy with the topics whole.
 */
function withBase(config: Record<string, unknown>): Record<string, unknown> {
  const base = textOf(config['~']);

  if (base === undefined) {
    return config;
  }

  /**
   * One topic, whole.
   *
   * @param value - As announced.
   * @returns With the base in place.
   */
  const whole = (value: unknown): unknown => {
    if (typeof value !== 'string') {
      return value;
    }

    if (value.startsWith('~')) {
      return `${base}${value.slice(1)}`;
    }

    return value.endsWith('~') ? `${value.slice(0, -1)}${base}` : value;
  };

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(config)) {
    result[key] = key.endsWith('_topic') ? whole(value) : value;
  }

  if (Array.isArray(result['availability'])) {
    result['availability'] = result['availability'].map((entry: unknown) =>
      isRecord(entry) ? { ...entry, topic: whole(entry['topic']) } : entry,
    );
  }

  return result;
}

/**
 * Text fields of a document, those that are text.
 *
 * @param document - The document.
 * @param fields - The output name of each, by key.
 * @returns The fields that are there.
 */
function textFields<TKey extends string>(
  document: Readonly<Record<string, unknown>>,
  fields: Readonly<Record<TKey, string>>,
): Partial<Record<TKey, string>> {
  const found: Partial<Record<TKey, string>> = {};

  for (const [name, key] of Object.entries(fields) as [TKey, string][]) {
    const value = document[key];
    const text = typeof value === 'number' ? String(value) : textOf(value);

    if (text !== undefined) {
      found[name] = text.slice(0, 256);
    }
  }

  return found;
}

/**
 * The device an entity belongs to.
 *
 * @param config - The announcement, expanded.
 * @param fallback - What names it when the announcement names no device.
 * @returns The device.
 */
function deviceOf(config: Record<string, unknown>, fallback: string): MqttAnnouncedDevice {
  const raw = isRecord(config['device']) ? expand(config['device'], DEVICE_ABBREVIATIONS) : {};
  const origin = isRecord(config['origin']) ? expand(config['origin'], ORIGIN_ABBREVIATIONS) : {};
  const identifiers = (
    Array.isArray(raw['identifiers']) ? raw['identifiers'] : [raw['identifiers']]
  ).flatMap((each: unknown) => {
    const text = typeof each === 'number' ? String(each) : textOf(each);

    return text === undefined ? [] : [text.slice(0, 256)];
  });
  const connections = Array.isArray(raw['connections'])
    ? raw['connections'].filter((each: unknown): each is unknown[] => Array.isArray(each))
    : [];
  const firstConnection =
    connections[0] === undefined ? undefined : connections[0].map(String).join(':');
  const macAddresses = connections.flatMap((connection) =>
    connection[0] === 'mac' ? [normalizeMac(String(connection[1]))] : [],
  );
  const id = (identifiers[0] ?? firstConnection ?? fallback).slice(0, 256);

  return {
    id,
    name: (textOf(raw['name']) ?? textOf(config['name']) ?? id).slice(0, 256),
    ...textFields(raw, {
      manufacturer: 'manufacturer',
      model: 'model',
      modelId: 'model_id',
      swVersion: 'sw_version',
      hwVersion: 'hw_version',
      serialNumber: 'serial_number',
      viaDevice: 'via_device',
    }),
    ...textFields(origin, { originName: 'name', originSwVersion: 'sw_version' }),
    identifiers: identifiers.slice(0, 64),
    macAddresses: macAddresses.filter((mac): mac is string => mac !== null).slice(0, 64),
  };
}

/**
 * Reads one announcement.
 *
 * @param prefix - The discovery prefix: `homeassistant`, unless the owner said another.
 * @param topic - Where it was published.
 * @param payload - What was published, as text.
 * @returns The entity, its removal, why it was not taken, or nothing for a topic that is not
 *   an announcement.
 */
export function readAnnouncement(
  prefix: string,
  topic: string,
  payload: string,
): AnnouncementReading {
  if (!topic.startsWith(`${prefix}/`) || !topic.endsWith('/config')) {
    return { kind: 'ignored' };
  }

  const levels = topic.slice(prefix.length + 1, -'/config'.length).split('/');

  if (levels.length < 2 || levels.length > 3) {
    return { kind: 'ignored' };
  }

  const [component = '', ...ids] = levels;
  const topicKey = `${component}/${ids.join('/')}`;

  if (payload.trim() === '') {
    return { kind: 'removed', key: topicKey };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(payload) as unknown;
  } catch {
    return { kind: 'skipped', skipped: { topic, reason: 'The announcement is not JSON' } };
  }

  if (!isRecord(parsed)) {
    return { kind: 'skipped', skipped: { topic, reason: 'The announcement is not an object' } };
  }

  const supported = MQTT_COMPONENTS.find((each) => each === component);

  if (supported === undefined) {
    return {
      kind: 'skipped',
      skipped: { topic, reason: `A ${component} is not something the platform reads yet` },
    };
  }

  const config = withBase(expand(parsed, ABBREVIATIONS));

  if (Array.isArray(config['availability'])) {
    config['availability'] = config['availability'].map((entry: unknown) =>
      isRecord(entry) ? expand(entry, AVAILABILITY_ABBREVIATIONS) : entry,
    );
  }

  const uniqueId = textOf(config['unique_id']);
  const device = deviceOf(config, uniqueId ?? topicKey);
  const value = readTemplate(
    textOf(config['value_template']) ??
      textOf(config['state_value_template']) ??
      textOf(config['state_template']),
  );

  if (value.kind === 'unsupported' && textOf(config['state_topic']) !== undefined) {
    return {
      kind: 'skipped',
      skipped: {
        topic,
        reason: `Its value template is not one the platform reads: ${value.template}`,
      },
    };
  }

  const ownName = config['name'];

  return {
    kind: 'entity',
    entity: {
      key: uniqueId ?? topicKey,
      origin: 'discovery',
      component: supported,
      // `name: null` is the convention's "the device's name alone".
      name: (typeof ownName === 'string' && ownName !== ''
        ? ownName === device.name
          ? ownName
          : `${device.name} ${ownName}`
        : device.name
      ).slice(0, 128),
      objectId: objectIdOf(uniqueId ?? `${ids.join('_')}_${component}`, device.identifiers),
      device,
      // A JSON round trip: what is left is JSON, which a claim keeps.
      config: JSON.parse(JSON.stringify(config)) as Record<string, unknown>,
    },
  };
}

/**
 * A mapping as an entity: its own device, read with a template built from its path.
 *
 * @param mapping - The mapping.
 * @returns The entity.
 */
export function mqttEntityOfMapping(mapping: MqttMapping): MqttEntity {
  const template =
    mapping.valuePath === ''
      ? undefined
      : `{{ value_json${mapping.valuePath
          .split('.')
          .map((key) => `['${key}']`)
          .join('')} }}`;
  const config: Record<string, unknown> = {
    state_topic: mapping.stateTopic,
    payload_on: mapping.payloadOn,
    payload_off: mapping.payloadOff,
    ...(template === undefined ? {} : { value_template: template }),
    ...(mapping.commandTopic === undefined ? {} : { command_topic: mapping.commandTopic }),
    ...(mapping.unit === '' ? {} : { unit_of_measurement: mapping.unit }),
    ...(mapping.deviceClass === '' ? {} : { device_class: mapping.deviceClass }),
  };

  return {
    key: `mapping:${mapping.id}`,
    origin: 'mapping',
    component: mapping.component,
    name: mapping.name,
    objectId: mapping.component,
    device: {
      id: `mapping-${mapping.id}`,
      name: mapping.name,
      model: 'Mapped by hand',
      identifiers: [],
      macAddresses: [],
    },
    config,
  };
}

/** One entity of a device, as a claim keeps it. */
export const mqttEntitySnapshotSchema = z.object({
  key: z.string().min(1),
  objectId: z.string().min(1).max(64),
  name: z.string().max(128),
  component: z.enum(MQTT_COMPONENTS),
  config: z.record(z.string(), z.unknown()),
});

/** One entity of a device, as a claim keeps it. */
export type MqttEntitySnapshot = z.output<typeof mqttEntitySnapshotSchema>;

/**
 * A device the broker hears, whole: who it says it is and every entity it has. What discovery
 * proposes, what a claim keeps and what the transport delivers.
 */
export const mqttDeviceSnapshotSchema = z.object({
  deviceKey: z.string().min(1).max(256),
  identity: mqttIdentitySchema,
  entities: z.array(mqttEntitySnapshotSchema).max(256),
});

/** A device the broker hears, whole. */
export type MqttDeviceSnapshot = z.output<typeof mqttDeviceSnapshotSchema>;

/** Where each origin's devices are said to come from. */
const SOURCES = {
  discovery: 'announced',
  mapping: 'mapped',
  broker: 'broker',
} as const satisfies Record<MqttEntityOrigin, MqttIdentity['source']>;

/**
 * One device, from its entities: who the first says it is, every entity once.
 *
 * @param entities - The device's entities, all of one device, the first saying who it is.
 * @returns The device, or undefined for none.
 */
export function mqttDeviceSnapshotOf(
  entities: readonly MqttEntity[],
): MqttDeviceSnapshot | undefined {
  const [first] = entities;

  if (first === undefined) {
    return undefined;
  }

  const { device } = first;
  const objectIds = new Set<string>();

  return {
    deviceKey: device.id,
    identity: {
      deviceKey: device.id,
      source: SOURCES[first.origin],
      name: device.name,
      manufacturer: device.manufacturer ?? null,
      model: device.model ?? null,
      modelId: device.modelId ?? null,
      swVersion: device.swVersion ?? null,
      hwVersion: device.hwVersion ?? null,
      serialNumber: device.serialNumber ?? null,
      identifiers: [...device.identifiers],
      macAddresses: [...device.macAddresses],
      viaDevice: device.viaDevice ?? null,
      originName: entities.map((each) => each.device.originName).find(Boolean) ?? null,
      originSwVersion: entities.map((each) => each.device.originSwVersion).find(Boolean) ?? null,
      components: [...new Set(entities.map((each) => each.component))],
    },
    // Two entities of one object id would be one entity of the device: the second is left out.
    entities: entities.flatMap((entity) => {
      if (objectIds.has(entity.objectId)) {
        return [];
      }

      objectIds.add(entity.objectId);

      return [
        {
          key: entity.key,
          objectId: entity.objectId,
          name: entity.name,
          component: entity.component,
          config: { ...entity.config },
        },
      ];
    }),
  };
}
