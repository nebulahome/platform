/**
 * The platform's mapping of a Matter device onto entities: the one driver every Matter device can
 * be run by, whoever's integration it is.
 *
 * Matter describes itself - device types and clusters on numbered endpoints - so one mapping
 * covers what any maker ships, and a vendor whose `driver.json` says `"kind": "matter"` gets it
 * without writing code: its devices are its own, on its page, and mapped here.
 *
 * **What is mapped.** Per endpoint: on/off, level and colour (hue and saturation, temperature) as
 * a light or a switch; a window covering; a door lock; a thermostat; temperature, humidity,
 * illuminance, pressure and CO₂; occupancy, contact and leak; the battery; power, voltage, current
 * and energy; and, for the node itself, its firmware. What else a device serves is listed on the
 * Brokers page as not mapped.
 *
 * **Pure throughout**, like every integration: what the transport hands over is the device's
 * whole attribute record and the paths that changed, so a state is always computed from every
 * field it needs - a colour's hue with its saturation, a thermostat's setpoint with its mode.
 */
import { z } from 'zod';

import {
  jsonObjectSchema,
  matterIdentitySchema,
  MATTER_TRANSPORT,
  normalizeMac,
  resolveCanonicalUnit,
  resolveStateClass,
  toCanonical,
  ValidationError,
  type CapabilityName,
  type CapabilityState,
  type EntityStateClass,
  type JsonObject,
  type THERMOSTAT_MODES,
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
  attributeOf,
  CLUSTER,
  DEVICE_TYPE,
  deviceTypesOf,
  matterDeviceKey,
  nameOf,
  serves,
  splitPath,
  type MatterAttributes,
  type MatterDeviceSnapshot,
} from './matter-node.js';
import type { Discovered, TransportInbound, TransportRequest } from './transport.js';

/** A thermostat's mode, as the platform names it. */
type ThermostatMode = (typeof THERMOSTAT_MODES)[number];

/** The global attribute every cluster carries its features in. */
const FEATURE_MAP = 65_532;

/** How long a lock is given to answer a timed command. */
const TIMED_COMMAND_MS = 10_000;

/** The firmware the controller found on offer for a node; null when none is newer. */
export type MatterUpdateOffer = {
  readonly softwareVersion: number;
  readonly softwareVersionString: string;
} | null;

/** What the transport hands a driver: the device as it is now, and what changed. */
export type MatterInbound = {
  readonly device: MatterDeviceSnapshot;

  /** The paths that changed; null when everything is to be read again. */
  readonly changed: readonly string[] | null;

  /** The firmware on offer, for the node itself; undefined when not looked for yet. */
  readonly update?: MatterUpdateOffer;
};

/** What a driver asks the transport to do. */
export type MatterRequest =
  | {
      readonly op: 'invoke';
      readonly args: {
        readonly endpoint: number;
        readonly cluster: number;
        readonly command: string;
        readonly payload: JsonObject;
        readonly timedMs?: number;
      };
    }
  | {
      readonly op: 'write';
      readonly args: {
        readonly endpoint: number;
        readonly cluster: number;
        readonly attribute: number;
        readonly value: number;
      };
    }
  | { readonly op: 'update'; readonly args: JsonObject };

/** The clusters below turn into entities. */
export const MATTER_MAPPED_CLUSTERS: ReadonlySet<number> = new Set([
  CLUSTER.onOff,
  CLUSTER.levelControl,
  CLUSTER.colorControl,
  CLUSTER.windowCovering,
  CLUSTER.doorLock,
  CLUSTER.thermostat,
  CLUSTER.temperatureMeasurement,
  CLUSTER.relativeHumidityMeasurement,
  CLUSTER.illuminanceMeasurement,
  CLUSTER.pressureMeasurement,
  CLUSTER.carbonDioxideMeasurement,
  CLUSTER.occupancySensing,
  CLUSTER.booleanState,
  CLUSTER.powerSource,
  CLUSTER.electricalPowerMeasurement,
  CLUSTER.electricalEnergyMeasurement,
  CLUSTER.otaRequestor,
]);

/**
 * The clusters every device serves to be a Matter device at all - commissioning, diagnostics,
 * labels, groups - which are neither mapped nor worth listing as not mapped.
 */
export const MATTER_INFRASTRUCTURE_CLUSTERS: ReadonlySet<number> = new Set([
  3, 4, 5, 29, 30, 31, 40, 41, 43, 44, 45, 46, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 60, 62, 63,
  64, 65, 70, 98, 156,
]);

/** One entity of a device, and how its state and commands are read. */
type MatterEntity = {
  readonly objectId: string;
  readonly endpoint: number;

  /** The clusters whose attributes it is computed from: a change to one recomputes it. */
  readonly clusters: readonly number[];

  /** The one attribute it is computed from, for an entity that reads only one. */
  readonly attribute?: number;

  readonly descriptor: EntityDescriptor;

  /**
   * Its state now.
   *
   * @param attributes - The device's.
   * @param update - The firmware on offer.
   * @returns The state, or undefined while the device has not said enough.
   */
  readonly stateOf: (
    attributes: MatterAttributes,
    update: MatterUpdateOffer | undefined,
  ) => CapabilityState | undefined;

  /**
   * The request a command is.
   *
   * @param target - The command.
   * @param last - The entity's last state.
   * @returns The request, or undefined for a command it does not take.
   */
  readonly commandOf?: (
    target: CommandTarget,
    last: CapabilityState | undefined,
  ) => MatterRequest | undefined;
};

