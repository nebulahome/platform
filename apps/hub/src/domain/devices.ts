/**
 * What one integration instance owns: its device, its entities, and their last known state.
 *
 * Pure by construction - nothing here opens a connection or publishes anything. That matters
 * because this is where the routing decisions are made, and routing decisions are what you want
 * to be able to test by handing them a captured payload rather than by standing up a broker.
 *
 * The last known state is kept for one reason: it is what lets {@link Integration.toCommand} stay
 * pure. A relative dim or a toggle needs the current value, and `hub` already has it - it is what
 * published it - so the mapper reads it here instead of asking the device.
 */
import type {
  CapabilityState,
  EntityId,
  EntityRegistration,
  JsonObject,
  StateReport,
} from '@nebula-home/contracts';
import type {
  Claim,
  DeviceDescriptor,
  DeviceInfo,
  Integration,
  MappingContext,
  TransportInbound,
} from '@nebula-home/package-runtime';

import { composeEntityId } from './entity-ids.js';

/** One identified device and the identifiers its entities carry. */
export type DeviceBinding = {
  readonly claim: Claim;

  /** Keyed by the descriptor's `objectId`, or the empty string for a device with one entity. */
  readonly entities: ReadonlyMap<string, EntityId>;
};

/** A claimed device, described: what to bind, and what to ask `core` to write. */
export type DescribedDevice = {
  readonly claim: Claim;
  readonly descriptor: DeviceDescriptor;
  readonly binding: DeviceBinding;

  /** The entities as `core` registers them, in the descriptor's order. */
  readonly registrations: readonly EntityRegistration[];
};

/**
 * Describes a claimed device the one way, whether it was just identified or is being bound
 * again from its row.
 *
 * The entity identifiers are composed from the device id - the instance id - rather than from
 * the serial the hardware reports: `switch.relay_lab` reads as the device the owner named, and
 * a replaced relay keeps the automations that name it. Composed here, once, so that the
 * identifiers registered and the identifiers bound after a restart are the same by construction.
 *
 * @param deviceId - The device's id, which is the instance id.
 * @param integration - The integration that claimed it.
 * @param claim - The claim.
 * @param options - The instance's options, handed to `describe`.
 * @returns The device, described.
 */
export function describeDevice(
  deviceId: string,
  integration: Integration,
  claim: Claim,
  options: JsonObject,
): DescribedDevice {
  const descriptor = integration.describe(claim, options);
  const entities = descriptor.entities.map((entity) => ({
    entity,
    entityId: composeEntityId(entity.domain, deviceId, entity.objectId),
  }));

  return {
    claim,
    descriptor,
    binding: {
      claim,
      entities: new Map(entities.map(({ entity, entityId }) => [entity.objectId ?? '', entityId])),
    },
    registrations: entities.map(({ entity, entityId }) => ({
      entityId,
      name: entity.name,
      ...(entity.icon === undefined ? {} : { icon: entity.icon }),
      capabilities: entity.capabilities,
      ...(entity.unitOfMeasurement === undefined
        ? {}
        : { unitOfMeasurement: entity.unitOfMeasurement }),
      ...(entity.deviceClass === undefined ? {} : { deviceClass: entity.deviceClass }),
      ...(entity.stateClass === undefined ? {} : { stateClass: entity.stateClass }),
      ...(entity.displayPrecision === undefined
        ? {}
        : { displayPrecision: entity.displayPrecision }),
    })),
  };
}

/** What one integration instance owns. */
export class DeviceBook {
  readonly #byDeviceKey = new Map<string, DeviceBinding>();
  readonly #byEntityId = new Map<EntityId, DeviceBinding>();
  readonly #lastState = new Map<EntityId, CapabilityState>();

  /** What each device last said about its firmware, as text to compare, by its key. */
  readonly #info = new Map<string, string>();

  /**
   * How many devices are bound.
   *
   * @returns The number of adopted devices.
   */
  public get size(): number {
    return this.#byDeviceKey.size;
  }

  /**
   * Records a device this instance owns.
   *
   * @param binding - The device and its entity identifiers.
   */
  public bind(binding: DeviceBinding): void {
    this.#byDeviceKey.set(binding.claim.deviceKey, binding);

    for (const entityId of binding.entities.values()) {
      this.#byEntityId.set(entityId, binding);
    }
  }

