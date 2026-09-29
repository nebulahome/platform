/**
 * What the broker hears, as devices of the house.
 *
 * Every entity - announced through discovery, or mapped by the owner - is held here with the
 * topics it is read from: its state, its availability, a light's brightness and white, a cover's
 * position. Every message the broker carries is offered to {@link House.hear}; the ones on those
 * topics become state reports, and a command from the platform becomes the payload its entity's
 * command topic expects. Which capability each component is, and how its payloads read, is here
 * and nowhere else.
 *
 * A number is reported in the unit the platform keeps its class in - a power in watts, however
 * the device counts it - so a history of it compares with every other. A class whose unit cannot
 * be converted is dropped, and the number is kept as it came.
 */
import {
  getSensorClass,
  resolveCanonicalUnit,
  sensorRegistrationIssue,
  toCanonical,
  type CapabilityName,
  type CapabilityState,
  type DeclaredCapabilities,
  type EntityDomain,
  type EntityStateClass,
  type JsonObject,
} from '@nebula-home/contracts';

import { textOf, type MqttEntity, type Skipped } from './discovery.js';
import { valueAt, type ValuePath, readTemplate } from './templates.js';

/** What an entity is registered as. */
export type EntityShape = {
  readonly domain: EntityDomain;
  readonly capabilities: DeclaredCapabilities;
  readonly unitOfMeasurement?: string;
  readonly deviceClass?: string;
  readonly stateClass?: EntityStateClass;
};

/** A device of the house, with its entities, as the package syncs it. */
export type HouseDevice = {
  readonly externalId: string;
  readonly name: string;
  readonly manufacturer?: string;
  readonly model?: string;
  readonly swVersion?: string;
  readonly entities: readonly (EntityShape & {
    readonly objectId: string;
    readonly name: string;
  })[];
};

/** What the house needs from the package around it. */
export type HouseOptions = {
  /**
   * Reports one entity's state.
   *
   * @param entity - Which.
   * @param domain - Its domain, for its id.
   * @param state - What it holds now, whole.
   * @param isAvailable - Whether its device says it is there.
   */
  readonly report: (
    entity: MqttEntity,
    domain: EntityDomain,
    state: CapabilityState,
    isAvailable: boolean,
  ) => void;

  /**
   * Publishes a command.
   *
   * @param topic - Where.
   * @param payload - What.
   */
  readonly publish: (topic: string, payload: string) => void;

  /** Says the devices changed: an entity came, went or changed shape. */
  readonly changed: () => void;
};

/** What the house holds of one entity. */
type Held = {
  readonly entity: MqttEntity;
  readonly shape: EntityShape;

  /** The unit its numbers come in, for one converted to its class's. */
  readonly nativeUnit?: string;
  state: Record<string, unknown>;
  isAvailable: boolean;
};

/** The domain of each component. */
const DOMAINS: Readonly<Record<MqttEntity['component'], EntityDomain>> = {
  sensor: 'sensor',
  binary_sensor: 'binary_sensor',
  switch: 'switch',
  light: 'light',
  cover: 'cover',
  button: 'button',
  number: 'number',
  select: 'select',
  lock: 'lock',
};

/**
 * One of an entity's settings, as text, with a default.
 *
 * @param entity - The entity.
 * @param key - The setting.
 * @param fallback - What it is when not announced.
 * @returns It.
 */
