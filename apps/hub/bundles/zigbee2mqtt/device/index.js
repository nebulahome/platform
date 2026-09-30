// @ts-check
/**
 * Any Zigbee device Zigbee2MQTT supports: what it is, what it exposes, what it says and what it
 * is told.
 *
 * One driver for thousands of models, because Zigbee2MQTT describes each the same way
 * (`exposes.js`). A device is added from what the discovery listener proposed, known by its IEEE
 * address; the hub's identification finds it in `bridge/devices` and describes it from its entry
 * there. After that the transport hands this driver the device's state, its availability and, when
 * the bridge lists the devices again, its entry - from which the firmware it now runs is read.
 *
 * Code rather than a profile because the number and kind of entities depend on the device.
 * Exported as a function of the SDK, so its schemas are built with the runtime's zod.
 */
import { commandOf, planEntities, refreshPayload, stateOf } from './exposes.js';

/** @typedef {import('@nebula-home/package-runtime').BundleSdk} BundleSdk */
/** @typedef {import('@nebula-home/package-runtime').Claim} Claim */
/** @typedef {import('@nebula-home/package-runtime').Integration} Integration */
/** @typedef {import('@nebula-home/package-runtime').MappingContext} MappingContext */
/** @typedef {import('@nebula-home/contracts').StateReport} StateReport */
/** @typedef {import('@nebula-home/contracts').JsonObject} JsonObject */

/**
 * The device's entry in `bridge/devices`, out of what its claim kept.
 *
 * @param {Claim} claim - The claim.
 * @returns {Record<string, unknown>} The entry.
 */
function deviceOf(claim) {
  const descriptor = /** @type {Record<string, unknown>} */ (claim.descriptor ?? {});

  return /** @type {Record<string, unknown>} */ (descriptor['device'] ?? {});
}

/**
 * Builds the driver.
 *
 * @param {BundleSdk} sdk - What the hub hands a vendor's code.
 * @returns {Integration} `zigbee2mqtt/device`.
 */
export default function createZigbeeDevice(sdk) {
  return {
    id: 'zigbee2mqtt/device',
    transport: 'zigbee2mqtt/mqtt',
    optionsSchema: sdk.z.object({}),
    discovery: {},

    /**
     * Takes a device the scan found, never the bridge.
     *
     * @param {import('@nebula-home/package-runtime').Discovered} discovered - What the scan saw.
     * @returns {Claim | null} The claim.
     */
    claim: (discovered) => {
      const payload = /** @type {Record<string, unknown>} */ (discovered.payload ?? {});

      return payload['role'] === 'device' && typeof payload['ieee'] === 'string'
        ? { deviceKey: payload['ieee'], externalId: payload['ieee'], descriptor: payload }
        : null;
    },

    /**
     * Asks each device for its readable state when the link comes up.
     *
     * @param {readonly Claim[]} claims - The devices.
     * @returns {import('@nebula-home/package-runtime').TransportSubscription[]} One refresh each.
     */
    subscriptions: (claims) =>
      claims.flatMap((claim) => {
        const payload = refreshPayload(planEntities(deviceOf(claim)));

        return Object.keys(payload).length === 0
          ? []
          : [{ op: 'refresh', args: { ieee: claim.deviceKey, payload } }];
      }),

    /**
     * Says what the device is and what it exposes.
     *
     * @param {Claim} claim - The device.
     * @returns {import('@nebula-home/package-runtime').DeviceDescriptor} Its identity and entities.
     */
    describe: (claim) => {
      const device = deviceOf(claim);
      const definition = /** @type {Record<string, unknown>} */ (device['definition'] ?? {});
      /**
       * A field that is text, as the registry keeps it.
       *
       * @param {unknown} value - The field.
       * @returns {string | undefined} Its text, or nothing.
       */
      const text = (value) =>
        typeof value === 'string' && value.length > 0 ? value.slice(0, 64) : undefined;
      const manufacturer = text(definition['vendor']);
      const model = text(definition['model']);
      const swVersion = text(device['software_build_id']);

      return {
        externalId: claim.externalId,
        name: text(device['friendly_name']) ?? claim.externalId,
        ...(manufacturer === undefined ? {} : { manufacturer }),
        ...(model === undefined ? {} : { model }),
        ...(swVersion === undefined ? {} : { swVersion }),
        entities: planEntities(device).map((plan) => plan.descriptor),
      };
    },

    /**
     * Turns what the transport delivered into state.
     *
     * @param {import('@nebula-home/package-runtime').TransportInbound} message - What arrived.
     * @param {MappingContext} context - The claim and the entity ids.
     * @returns {StateReport[]} One report per entity the message says something about.
     */
    toState: (message, context) => {
      const payload = /** @type {Record<string, unknown>} */ (message.payload ?? {});
      const plans = planEntities(deviceOf(context.claim));

      /** @type {StateReport[]} */
      const reports = [];

      if (payload['kind'] === 'availability' && typeof payload['isOnline'] === 'boolean') {
        for (const plan of plans) {
          const entityId = context.entities.get(plan.objectId);

          if (entityId !== undefined) {
            reports.push({
              entityId,
              state:
                plan.kind === 'connected' ? { sensor_binary: { isOn: payload['isOnline'] } } : {},
              isAvailable: payload['isOnline'],
            });
          }
        }

        return reports;
      }

      const state = payload['state'];

      if (payload['kind'] !== 'state' || typeof state !== 'object' || state === null) {
        return reports;
      }

      for (const plan of plans) {
        const entityId = context.entities.get(plan.objectId);
        const said = stateOf(plan, /** @type {Record<string, unknown>} */ (state));

        if (entityId !== undefined && said !== null) {
          reports.push(/** @type {StateReport} */ ({ entityId, state: said, isAvailable: true }));
        }
      }

      return reports;
    },

    /**
     * Turns a command into what to publish.
     *
     * @param {import('@nebula-home/package-runtime').CommandTarget} target - The command.
     * @param {MappingContext} context - The claim and the entity ids.
     * @returns {import('@nebula-home/package-runtime').TransportRequest} The request.
     * @throws {Error} For an entity the device does not have.
     */
    toCommand: (target, context) => {
      const plan = planEntities(deviceOf(context.claim)).find(
        (each) => context.entities.get(each.objectId) === target.entityId,
      );

      if (plan === undefined) {
        throw new Error(`${target.entityId} is not one of this device's entities`);
      }

      const { op, payload } = commandOf(
        plan,
        target.capability,
        target.command,
        /** @type {Record<string, unknown> | undefined} */ (context.lastState(target.entityId)),
      );

      return {
        deviceKey: context.claim.deviceKey,
        op,
        args: { payload: /** @type {JsonObject} */ (payload) },
      };
    },

    /**
     * Reads the firmware the device runs now, from the bridge's list.
     *
     * @param {import('@nebula-home/package-runtime').TransportInbound} message - What arrived.
     * @returns {{ swVersion?: string } | undefined} The firmware, when the message is the list.
     */
    deviceInfo: (message) => {
      const payload = /** @type {Record<string, unknown>} */ (message.payload ?? {});
      const device = /** @type {Record<string, unknown>} */ (payload['device'] ?? {});
      const version = device['software_build_id'];

      return payload['kind'] === 'definition' && typeof version === 'string' && version.length > 0
        ? { swVersion: version.slice(0, 64) }
        : undefined;
    },
  };
}