/** One entity before its object id is settled. */
type Draft = Omit<MatterEntity, 'objectId' | 'descriptor'> & {
  /** What kind of entity it is, which its object id is made of: `light`, `temperature`. */
  readonly key: string;
  readonly descriptor: Omit<EntityDescriptor, 'objectId'>;
};

/**
 * A number attribute.
 *
 * @param value - The attribute.
 * @returns It, or undefined when it is not a finite number - null included.
 */
function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * A value held to a range.
 *
 * @param value - The value.
 * @param min - The least.
 * @param max - The most.
 * @returns It, within the range.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * A fade in Matter's tenths of a second.
 *
 * @param transitionMs - The fade the command asks for, if any.
 * @returns Tenths of a second; 0 for at once.
 */
function tenthsOf(transitionMs: unknown): number {
  return typeof transitionMs === 'number' ? Math.round(transitionMs / 100) : 0;
}

/**
 * A command invoked on a cluster.
 *
 * @param endpoint - The endpoint.
 * @param cluster - The cluster.
 * @param command - The command, as matter.js names it.
 * @param payload - Its fields.
 * @param timedMs - How long a timed command is given, for one that must be timed.
 * @returns The request.
 */
function invoke(
  endpoint: number,
  cluster: number,
  command: string,
  payload: JsonObject = {},
  timedMs?: number,
): MatterRequest {
  return {
    op: 'invoke',
    args: { endpoint, cluster, command, payload, ...(timedMs === undefined ? {} : { timedMs }) },
  };
}

/** What every fade-capable command of the lighting clusters carries besides its own fields. */
const NO_OPTIONS = { optionsMask: 0, optionsOverride: 0 } as const;

/**
 * The light, or switch, an endpoint with On/Off is.
 *
 * @param attributes - The device's.
 * @param endpoint - The endpoint.
 * @returns The entity.
 */
function onOffEntity(attributes: MatterAttributes, endpoint: number): Draft {
  const types = deviceTypesOf(attributes, endpoint);
  const isLight = [
    DEVICE_TYPE.onOffLight,
    DEVICE_TYPE.dimmableLight,
    DEVICE_TYPE.colorTemperatureLight,
    DEVICE_TYPE.extendedColorLight,
    DEVICE_TYPE.dimmablePlugInUnit,
    DEVICE_TYPE.mountedDimmableLoadControl,
  ].some((type) => types.includes(type));
  const hasLevel = isLight && serves(attributes, endpoint, CLUSTER.levelControl);
  const colorFeatures = serves(attributes, endpoint, CLUSTER.colorControl)
    ? (numberOf(attributeOf(attributes, endpoint, CLUSTER.colorControl, FEATURE_MAP)) ?? 0)
    : 0;
  // Hue and saturation is feature bit 0, colour temperature bit 4; a lamp that only speaks XY is
  // left to its on/off and level.
  const hasHs = isLight && (colorFeatures & 1) !== 0;
  const hasTemperature = isLight && (colorFeatures & 16) !== 0;
  const minMireds = clamp(
    numberOf(attributeOf(attributes, endpoint, CLUSTER.colorControl, 16_395)) ?? 153,
    1,
    1000,
  );
  const maxMireds = clamp(
    numberOf(attributeOf(attributes, endpoint, CLUSTER.colorControl, 16_396)) ?? 500,
    minMireds,
    1000,
  );
  const capabilities: Partial<Record<CapabilityName, JsonObject>> = {
    on_off: { hasTransition: false },
    ...(hasLevel ? { level: { hasTransition: true } } : {}),
    ...(hasHs ? { color_hs: { hasTransition: true } } : {}),
    ...(hasTemperature ? { color_temp: { minMireds, maxMireds, hasTransition: true } } : {}),
  };

  return {
    key: isLight ? 'light' : 'switch',
    endpoint,
    clusters: [CLUSTER.onOff, CLUSTER.levelControl, CLUSTER.colorControl],
    descriptor: {
      domain: isLight ? 'light' : 'switch',
      name: isLight ? 'Light' : 'Switch',
      capabilities,
    },
    /**
     * Reads the entity's state.
     *
     * @param read - The device's attributes.
     * @returns The state, or undefined while the device has not said enough.
     */
    stateOf: (read) => {
      const isOn = attributeOf(read, endpoint, CLUSTER.onOff, 0);

      if (typeof isOn !== 'boolean') {
        return undefined;
      }

      const level = numberOf(attributeOf(read, endpoint, CLUSTER.levelControl, 0));
      const hue = numberOf(attributeOf(read, endpoint, CLUSTER.colorControl, 0));
      const saturation = numberOf(attributeOf(read, endpoint, CLUSTER.colorControl, 1));
      const mireds = numberOf(attributeOf(read, endpoint, CLUSTER.colorControl, 7));

      return {
        on_off: { isOn },
        ...(hasLevel && level !== undefined
          ? { level: { level: clamp(Math.round((level / 254) * 100), 0, 100) } }
          : {}),
        ...(hasHs && hue !== undefined && saturation !== undefined
          ? {
              color_hs: {
                hue: clamp(Math.round((hue / 254) * 360), 0, 360),
                saturation: clamp(Math.round((saturation / 254) * 100), 0, 100),
              },
            }
          : {}),
        ...(hasTemperature && mireds !== undefined
          ? { color_temp: { mireds: clamp(Math.round(mireds), 1, 1000) } }
          : {}),
      };
    },
    /**
     * Turns a command into a request.
     *
     * @param target - The command.
     * @returns The request, or undefined for a command it does not take.
     */
    commandOf: (target) => {
      const { command } = target;
      const name = command['command'];

      switch (name) {
        case 'turn_on':
          return invoke(endpoint, CLUSTER.onOff, 'on');
        case 'turn_off':
          return invoke(endpoint, CLUSTER.onOff, 'off');
        case 'toggle':
          return invoke(endpoint, CLUSTER.onOff, 'toggle');
        case 'set_level': {
          const level = numberOf(command['level']) ?? 0;

          return level <= 0
            ? invoke(endpoint, CLUSTER.onOff, 'off')
            : invoke(endpoint, CLUSTER.levelControl, 'moveToLevelWithOnOff', {
                level: clamp(Math.round((level / 100) * 254), 1, 254),
                transitionTime: tenthsOf(command['transitionMs']),
                ...NO_OPTIONS,
              });
        }
        case 'set_color':
          return invoke(endpoint, CLUSTER.colorControl, 'moveToHueAndSaturation', {
            hue: clamp(Math.round(((numberOf(command['hue']) ?? 0) / 360) * 254), 0, 254),
            saturation: clamp(
              Math.round(((numberOf(command['saturation']) ?? 0) / 100) * 254),
              0,
              254,
            ),
            transitionTime: tenthsOf(command['transitionMs']),
            ...NO_OPTIONS,
          });
        case 'set_color_temp':
          return invoke(endpoint, CLUSTER.colorControl, 'moveToColorTemperature', {
            colorTemperatureMireds: clamp(
              Math.round(numberOf(command['mireds']) ?? minMireds),
              minMireds,
              maxMireds,
            ),
            transitionTime: tenthsOf(command['transitionMs']),
            ...NO_OPTIONS,
          });
        default:
          return undefined;
      }
    },
  };
}

