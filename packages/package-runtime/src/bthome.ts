/**
 * BTHome v2: what a sensor advertising under the service UUID 0xFCD2 says, decoded: pure.
 *
 * BTHome is an open format many cheap Bluetooth sensors speak - Shelly's BLU range among them - so
 * the platform recognises it itself, as its own `bluetooth` vendor (driver `bluetooth/bthome`),
 * without an integration. The service data is a device-information byte - whether the payload is
 * encrypted, whether the device only advertises when something happens, and the format's version -
 * then objects: an id, and a value of the length, sign and factor that id fixes, little-endian. The
 * same id may come more than once: a four-button remote sends four button events.
 *
 * An id this table does not know ends decoding with what was read so far, since its length is
 * unknown and nothing after it can be found.
 */

/** The version BTHome advertises in the top three bits of its first byte. */
export const BTHOME_VERSION = 2;

/** What one reading is: a number, an on/off, or an event - a button pressed, a dimmer turned. */
export type BthomeReadingKind = 'number' | 'binary' | 'event';

/** One reading a BTHome advertisement carries. */
export type BthomeReading = {
  /** What it measures, which an entity's object id is made from: `temperature`, `window`. */
  readonly key: string;

  /** What it is called, in English: `Temperature`. */
  readonly name: string;
  readonly kind: BthomeReadingKind;

  /** A number in {@link BthomeReading.unit}, an on/off, or an event's name (`double_press`). */
  readonly value: number | boolean | string;

  /** The unit BTHome sends a number in, as the platform writes units: `°C`, `hPa`. */
  readonly unit?: string;

  /** How many decimals a number carries, as BTHome scales it. */
  readonly decimals?: number;

  /** The platform's class for it: a sensor class for a number, a binary sensor's for an on/off. */
  readonly deviceClass?: string;

  /** How many steps a dimmer was turned. */
  readonly steps?: number;
};

/** One advertisement's service data, decoded. */
export type BthomePacket =
  | {
      readonly isEncrypted: false;

      /** Whether the device advertises only when something happens, so silence is not absence. */
      readonly isTriggerBased: boolean;

      /** The packet's id, which a device repeats while it sends the same packet again; null when it sends none. */
      readonly packetId: number | null;
      readonly readings: readonly BthomeReading[];
    }
  | { readonly isEncrypted: true; readonly isTriggerBased: boolean };

/** One object id's value: how long, whether signed, the factor, and what it means. */
type BthomeObject = {
  readonly key: string;
  readonly name: string;
  readonly kind: BthomeReadingKind | 'packet' | 'dimmer';
  readonly bytes: number;
  readonly isSigned?: boolean;
  readonly factor?: number;
  readonly unit?: string;
  readonly deviceClass?: string;
};

/**
 * A number of `bytes` bytes, scaled.
 *
 * @param key - What it measures.
 * @param name - What it is called.
 * @param bytes - How long it is.
 * @param factor - What one step of it is worth.
 * @param unit - Its unit, if any.
 * @param deviceClass - Its sensor class, if any.
 * @param isSigned - Whether it is signed.
 * @returns The object.
 */
function numberObject(
  key: string,
  name: string,
  bytes: number,
  factor: number,
  unit?: string,
  deviceClass?: string,
  isSigned = false,
): BthomeObject {
  return {
    key,
    name,
    kind: 'number',
    bytes,
    factor,
    isSigned,
    ...(unit === undefined ? {} : { unit }),
    ...(deviceClass === undefined ? {} : { deviceClass }),
  };
}

/**
 * A one-byte on/off.
 *
 * @param key - What it senses.
 * @param name - What it is called.
 * @param deviceClass - Its binary sensor class, when the platform has one.
 * @returns The object.
 */
function binaryObject(key: string, name: string, deviceClass?: string): BthomeObject {
  return {
    key,
    name,
    kind: 'binary',
    bytes: 1,
    ...(deviceClass === undefined ? {} : { deviceClass }),
  };
}

/**
 * The objects of BTHome v2 by id, as its specification lists them. Binary readings take keys of
 * their own where a number has the same name - `battery_low`, `power_state`, `leak` - so one device's
 * entities never share an object id.
 */
