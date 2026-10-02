// @ts-check
/**
 * A Zigbee device's `exposes`, read into the platform's entities, its states and its commands.
 *
 * Zigbee2MQTT describes every device it supports the same way: a list of what the device exposes,
 * each either a whole kind of thing - a `light` with its `state`, `brightness`, `color_temp` and
 * `color`, a `switch`, a `cover`, a `lock`, a `climate` - or a single value: a `numeric`
 * temperature, a `binary` contact, an `enum` action. The number and kind of entities therefore
 * depend on the device, which is why this driver is code (ARCHITECTURE.md 8.3); what each maps to
 * is fixed here, once, for every model Zigbee2MQTT knows.
 *
 * What is mapped: the kinds above; each numeric, binary, enum and text value the device publishes,
 * as a sensor; each value it takes as a setting - `category: config` or not, published or only
 * written - as the entity that sets it: a binary as a switch (a child lock, an LED), a number as a
 * number within its limits (a calibration, a timeout), an enum as a select (the power-on
 * behaviour, an operation mode, an effect); the features of a whole kind of thing it does not use
 * itself (a light's start-up colour temperature, a thermostat's calibration), and the values of a
 * composite (a light's colour options), each as a value of its own; and the firmware update
 * Zigbee2MQTT offers. What is not: text a device takes, which no entity sets, and lists.
 *
 * Pure throughout: a plan is recomputed from the device's entry whenever it is needed, so
 * `describe`, `toState` and `toCommand` always agree on what each entity is.
 */

/** The access bits of an expose. */
const PUBLISHED = 1;
const SETTABLE = 2;
const GETTABLE = 4;

/** The coolest and warmest a light may say it goes, when it does not say: 6500 K and 2000 K. */
const DEFAULT_MIREDS = /** @type {const} */ ([153, 500]);

/** The thermostat modes the platform knows. */
const THERMOSTAT_MODES = ['off', 'heat', 'cool', 'auto', 'fan_only', 'dry'];

/**
 * How far a numeric setting that states no limits goes either way: as far as Zigbee2MQTT's own
 * discovery for Home Assistant lets it.
 */
const UNBOUNDED = 65_535;

/** The most choices a select offers. */
const MAXIMUM_OPTIONS = 64;

/** The whole kinds of thing, whose features are one entity rather than several. */
const WHOLE_KINDS = new Set(['light', 'switch', 'fan', 'cover', 'lock', 'climate']);

/**
 * One expose, the fields read.
 *
 * @typedef {object} Expose
 * @property {string} type - `light`, `switch`, `numeric`, `binary`, …
 * @property {string} [name] - What it is: `state`, `temperature`.
 * @property {string} [label] - What a person calls it.
 * @property {string} [property] - Where its value is in the device's state.
 * @property {number} [access] - Bits: published, settable, gettable.
 * @property {string} [unit] - Its unit.
 * @property {number} [value_min] - Its least value.
 * @property {number} [value_max] - Its greatest.
 * @property {number} [value_step] - How far apart two values are.
 * @property {unknown} [value_on] - What on is, for a binary.
 * @property {unknown} [value_off] - What off is.
 * @property {string[]} [values] - The choices, for an enum.
 * @property {string} [endpoint] - Which endpoint of the device, for one with several.
 * @property {string} [category] - `config` or `diagnostic`.
 * @property {Expose[]} [features] - What a light, a switch, a composite is made of.
 */

/** @typedef {import('@nebulahome/package-runtime').EntityDescriptor} EntityDescriptor */
/** @typedef {import('@nebulahome/contracts').StateReport} StateReport */
/** @typedef {import('@nebulahome/package-runtime').TransportRequest} TransportRequest */

/**
 * What kind of entity a plan is.
 *
 * @typedef {'light' | 'switch' | 'cover' | 'lock' | 'climate' | 'numeric' | 'binary' | 'text'
 *   | 'toggle' | 'number' | 'select' | 'update' | 'connected'} PlanKind
 */

/**
 * One entity, planned out of an expose.
 *
 * @typedef {object} Plan
 * @property {string} objectId - Its id within the device.
 * @property {PlanKind} kind - What it is.
 * @property {EntityDescriptor} descriptor - What `describe` says of it.
 * @property {Record<string, Expose | undefined>} features - The exposes it reads, by role.
 * @property {number} [factor] - What a numeric reading is multiplied by, into its class's unit.
 * @property {string} [parent] - The composite a value is part of, by its property: the value is
 *   `state[parent][property]`, and a setting is sent inside it.
 */

