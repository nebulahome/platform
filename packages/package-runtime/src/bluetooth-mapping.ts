/**
 * How a BTHome sensor heard over Bluetooth is a device: pure.
 *
 * A Bluetooth device of the house is reached over the platform transport `bluetooth`, its device
 * key its address; the Bluetooth broker hands it over as a {@link BluetoothDeviceSnapshot} - its
 * address, the driver it is read as, its name, and the advertisement it was recognised from - and
 * delivers every advertisement heard from it afterwards. That is the shape every driver of kind
 * `bluetooth` claims from; this module is the platform's own, `bluetooth/bthome`.
 *
 * A BTHome sensor says what it measures in every advertisement, so its entities are the readings
 * of the advertisement it was recognised from: a numeric one a sensor of the platform's class in
 * its canonical unit, an on/off a binary sensor, a button or a dimmer a text sensor saying the last
 * event. Each reading's entity is its key - `temperature`, `window` - and `_2`, `_3` for the second
 * and third of one key, as a four-button remote sends.
 */
import { z } from 'zod';

import {
  bluetoothAdvertSchema,
  bluetoothAddressSchema,
  BLUETOOTH_TRANSPORT,
  BTHOME_SERVICE_UUID,
  jsonObjectSchema,
  resolveCanonicalUnit,
  resolveStateClass,
  toCanonical,
  ValidationError,
  type BluetoothAdvert,
  type CapabilityState,
} from '@nebulahome/contracts';

import { decodeBthome, type BthomeReading } from './bthome.js';
import type {
  EntityDescriptor,
  Integration,
  MappingContext,
  ReportedState,
} from './integration.js';
import type { Discovered, TransportInbound } from './transport.js';

/** A Bluetooth device as the Bluetooth broker hands it over to the driver it is read as. */
export const bluetoothDeviceSnapshotSchema = z.object({
  /** Its address, upper case: its device key on the `bluetooth` transport. */
  deviceKey: bluetoothAddressSchema,

  /** The driver it is read as: `bluetooth/bthome`, or an integration's of kind `bluetooth`. */
  kind: z.string().min(1).max(160),
  name: z.string().min(1).max(256),

  /** The advertisement it was recognised from. */
  advert: bluetoothAdvertSchema,
});

/** A Bluetooth device as the Bluetooth broker hands it over. */
export type BluetoothDeviceSnapshot = z.output<typeof bluetoothDeviceSnapshotSchema>;

/** One reading of an advertisement, and the entity it is. */
type ReadingEntity = {
  readonly objectId: string;
  readonly name: string;
  readonly reading: BthomeReading;
};

/**
 * The device a claim was made for, or a delivery is about.
 *
 * @param value - The claim's descriptor.
 * @returns The device, or undefined for anything that is not one.
 */
function snapshotOf(value: unknown): BluetoothDeviceSnapshot | undefined {
  const parsed = bluetoothDeviceSnapshotSchema.safeParse(value);

  return parsed.success ? parsed.data : undefined;
}

/**
 * The readings of an advertisement, each with the entity it is: the second of a key `_2`.
 *
 * @param advert - The advertisement.
 * @returns Its readings, none when it carries no BTHome or only encrypted.
 */
function readingsOf(advert: BluetoothAdvert): ReadingEntity[] {
  const packet = decodeBthome(advert.serviceData?.[BTHOME_SERVICE_UUID] ?? '');

  if (packet === null || packet.isEncrypted) {
    return [];
  }

  const seen = new Map<string, number>();

  return packet.readings.map((reading) => {
    const count = (seen.get(reading.key) ?? 0) + 1;

    seen.set(reading.key, count);

    return count === 1
      ? { objectId: reading.key, name: reading.name, reading }
      : {
          objectId: `${reading.key}_${String(count)}`,
          name: `${reading.name} ${String(count)}`,
          reading,
        };
  });
}

/**
 * A reading's entity as the house registers it.
 *
 * @param entity - The reading and its object id.
 * @returns Its descriptor.
 */
function descriptorOf(entity: ReadingEntity): EntityDescriptor {
  const { objectId, name, reading } = entity;

  if (reading.kind === 'binary') {
    return {
      domain: 'binary_sensor',
      objectId,
      name,
      capabilities: { sensor_binary: {} },
      ...(reading.deviceClass === undefined ? {} : { deviceClass: reading.deviceClass }),
    };
  }

  if (reading.kind === 'event') {
    return { domain: 'sensor', objectId, name, capabilities: { sensor_text: {} } };
  }

  const canonical = resolveCanonicalUnit(reading.deviceClass);
  const unit = canonical ?? reading.unit;

  return {
    domain: 'sensor',
    objectId,
    name,
    capabilities: { sensor_numeric: {} },
    ...(unit === undefined ? {} : { unitOfMeasurement: unit }),
    ...(reading.deviceClass === undefined ? {} : { deviceClass: reading.deviceClass }),
    stateClass: resolveStateClass(reading.deviceClass, undefined) ?? 'measurement',
    // BTHome's decimals hold in its own unit; a value converted - hPa to Pa - says its own.
    ...(reading.decimals === undefined || unit !== reading.unit
      ? {}
      : { displayPrecision: reading.decimals }),
  };
}