/**
 * The cover a Window Covering endpoint is. Matter counts how far it is closed, in hundredths of a
 * percent; the platform counts how far it is open.
 *
 * @param attributes - The device's.
 * @param endpoint - The endpoint.
 * @returns The entity.
 */
function coverEntity(attributes: MatterAttributes, endpoint: number): Draft {
  const features =
    numberOf(attributeOf(attributes, endpoint, CLUSTER.windowCovering, FEATURE_MAP)) ?? 0;
  // Position-aware lift is bit 2; tilt bit 1 with position-aware tilt bit 4.
  const hasPosition = (features & 4) !== 0;
  const hasTilt = (features & 2) !== 0 && (features & 16) !== 0;

  /**
   * How far open, from how far closed.
   *
   * @param closed - Hundredths of a percent closed.
   * @returns The percentage open.
   */
  const openOf = (closed: number): number => clamp(Math.round(100 - closed / 100), 0, 100);

  return {
    key: 'cover',
    endpoint,
    clusters: [CLUSTER.windowCovering],
    descriptor: {
      domain: 'cover',
      name: 'Cover',
      capabilities: { cover: { hasPosition, hasTilt } },
    },
    /**
     * Reads the entity's state.
     *
     * @param read - The device's attributes.
     * @returns The state, or undefined while the device has not said enough.
     */
    stateOf: (read) => {
      const closed = numberOf(attributeOf(read, endpoint, CLUSTER.windowCovering, 14));
      const tilt = numberOf(attributeOf(read, endpoint, CLUSTER.windowCovering, 15));
      const status = (numberOf(attributeOf(read, endpoint, CLUSTER.windowCovering, 10)) ?? 0) & 3;

      if (closed === undefined) {
        return undefined;
      }

      return {
        cover: {
          position: openOf(closed),
          ...(hasTilt && tilt !== undefined ? { tilt: openOf(tilt) } : {}),
          motion: status === 1 ? 'opening' : status === 2 ? 'closing' : 'stopped',
        },
      };
    },
    /**
     * Turns a command into a request.
     *
     * @param target - The command.
     * @returns The request, or undefined for a command it does not take.
     */
    commandOf: (target) => {
      const { command } = target;

      switch (command['command']) {
        case 'open':
          return invoke(endpoint, CLUSTER.windowCovering, 'upOrOpen');
        case 'close':
          return invoke(endpoint, CLUSTER.windowCovering, 'downOrClose');
        case 'stop':
          return invoke(endpoint, CLUSTER.windowCovering, 'stopMotion');
        case 'set_position':
          return invoke(endpoint, CLUSTER.windowCovering, 'goToLiftPercentage', {
            liftPercent100thsValue: Math.round((100 - (numberOf(command['position']) ?? 0)) * 100),
          });
        case 'set_tilt':
          return invoke(endpoint, CLUSTER.windowCovering, 'goToTiltPercentage', {
            tiltPercent100thsValue: Math.round((100 - (numberOf(command['tilt']) ?? 0)) * 100),
          });
        default:
          return undefined;
      }
    },
  };
}

/**
 * The lock a Door Lock endpoint is.
 *
 * @param endpoint - The endpoint.
 * @returns The entity.
 */