/**
 * A sensor class, and the units of a device it takes: each to the class's own unit, which the
 * platform registers every reading of the class in, by what to multiply by.
 *
 * @typedef {object} SensorClass
 * @property {string} deviceClass - The platform's class.
 * @property {string} unit - The class's own unit, which the entity is registered in.
 * @property {Readonly<Record<string, number>>} from - Each unit it takes, and its factor.
 * @property {'measurement' | 'total_increasing'} [stateClass] - How history aggregates it.
 * @property {string} [icon] - The icon it starts with.
 */

/** @type {Readonly<Record<string, SensorClass[]>>} */
export const SENSOR_CLASSES = {
  temperature: [{ deviceClass: 'temperature', unit: '°C', from: { '°C': 1 }, icon: 'thermometer' }],
  device_temperature: [{ deviceClass: 'temperature', unit: '°C', from: { '°C': 1 } }],
  local_temperature: [
    { deviceClass: 'temperature', unit: '°C', from: { '°C': 1 }, icon: 'thermometer' },
  ],
  humidity: [{ deviceClass: 'humidity', unit: '%', from: { '%': 1 }, icon: 'humidity' }],
  pressure: [
    {
      deviceClass: 'atmospheric_pressure',
      unit: 'Pa',
      from: { Pa: 1, hPa: 100, kPa: 1000, mbar: 100 },
    },
  ],
  illuminance: [{ deviceClass: 'illuminance', unit: 'lx', from: { lx: 1 } }],
  illuminance_lux: [{ deviceClass: 'illuminance', unit: 'lx', from: { lx: 1 } }],
  power: [{ deviceClass: 'power', unit: 'W', from: { W: 1, kW: 1000, mW: 0.001 }, icon: 'power' }],
  energy: [
    {
      deviceClass: 'energy',
      unit: 'Wh',
      from: { Wh: 1, kWh: 1000 },
      stateClass: 'total_increasing',
      icon: 'energy',
    },
  ],
  voltage: [{ deviceClass: 'voltage', unit: 'V', from: { V: 1, mV: 0.001 } }],
  current: [{ deviceClass: 'current', unit: 'A', from: { A: 1, mA: 0.001 } }],
  battery: [{ deviceClass: 'battery', unit: '%', from: { '%': 1 }, icon: 'battery' }],
  co2: [{ deviceClass: 'carbon_dioxide', unit: 'ppm', from: { ppm: 1 } }],
  voc: [
    { deviceClass: 'volatile_organic_compounds', unit: 'µg/m³', from: { 'µg/m³': 1 } },
    { deviceClass: 'volatile_organic_compounds_parts', unit: 'ppm', from: { ppm: 1, ppb: 0.001 } },
  ],
  pm25: [{ deviceClass: 'pm25', unit: 'µg/m³', from: { 'µg/m³': 1 } }],
  pm10: [{ deviceClass: 'pm10', unit: 'µg/m³', from: { 'µg/m³': 1 } }],
  pm1: [{ deviceClass: 'pm1', unit: 'µg/m³', from: { 'µg/m³': 1 } }],
};

/** What a binary value means, by its property, and whether on is its value's opposite. */
const BINARY_CLASSES =
  /** @type {Readonly<Record<string, { deviceClass: string, icon?: string, isInverted?: boolean }>>} */ ({
    occupancy: { deviceClass: 'occupancy', icon: 'motion' },
    presence: { deviceClass: 'presence', icon: 'motion' },
    contact: { deviceClass: 'door', icon: 'door', isInverted: true },
    water_leak: { deviceClass: 'moisture', icon: 'water' },
    smoke: { deviceClass: 'smoke', icon: 'smoke' },
    gas: { deviceClass: 'gas' },
    carbon_monoxide: { deviceClass: 'carbon_monoxide' },
    tamper: { deviceClass: 'tamper' },
    battery_low: { deviceClass: 'battery', icon: 'battery' },
    vibration: { deviceClass: 'vibration' },
  });

/**
 * An id within the device, from a property: lower case, letters, digits and underscores.
 *
 * @param {string} value - The property.
 * @returns {string} The id.
 */
function slug(value) {
  const cleaned = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '_')
    .replaceAll(/^_+|_+$/gu, '')
    .slice(0, 40);

  return /^[a-z]/u.test(cleaned) ? cleaned : `x${cleaned}`;
}