const OBJECTS: ReadonlyMap<number, BthomeObject> = new Map([
  [0x00, { key: 'packet_id', name: 'Packet id', kind: 'packet', bytes: 1 }],
  [0x01, numberObject('battery', 'Battery', 1, 1, '%', 'battery')],
  [0x02, numberObject('temperature', 'Temperature', 2, 0.01, '°C', 'temperature', true)],
  [0x03, numberObject('humidity', 'Humidity', 2, 0.01, '%', 'humidity')],
  [0x04, numberObject('pressure', 'Pressure', 3, 0.01, 'hPa', 'atmospheric_pressure')],
  [0x05, numberObject('illuminance', 'Illuminance', 3, 0.01, 'lx', 'illuminance')],
  [0x06, numberObject('mass', 'Mass', 2, 0.01, 'kg', 'weight')],
  [0x07, numberObject('mass', 'Mass', 2, 0.01, 'lb', 'weight')],
  [0x08, numberObject('dew_point', 'Dew point', 2, 0.01, '°C', 'temperature', true)],
  [0x09, numberObject('count', 'Count', 1, 1)],
  [0x0a, numberObject('energy', 'Energy', 3, 0.001, 'kWh', 'energy')],
  [0x0b, numberObject('power', 'Power', 3, 0.01, 'W', 'power')],
  [0x0c, numberObject('voltage', 'Voltage', 2, 0.001, 'V', 'voltage')],
  [0x0d, numberObject('pm25', 'PM2.5', 2, 1, 'µg/m³', 'pm25')],
  [0x0e, numberObject('pm10', 'PM10', 2, 1, 'µg/m³', 'pm10')],
  [0x0f, binaryObject('binary', 'Binary')],
  [0x10, binaryObject('power_state', 'Power', 'power')],
  [0x11, binaryObject('opening', 'Opening', 'opening')],
  [0x12, numberObject('carbon_dioxide', 'Carbon dioxide', 2, 1, 'ppm', 'carbon_dioxide')],
  [0x13, numberObject('tvoc', 'VOC', 2, 1, 'µg/m³', 'volatile_organic_compounds')],
  [0x14, numberObject('moisture', 'Moisture', 2, 0.01, '%')],
  [0x15, binaryObject('battery_low', 'Battery low', 'battery')],
  [0x16, binaryObject('battery_charging', 'Battery charging', 'battery_charging')],
  [0x17, binaryObject('carbon_monoxide', 'Carbon monoxide')],
  [0x18, binaryObject('cold', 'Cold')],
  [0x19, binaryObject('connectivity', 'Connectivity', 'connectivity')],
  [0x1a, binaryObject('door', 'Door', 'door')],
  [0x1b, binaryObject('garage_door', 'Garage door', 'garage_door')],
  [0x1c, binaryObject('gas_detected', 'Gas', 'gas')],
  [0x1d, binaryObject('heat', 'Heat')],
  [0x1e, binaryObject('light', 'Light')],
  [0x1f, binaryObject('lock', 'Lock')],
  [0x20, binaryObject('leak', 'Moisture', 'moisture')],
  [0x21, binaryObject('motion', 'Motion', 'motion')],
  [0x22, binaryObject('moving', 'Moving')],
  [0x23, binaryObject('occupancy', 'Occupancy', 'occupancy')],
  [0x24, binaryObject('plug', 'Plug', 'plug')],
  [0x25, binaryObject('presence', 'Presence', 'presence')],
  [0x26, binaryObject('problem', 'Problem', 'problem')],
  [0x27, binaryObject('running', 'Running', 'running')],
  [0x28, binaryObject('safety', 'Safety')],
  [0x29, binaryObject('smoke', 'Smoke', 'smoke')],
  [0x2a, binaryObject('sound', 'Sound')],
  [0x2b, binaryObject('tamper', 'Tamper')],
  [0x2c, binaryObject('vibration', 'Vibration')],
  [0x2d, binaryObject('window', 'Window', 'window')],
  [0x2e, numberObject('humidity', 'Humidity', 1, 1, '%', 'humidity')],
  [0x2f, numberObject('moisture', 'Moisture', 1, 1, '%')],
  [0x3a, { key: 'button', name: 'Button', kind: 'event', bytes: 1 }],
  [0x3c, { key: 'dimmer', name: 'Dimmer', kind: 'dimmer', bytes: 2 }],
  [0x3d, numberObject('count', 'Count', 2, 1)],
  [0x3e, numberObject('count', 'Count', 4, 1)],
  [0x3f, numberObject('rotation', 'Rotation', 2, 0.1, '°', undefined, true)],
  [0x40, numberObject('distance', 'Distance', 2, 1, 'mm', 'distance')],
  [0x41, numberObject('distance', 'Distance', 2, 0.1, 'm', 'distance')],
  [0x42, numberObject('duration', 'Duration', 3, 0.001, 's', 'duration')],
  [0x43, numberObject('current', 'Current', 2, 0.001, 'A', 'current')],
  [0x44, numberObject('speed', 'Speed', 2, 0.01, 'm/s', 'speed')],
  [0x45, numberObject('temperature', 'Temperature', 2, 0.1, '°C', 'temperature', true)],
  [0x46, numberObject('uv_index', 'UV index', 1, 0.1)],
  [0x47, numberObject('volume', 'Volume', 2, 0.1, 'L', 'volume')],
  [0x48, numberObject('volume', 'Volume', 2, 1, 'mL', 'volume')],
  [0x49, numberObject('volume_flow_rate', 'Flow rate', 2, 0.001, 'm³/h', 'volume_flow_rate')],
  [0x4a, numberObject('voltage', 'Voltage', 2, 0.1, 'V', 'voltage')],
  [0x4b, numberObject('gas', 'Gas', 3, 0.001, 'm³', 'gas')],
  [0x4c, numberObject('gas', 'Gas', 4, 0.001, 'm³', 'gas')],
  [0x4d, numberObject('energy', 'Energy', 4, 0.001, 'kWh', 'energy')],
  [0x4e, numberObject('volume', 'Volume', 4, 0.001, 'L', 'volume')],
  [0x4f, numberObject('water', 'Water', 4, 0.001, 'L', 'water')],
]);

