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
  HistoryRange,
  Integration,
  LoadedBundle,
  MappingContext,
  PastReadings,
  ReportedState,
  TransportRequest,
  TransportSubscription,
} from '@nebulahome/package-runtime';

/** The most requests one command may take, as the hub allows. */
const MAX_STEPS = 8;

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
   * Carries a command through a conversation, as the hub does for a driver with
   * `continueCommand`: each request is answered with the next of `answers`, what the driver's
   * `fromAnswer` reads of each answer is reported, and the driver says what to send next.
   *
   * @param entityId - The entity.
   * @param capability - The capability.
   * @param command - The command, as `core` validated it.
   * @param answers - What the transport answers each request, in turn.
   * @returns Every request the command made, the last one unanswered when `answers` ran out; and
   * as `states`, the reports `fromAnswer` made of the answers, each entity's last state kept.
   */
  converse: (
    entityId: string,
    capability: CapabilityName,
    command: JsonObject,
    answers: readonly unknown[],
  ) => TransportRequest[] & { readonly states: ReportedState[] };

  /**
   * Imports a device's past, as the hub does once it is added, for a driver with `history`: the
   * request the transport would be sent, and the readings the driver reads from its answer. No
   * state changes.
   *
   * @param range - From when and until when, ISO 8601.
   * @param answer - What the transport answers the request.
   * @param deviceKey - Which device; the one added last when not said.
   * @returns The request, and the readings of each entity.
   * @throws {Error} When the driver imports no past.
   */
  importHistory: (
    range: HistoryRange,
    answer: unknown,
    deviceKey?: string,
  ) => { request: TransportRequest; readings: PastReadings[] };

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
   * The device added that has an entity.
   *
   * @param entityId - The entity.
   * @returns The device.
   * @throws {Error} When none has it.
   */
  const deviceWith = (entityId: string): HarnessDevice => {
    const device = [...devices.values()].find((candidate) =>
      candidate.entityIds.includes(entityId as EntityId),
    );

    if (device === undefined) {
      throw new Error(`No device added has the entity ${entityId}`);
    }

    return device;
  };

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
      const device = deviceWith(entityId);

      return integration.toCommand(
        { entityId: entityId as EntityId, capability, command },
        contextFor(device),
      );
    },

    /**
     * Carries a command through its conversation.
     *
     * @param entityId - The entity.
     * @param capability - The capability.
     * @param command - The command.
     * @param answers - The transport's answers, in turn.
     * @returns The requests, and the states the answers reported.
     * @throws {Error} When no device added has the entity, or past eight requests; and what
     * `fromAnswer` throws, which the hub only logs: here a test sees it.
     */
    converse: (entityId, capability, command, answers) => {
      const context = contextFor(deviceWith(entityId));
      const target = { entityId: entityId as EntityId, capability, command };
      const requests = [integration.toCommand(target, context)];
      const states: ReportedState[] = [];

      for (const [index, answer] of answers.entries()) {
        const request = requests[index];

        if (request === undefined) {
          break;
        }

        const step = { request, answer, index };

        for (const report of integration.fromAnswer?.(target, step, context) ?? []) {
          lastStates.set(report.entityId, report.state);
          states.push(report);
        }

        const next = integration.continueCommand?.(target, step, context);

        if (next === null || next === undefined) {
          break;
        }

        if (requests.length === MAX_STEPS) {
          throw new Error(`The command asked for more than ${String(MAX_STEPS)} requests`);
        }

        requests.push(next);
      }

      // Not enumerable, so a test comparing the requests with toEqual still sees only them.
      return Object.defineProperty(requests, 'states', { value: states }) as TransportRequest[] & {
        readonly states: ReportedState[];
      };
    },

    /**
     * Imports a device's past.
     *
     * @param range - From when and until when.
     * @param answer - The transport's answer.
     * @param deviceKey - Which device.
     * @returns The request and the readings.
     * @throws {Error} When the driver imports no past, or no device was added.
     */
    importHistory: (range, answer, deviceKey) => {
      const { history } = integration;

      if (history === undefined) {
        throw new Error(`${integration.id} imports no past: it has no history`);
      }

      const context = contextFor(deviceOf(deviceKey));

      return {
        request: history.request(range, context),
        readings: history.toReadings(answer, context),
      };
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