function lockEntity(endpoint: number): Draft {
  return {
    key: 'lock',
    endpoint,
    clusters: [CLUSTER.doorLock],
    descriptor: { domain: 'lock', name: 'Lock', capabilities: { lock: { hasCode: false } } },
    /**
     * Reads the entity's state.
     *
     * @param read - The device's attributes.
     * @returns The state, or undefined while the device has not said enough.
     */
    stateOf: (read) => {
      const state = numberOf(attributeOf(read, endpoint, CLUSTER.doorLock, 0));

      // 1 locked, 2 unlocked, 3 unlatched; 0 is "not fully locked", a bolt that stopped short.
      switch (state) {
        case 0:
          return { lock: { lockState: 'jammed' } };
        case 1:
          return { lock: { lockState: 'locked' } };
        case 2:
        case 3:
          return { lock: { lockState: 'unlocked' } };
        default:
          return undefined;
      }
    },
    /**
     * Turns a command into a request.
     *
     * @param target - The command.
     * @returns The request, or undefined for a command it does not take.
     */
    commandOf: (target) => {
      const { command } = target;

      switch (command['command']) {
        case 'lock':
          return invoke(endpoint, CLUSTER.doorLock, 'lockDoor', {}, TIMED_COMMAND_MS);
        case 'unlock':
          return invoke(endpoint, CLUSTER.doorLock, 'unlockDoor', {}, TIMED_COMMAND_MS);
        default:
          return undefined;
      }
    },
  };
}

/** Matter's system modes, as the platform's thermostat modes. */
const SYSTEM_MODES: Readonly<Record<number, ThermostatMode>> = {
  0: 'off',
  1: 'auto',
  3: 'cool',
  4: 'heat',
  5: 'heat',
  6: 'cool',
  7: 'fan_only',
  8: 'dry',
  9: 'auto',
};

/** The platform's thermostat modes, as the system mode written for each. */
const MODE_VALUES: Readonly<Record<ThermostatMode, number>> = {
  off: 0,
  auto: 1,
  cool: 3,
  heat: 4,
  fan_only: 7,
  dry: 8,
};

/**
 * The thermostat a Thermostat endpoint is, its humidity beside it when the endpoint measures it.
 *
 * @param attributes - The device's.
 * @param endpoint - The endpoint.
 * @returns The entity.
 */
function thermostatEntity(attributes: MatterAttributes, endpoint: number): Draft {
  const features =
    numberOf(attributeOf(attributes, endpoint, CLUSTER.thermostat, FEATURE_MAP)) ?? 1;
  const canHeat = (features & 1) !== 0;
  const canCool = (features & 2) !== 0;
  const hasAuto = (features & 32) !== 0;

  /**
   * A temperature attribute, in degrees.
   *
   * @param read - The device's attributes.
   * @param attribute - The attribute, in hundredths of a degree.
   * @returns The degrees, or undefined.
   */
  const degreesOf = (read: MatterAttributes, attribute: number): number | undefined => {
    const value = numberOf(attributeOf(read, endpoint, CLUSTER.thermostat, attribute));

    return value === undefined ? undefined : value / 100;
  };
  const min = degreesOf(attributes, canHeat ? 21 : 23) ?? 7;
  const max = degreesOf(attributes, canHeat ? 22 : 24) ?? 30;

  return {
    key: 'thermostat',
    endpoint,
    clusters: [CLUSTER.thermostat, CLUSTER.relativeHumidityMeasurement],
    descriptor: {
      domain: 'climate',
      name: 'Thermostat',
      capabilities: {
        thermostat: {
          supportedModes: [
            'off',
            ...(canHeat ? ['heat'] : []),
            ...(canCool ? ['cool'] : []),
            ...(hasAuto ? ['auto'] : []),
          ],
          minTemperature: Math.min(min, max),
          maxTemperature: Math.max(min, max),
          temperatureStep: 0.5,
        },
      },
    },
    /**
     * Reads the entity's state.
     *
     * @param read - The device's attributes.
     * @returns The state, or undefined while the device has not said enough.
     */
    stateOf: (read) => {
      const current = degreesOf(read, 0);
      const mode = SYSTEM_MODES[numberOf(attributeOf(read, endpoint, CLUSTER.thermostat, 28)) ?? 0];
      const target = degreesOf(read, mode === 'cool' ? 17 : 18) ?? degreesOf(read, 17);
      const running = numberOf(attributeOf(read, endpoint, CLUSTER.thermostat, 41)) ?? 0;
      const humidity = numberOf(
        attributeOf(read, endpoint, CLUSTER.relativeHumidityMeasurement, 0),
      );

      if (current === undefined || target === undefined || mode === undefined) {
        return undefined;
      }

      // Running state: heat stages are bits 0 and 3, cooling 1 and 4, the fan 2, 5 and 6.
      const action =
        mode === 'off'
          ? 'off'
          : (running & 0b1001) !== 0
            ? 'heating'
            : (running & 0b1_0010) !== 0
              ? 'cooling'
              : (running & 0b110_0100) !== 0
                ? 'fan'
                : 'idle';

      return {
        thermostat: {
          currentTemperature: current,
          targetTemperature: target,
          mode,
          action,
          ...(humidity === undefined ? {} : { humidity: clamp(humidity / 100, 0, 100) }),
        },
      };
    },
    /**
     * Turns a command into a request.
     *
     * @param target - The command.
     * @param last - The entity's last state.
     * @returns The request, or undefined for a command it does not take.
     */
    commandOf: (target, last) => {
      const { command } = target;

      if (command['command'] === 'set_target') {
        const isCooling = last?.thermostat?.mode === 'cool' || !canHeat;

        return {
          op: 'write',
          args: {
            endpoint,
            cluster: CLUSTER.thermostat,
            attribute: isCooling ? 17 : 18,
            value: Math.round((numberOf(command['temperature']) ?? 0) * 100),
          },
        };
      }

      const mode = command['mode'];
      const value =
        command['command'] === 'set_mode' && typeof mode === 'string' && mode in MODE_VALUES
          ? MODE_VALUES[mode as ThermostatMode]
          : undefined;

      return value === undefined
        ? undefined
        : { op: 'write', args: { endpoint, cluster: CLUSTER.thermostat, attribute: 28, value } };
    },
  };
}

