/**
 * Home Assistant MQTT discovery, read (https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery).
 *
 * A device announces each of its entities with a retained JSON document on
 * `<prefix>/<component>/[<node_id>/]<object_id>/config` - its name, the topics it reports and is
 * commanded on, the device it belongs to - and takes it back with an empty one. Tasmota, ESPHome,
 * Shelly, OpenMQTTGateway and most others speak it. This module reads one announcement into an
 * {@link MqttEntity}: the abbreviations expanded, `~` put in place of the base topic, the device
 * found, the value template read as a path. What each component becomes - which capability, how a
 * payload is read, what a command publishes - is `house.ts`'s.
 */
import { readTemplate, type TemplateReading } from './templates.js';

/** The components the broker turns into entities. */
export const SUPPORTED_COMPONENTS = [
  'sensor',
  'binary_sensor',
  'switch',
  'light',
  'cover',
  'button',
  'number',
  'select',
  'lock',
] as const;

/** A component the broker turns into entities. */
export type Component = (typeof SUPPORTED_COMPONENTS)[number];

/** The device an entity belongs to. */
export type MqttDevice = {
  readonly id: string;
  readonly name: string;
  readonly manufacturer?: string;
  readonly model?: string;
  readonly swVersion?: string;
};

/** One entity a device announced, or the owner mapped by hand. */
export type MqttEntity = {
  /** What finds it again: its unique id, or its discovery topic. */
  readonly key: string;

  /** Where it came from. */
  readonly origin: 'discovery' | 'mapping';

  readonly component: Component;

  /** Its name, the device's own when it announced none. */
  readonly name: string;

  /** What its entity id is made of: lower-case, digits and underscores. */
  readonly objectId: string;

  readonly device: MqttDevice;

  /** The announcement, abbreviations expanded and `~` put in place. */
  readonly config: Readonly<Record<string, unknown>>;

  /** Where its state is read from the state topic's payload. */
  readonly value: TemplateReading;
};

/** Why an announcement was not taken. */
export type Skipped = { readonly topic: string; readonly reason: string };

/** What reading one announcement came to. */
export type DiscoveryReading =
  | { readonly kind: 'entity'; readonly entity: MqttEntity }
  | { readonly kind: 'removed'; readonly key: string }
  | { readonly kind: 'skipped'; readonly skipped: Skipped }
  | { readonly kind: 'ignored' };

/** The abbreviations Home Assistant accepts, for the keys the broker reads. */
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
  sup_clrm: 'supported_color_modes',
  uniq_id: 'unique_id',
  unit_of_meas: 'unit_of_measurement',
  val_tpl: 'value_template',
};

/** The abbreviations of a device's keys. */
const DEVICE_ABBREVIATIONS: Readonly<Record<string, string>> = {
  cns: 'connections',
  ids: 'identifiers',
  mdl: 'model',
  mf: 'manufacturer',
  sw: 'sw_version',
  hw: 'hw_version',
  sa: 'suggested_area',
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

/**
 * What an entity id is made of, from anything.
 *
 * @param text - A unique id, a topic.
 * @returns Lower-case letters, digits and single underscores, at most 64 of them.
 */
export function slugOf(text: string): string {
  const slug = text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '_')
    .replaceAll(/^_+|_+$/gu, '')
    .slice(0, 64)
    .replace(/_+$/u, '');

  return slug === '' ? 'entity' : slug;
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
 * The device an entity belongs to.
 *
 * @param config - The announcement, expanded.
 * @param fallback - What names it when the announcement names no device.
 * @returns The device.
 */
function deviceOf(config: Record<string, unknown>, fallback: string): MqttDevice {
  const raw = isRecord(config['device']) ? expand(config['device'], DEVICE_ABBREVIATIONS) : {};
  const identifiers = raw['identifiers'];
  const connections = raw['connections'];
  const firstIdentifier = Array.isArray(identifiers) ? textOf(identifiers[0]) : textOf(identifiers);
  const firstConnection =
    Array.isArray(connections) && Array.isArray(connections[0])
      ? (connections[0] as unknown[]).map(String).join(':')
      : undefined;
  const id = firstIdentifier ?? firstConnection ?? fallback;
  const manufacturer = textOf(raw['manufacturer']);
  const model = textOf(raw['model']);
  const swVersion = textOf(raw['sw_version']);

  return {
    id,
    name: textOf(raw['name']) ?? textOf(config['name']) ?? id,
    ...(manufacturer === undefined ? {} : { manufacturer }),
    ...(model === undefined ? {} : { model }),
    ...(swVersion === undefined ? {} : { swVersion }),
  };
}

/**
 * Reads one discovery message.
 *
 * @param prefix - The discovery prefix: `homeassistant`.
 * @param topic - Where it was published.
 * @param payload - What was published, as text.
 * @returns The entity, its removal, why it was not taken, or nothing for a topic that is not
 *   an announcement.
 */
export function readAnnouncement(prefix: string, topic: string, payload: string): DiscoveryReading {
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

  const supported = SUPPORTED_COMPONENTS.find((each) => each === component);

  if (supported === undefined) {
    return {
      kind: 'skipped',
      skipped: { topic, reason: `A ${component} is not something the broker reads yet` },
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
  const value = readTemplate(textOf(config['value_template']) ?? textOf(config['state_template']));

  if (value.kind === 'unsupported' && textOf(config['state_topic']) !== undefined) {
    return {
      kind: 'skipped',
      skipped: {
        topic,
        reason: `Its value template is not one the broker reads: ${value.template}`,
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
      // `name: null` is Home Assistant's "the device's name alone".
      name:
        typeof ownName === 'string' && ownName !== ''
          ? ownName === device.name
            ? ownName
            : `${device.name} ${ownName}`
          : device.name,
      objectId: slugOf(uniqueId ?? `${ids.join('_')}_${component}`),
      device,
      config,
      value,
    },
  };
}
