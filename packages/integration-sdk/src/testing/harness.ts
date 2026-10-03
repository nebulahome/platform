/**
 * A driver under test, driven the way `hub` drives one: a device found is claimed and described,
 * its entities get the identifiers `hub` would give them, what it sends becomes state - the last
 * state of each entity kept, as `hub` keeps it for a command that needs it - and a command
 * becomes the request the transport would perform. No transport and no bus: an integration is
 * pure, so what it does with what it is handed is all there is to test.
 *
 * ```ts
 * const harness = driverHarness(integration.driver('panels'));
 * const device = harness.add({ deviceKey: '192.168.1.40', payload: statusJson });
 * harness.receive(statusJson);  // → [{ entityId: 'light.device', state: { on_off: { isOn: true } } }]
 * harness.command(device.entityIds[0], 'on_off', { command: 'turn_on' });
 * ```
 */
import {
  composeEntityId,
  type CapabilityName,
  type CapabilityState,
  type EntityId,
  type JsonObject,
} from '@nebulahome/contracts';
import type {
  Claim,
  DeviceDescriptor,
  Discovered,
  Integration,
  LoadedBundle,
  MappingContext,
  ReportedState,
  TransportRequest,
  TransportSubscription,
} from '@nebulahome/package-runtime';

/** What the harness is set up with. */
export type DriverHarnessOptions = {
  /** The instance's options, as the owner set them; checked against the driver's schema. */
  readonly options?: JsonObject;

  /** The device's id, which its entities' identifiers are made from: `device` when not said. */
  readonly deviceId?: string;

  /** The connection a message arrives on, as the transport would key it. */
  readonly connectionKey?: string;
};

/** A device added through the harness. */
export type HarnessDevice = {
  readonly claim: Claim;

  /** What the driver said the device is. */
  readonly device: DeviceDescriptor;

  /** Each entity's identifier, by its descriptor's `objectId` - `''` for a device's only one. */
  readonly entities: ReadonlyMap<string, EntityId>;

  /** The identifiers, in the descriptor's order. */
  readonly entityIds: readonly EntityId[];
};

/** A driver, driven. */
export type DriverHarness = {
  readonly integration: Integration;

  /** The instance's options, checked. */
  readonly options: JsonObject;

  /**
   * Asks the driver whether a device is its own.
   *
   * @param discovered - What a scan or a probe found.
   * @returns The claim, or null.
   */
  claim: (discovered: Discovered) => Claim | null;

  /**
   * Claims a device and describes it: what adding it does.
   *
   * @param discovered - What a scan or a probe found.
   * @returns The device, its entities named.
   * @throws {Error} When the driver does not claim it.
   */
  add: (discovered: Discovered) => HarnessDevice;

  /**
   * What the transport must carry for the devices added.
   *
   * @returns The subscriptions.
   */
  subscriptions: () => TransportSubscription[];

  /**
   * Hands the driver a message from a device added, as the transport would.
   *
   * @param payload - What arrived.
   * @param deviceKey - Which device; the one added last when not said.
   * @returns The reports, each entity's last state kept.
   */
  receive: (payload: unknown, deviceKey?: string) => ReportedState[];

  /**
   * Turns a command into the request the transport would perform.
   *
   * @param entityId - The entity.
   * @param capability - The capability.
   * @param command - The command, as `core` validated it.
   * @returns The request.
   */
  command: (entityId: string, capability: CapabilityName, command?: JsonObject) => TransportRequest;

  /**
   * The last state an entity reported.
   *
   * @param entityId - The entity.
   * @returns Its state, or undefined before it reported.
   */
  lastState: (entityId: string) => CapabilityState | undefined;
};

/**
 * Sets a driver up to be driven.
 *
 * @param driver - A driver of an integration loaded with `loadIntegration`, or an integration.
 * @param settings - The instance's options, the device's id, the connection.
 * @returns The harness.
 */