/** A numeric sensor, as one table row: what it reads, and how. */
type NumericSensor = {
  readonly key: string;
  readonly name: string;
  readonly cluster: number;
  readonly attribute: number;
  readonly deviceClass: string;

  /** The unit the value is in once {@link NumericSensor.scale} has read it. */
  readonly unit: string;
  readonly stateClass?: EntityStateClass;
  readonly displayPrecision?: number;

  /**
   * Reads the attribute as a number in {@link NumericSensor.unit}.
   *
   * @param value - The attribute.
   * @returns The number, or undefined.
   */
  readonly scale: (value: unknown) => number | undefined;
};

/**
 * Hundredths, as a number.
 *
 * @param value - The attribute.
 * @returns It divided by 100.
 */
function hundredths(value: unknown): number | undefined {
  const number = numberOf(value);

  return number === undefined ? undefined : number / 100;
}

/** The sensors read as one value of one attribute. */
const NUMERIC_SENSORS: readonly NumericSensor[] = [
  {
    key: 'temperature',
    name: 'Temperature',
    cluster: CLUSTER.temperatureMeasurement,
    attribute: 0,
    deviceClass: 'temperature',
    unit: '°C',
    displayPrecision: 1,
    scale: hundredths,
  },
  {
    key: 'humidity',
    name: 'Humidity',
    cluster: CLUSTER.relativeHumidityMeasurement,
    attribute: 0,
    deviceClass: 'humidity',
    unit: '%',
    displayPrecision: 0,
    scale: hundredths,
  },
  {
    key: 'illuminance',
    name: 'Illuminance',
    cluster: CLUSTER.illuminanceMeasurement,
    attribute: 0,
    deviceClass: 'illuminance',
    unit: 'lx',
    displayPrecision: 0,
    // Logarithmic: 10 000 × log10(lux) + 1, with 0 for too dark to measure.
    /**
     * Reads the attribute.
     *
     * @param value - The attribute.
     * @returns The number, or undefined.
     */
    scale: (value) => {
      const measured = numberOf(value);

      return measured === undefined
        ? undefined
        : measured === 0
          ? 0
          : 10 ** ((measured - 1) / 10_000);
    },
  },
  {
    key: 'pressure',
    name: 'Pressure',
    cluster: CLUSTER.pressureMeasurement,
    attribute: 0,
    deviceClass: 'atmospheric_pressure',
    // Tenths of a kilopascal, which is hectopascals.
    unit: 'hPa',
    displayPrecision: 0,
    scale: numberOf,
  },
  {
    key: 'carbon_dioxide',
    name: 'Carbon dioxide',
    cluster: CLUSTER.carbonDioxideMeasurement,
    attribute: 0,
    deviceClass: 'carbon_dioxide',
    unit: 'ppm',
    displayPrecision: 0,
    scale: numberOf,
  },
  {
    key: 'battery',
    name: 'Battery',
    cluster: CLUSTER.powerSource,
    attribute: 12,
    deviceClass: 'battery',
    unit: '%',
    displayPrecision: 0,
    // Half percents.
    /**
     * Reads the attribute.
     *
     * @param value - The attribute.
     * @returns The number, or undefined.
     */
    scale: (value) => {
      const halves = numberOf(value);

      return halves === undefined ? undefined : clamp(halves / 2, 0, 100);
    },
  },
  {
    key: 'power',
    name: 'Power',
    cluster: CLUSTER.electricalPowerMeasurement,
    attribute: 8,
    deviceClass: 'power',
    unit: 'mW',
    displayPrecision: 1,
    scale: numberOf,
  },
  {
    key: 'voltage',
    name: 'Voltage',
    cluster: CLUSTER.electricalPowerMeasurement,
    attribute: 4,
    deviceClass: 'voltage',
    unit: 'mV',
    displayPrecision: 1,
    scale: numberOf,
  },
  {
    key: 'current',
    name: 'Current',
    cluster: CLUSTER.electricalPowerMeasurement,
    attribute: 5,
    deviceClass: 'current',
    unit: 'mA',
    displayPrecision: 2,
    scale: numberOf,
  },
  {
    key: 'energy',
    name: 'Energy',
    cluster: CLUSTER.electricalEnergyMeasurement,
    attribute: 1,
    deviceClass: 'energy',
    unit: 'mWh',
    stateClass: 'total_increasing',
    displayPrecision: 2,
    // A struct, its energy the first field.
    /**
     * Reads the attribute.
     *
     * @param value - The attribute.
     * @returns The number, or undefined.
     */
    scale: (value) => numberOf((value as Record<string, unknown> | null)?.['0']),
  },
];

/**
 * A numeric sensor of one endpoint.
 *
 * @param sensor - Which.
 * @param endpoint - The endpoint.
 * @returns The entity, reporting in the class's canonical unit.
 */