function textSetting(entity: MqttEntity, key: string, fallback: string): string {
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
function numberSetting(entity: MqttEntity, key: string, fallback: number): number {
  const value = Number(entity.config[key]);

  return Number.isFinite(value) ? value : fallback;
}

/**
 * Whether a JSON light announces a feature: `brightness: true`, or a colour mode that has it.
 *
 * @param entity - The light.
 * @param flag - `brightness`, `color_temp`.
 * @returns True when it does.
 */
function jsonLightHas(entity: MqttEntity, flag: 'brightness' | 'color_temp'): boolean {
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
 * Whether a light speaks JSON.
 *
 * @param entity - The light.
 * @returns True for `schema: json`.
 */
function isJsonLight(entity: MqttEntity): boolean {
  return entity.component === 'light' && entity.config['schema'] === 'json';
}

/**
 * What a sensor is registered as, and the unit its numbers come in.
 *
 * @param entity - The sensor.
 * @returns Its shape, and the unit to convert from when it is not its class's.
 */
function sensorShape(entity: MqttEntity): { shape: EntityShape; nativeUnit?: string } {
  const unit = textOf(entity.config['unit_of_measurement']);
  const deviceClass = textOf(entity.config['device_class']);
  const stateClassValue = textOf(entity.config['state_class']);
  const stateClass =
    stateClassValue === 'measurement' ||
    stateClassValue === 'total' ||
    stateClassValue === 'total_increasing'
      ? stateClassValue
      : undefined;
  const entry = getSensorClass(deviceClass);
  const isNumeric = unit !== undefined || stateClass !== undefined || entry?.valueKind === 'number';

  if (!isNumeric) {
    return { shape: { domain: 'sensor', capabilities: { sensor_text: {} } } };
  }

  const base: EntityShape = {
    domain: 'sensor',
    capabilities: { sensor_numeric: {} },
    ...(stateClass === undefined ? {} : { stateClass }),
  };

  if (entry?.valueKind === 'number' && deviceClass !== undefined) {
    const canonical = resolveCanonicalUnit(deviceClass);
    const registered = canonical ?? unit;
    const convertible =
      unit === undefined ||
      canonical === undefined ||
      unit === canonical ||
      toCanonical(deviceClass, 1, unit) !== undefined;
    const issue = sensorRegistrationIssue({ deviceClass, unitOfMeasurement: registered });

    if (convertible && issue === undefined && (unit !== undefined || canonical === undefined)) {
      return {
        shape: {
          ...base,
          deviceClass,
          ...(registered === undefined ? {} : { unitOfMeasurement: registered }),
        },
        ...(unit !== undefined && canonical !== undefined && unit !== canonical
          ? { nativeUnit: unit }
          : {}),
      };
    }
  }

  // A class the platform does not know, or a unit it cannot bring to its class's: the number as
  // it came, in its own unit, and no class.
  return { shape: { ...base, ...(unit === undefined ? {} : { unitOfMeasurement: unit }) } };
}

/**
 * What one entity is registered as.
 *
 * @param entity - The entity.
 * @returns Its shape, and the unit its numbers come in when they are converted.
 */
export function shapeOf(entity: MqttEntity): { shape: EntityShape; nativeUnit?: string } {
  const deviceClass = textOf(entity.config['device_class']);
  const withClass = deviceClass === undefined ? {} : { deviceClass };

  switch (entity.component) {
    case 'sensor':
      return sensorShape(entity);
    case 'binary_sensor':
      return {
        shape: { domain: 'binary_sensor', capabilities: { sensor_binary: {} }, ...withClass },
      };
    case 'switch':
      return { shape: { domain: 'switch', capabilities: { on_off: {} }, ...withClass } };
    case 'light': {
      const json = isJsonLight(entity);
      const hasLevel = json
        ? jsonLightHas(entity, 'brightness')
        : textOf(entity.config['brightness_command_topic']) !== undefined;
      const hasWhite = json
        ? jsonLightHas(entity, 'color_temp')
        : textOf(entity.config['color_temp_command_topic']) !== undefined;
      const capabilities: DeclaredCapabilities = {
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
      };

      return { shape: { domain: 'light', capabilities } };
    }
    case 'cover':
      return {
        shape: {
          domain: 'cover',
          capabilities: {
            cover: {
              hasPosition:
                textOf(entity.config['position_topic']) !== undefined ||
                textOf(entity.config['set_position_topic']) !== undefined,
              hasTilt: false,
            },
          },
          ...withClass,
        },
      };
    case 'button':
      return { shape: { domain: 'button', capabilities: { button: {} }, ...withClass } };
    case 'number': {
      const min = numberSetting(entity, 'min', 1);
      const max = numberSetting(entity, 'max', 100);
      const unit = textOf(entity.config['unit_of_measurement']);

      return {
        shape: {
          domain: 'number',
          capabilities: {
            number: { min, max: max > min ? max : min + 1, step: numberSetting(entity, 'step', 1) },
          },
          ...(unit === undefined ? {} : { unitOfMeasurement: unit }),
        },
      };
    }
    case 'select': {
      const options = Array.isArray(entity.config['options'])
        ? [...new Set(entity.config['options'].map(String))].filter(
            (option) => option !== '' && option.length <= 64,
          )
        : [];

      return {
        shape: {
          domain: 'select',
          capabilities: {
            select: {
              options: (options.length === 0 ? ['—'] : options).map((option) => ({
                value: option,
                label: option,
              })),
            },
          },
        },
      };
    }
    case 'lock':
      return { shape: { domain: 'lock', capabilities: { lock: { hasCode: false } } } };
  }
}

/** The topics one entity is read from, and what each carries. */
type Reading = 'state' | 'availability' | 'brightness' | 'color_temp' | 'position';

/**
 * The availability topics of an entity, with the payloads that say it is and is not there.
 *
 * @param entity - The entity.
 * @returns The topics.
 */
function availabilityOf(
  entity: MqttEntity,
): { topic: string; available: string; notAvailable: string; path: ValuePath }[] {
  const shared = {
    available: textSetting(entity, 'payload_available', 'online'),
    notAvailable: textSetting(entity, 'payload_not_available', 'offline'),
  };
  const single = textOf(entity.config['availability_topic']);
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

  return single === undefined ? topics : [{ topic: single, ...shared, path: [] }, ...topics];
}

/**
 * A number from what a template read.
 *
 * @param value - What it read.
 * @returns The number, or undefined when it is not one.
 */
function numberOf(value: unknown): number | undefined {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;

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
 * One field of a command, as text.
 *
 * @param value - The field.
 * @returns It as text; empty for anything that is not a string or a number.
 */
function textOfCommand(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

/** Everything the broker hears as devices of the house. */
export class House {
  readonly #options: HouseOptions;
  readonly #held = new Map<string, Held>();

  /** Which entities read each topic, and as what. */
  #byTopic = new Map<string, { key: string; reading: Reading; path: ValuePath }[]>();

  /** Which entity each announcement topic made, for its removal. */
  readonly #announced = new Map<string, string>();

  readonly #skipped = new Map<string, Skipped>();

  /**
   * Keeps the options.
   *
   * @param options - See {@link HouseOptions}.
   */
  public constructor(options: HouseOptions) {
    this.#options = options;
  }

  /**
   * Puts one entity in place of the one of its key, or adds it.
   *
   * @param entity - The entity.
   * @param announcedOn - The announcement topic it came on, when it came through discovery.
   * @param lastPayloads - The last payload each topic carried, for a state already retained.
   */
  public put(
    entity: MqttEntity,
    announcedOn: string | undefined,
    lastPayloads: (topic: string) => string | undefined,
  ): void {
    const { shape, nativeUnit } = shapeOf(entity);
    const before = this.#held.get(entity.key);
    const isSame = before !== undefined && JSON.stringify(before.entity) === JSON.stringify(entity);

    if (announcedOn !== undefined) {
      this.#announced.set(announcedOn, entity.key);
      this.#skipped.delete(announcedOn);
    }

    if (isSame) {
      return;
    }

    this.#held.set(entity.key, {
      entity,
      shape,
      ...(nativeUnit === undefined ? {} : { nativeUnit }),
      state: this.#initialState(entity),
      isAvailable: availabilityOf(entity).length === 0,
    });
    this.#index();
    this.#options.changed();

    // What was retained before it was announced: its state is there already.
    for (const [topic, readers] of this.#byTopic) {
      const payload = lastPayloads(topic);

      if (payload !== undefined && readers.some((reader) => reader.key === entity.key)) {
        this.#read(entity.key, topic, payload);
      }
    }

    this.#reportOf(entity.key);
  }

  /**
   * Takes back an entity.
   *
   * @param key - Its key, or the announcement topic it came on.
   */
  public remove(key: string): void {
    const found = this.#announced.get(key) ?? key;

    this.#announced.delete(key);

    if (this.#held.delete(found)) {
      this.#index();
      this.#options.changed();
    }
  }

  /**
   * Takes back every entity of an origin but those kept.
   *
   * @param origin - `mapping`, when the owner's mappings are read again.
   * @param kept - The keys that stay.
   */
  public retain(origin: MqttEntity['origin'], kept: ReadonlySet<string>): void {
    let isChanged = false;

    for (const [key, held] of this.#held) {
      if (held.entity.origin === origin && !kept.has(key)) {
        this.#held.delete(key);
        isChanged = true;
      }
    }

    if (isChanged) {
      this.#index();
      this.#options.changed();
    }
  }

  /**
   * Notes an announcement that was not taken.
   *
   * @param skipped - Where, and why.
   */
  public skip(skipped: Skipped): void {
    this.#skipped.set(skipped.topic, skipped);

    // At most the latest hundred: a network of unsupported things says the same thing often.
    if (this.#skipped.size > 100) {
      const [oldest] = this.#skipped.keys();

      if (oldest !== undefined) {
        this.#skipped.delete(oldest);
      }
    }
  }

  /**
   * The announcements that were not taken.
   *
   * @returns Where, and why.
   */
  public skipped(): Skipped[] {
    return [...this.#skipped.values()];
  }

  /**
   * How many entities there are, of each origin.
   *
   * @returns The counts.
   */
  public counts(): { discovered: number; mapped: number; devices: number } {
    const held = [...this.#held.values()];

    return {
      discovered: held.filter((each) => each.entity.origin === 'discovery').length,
      mapped: held.filter((each) => each.entity.origin === 'mapping').length,
      devices: new Set(held.map((each) => each.entity.device.id)).size,
    };
  }

  /**
   * The devices, with their entities, as the package syncs them.
   *
   * @returns Them.
   */
  public devices(): HouseDevice[] {
    const byDevice = new Map<string, Held[]>();

    for (const held of this.#held.values()) {
      const list = byDevice.get(held.entity.device.id) ?? [];

      list.push(held);
      byDevice.set(held.entity.device.id, list);
    }

    return [...byDevice.values()].map((list) => {
      const [first] = list;
      const device = first?.entity.device ?? { id: 'unknown', name: 'Unknown' };
      const objectIds = new Set<string>();

      return {
        externalId: `mqtt:${device.id}`,
        name: device.name,
        ...(device.manufacturer === undefined ? {} : { manufacturer: device.manufacturer }),
        ...(device.model === undefined ? {} : { model: device.model }),
        ...(device.swVersion === undefined ? {} : { swVersion: device.swVersion }),
        // Two entities of one slug would be one entity id: the second is left out.
        entities: list.flatMap((held) => {
          const objectId = held.entity.objectId;

          if (objectIds.has(objectId)) {
            return [];
          }

          objectIds.add(objectId);

          return [{ ...held.shape, objectId, name: held.entity.name.slice(0, 128) }];
        }),
      };
    });
  }

  /**
   * Offers one message the broker carried.
   *
   * @param topic - Where it was published.
   * @param payload - What, as text.
   */
  public hear(topic: string, payload: string): void {
    const readers = this.#byTopic.get(topic);

    if (readers === undefined) {
      return;
    }

    const touched = new Set<string>();

    for (const reader of readers) {
      if (this.#read(reader.key, topic, payload)) {
        touched.add(reader.key);
      }
    }

    for (const key of touched) {
      this.#reportOf(key);
    }
  }

  /**
   * Carries out a command on an entity.
   *
   * @param objectId - Its object id.
   * @param capability - Which capability.
   * @param command - The command, as the contract has it.
   * @throws {Error} When the entity is not the broker's, or takes no such command.
   */
  public command(objectId: string, capability: CapabilityName, command: JsonObject): void {
    const held = [...this.#held.values()].find((each) => each.entity.objectId === objectId);

    if (held === undefined) {
      throw new Error(`No entity of the broker is ${objectId}`);
    }

    const { entity } = held;

    if (textOf(entity.config['command_template']) !== undefined) {
      throw new Error(`${entity.name} announces a command template, which the broker cannot fill`);
    }

    const published = this.#commandOf(held, capability, command);

    for (const [topic, payload] of published) {
      this.#options.publish(topic, payload);
    }

    // An entity with no state topic reports what it was told to be: Home Assistant's
    // "optimistic" mode, the only way it has a state at all.
    if (textOf(entity.config['state_topic']) === undefined && entity.component !== 'button') {
      this.#optimistic(held, capability, command);
      this.#reportOf(entity.key);
    }
  }

  /**
   * The state an entity starts from, before anything is heard.
   *
   * @param entity - The entity.
   * @returns Its state.
   */
  #initialState(entity: MqttEntity): Record<string, unknown> {
    switch (entity.component) {
      case 'cover':
        return { cover: { position: 0, motion: 'stopped' } };
      case 'button':
        return { button: {} };
      case 'select':
        return { select: { option: null } };
      case 'number':
        return { number: { value: null } };
      default:
        return {};
    }
  }

  /** Rebuilds which entities read each topic. */
  #index(): void {
    const byTopic = new Map<string, { key: string; reading: Reading; path: ValuePath }[]>();

    /**
     * Notes one reader of a topic.
     *
     * @param topic - The topic, if the entity has it.
     * @param key - The entity.
     * @param reading - What the topic carries for it.
     * @param path - Where its value is in the payload.
     */
    const add = (
      topic: string | undefined,
      key: string,
      reading: Reading,
      path: ValuePath,
    ): void => {
      if (topic === undefined) {
        return;
      }

      const list = byTopic.get(topic) ?? [];

      list.push({ key, reading, path });
      byTopic.set(topic, list);
    };

    for (const { entity } of this.#held.values()) {
      const statePath = entity.value.kind === 'path' ? entity.value.path : [];

      add(textOf(entity.config['state_topic']), entity.key, 'state', statePath);

      for (const availability of availabilityOf(entity)) {
        add(availability.topic, entity.key, 'availability', availability.path);
      }

      if (entity.component === 'light' && !isJsonLight(entity)) {
        const brightness = readTemplate(textOf(entity.config['brightness_value_template']));
        const white = readTemplate(textOf(entity.config['color_temp_value_template']));

        add(
          textOf(entity.config['brightness_state_topic']),
          entity.key,
          'brightness',
          brightness.kind === 'path' ? brightness.path : [],
        );
        add(
          textOf(entity.config['color_temp_state_topic']),
          entity.key,
          'color_temp',
          white.kind === 'path' ? white.path : [],
        );
      }

      if (entity.component === 'cover') {
        const position = readTemplate(textOf(entity.config['position_template']));

        add(
          textOf(entity.config['position_topic']),
          entity.key,
          'position',
          position.kind === 'path' ? position.path : [],
        );
      }
    }

    this.#byTopic = byTopic;
  }

  /**
   * Reads one payload into an entity's state.
   *
   * @param key - The entity.
   * @param topic - Where it came from.
   * @param payload - What.
   * @returns Whether its state or availability changed.
   */
  #read(key: string, topic: string, payload: string): boolean {
    const held = this.#held.get(key);
    const readers = (this.#byTopic.get(topic) ?? []).filter((reader) => reader.key === key);

    if (held === undefined) {
      return false;
    }

    let isChanged = false;

    for (const reader of readers) {
      const value = valueAt(payload, reader.path);

      if (reader.reading === 'availability') {
        const entry = availabilityOf(held.entity).find((each) => each.topic === topic);
        const text = stringOf(value);

        if (entry !== undefined && (text === entry.available || text === entry.notAvailable)) {
          held.isAvailable = text === entry.available;
          isChanged = true;
        }

        continue;
      }

      const next = this.#stateFrom(held, reader.reading, value, payload);

      if (next !== null) {
        held.state = { ...held.state, ...next };
        isChanged = true;
      }
    }

    return isChanged;
  }

  /**
   * What one reading says about an entity.
   *
   * @param held - The entity.
   * @param reading - What the topic carries.
   * @param value - What its template read.
   * @param payload - The whole payload, for a JSON light.
   * @returns The capabilities it changes, or null when it says nothing the entity reads.
   */
  #stateFrom(
    held: Held,
    reading: Reading,
    value: unknown,
    payload: string,
  ): Record<string, unknown> | null {
    const { entity } = held;
    const text = stringOf(value);

    switch (entity.component) {
      case 'sensor': {
        if (held.shape.capabilities.sensor_text !== undefined) {
          return text === undefined ? null : { sensor_text: { value: text.slice(0, 512) } };
        }

        const number = numberOf(value);
        const deviceClass = held.shape.deviceClass;
        const converted =
          number === undefined || held.nativeUnit === undefined || deviceClass === undefined
            ? number
            : toCanonical(deviceClass, number, held.nativeUnit);

        return converted === undefined ? null : { sensor_numeric: { value: converted } };
      }
      case 'binary_sensor': {
        const on = textSetting(entity, 'payload_on', 'ON');
        const off = textSetting(entity, 'payload_off', 'OFF');

        return text === on
          ? { sensor_binary: { isOn: true } }
          : text === off
            ? { sensor_binary: { isOn: false } }
            : null;
      }
      case 'switch':
      case 'lock':
      case 'select':
      case 'number':
        return this.#simpleState(entity, text, value);
      case 'light':
        return this.#lightState(held, reading, value, payload);
      case 'cover':
        return this.#coverState(held, reading, value, text);
      case 'button':
        return null;
    }
  }

  /**
   * The state of a switch, a lock, a select or a number.
   *
   * @param entity - The entity.
   * @param text - What its template read, as text.
   * @param value - What its template read.
   * @returns The state, or null.
   */
  #simpleState(
    entity: MqttEntity,
    text: string | undefined,
    value: unknown,
  ): Record<string, unknown> | null {
    switch (entity.component) {
      case 'switch': {
        const on = textSetting(entity, 'state_on', textSetting(entity, 'payload_on', 'ON'));
        const off = textSetting(entity, 'state_off', textSetting(entity, 'payload_off', 'OFF'));

        return text === on
          ? { on_off: { isOn: true } }
          : text === off
            ? { on_off: { isOn: false } }
            : null;
      }
      case 'lock': {
        const states: Record<string, 'locked' | 'unlocked' | 'jammed'> = {
          [textSetting(entity, 'state_locked', 'LOCKED')]: 'locked',
          [textSetting(entity, 'state_unlocked', 'UNLOCKED')]: 'unlocked',
          [textSetting(entity, 'state_jammed', 'JAMMED')]: 'jammed',
        };
        const lockState = text === undefined ? undefined : states[text];

        return lockState === undefined ? null : { lock: { lockState } };
      }
      case 'select':
        return text === undefined || text === '' ? null : { select: { option: text.slice(0, 64) } };
      case 'number': {
        const number = numberOf(value);

        return number === undefined ? null : { number: { value: number } };
      }
      default:
        return null;
    }
  }

  /**
   * A light's state.
   *
   * @param held - The light.
   * @param reading - What the topic carries.
   * @param value - What its template read.
   * @param payload - The whole payload.
   * @returns The capabilities it changes, or null.
   */
  #lightState(
    held: Held,
    reading: Reading,
    value: unknown,
    payload: string,
  ): Record<string, unknown> | null {
    const { entity, shape } = held;
    const scale = numberSetting(entity, 'brightness_scale', 255);

    if (isJsonLight(entity)) {
      let document: Record<string, unknown>;

      try {
        document = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        return null;
      }

      const next: Record<string, unknown> = {};
      const state = stringOf(document['state']);
      const brightness = numberOf(document['brightness']);
      const mireds = numberOf(document['color_temp']);

      if (state !== undefined) {
        next['on_off'] = { isOn: state.toUpperCase() === 'ON' };
      }

      if (brightness !== undefined && shape.capabilities.level !== undefined) {
        next['level'] = { level: Math.max(0, Math.min(100, (brightness / scale) * 100)) };
      }

      if (mireds !== undefined && shape.capabilities.color_temp !== undefined) {
        next['color_temp'] = { mireds: Math.max(1, Math.min(1000, Math.round(mireds))) };
      }

      return Object.keys(next).length === 0 ? null : next;
    }

    if (reading === 'brightness') {
      const brightness = numberOf(value);

      return brightness === undefined
        ? null
        : { level: { level: Math.max(0, Math.min(100, (brightness / scale) * 100)) } };
    }

    if (reading === 'color_temp') {
      const mireds = numberOf(value);

      return mireds === undefined
        ? null
        : { color_temp: { mireds: Math.max(1, Math.min(1000, Math.round(mireds))) } };
    }

    const text = stringOf(value);
    const on = textSetting(entity, 'state_on', textSetting(entity, 'payload_on', 'ON'));
    const off = textSetting(entity, 'state_off', textSetting(entity, 'payload_off', 'OFF'));

    return text === on
      ? { on_off: { isOn: true } }
      : text === off
        ? { on_off: { isOn: false } }
        : null;
  }

  /**
   * A cover's state.
   *
   * @param held - The cover.
   * @param reading - What the topic carries.
   * @param value - What its template read.
   * @param text - The same, as text.
   * @returns The cover's state, or null.
   */
  #coverState(
    held: Held,
    reading: Reading,
    value: unknown,
    text: string | undefined,
  ): Record<string, unknown> | null {
    const { entity } = held;
    const current = (held.state['cover'] ?? { position: 0, motion: 'stopped' }) as {
      position: number;
      motion: string;
    };

    if (reading === 'position') {
      const raw = numberOf(value);
      const open = numberSetting(entity, 'position_open', 100);
      const closed = numberSetting(entity, 'position_closed', 0);

      if (raw === undefined || open === closed) {
        return null;
      }

      const position = Math.max(0, Math.min(100, ((raw - closed) / (open - closed)) * 100));

      return { cover: { ...current, position } };
    }

    const states: Record<string, { motion: string; position?: number }> = {
      [textSetting(entity, 'state_open', 'open')]: { motion: 'stopped', position: 100 },
      [textSetting(entity, 'state_closed', 'closed')]: { motion: 'stopped', position: 0 },
      [textSetting(entity, 'state_opening', 'opening')]: { motion: 'opening' },
      [textSetting(entity, 'state_closing', 'closing')]: { motion: 'closing' },
      [textSetting(entity, 'state_stopped', 'stopped')]: { motion: 'stopped' },
    };
    const said = text === undefined ? undefined : states[text];

    if (said === undefined) {
      return null;
    }

    // A cover that reports its position keeps it; one that does not is at an end when it says so.
    const hasPosition = textOf(entity.config['position_topic']) !== undefined;

    return {
      cover: {
        position: hasPosition || said.position === undefined ? current.position : said.position,
        motion: said.motion,
      },
    };
  }

  /**
   * What a command publishes.
   *
   * @param held - The entity.
   * @param capability - Which capability.
   * @param command - The command.
   * @returns The topics and payloads.
   * @throws {Error} When the entity takes no such command.
   */
  #commandOf(held: Held, capability: CapabilityName, command: JsonObject): [string, string][] {
    const { entity } = held;
    const topic = textOf(entity.config['command_topic']);
    const name = textOfCommand(command['command']);

    /**
     * The command topic, or a refusal.
     *
     * @returns The topic.
     * @throws {Error} When there is none.
     */
    const commandTopic = (): string => {
      if (topic === undefined) {
        throw new Error(`${entity.name} announces no command topic`);
      }

      return topic;
    };

    if (entity.component === 'light' && isJsonLight(entity)) {
      const scale = numberSetting(entity, 'brightness_scale', 255);
      const isOn = (held.state['on_off'] as { isOn?: boolean } | undefined)?.isOn === true;
      const document: Record<string, unknown> =
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
                  : {};

      if (Object.keys(document).length === 0) {
        throw new Error(`${entity.name} takes no ${name}`);
      }

      return [[commandTopic(), JSON.stringify(document)]];
    }

    switch (capability) {
      case 'on_off': {
        const isOn = (held.state['on_off'] as { isOn?: boolean } | undefined)?.isOn === true;
        const wantsOn = name === 'turn_on' || (name === 'toggle' && !isOn);

        return [
          [
            commandTopic(),
            wantsOn
              ? textSetting(entity, 'payload_on', 'ON')
              : textSetting(entity, 'payload_off', 'OFF'),
          ],
        ];
      }
      case 'level': {
        const brightnessTopic = textOf(entity.config['brightness_command_topic']);
        const scale = numberSetting(entity, 'brightness_scale', 255);

        if (brightnessTopic === undefined) {
          throw new Error(`${entity.name} announces no brightness topic`);
        }

        return [[brightnessTopic, String(Math.round((Number(command['level']) / 100) * scale))]];
      }
      case 'color_temp': {
        const whiteTopic = textOf(entity.config['color_temp_command_topic']);

        if (whiteTopic === undefined) {
          throw new Error(`${entity.name} announces no colour temperature topic`);
        }

        return [[whiteTopic, String(Math.round(Number(command['mireds'])))]];
      }
      case 'cover': {
        if (name === 'set_position') {
          const positionTopic = textOf(entity.config['set_position_topic']);

          if (positionTopic === undefined) {
            throw new Error(`${entity.name} cannot be sent to a position`);
          }

          const open = numberSetting(entity, 'position_open', 100);
          const closed = numberSetting(entity, 'position_closed', 0);

          return [
            [
              positionTopic,
              String(Math.round(closed + (Number(command['position']) / 100) * (open - closed))),
            ],
          ];
        }

        const payloads: Record<string, string> = {
          open: textSetting(entity, 'payload_open', 'OPEN'),
          close: textSetting(entity, 'payload_close', 'CLOSE'),
          stop: textSetting(entity, 'payload_stop', 'STOP'),
        };
        const payload = payloads[name];

        if (payload === undefined) {
          throw new Error(`${entity.name} takes no ${name}`);
        }

        return [[commandTopic(), payload]];
      }
      case 'button':
        return [[commandTopic(), textSetting(entity, 'payload_press', 'PRESS')]];
      case 'number':
        return [[commandTopic(), textOfCommand(command['value'])]];
      case 'select':
        return [[commandTopic(), textOfCommand(command['option'])]];
      case 'lock':
        return [
          [
            commandTopic(),
            name === 'lock'
              ? textSetting(entity, 'payload_lock', 'LOCK')
              : textSetting(entity, 'payload_unlock', 'UNLOCK'),
          ],
        ];
      default:
        throw new Error(`${entity.name} takes no ${capability} command`);
    }
  }

  /**
   * What an entity with no state topic is, after a command.
   *
   * @param held - The entity.
   * @param capability - Which capability.
   * @param command - The command.
   */
  #optimistic(held: Held, capability: CapabilityName, command: JsonObject): void {
    const name = textOfCommand(command['command']);
    const isOn = (held.state['on_off'] as { isOn?: boolean } | undefined)?.isOn === true;

    switch (capability) {
      case 'on_off':
        held.state = {
          ...held.state,
          on_off: { isOn: name === 'turn_on' || (name === 'toggle' && !isOn) },
        };
        break;
      case 'level':
        held.state = {
          ...held.state,
          on_off: { isOn: true },
          level: { level: Number(command['level']) },
        };
        break;
      case 'color_temp':
        held.state = { ...held.state, color_temp: { mireds: Number(command['mireds']) } };
        break;
      case 'number':
        held.state = { ...held.state, number: { value: Number(command['value']) } };
        break;
      case 'select':
        held.state = { ...held.state, select: { option: textOfCommand(command['option']) } };
        break;
      case 'lock':
        held.state = {
          ...held.state,
          lock: { lockState: name === 'lock' ? 'locked' : 'unlocked' },
        };
        break;
      default:
        break;
    }
  }

  /**
   * Reports one entity's state, when it has any.
   *
   * @param key - The entity.
   */
  #reportOf(key: string): void {
    const held = this.#held.get(key);

    if (held === undefined) {
      return;
    }

    // A light that has said nothing of whether it is on has nothing to report yet.
    if (held.entity.component === 'light' && held.state['on_off'] === undefined) {
      return;
    }

    if (Object.keys(held.state).length === 0) {
      return;
    }

    this.#options.report(held.entity, DOMAINS[held.entity.component], held.state, held.isAvailable);
  }
}