export function driverHarness(
  driver: LoadedBundle | Integration,
  settings: DriverHarnessOptions = {},
): DriverHarness {
  const integration = 'integration' in driver ? driver.integration : driver;
  const options = integration.optionsSchema.parse(settings.options ?? {});
  const deviceId = settings.deviceId ?? 'device';
  const connectionKey = settings.connectionKey ?? 'test';
  const devices = new Map<string, HarnessDevice>();
  const lastStates = new Map<EntityId, CapabilityState>();
  let lastAdded: string | undefined;

  /**
   * What a mapper of a device is handed.
   *
   * @param device - The device.
   * @returns The context.
   */
  const contextFor = (device: HarnessDevice): MappingContext => ({
    options,
    claim: device.claim,
    entities: device.entities,

    /**
     * The last state an entity reported.
     *
     * @param entityId - The entity.
     * @returns Its state.
     */
    lastState: (entityId) => lastStates.get(entityId),
  });

  /**
   * The device added with a key.
   *
   * @param deviceKey - The key; the one added last when not said.
   * @returns The device.
   * @throws {Error} When none was added with it.
   */
  const deviceOf = (deviceKey: string | undefined): HarnessDevice => {
    const device = devices.get(deviceKey ?? lastAdded ?? '');

    if (device === undefined) {
      throw new Error(
        deviceKey === undefined
          ? 'No device was added: call add() first'
          : `No device was added as ${deviceKey}`,
      );
    }

    return device;
  };

  return {
    integration,
    options,

    /**
     * Asks the driver whether a device is its own.
     *
     * @param discovered - What was found.
     * @returns The claim, or null.
     */
    claim: (discovered) => integration.claim(discovered, options),

    /**
     * Claims a device and describes it.
     *
     * @param discovered - What was found.
     * @returns The device.
     * @throws {Error} When the driver does not claim it.
     */
    add: (discovered) => {
      const claim = integration.claim(discovered, options);

      if (claim === null) {
        throw new Error(`${integration.id} does not claim ${discovered.deviceKey}`);
      }

      const device = integration.describe(claim, options);
      const entities = device.entities.map((entity) => ({
        objectId: entity.objectId ?? '',
        entityId: composeEntityId(entity.domain, deviceId, entity.objectId),
      }));
      const added: HarnessDevice = {
        claim,
        device,
        entities: new Map(entities.map((entity) => [entity.objectId, entity.entityId])),
        entityIds: entities.map((entity) => entity.entityId),
      };

      devices.set(claim.deviceKey, added);
      lastAdded = claim.deviceKey;

      return added;
    },

    /**
     * What the transport must carry.
     *
     * @returns The subscriptions.
     */
    subscriptions: () =>
      integration.subscriptions(
        [...devices.values()].map((device) => device.claim),
        options,
      ),

    /**
     * Hands the driver a message.
     *
     * @param payload - What arrived.
     * @param deviceKey - Which device.
     * @returns The reports.
     */
    receive: (payload, deviceKey) => {
      const device = deviceOf(deviceKey);
      const reports = integration.toState(
        { connectionKey, deviceKey: device.claim.deviceKey, payload },
        contextFor(device),
      );

      for (const report of reports) {
        lastStates.set(report.entityId, report.state);
      }

      return reports;
    },

    /**
     * Turns a command into a request.
     *
     * @param entityId - The entity.
     * @param capability - The capability.
     * @param command - The command.
     * @returns The request.
     * @throws {Error} When no device added has the entity.
     */
    command: (entityId, capability, command = {}) => {
      const device = [...devices.values()].find((candidate) =>
        candidate.entityIds.includes(entityId as EntityId),
      );

      if (device === undefined) {
        throw new Error(`No device added has the entity ${entityId}`);
      }

      return integration.toCommand(
        { entityId: entityId as EntityId, capability, command },
        contextFor(device),
      );
    },

    /**
     * The last state an entity reported.
     *
     * @param entityId - The entity.
     * @returns Its state.
     */
    lastState: (entityId) => lastStates.get(entityId as EntityId),
  };
}