function numericEntity(sensor: NumericSensor, endpoint: number): Draft {
  const unitOfMeasurement = resolveCanonicalUnit(sensor.deviceClass) ?? sensor.unit;
  const stateClass = resolveStateClass(sensor.deviceClass, sensor.stateClass);

  return {
    key: sensor.key,
    endpoint,
    clusters: [sensor.cluster],
    attribute: sensor.attribute,
    descriptor: {
      domain: 'sensor',
      name: sensor.name,
      capabilities: { sensor_numeric: {} },
      unitOfMeasurement,
      deviceClass: sensor.deviceClass,
      ...(stateClass === undefined ? {} : { stateClass }),
      ...(sensor.displayPrecision === undefined
        ? {}
        : { displayPrecision: sensor.displayPrecision }),
    },
    /**
     * Reads the entity's state.
     *
     * @param read - The device's attributes.
     * @returns The state, or undefined while the device has not said enough.
     */
    stateOf: (read) => {
      const value = sensor.scale(attributeOf(read, endpoint, sensor.cluster, sensor.attribute));
      const canonical =
        value === undefined ? undefined : toCanonical(sensor.deviceClass, value, sensor.unit);

      return canonical === undefined ? undefined : { sensor_numeric: { value: canonical } };
    },
  };
}

/**
 * A binary sensor of one endpoint.
 *
 * @param endpoint - The endpoint.
 * @param spec - What it is.
 * @param spec.key - Its kind.
 * @param spec.name - Its name.
 * @param spec.icon - Its icon.
 * @param spec.cluster - The cluster it reads.
 * @param spec.isOn - How the attribute reads as on.
 * @returns The entity.
 */
function binaryEntity(
  endpoint: number,
  spec: {
    readonly key: string;
    readonly name: string;
    readonly icon: string;
    readonly cluster: number;
    readonly isOn: (value: unknown) => boolean | undefined;
  },
): Draft {
  return {
    key: spec.key,
    endpoint,
    clusters: [spec.cluster],
    descriptor: {
      domain: 'binary_sensor',
      name: spec.name,
      icon: spec.icon,
      capabilities: { sensor_binary: {} },
    },
    /**
     * Reads the entity's state.
     *
     * @param read - The device's attributes.
     * @returns The state, or undefined while the device has not said enough.
     */
    stateOf: (read) => {
      const isOn = spec.isOn(attributeOf(read, endpoint, spec.cluster, 0));

      return isOn === undefined ? undefined : { sensor_binary: { isOn } };
    },
  };
}

/**
 * A boolean, as it is.
 *
 * @param value - The attribute.
 * @returns It, or undefined when it is not one.
 */