/**
 * A word as a sentence starts it.
 *
 * @param {string} text - The word, as Zigbee2MQTT writes it: `previous_state`.
 * @returns {string} `Previous state`.
 */
function wordsOf(text) {
  const words = text.replaceAll('_', ' ');

  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/**
 * Whether a limit is a number.
 *
 * @param {unknown} value - The limit.
 * @returns {value is number} True when it is a finite number.
 */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * What a person calls an expose.
 *
 * @param {Expose} expose - The expose.
 * @returns {string} Its label, or its property made readable.
 */
function nameOf(expose) {
  if (typeof expose.label === 'string' && expose.label.length > 0) {
    return expose.label.slice(0, 128);
  }

  const words = (expose.property ?? expose.name ?? 'value').replaceAll('_', ' ');

  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`.slice(0, 128);
}

/**
 * Whether an expose's bit is set.
 *
 * @param {Expose | undefined} expose - The expose.
 * @param {number} bit - The bit.
 * @returns {boolean} True when it is.
 */
function can(expose, bit) {
  return expose !== undefined && ((expose.access ?? PUBLISHED) & bit) !== 0;
}

/**
 * The features of a whole kind of thing, by name.
 *
 * @param {Expose} expose - The light, the switch, the cover.
 * @returns {Record<string, Expose>} Its features.
 */
function featuresOf(expose) {
  /** @type {Record<string, Expose>} */
  const features = {};

  for (const feature of expose.features ?? []) {
    if (typeof feature.name === 'string') {
      features[feature.name] = feature;
    }
  }

  return features;
}

/**
 * The sensor class a numeric value is, when its unit is one the class takes.
 *
 * @param {Expose} expose - The value.
 * @returns {SensorClass | undefined} The class.
 */
function sensorClassOf(expose) {
  const candidates = SENSOR_CLASSES[expose.property ?? ''] ?? [];

  return candidates.find((candidate) => (expose.unit ?? '') in candidate.from);
}

/**
 * Plans one whole kind of thing, or one value.
 *
 * @param {Expose} expose - The expose.
 * @returns {Omit<Plan, 'objectId'> & { base: string } | null} The plan, its id not yet made
 *   unique; null for what is not mapped.
 */
function planOne(expose) {
  const suffix = typeof expose.endpoint === 'string' ? `_${expose.endpoint}` : '';

  switch (expose.type) {
    case 'light': {
      const f = featuresOf(expose);
      const color = f['color_hs'] ?? f['color_xy'];

      if (f['state'] === undefined) {
        return null;
      }

      return {
        base: `light${suffix}`,
        kind: 'light',
        features: {
          state: f['state'],
          brightness: f['brightness'],
          colorTemp: f['color_temp'],
          color,
        },
        descriptor: {
          domain: 'light',
          name: suffix === '' ? 'Light' : `Light ${expose.endpoint}`,
          icon: 'light',
          capabilities: {
            on_off: {},
            ...(f['brightness'] === undefined ? {} : { level: { hasTransition: true } }),
            ...(f['color_temp'] === undefined
              ? {}
              : {
                  color_temp: {
                    minMireds: Math.round(f['color_temp'].value_min ?? DEFAULT_MIREDS[0]),
                    maxMireds: Math.round(f['color_temp'].value_max ?? DEFAULT_MIREDS[1]),
                  },
                }),
            ...(color === undefined ? {} : { color_hs: {} }),
          },
        },
      };
    }

    case 'switch':
    case 'fan': {
      const f = featuresOf(expose);

      if (f['state'] === undefined) {
        return null;
      }

      const isFan = expose.type === 'fan';

      return {
        base: `${isFan ? 'fan' : 'switch'}${suffix}`,
        kind: 'switch',
        features: { state: f['state'] },
        descriptor: {
          domain: 'switch',
          name: `${isFan ? 'Fan' : 'Switch'}${suffix === '' ? '' : ` ${String(expose.endpoint)}`}`,
          icon: isFan ? 'fan' : 'switch',
          capabilities: { on_off: {} },
        },
      };
    }

    case 'cover': {
      const f = featuresOf(expose);

      return {
        base: `cover${suffix}`,
        kind: 'cover',
        features: { state: f['state'], position: f['position'], tilt: f['tilt'] },
        descriptor: {
          domain: 'cover',
          name: suffix === '' ? 'Cover' : `Cover ${String(expose.endpoint)}`,
          icon: 'blind',
          capabilities: {
            cover: { hasPosition: f['position'] !== undefined, hasTilt: f['tilt'] !== undefined },
          },
        },
      };
    }

    case 'lock': {
      const f = featuresOf(expose);

      return {
        base: `lock${suffix}`,
        kind: 'lock',
        features: { state: f['state'], lockState: f['lock_state'] },
        descriptor: {
          domain: 'lock',
          name: 'Lock',
          icon: 'lock',
          capabilities: { lock: {} },
        },
      };
    }

    case 'climate': {
      const f = featuresOf(expose);
      const setpoint = f['occupied_heating_setpoint'] ?? f['current_heating_setpoint'];

      if (setpoint === undefined || f['local_temperature'] === undefined) {
        return null;
      }

      const modes = (f['system_mode']?.values ?? ['heat']).filter((mode) =>
        THERMOSTAT_MODES.includes(mode),
      );

      return {
        base: `thermostat${suffix}`,
        kind: 'climate',
        features: {
          current: f['local_temperature'],
          setpoint,
          mode: f['system_mode'],
          action: f['running_state'],
        },
        descriptor: {
          domain: 'climate',
          name: 'Thermostat',
          icon: 'thermostat',
          capabilities: {
            thermostat: {
              supportedModes: modes.length === 0 ? ['heat'] : modes,
              minTemperature: setpoint.value_min ?? 5,
              maxTemperature: setpoint.value_max ?? 30,
              temperatureStep: setpoint.value_step ?? 0.5,
            },
          },
        },
      };
    }

    default: {
      return null;
    }
  }
}

/**
 * Plans one value: a reading as a sensor, a setting as the entity that sets it, or - for a
 * composite - each of its values, set inside it.
 *
 * @param {Expose} expose - The value, or the composite.
 * @param {Expose} [parent] - The composite it is part of.
 * @returns {Array<Omit<Plan, 'objectId'> & { base: string }>} The plans, their ids not yet made
 *   unique; none for what is not mapped.
 */
function planValue(expose, parent) {
  if (expose.type === 'composite') {
    // One level: a composite inside another, or one without a property, is not set by parts.
    return parent === undefined && typeof expose.property === 'string'
      ? (expose.features ?? []).flatMap((feature) => planValue(feature, expose))
      : [];
  }

  const property = expose.property;

  if (typeof property !== 'string') {
    return [];
  }

  const isSetting = can(expose, SETTABLE);
  const isRead = can(expose, PUBLISHED);
  const own = nameOf(expose);
  const name =
    parent === undefined
      ? own
      : `${nameOf(parent)}: ${own.charAt(0).toLowerCase()}${own.slice(1)}`.slice(0, 128);
  const base = parent === undefined ? property : `${String(parent.property)}_${property}`;
  const within = parent?.property === undefined ? {} : { parent: parent.property };

  switch (expose.type) {
    case 'numeric': {
      const min = isFiniteNumber(expose.value_min) ? expose.value_min : -UNBOUNDED;
      const max = isFiniteNumber(expose.value_max) ? expose.value_max : UNBOUNDED;

      if (isSetting && min < max) {
        const step =
          isFiniteNumber(expose.value_step) && expose.value_step > 0 ? expose.value_step : 1;

        return [
          {
            base,
            kind: 'number',
            ...within,
            features: { value: expose },
            descriptor: {
              domain: 'number',
              name,
              ...(expose.unit === undefined || expose.unit === ''
                ? {}
                : { unitOfMeasurement: expose.unit.slice(0, 32) }),
              capabilities: { number: { min, max, step } },
            },
          },
        ];
      }

      if (!isRead) {
        return [];
      }

      const sensorClass = sensorClassOf(expose);
      const unit = sensorClass?.unit ?? expose.unit;

      return [
        {
          base,
          kind: 'numeric',
          ...within,
          features: { value: expose },
          factor: sensorClass?.from[expose.unit ?? ''] ?? 1,
          descriptor: {
            domain: 'sensor',
            name,
            ...(sensorClass?.icon === undefined ? {} : { icon: sensorClass.icon }),
            ...(unit === undefined || unit === '' ? {} : { unitOfMeasurement: unit.slice(0, 32) }),
            ...(sensorClass === undefined ? {} : { deviceClass: sensorClass.deviceClass }),
            stateClass: sensorClass?.stateClass ?? 'measurement',
            capabilities: { sensor_numeric: {} },
          },
        },
      ];
    }

    case 'binary': {
      // A binary the device takes - a child lock, an LED - is a switch of its settings.
      if (isSetting) {
        return [
          {
            base,
            kind: 'toggle',
            ...within,
            features: { value: expose },
            descriptor: { domain: 'switch', name, capabilities: { on_off: {} } },
          },
        ];
      }

      if (!isRead) {
        return [];
      }

      const binaryClass = BINARY_CLASSES[property];

      return [
        {
          base,
          kind: 'binary',
          ...within,
          features: { value: expose },
          descriptor: {
            domain: 'binary_sensor',
            name,
            ...(binaryClass?.icon === undefined ? {} : { icon: binaryClass.icon }),
            ...(binaryClass === undefined ? {} : { deviceClass: binaryClass.deviceClass }),
            capabilities: { sensor_binary: {} },
          },
        },
      ];
    }

    case 'enum':
    case 'text': {
      const values = [...new Set((expose.values ?? []).map(String))].filter(
        (value) => value.length > 0 && value.length <= 64,
      );

      if (
        expose.type === 'enum' &&
        isSetting &&
        values.length > 0 &&
        values.length <= MAXIMUM_OPTIONS
      ) {
        return [
          {
            base,
            kind: 'select',
            ...within,
            features: { value: expose },
            descriptor: {
              domain: 'select',
              name,
              capabilities: {
                select: {
                  options: values.map((value) => ({ value, label: wordsOf(value).slice(0, 64) })),
                },
              },
            },
          },
        ];
      }

      // Text a device takes has no entity to set it: what it says of it is still read.
      if (!isRead) {
        return [];
      }

      return [
        {
          base,
          kind: 'text',
          ...within,
          features: { value: expose },
          descriptor: {
            domain: 'sensor',
            name,
            ...(property === 'action' ? { icon: 'remote' } : {}),
            capabilities: { sensor_text: {} },
          },
        },
      ];
    }

    default: {
      return [];
    }
  }
}

/**
 * Plans one expose: a whole kind of thing, and each of its features it does not use itself as a
 * value of its own - or one value.
 *
 * @param {Expose} expose - The expose.
 * @returns {Array<Omit<Plan, 'objectId'> & { base: string }>} The plans.
 */
function planExpose(expose) {
  if (!WHOLE_KINDS.has(expose.type)) {
    return planValue(expose);
  }

  const whole = planOne(expose);
  const used = new Set(
    Object.values(whole?.features ?? {}).flatMap((feature) =>
      feature?.name === undefined ? [] : [feature.name],
    ),
  );

  // A light's colour is one of two composites, whichever it reads: neither is set by parts.
  if (expose.type === 'light') {
    used.add('color_xy').add('color_hs');
  }

  const rest = (expose.features ?? [])
    .filter((feature) => feature.name === undefined || !used.has(feature.name))
    .flatMap((feature) => planValue(feature));

  return whole === null ? rest : [whole, ...rest];
}

/**
 * Plans every entity of a device.
 *
 * @param {Record<string, unknown>} device - The device's entry in `bridge/devices`.
 * @returns {Plan[]} One plan per entity, each with an id of its own within the device.
 */
export function planEntities(device) {
  const definition = /** @type {Record<string, unknown>} */ (device['definition'] ?? {});
  const exposes = /** @type {Expose[]} */ (
    Array.isArray(definition['exposes']) ? definition['exposes'] : []
  );

  /** @type {Plan[]} */
  const plans = [];
  const taken = new Set();

  /**
   * Adds a plan under an id no other plan of the device has.
   *
   * @param {Omit<Plan, 'objectId'> & { base: string }} planned - The plan.
   */
  const add = (planned) => {
    const base = slug(planned.base);
    let objectId = base;

    for (let count = 2; taken.has(objectId); count += 1) {
      objectId = `${base}_${String(count)}`;
    }

    taken.add(objectId);

    plans.push({
      kind: planned.kind,
      features: planned.features,
      ...(planned.factor === undefined ? {} : { factor: planned.factor }),
      ...(planned.parent === undefined ? {} : { parent: planned.parent }),
      objectId,
      descriptor: { ...planned.descriptor, objectId },
    });
  };

  for (const expose of exposes) {
    for (const planned of planExpose(expose)) {
      add(planned);
    }
  }

  if (definition['supports_ota'] === true) {
    add({
      base: 'firmware',
      kind: 'update',
      features: {},
      descriptor: {
        domain: 'update',
        name: 'Firmware',
        capabilities: { update: { canInstall: true, hasProgress: true } },
      },
    });
  }

  // A device with nothing mapped still says whether Zigbee2MQTT reaches it: a device row with no
  // entity is one the interface cannot explain.
  if (plans.length === 0) {
    add({
      base: 'connected',
      kind: 'connected',
      features: {},
      descriptor: {
        domain: 'binary_sensor',
        name: 'Connected',
        deviceClass: 'connectivity',
        capabilities: { sensor_binary: {} },
      },
    });
  }

  return plans;
}

/**
 * Clamps a number into a range.
 *
 * @param {number} value - The number.
 * @param {number} low - The least.
 * @param {number} high - The greatest.
 * @returns {number} It, within the range.
 */
function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/**
 * A colour given as CIE x and y, as a hue and a saturation.
 *
 * Through linear sRGB at full brightness - a light's brightness is its own setting - then the
 * sRGB curve, then the hue and saturation of that colour.
 *
 * @param {number} x - x.
 * @param {number} y - y.
 * @returns {{ hue: number, saturation: number }} The colour.
 */
export function xyToHs(x, y) {
  const Y = 1;
  const X = y === 0 ? 0 : (Y / y) * x;
  const Z = y === 0 ? 0 : (Y / y) * (1 - x - y);
  const linear = [
    X * 3.2406 - Y * 1.5372 - Z * 0.4986,
    -X * 0.9689 + Y * 1.8758 + Z * 0.0415,
    X * 0.0557 - Y * 0.204 + Z * 1.057,
  ].map((channel) => Math.max(0, channel));
  const peak = Math.max(...linear, 1e-9);
  const [r = 0, g = 0, b = 0] = linear
    .map((channel) => channel / peak)
    .map((channel) =>
      channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055,
    );
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;

  if (delta > 0) {
    hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }

  return {
    hue: Math.round(clamp(hue, 0, 360)),
    saturation: Math.round(clamp(max === 0 ? 0 : (delta / max) * 100, 0, 100)),
  };
}

/**
 * The value of a feature in a state message, when it is there.
 *
 * @param {Record<string, unknown>} state - The message.
 * @param {Expose | undefined} feature - The feature.
 * @returns {unknown} Its value, or undefined.
 */
function valueOf(state, feature) {
  return feature?.property === undefined ? undefined : state[feature.property];
}

/**
 * The value of a plan's feature in a state message: at its property, or inside its composite.
 *
 * @param {Plan} plan - The entity.
 * @param {Record<string, unknown>} state - The message.
 * @param {Expose | undefined} feature - The feature.
 * @returns {unknown} Its value, or undefined.
 */
function valueIn(plan, state, feature) {
  if (plan.parent === undefined) {
    return valueOf(state, feature);
  }

  const holder = state[plan.parent];

  return typeof holder === 'object' && holder !== null && !Array.isArray(holder)
    ? valueOf(/** @type {Record<string, unknown>} */ (holder), feature)
    : undefined;
}

/**
 * What one plan says, out of a state message.
 *
 * @param {Plan} plan - The entity.
 * @param {Record<string, unknown>} state - What the device published.
 * @returns {Record<string, unknown> | null} The capability state, only what the message says;
 *   null when it says nothing about the entity.
 */
export function stateOf(plan, state) {
  const f = plan.features;

  switch (plan.kind) {
    case 'light': {
      /** @type {Record<string, unknown>} */
      const out = {};
      const on = valueOf(state, f['state']);
      const brightness = valueOf(state, f['brightness']);
      const mireds = valueOf(state, f['colorTemp']);
      const color = valueOf(state, f['color']);

      if (on !== undefined) {
        out['on_off'] = { isOn: on === (f['state']?.value_on ?? 'ON') };
      }

      if (typeof brightness === 'number') {
        const max = f['brightness']?.value_max ?? 254;

        out['level'] = { level: clamp(Math.round((brightness / max) * 100), 0, 100) };
      }

      if (typeof mireds === 'number') {
        out['color_temp'] = { mireds: clamp(Math.round(mireds), 1, 1000) };
      }

      if (typeof color === 'object' && color !== null) {
        const c = /** @type {Record<string, unknown>} */ (color);

        if (typeof c['hue'] === 'number' && typeof c['saturation'] === 'number') {
          out['color_hs'] = {
            hue: clamp(c['hue'], 0, 360),
            saturation: clamp(c['saturation'], 0, 100),
          };
        } else if (typeof c['x'] === 'number' && typeof c['y'] === 'number') {
          out['color_hs'] = xyToHs(c['x'], c['y']);
        }
      }

      return Object.keys(out).length === 0 ? null : out;
    }

    case 'switch': {
      const on = valueOf(state, f['state']);

      return on === undefined ? null : { on_off: { isOn: on === (f['state']?.value_on ?? 'ON') } };
    }

    case 'cover': {
      const position = valueOf(state, f['position']);
      const word = valueOf(state, f['state']);
      const moving = state['moving'];
      const known =
        typeof position === 'number'
          ? position
          : word === 'OPEN'
            ? 100
            : word === 'CLOSE'
              ? 0
              : undefined;

      if (known === undefined) {
        return null;
      }

      const tilt = valueOf(state, f['tilt']);

      return {
        cover: {
          position: clamp(known, 0, 100),
          ...(typeof tilt === 'number' ? { tilt: clamp(tilt, 0, 100) } : {}),
          motion: moving === 'UP' ? 'opening' : moving === 'DOWN' ? 'closing' : 'stopped',
        },
      };
    }

    case 'lock': {
      const detail = valueOf(state, f['lockState']);
      const word = valueOf(state, f['state']);
      const lockState =
        detail === 'locked' || word === 'LOCK'
          ? 'locked'
          : detail === 'unlocked' || word === 'UNLOCK'
            ? 'unlocked'
            : detail === 'not_fully_locked'
              ? 'jammed'
              : undefined;

      return lockState === undefined ? null : { lock: { lockState } };
    }

    case 'climate': {
      const current = valueOf(state, f['current']);
      const target = valueOf(state, f['setpoint']);

      if (typeof current !== 'number' || typeof target !== 'number') {
        return null;
      }

      const mode = valueOf(state, f['mode']);
      const running = valueOf(state, f['action']);

      return {
        thermostat: {
          currentTemperature: current,
          targetTemperature: target,
          mode: typeof mode === 'string' && THERMOSTAT_MODES.includes(mode) ? mode : 'heat',
          action:
            running === 'heat'
              ? 'heating'
              : running === 'cool'
                ? 'cooling'
                : running === 'fan_only'
                  ? 'fan'
                  : 'idle',
        },
      };
    }

    case 'numeric': {
      const value = valueIn(plan, state, f['value']);

      return typeof value === 'number'
        ? { sensor_numeric: { value: value * (plan.factor ?? 1) } }
        : null;
    }

    case 'number': {
      const value = valueIn(plan, state, f['value']);

      return typeof value === 'number' && Number.isFinite(value) ? { number: { value } } : null;
    }

    case 'toggle': {
      const value = valueIn(plan, state, f['value']);

      return value === undefined || value === null
        ? null
        : { on_off: { isOn: value === (f['value']?.value_on ?? true) } };
    }

    case 'select': {
      const value = valueIn(plan, state, f['value']);
      const option = value === undefined || value === null ? '' : String(value).slice(0, 64);

      return option === '' ? null : { select: { option } };
    }

    case 'binary': {
      const value = valueIn(plan, state, f['value']);

      if (value === undefined || value === null) {
        return null;
      }

      const isOn = value === (f['value']?.value_on ?? true);
      const isInverted = BINARY_CLASSES[f['value']?.property ?? '']?.isInverted === true;

      return { sensor_binary: { isOn: isInverted ? !isOn : isOn } };
    }

    case 'text': {
      const value = valueIn(plan, state, f['value']);

      return value === undefined || value === null
        ? null
        : { sensor_text: { value: String(value).slice(0, 512) } };
    }

    case 'update': {
      const update = state['update'];

      if (typeof update !== 'object' || update === null) {
        return null;
      }

      const u = /** @type {Record<string, unknown>} */ (update);
      const installed = u['installed_version'] ?? null;
      const latest = u['latest_version'] ?? null;
      const installedVersion = installed === null ? null : String(installed).slice(0, 64);

      return {
        update: {
          installedVersion,
          latestVersion:
            u['state'] === 'available'
              ? latest === null
                ? 'newer'
                : String(latest).slice(0, 64)
              : installedVersion,
          isInstalling: u['state'] === 'updating',
          progress: typeof u['progress'] === 'number' ? clamp(u['progress'], 0, 100) : null,
        },
      };
    }

    case 'connected': {
      return null;
    }
  }
}

/**
 * What to publish for a command.
 *
 * @param {Plan} plan - The entity.
 * @param {string} capability - Which of its capabilities.
 * @param {Record<string, unknown>} command - What to do, already validated by `core`.
 * @param {Record<string, unknown>} [current] - What the entity last reported, for a toggle of a
 *   setting: Zigbee2MQTT toggles only a device's own state.
 * @returns {{ op: string, payload: Record<string, unknown> }} The request's verb and payload.
 * @throws {Error} For a command the entity does not take.
 */
export function commandOf(plan, capability, command, current) {
  const f = plan.features;
  const verb = command['command'];

  /**
   * A `set` of some properties.
   *
   * @param {Record<string, unknown>} payload - The properties.
   * @returns {{ op: string, payload: Record<string, unknown> }} The request.
   */
  const set = (payload) => ({ op: 'set', payload });
  const stateProperty = f['state']?.property ?? 'state';

  /**
   * A `set` of the one value a setting is, inside its composite when it is part of one.
   *
   * @param {unknown} value - What to set it to.
   * @returns {{ op: string, payload: Record<string, unknown> }} The request.
   */
  const put = (value) => {
    const property = f['value']?.property ?? plan.objectId;

    return set(
      plan.parent === undefined ? { [property]: value } : { [plan.parent]: { [property]: value } },
    );
  };

  if (plan.kind === 'toggle' && capability === 'on_off') {
    const was = /** @type {{ isOn?: unknown } | undefined} */ (current?.['on_off'])?.isOn === true;
    const isOn = verb === 'turn_on' ? true : verb === 'turn_off' ? false : !was;

    return put(isOn ? (f['value']?.value_on ?? true) : (f['value']?.value_off ?? false));
  }

  if (plan.kind === 'number' && capability === 'number' && typeof command['value'] === 'number') {
    return put(command['value']);
  }

  if (plan.kind === 'select' && capability === 'select' && typeof command['option'] === 'string') {
    return put(command['option']);
  }

  if (capability === 'on_off') {
    return set({
      [stateProperty]: verb === 'turn_on' ? 'ON' : verb === 'turn_off' ? 'OFF' : 'TOGGLE',
    });
  }

  if (capability === 'level' && typeof command['level'] === 'number') {
    const max = f['brightness']?.value_max ?? 254;
    const level = command['level'];

    if (level === 0) {
      return set({ [stateProperty]: 'OFF' });
    }

    return set({
      [f['brightness']?.property ?? 'brightness']: Math.round((level / 100) * max),
      ...(typeof command['transitionMs'] === 'number'
        ? { transition: command['transitionMs'] / 1000 }
        : {}),
    });
  }

  if (capability === 'color_temp' && typeof command['mireds'] === 'number') {
    return set({ [f['colorTemp']?.property ?? 'color_temp']: command['mireds'] });
  }

  if (capability === 'color_hs') {
    return set({ color: { hue: command['hue'], saturation: command['saturation'] } });
  }

  if (capability === 'cover') {
    if (verb === 'set_position') {
      return set({ [f['position']?.property ?? 'position']: command['position'] });
    }

    if (verb === 'set_tilt') {
      return set({ [f['tilt']?.property ?? 'tilt']: command['tilt'] });
    }

    return set({ [stateProperty]: verb === 'open' ? 'OPEN' : verb === 'close' ? 'CLOSE' : 'STOP' });
  }

  if (capability === 'lock') {
    return set({ [stateProperty]: verb === 'lock' ? 'LOCK' : 'UNLOCK' });
  }

  if (capability === 'thermostat') {
    return verb === 'set_mode'
      ? set({ [f['mode']?.property ?? 'system_mode']: command['mode'] })
      : set({ [f['setpoint']?.property ?? 'occupied_heating_setpoint']: command['temperature'] });
  }

  if (capability === 'update') {
    return { op: 'ota_update', payload: {} };
  }

  throw new Error(`${plan.objectId} takes no ${capability} command`);
}

/**
 * What to ask a device for when the hub starts: its readable state, which Zigbee2MQTT does not
 * keep on the broker.
 *
 * @param {Plan[]} plans - The device's entities.
 * @returns {Record<string, string>} The `get` payload: every gettable property, empty.
 */
export function refreshPayload(plans) {
  /** @type {Record<string, string>} */
  const payload = {};

  for (const plan of plans) {
    for (const feature of Object.values(plan.features)) {
      if (feature?.property !== undefined && can(feature, GETTABLE)) {
        // A composite is read whole.
        payload[plan.parent ?? feature.property] = '';
      }
    }
  }

  return payload;
}
