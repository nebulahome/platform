/**
 * `mqtt-house`: the platform transport every device the house's MQTT broker hears is reached
 * through - announced, mapped by the owner, or the broker's own - which the hub's
 * {@link MqttBroker} runs.
 *
 * One connection for every device, keyed `mqtt-house`: the broker is one place. A device is told
 * apart by its key - its first identifier - which is also its external id, so an instance is bound
 * to its device by the id it was proposed with, its configuration empty.
 *
 * What it delivers is the device whole, the last text of every topic it reads and the topics that
 * changed, or none to say everything is to be read again: the driver, the platform's MQTT
 * mapping, computes every state from every topic it needs. A command is the messages it
 * publishes. The connection stays up while the broker cannot listen - its state says so - and
 * delivers again as soon as it does.
 */
import { z } from 'zod';

import { MQTT_HOUSE_TRANSPORT } from '@nebulahome/contracts';
import {
  defineTransport,
  type MqttInbound,
  type TransportConnection,
  type TransportContext,
  type TransportRequest,
} from '@nebulahome/package-runtime';

import type { MqttBroker } from '../mqtt/broker.js';

/** A device's configuration: nothing, as it is bound by its id. */
const mqttHouseConfigSchema = z.object({});

/** A topic a command may publish on: no wildcards, no `$`. */
const commandTopicSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[^#+$][^#+]*$/u, 'A topic, without wildcards');

/** What a `publish` request holds. */
const publishArgsSchema = z.object({
  messages: z
    .array(z.object({ topic: commandTopicSchema, payload: z.string().max(65_536) }))
    .min(1)
    .max(16),
});

/**
 * Delivers one device: whole, with the texts of its topics and the topics that changed.
 *
 * @param broker - The broker.
 * @param context - Where deliveries go.
 * @param deviceKey - The device.
 * @param changed - The topics that changed, or null for all of them.
 */
function deliver(
  broker: MqttBroker,
  context: TransportContext,
  deviceKey: string,
  changed: readonly string[] | null,
): void {
  const device = broker.device(deviceKey);

  if (device === undefined) {
    return;
  }

  const payload: MqttInbound = { device, texts: broker.textsOf(device), changed };

  context.deliver({ connectionKey: MQTT_HOUSE_TRANSPORT, deviceKey, payload });
}

/**
 * Builds the transport over the house's broker.
 *
 * @param broker - The broker the hub runs.
 * @returns The transport.
 */
export function createMqttHouseTransport(broker: MqttBroker) {
  return defineTransport({
    id: MQTT_HOUSE_TRANSPORT,
    configSchema: mqttHouseConfigSchema,

    /**
     * Every device is on the one broker.
     *
     * @returns The one key.
     */
    connectionKey: () => MQTT_HOUSE_TRANSPORT,

    /**
     * Follows the broker for every device it hears.
     *
     * @param config - Nothing: the broker is the hub's.
     * @param context - Where deliveries go.
     * @returns The connection.
     */
    connect: (config, context): Promise<TransportConnection> => {
      const stopDevices = broker.onDevice((deviceKey, changed) => {
        deliver(broker, context, deviceKey, changed);
      });
      const stopState = broker.onState((state) => {
        context.report(state === 'running' ? 'up' : 'down');
      });

      context.report(broker.isRunning ? 'up' : 'down');

      return Promise.resolve({
        key: MQTT_HOUSE_TRANSPORT,

        /**
         * Publishes what a command says.
         *
         * @param request - What the driver asked.
         * @returns Nothing the driver reads.
         */
        send: async (request: TransportRequest): Promise<unknown> => {
          if (request.op !== 'publish') {
            throw new Error(`The ${MQTT_HOUSE_TRANSPORT} transport has no ${request.op} operation`);
          }

          await broker.publish(publishArgsSchema.parse(request.args).messages);

          return null;
        },

        /**
         * Delivers every device whole: what an instance that started reads first.
         *
         * @returns Once delivered.
         */
        // shortcut: delivers every device to every instance that starts, so N devices cost N²
        // deliveries at a start; deliver only the starting instance's once the pool says which.
        apply: (): Promise<void> => {
          for (const device of broker.heard()) {
            deliver(broker, context, device.deviceKey, null);
          }

          return Promise.resolve();
        },

        /**
         * Stops following the broker.
         *
         * @returns Once stopped.
         */
        close: (): Promise<void> => {
          stopDevices();
          stopState();

          return Promise.resolve();
        },
      });
    },

    /**
     * Yields every device the broker hears that is not removed from the house, for
     * identification to take the one an instance is bound to.
     *
     * @yields {Discovered} Each device, whole.
     */
    scan: async function* () {
      // The broker answers from memory; awaited only to be the generator the contract asks for.
      for (const sighting of await Promise.resolve(broker.devices())) {
        yield { deviceKey: sighting.deviceKey, payload: sighting.device };
      }
    },

    /**
     * Says whether the broker listens.
     *
     * @returns How many devices it hears.
     * @throws {Error} When it does not listen, with why.
     */
    probe: (): Promise<string> => {
      const status = broker.status();

      if (status.state !== 'running') {
        return Promise.reject(
          new Error(
            `The MQTT broker is not running${status.error === null ? '' : `: ${status.error}`}`,
          ),
        );
      }

      return Promise.resolve(`${String(broker.heard().length)} devices`);
    },
  });
}