function booleanOf(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * The firmware of the node itself.
 *
 * @returns The entity, reading what the node runs, what is on offer and how an install goes.
 */
function firmwareEntity(): Draft {
  return {
    key: 'firmware',
    endpoint: 0,
    clusters: [CLUSTER.basicInformation, CLUSTER.otaRequestor],
    descriptor: {
      domain: 'update',
      name: 'Firmware',
      capabilities: { update: { canInstall: true, hasProgress: true } },
    },
    /**
     * Reads the entity's state.
     *
     * @param read - The device's attributes.
     * @param update - The firmware on offer.
     * @returns The state.
     */
    stateOf: (read, update) => {
      const text = attributeOf(read, 0, CLUSTER.basicInformation, 10);
      const number = numberOf(attributeOf(read, 0, CLUSTER.basicInformation, 9));
      const installed =
        typeof text === 'string' && text !== ''
          ? text
          : number === undefined
            ? null
            : String(number);
      // Update states: 4 downloading, 5 applying.
      const updating = numberOf(attributeOf(read, 0, CLUSTER.otaRequestor, 2));
      const progress = numberOf(attributeOf(read, 0, CLUSTER.otaRequestor, 3));
      const isInstalling = updating === 4 || updating === 5;

      return {
        update: {
          installedVersion: installed?.slice(0, 64) ?? null,
          latestVersion: update?.softwareVersionString.slice(0, 64) ?? null,
          isInstalling,
          progress: isInstalling && progress !== undefined ? clamp(progress, 0, 100) : null,
        },
      };
    },
    /**
     * Turns a command into a request.
     *
     * @param target - The command.
     * @returns The request, or undefined for a command it does not take.
     */
    commandOf: (target) =>
      target.command['command'] === 'install' ? { op: 'update', args: {} } : undefined,
  };
}

/**
 * The entities one endpoint serves.
 *
 * @param attributes - The device's.
 * @param endpoint - The endpoint.
 * @returns Its entities, before their object ids are settled.
 */
function draftsOf(attributes: MatterAttributes, endpoint: number): Draft[] {
  /**
   * Whether the endpoint serves a cluster.
   *
   * @param cluster - The cluster.
   * @returns True when it does.
   */
  const has = (cluster: number): boolean => serves(attributes, endpoint, cluster);
  const types = deviceTypesOf(attributes, endpoint);
  const drafts: Draft[] = [];

  if (has(CLUSTER.onOff)) {
    drafts.push(onOffEntity(attributes, endpoint));
  }

  if (has(CLUSTER.windowCovering)) {
    drafts.push(coverEntity(attributes, endpoint));
  }

  if (has(CLUSTER.doorLock)) {
    drafts.push(lockEntity(endpoint));
  }

  const hasThermostat = has(CLUSTER.thermostat);

  if (hasThermostat) {
    drafts.push(thermostatEntity(attributes, endpoint));
  }

  for (const sensor of NUMERIC_SENSORS) {
    const isThermostatHumidity =
      hasThermostat && sensor.cluster === CLUSTER.relativeHumidityMeasurement;

    if (
      has(sensor.cluster) &&
      !isThermostatHumidity &&
      attributeOf(attributes, endpoint, sensor.cluster, sensor.attribute) !== undefined
    ) {
      drafts.push(numericEntity(sensor, endpoint));
    }
  }

  if (has(CLUSTER.occupancySensing)) {
    drafts.push(
      binaryEntity(endpoint, {
        key: 'motion',
        name: 'Motion',
        icon: 'motion',
        cluster: CLUSTER.occupancySensing,
        /**
         * Reads the attribute as on or off.
         *
         * @param value - The attribute.
         * @returns Whether it is on, or undefined.
         */
        isOn: (value) => {
          const bits = numberOf(value);

          return bits === undefined ? undefined : (bits & 1) !== 0;
        },
      }),
    );
  }

  if (has(CLUSTER.booleanState)) {
    const isContact = types.includes(DEVICE_TYPE.contactSensor);
    const isLeak = types.includes(DEVICE_TYPE.waterLeakDetector);

    drafts.push(
      binaryEntity(endpoint, {
        key: isContact ? 'contact' : isLeak ? 'leak' : 'state',
        name: isContact ? 'Contact' : isLeak ? 'Leak' : 'State',
        icon: isContact ? 'door' : isLeak ? 'water' : 'sensor',
        cluster: CLUSTER.booleanState,
        // A contact sensor's state is true while in contact - closed; the platform's door is on
        // when open.
        /**
         * Reads the attribute as on or off.
         *
         * @param value - The attribute.
         * @returns Whether it is on, or undefined.
         */
        isOn: (value) => {
          const state = booleanOf(value);

          return state === undefined ? undefined : isContact ? !state : state;
        },
      }),
    );
  }

  return drafts;
}

/**
 * The entities of one device of a node.
 *
 * Object ids are the entity's kind - `light`, `temperature` - with the endpoint's number after it
 * when the kind is on more than one endpoint: `switch_1`, `switch_2`. They follow from the device's
 * structure alone, so they are the same at every start.
 *
 * @param device - The device.
 * @returns Its entities.
 */
export function matterEntitiesOf(device: MatterDeviceSnapshot): MatterEntity[] {
  const drafts = device.endpoints.flatMap((endpoint) => draftsOf(device.attributes, endpoint));

  if (device.endpoint === null && serves(device.attributes, 0, CLUSTER.otaRequestor)) {
    drafts.push(firmwareEntity());
  }

  const counts = new Map<string, number>();

  for (const draft of drafts) {
    counts.set(draft.key, (counts.get(draft.key) ?? 0) + 1);
  }

  return drafts.map(({ key, descriptor, ...rest }): MatterEntity => {
    const isShared = (counts.get(key) ?? 0) > 1;
    const objectId = isShared ? `${key}_${String(rest.endpoint)}` : key;

    return {
      ...rest,
      objectId,
      descriptor: {
        ...descriptor,
        objectId,
        name: isShared ? `${descriptor.name} ${String(rest.endpoint)}` : descriptor.name,
        // Where it sits, so the same reading of the device's own transport can be linked to it:
        // the first cluster it reads, and its attribute - 0 for an entity that reads several.
        link: {
          matter: {
            endpoint: rest.endpoint,
            cluster: rest.clusters[0] ?? 0,
            attribute: rest.attribute ?? 0,
          },
        },
      },
    };
  });
}

/**
 * The clusters of a device that turn into no entity, and are not infrastructure.
 *
 * @param device - The device.
 * @returns Their numbers, ascending.
 */
export function unmappedClustersOf(device: MatterDeviceSnapshot): number[] {
  return device.identity.clusters.filter(
    (cluster) =>
      !MATTER_MAPPED_CLUSTERS.has(cluster) && !MATTER_INFRASTRUCTURE_CLUSTERS.has(cluster),
  );
}

/** Reads a device handed over by the transport, refusing anything else. */
const deviceSnapshotSchema = z.object({
  nodeId: z.string().min(1),
  endpoint: z.int().min(0).nullable(),
  endpoints: z.array(z.int().min(0)),
  isAvailable: z.boolean(),
  identity: matterIdentitySchema,
  attributes: z.record(z.string(), z.unknown()),
});

/** Reads what the transport delivers. */
const inboundSchema = z.object({
  device: deviceSnapshotSchema,
  changed: z.array(z.string()).nullable(),
  update: z
    .object({ softwareVersion: z.number(), softwareVersionString: z.string() })
    .nullable()
    .optional(),
});

/**
 * A device, read from what identification or a claim holds.
 *
 * @param value - What it holds.
 * @returns The device, or undefined when it is not one.
 */
function deviceOf(value: unknown): MatterDeviceSnapshot | undefined {
  const parsed = deviceSnapshotSchema.safeParse(value);

  return parsed.success ? parsed.data : undefined;
}

/**
 * Whether an entity is computed from one of the paths that changed.
 *
 * @param entity - The entity.
 * @param changed - The paths, or null for everything.
 * @returns True when it should be read again.
 */
function isTouched(entity: MatterEntity, changed: readonly string[] | null): boolean {
  return (
    changed === null ||
    changed.some((path) => {
      const split = splitPath(path);

      return (
        split?.endpoint === entity.endpoint &&
        entity.clusters.includes(split.cluster) &&
        (entity.attribute === undefined || split.attribute === entity.attribute)
      );
    })
  );
}

/**
 * Builds the Matter driver of a vendor: the platform's own, or one whose `driver.json` says
 * `"kind": "matter"`.
 *
 * @param manifest - The driver's.
 * @param manifest.id - Its kind, `vendor/driver`.
 * @returns The integration.
 */
export function createMatterIntegration(manifest: { readonly id: string }): Integration {
  /**
   * The device a claim was made for.
   *
   * @param context - The instance's mapping context.
   * @returns The device.
   * @throws {ValidationError} When the claim holds no device - which identification never makes.
   */
  const claimed = (context: MappingContext): MatterDeviceSnapshot => {
    const device = deviceOf(context.claim.descriptor);

    if (device === undefined) {
      throw new ValidationError(`${manifest.id} holds a claim that is not a Matter device`, {
        details: { integration: manifest.id },
      });
    }

    return device;
  };

  return {
    id: manifest.id,
    transport: MATTER_TRANSPORT,
    optionsSchema: jsonObjectSchema,
    discovery: {},

    /**
     * Claims a Matter device identification found.
     *
     * @param discovered - What the transport handed over.
     * @returns The claim, or null for anything that is not a Matter device.
     */
    claim: (discovered: Discovered) => {
      const device = deviceOf(discovered.payload);

      return device === undefined
        ? null
        : {
            deviceKey: discovered.deviceKey,
            externalId: matterDeviceKey(device.nodeId, device.endpoint),
            descriptor: device,
          };
    },

    /**
     * Subscribes to nothing: the controller already follows every attribute of every node.
     *
     * @returns Nothing.
     */
    subscriptions: () => [],

    /**
     * Describes the device and its entities.
     *
     * @param claim - The claim.
     * @returns The device.
     * @throws {ValidationError} When the claim holds no Matter device.
     */
    describe: (claim): DeviceDescriptor => {
      const device = deviceOf(claim.descriptor);

      if (device === undefined) {
        throw new ValidationError(`${manifest.id} cannot describe a claim with no Matter device`, {
          details: { integration: manifest.id },
        });
      }

      const { identity } = device;
      // A Thread radio's eight-byte address is no MAC another transport reports.
      const mac = identity.macAddresses.map(normalizeMac).find((each) => each !== null);

      return {
        externalId: claim.externalId,
        name: nameOf(identity).slice(0, 128),
        ...(mac === undefined ? {} : { mac }),
        ...(identity.serialNumber === null ? {} : { serialNumber: identity.serialNumber }),
        ...(identity.vendorName === null ? {} : { manufacturer: identity.vendorName }),
        ...(identity.productName === null ? {} : { model: identity.productName }),
        ...(identity.softwareVersionString === null
          ? {}
          : { swVersion: identity.softwareVersionString.slice(0, 64) }),
        ...(identity.hardwareVersionString === null
          ? {}
          : { hwVersion: identity.hardwareVersionString.slice(0, 64) }),
        ...(device.endpoint === null ? {} : { viaExternalId: device.nodeId }),
        entities: matterEntitiesOf(device).map((entity) => entity.descriptor),
      };
    },

    /**
     * Turns what changed into reports, one per entity it is about.
     *
     * @param message - What the transport delivered.
     * @param context - The identifiers the hub assigned.
     * @returns The reports.
     */
    toState: (message: TransportInbound, context: MappingContext): ReportedState[] => {
      const parsed = inboundSchema.safeParse(message.payload);

      if (!parsed.success) {
        return [];
      }

      const { device, changed, update } = parsed.data;

      return matterEntitiesOf(device).flatMap((entity): ReportedState[] => {
        const entityId = context.entities.get(entity.objectId);

        if (entityId === undefined || !isTouched(entity, changed)) {
          return [];
        }

        const state = entity.stateOf(device.attributes, update);

        return state === undefined
          ? []
          : [{ entityId, state, attributes: {}, isAvailable: device.isAvailable }];
      });
    },

    /**
     * Turns a command into a request.
     *
     * @param target - The entity, the capability and the command.
     * @param context - The claim and the last states.
     * @returns The request.
     * @throws {ValidationError} When the entity does not take the command.
     */
    toCommand: (target: CommandTarget, context: MappingContext): TransportRequest => {
      const device = claimed(context);
      const entity = matterEntitiesOf(device).find(
        (candidate) => context.entities.get(candidate.objectId) === target.entityId,
      );
      const request = entity?.commandOf?.(target, context.lastState(target.entityId));

      if (request === undefined) {
        throw new ValidationError(
          `${manifest.id} does not take ${target.capability}.${JSON.stringify(target.command['command'])} on ${target.entityId}`,
          { details: { integration: manifest.id, entityId: target.entityId } },
        );
      }

      return { deviceKey: context.claim.deviceKey, op: request.op, args: request.args };
    },

    /**
     * Reads the firmware the device runs now.
     *
     * @param message - What the transport delivered.
     * @returns The version, when the device says it.
     */
    deviceInfo: (message: TransportInbound) => {
      const parsed = inboundSchema.safeParse(message.payload);
      const version = parsed.success ? parsed.data.device.identity.softwareVersionString : null;

      return version === null ? undefined : { swVersion: version.slice(0, 64) };
    },
  };
}