  /**
   * Forgets a device and everything it reported.
   *
   * @param deviceKey - How the transport addressed it.
   * @returns True when it was there to forget.
   */
  public unbind(deviceKey: string): boolean {
    const binding = this.#byDeviceKey.get(deviceKey);

    if (binding === undefined) {
      return false;
    }

    for (const entityId of binding.entities.values()) {
      this.#byEntityId.delete(entityId);
      this.#lastState.delete(entityId);
    }

    this.#info.delete(deviceKey);

    return this.#byDeviceKey.delete(deviceKey);
  }

  /**
   * Finds the device an entity belongs to.
   *
   * @param entityId - The entity being addressed.
   * @returns Its device, or undefined when this instance does not own it.
   */
  public byEntityId(entityId: EntityId): DeviceBinding | undefined {
    return this.#byEntityId.get(entityId);
  }

  /**
   * Lists every device, which is what the subscription plan is built from.
   *
   * @returns The claims, in the order they were bound.
   */
  public claims(): Claim[] {
    return [...this.#byDeviceKey.values()].map((binding) => binding.claim);
  }

  /**
   * Lists every entity that has reported at least once.
   *
   * @returns Those entity identifiers. Deliberately not every entity this instance owns: a
   * resynchronisation must not invent a state for a device that has not answered since startup,
   * and `core` marks those unavailable itself when nobody speaks for them.
   */
  public known(): EntityId[] {
    return [...this.#lastState.keys()];
  }

  /**
   * Reads what an entity last reported.
   *
   * @param entityId - The entity to look up.
   * @returns Its last state, or undefined before it has ever reported.
   */
  public lastState(entityId: EntityId): CapabilityState | undefined {
    return this.#lastState.get(entityId);
  }

  /**
   * Rebuilds the report for an entity from what it last said.
   *
   * @param entityId - The entity to describe.
   * @returns The report, or undefined when it has never reported.
   */
  public replay(entityId: EntityId): StateReport | undefined {
    const state = this.#lastState.get(entityId);

    return state === undefined ? undefined : { entityId, state, attributes: {}, isAvailable: true };
  }

  /**
   * Turns something a connection delivered into canonical reports.
   *
   * @param integration - The integration that owns these devices.
   * @param options - The instance's settings.
   * @param message - What arrived.
   * @returns One report per entity the message spoke about. Empty when the message belongs to
   * some other instance sharing the same connection, which is most of what arrives on a shared
   * one and is not worth a line in the log each time.
   */
  public ingest(
    integration: Integration,
    options: JsonObject,
    message: TransportInbound,
  ): StateReport[] {
    const binding = this.#byDeviceKey.get(message.deviceKey);

    if (binding === undefined) {
      return [];
    }

    const reports = integration.toState(message, this.contextFor(binding, options));

    for (const report of reports) {
      this.#lastState.set(report.entityId, report.state);
    }

    return reports;
  }

  /**
   * Reads what a message says about its device's firmware, when it says something new.
   *
   * New since the last time this book heard it, not new to the registry: the first message
   * after a start is always new here, and `core` - which holds what the row says - decides
   * whether it changed anything. After that, a device repeating the same versions in every
   * status is not asked about again.
   *
   * @param integration - The integration that owns these devices.
   * @param options - The instance's settings.
   * @param message - What arrived.
   * @returns What it says, or undefined when it says nothing new or belongs to nobody here.
   */
  public infoOf(
    integration: Integration,
    options: JsonObject,
    message: TransportInbound,
  ): DeviceInfo | undefined {
    const binding = this.#byDeviceKey.get(message.deviceKey);

    if (binding === undefined || integration.deviceInfo === undefined) {
      return undefined;
    }

    const info = integration.deviceInfo(message, this.contextFor(binding, options));

    if (info === undefined) {
      return undefined;
    }

    const heard = JSON.stringify(info);

    if (this.#info.get(message.deviceKey) === heard) {
      return undefined;
    }

    this.#info.set(message.deviceKey, heard);

    return info;
  }

  /**
   * Builds what a mapper is allowed to look at besides its own arguments.
   *
   * @param binding - The device being mapped.
   * @param options - The instance's settings.
   * @returns The context.
   */
  public contextFor(binding: DeviceBinding, options: JsonObject): MappingContext {
    return {
      options,
      claim: binding.claim,
      entities: binding.entities,

      /**
       * Reads what an entity last reported.
       *
       * @param entityId - The entity to look up.
       * @returns Its last state, or undefined before it has ever reported.
       */
      lastState: (entityId: EntityId): CapabilityState | undefined => this.#lastState.get(entityId),
    };
  }
}