/**
 * A reading's state, in its class's canonical unit.
 *
 * @param reading - The reading.
 * @returns The state, or undefined for an event that did not happen.
 */
function stateOf(reading: BthomeReading): CapabilityState | undefined {
  if (typeof reading.value === 'boolean') {
    return { sensor_binary: { isOn: reading.value } };
  }

  if (typeof reading.value === 'string') {
    return reading.value === 'none' ? undefined : { sensor_text: { value: reading.value } };
  }

  const canonical =
    reading.deviceClass === undefined
      ? undefined
      : toCanonical(reading.deviceClass, reading.value, reading.unit ?? '');

  return { sensor_numeric: { value: canonical ?? reading.value } };
}

/**
 * Builds the platform's BTHome driver: `bluetooth/bthome`.
 *
 * @param manifest - The driver's.
 * @param manifest.id - Its kind, `vendor/driver`.
 * @returns The integration.
 */
export function createBthomeIntegration(manifest: { readonly id: string }): Integration {
  return {
    id: manifest.id,
    transport: BLUETOOTH_TRANSPORT,
    optionsSchema: jsonObjectSchema,
    discovery: {},

    /**
     * Claims a device the broker hands over as this driver's.
     *
     * @param discovered - What the transport handed over.
     * @returns The claim, or null for anything that is not one of this driver's devices.
     */
    claim: (discovered: Discovered) => {
      const device = snapshotOf(discovered.payload);

      return device?.kind !== manifest.id
        ? null
        : { deviceKey: device.deviceKey, externalId: device.deviceKey, descriptor: device };
    },

    /**
     * Follows each device's address, so the transport delivers what it advertises.
     *
     * @param claims - The devices.
     * @returns One per device.
     */
    subscriptions: (claims) =>
      claims.map((claim) => ({ op: 'follow', args: { address: claim.deviceKey } })),

    /**
     * Describes the device from the advertisement it was recognised by: an entity per reading.
     *
     * @param claim - The claim.
     * @returns The device.
     * @throws {ValidationError} When the claim holds no Bluetooth device.
     */
    describe: (claim) => {
      const device = snapshotOf(claim.descriptor);

      if (device === undefined) {
        throw new ValidationError(`${manifest.id} cannot describe a claim with no device`, {
          details: { integration: manifest.id },
        });
      }

      return {
        externalId: claim.externalId,
        name: device.name,
        ...(device.advert.name === undefined ? {} : { model: device.advert.name.slice(0, 128) }),
        // shortcut: a reading first heard after the device was added has no entity until the hub
        // describes the device again from a later advertisement; describe from every one heard
        // if sensors turn out to leave readings out of some.
        entities: readingsOf(device.advert).map(descriptorOf),
      };
    },

    /**
     * Turns an advertisement into a report per reading the device has an entity for.
     *
     * @param message - What the transport delivered: one advertisement.
     * @param context - The identifiers the hub assigned.
     * @returns The reports.
     */
    toState: (message: TransportInbound, context: MappingContext): ReportedState[] => {
      const advert = bluetoothAdvertSchema.safeParse(message.payload);

      if (!advert.success) {
        return [];
      }

      return readingsOf(advert.data).flatMap((entity): ReportedState[] => {
        const entityId = context.entities.get(entity.objectId);
        const state = stateOf(entity.reading);

        // shortcut: an event is the last one's name as text, so the same event twice in a row is
        // one change; move to an event entity once the platform has one.
        return entityId === undefined || state === undefined
          ? []
          : [
              {
                entityId,
                state,
                attributes:
                  entity.reading.steps === undefined ? {} : { steps: entity.reading.steps },
                isAvailable: true,
                observedAt: advert.data.at,
              },
            ];
      });
    },

    /**
     * Refuses every command: a BTHome sensor only advertises.
     *
     * @param target - The entity commanded.
     * @throws {ValidationError} Always.
     */
    toCommand: (target) => {
      throw new ValidationError(`${manifest.id} takes no commands`, {
        details: { integration: manifest.id, entityId: target.entityId },
      });
    },
  };
}