/** A button's events, by the byte BTHome sends; `none` is sent while nothing happened. */
const BUTTON_EVENTS: Readonly<Record<number, string>> = {
  0x00: 'none',
  0x01: 'press',
  0x02: 'double_press',
  0x03: 'triple_press',
  0x04: 'long_press',
  0x05: 'long_double_press',
  0x06: 'long_triple_press',
  0x80: 'hold_press',
};

/** A dimmer's events, by the byte BTHome sends. */
const DIMMER_EVENTS: Readonly<Record<number, string>> = {
  0x00: 'none',
  0x01: 'rotate_left',
  0x02: 'rotate_right',
};

/**
 * How many decimals a factor leaves: 2 for 0.01.
 *
 * @param factor - The factor.
 * @returns The decimals.
 */
function decimalsOf(factor: number): number {
  return Math.max(0, -Math.floor(Math.log10(factor) + 1e-9));
}

/**
 * Decodes BTHome v2 service data.
 *
 * @param hex - The service data under 0xFCD2, as an advertisement carries it.
 * @returns What it says, or null when it is not BTHome v2.
 */
export function decodeBthome(hex: string): BthomePacket | null {
  if (!/^(?:[0-9a-fA-F]{2})+$/u.test(hex)) {
    return null;
  }

  const bytes = Buffer.from(hex, 'hex');
  const info = bytes[0] ?? 0;

  if (info >> 5 !== BTHOME_VERSION) {
    return null;
  }

  const isTriggerBased = (info & 0x04) !== 0;

  if ((info & 0x01) !== 0) {
    // shortcut: encrypted BTHome is recognised and not read - the platform keeps no bind keys yet;
    // add a key per device and AES-CCM here when an owner has an encrypted sensor.
    return { isEncrypted: true, isTriggerBased };
  }

  const readings: BthomeReading[] = [];
  let packetId: number | null = null;
  let index = 1;

  while (index < bytes.length) {
    const object = OBJECTS.get(bytes[index] ?? -1);

    if (object === undefined || index + 1 + object.bytes > bytes.length) {
      break;
    }

    const at = index + 1;
    const raw =
      object.isSigned === true
        ? bytes.readIntLE(at, object.bytes)
        : bytes.readUIntLE(at, object.bytes);

    index = at + object.bytes;

    switch (object.kind) {
      case 'packet':
        packetId = raw;
        break;
      case 'binary':
        readings.push({ ...describe(object), value: raw !== 0 });
        break;
      case 'event':
        readings.push({ ...describe(object), value: BUTTON_EVENTS[raw] ?? 'none' });
        break;
      case 'dimmer':
        readings.push({
          ...describe(object),
          kind: 'event',
          value: DIMMER_EVENTS[bytes[at] ?? 0] ?? 'none',
          steps: bytes[at + 1] ?? 0,
        });
        break;
      default: {
        const factor = object.factor ?? 1;

        readings.push({
          ...describe(object),
          value: Number((raw * factor).toPrecision(12)),
          decimals: decimalsOf(factor),
        });
      }
    }
  }

  return { isEncrypted: false, isTriggerBased, packetId, readings };
}

/**
 * What a reading says of itself beside its value: its key, name, kind, unit and class.
 *
 * @param object - The object it was read as.
 * @returns Those, for a reading.
 */
function describe(object: BthomeObject): Omit<BthomeReading, 'value'> {
  return {
    key: object.key,
    name: object.name,
    kind: object.kind === 'number' || object.kind === 'binary' ? object.kind : 'event',
    ...(object.unit === undefined ? {} : { unit: object.unit }),
    ...(object.deviceClass === undefined ? {} : { deviceClass: object.deviceClass }),
  };
}
