/**
 * `bluetooth`: the platform transport every Bluetooth device of the house is reached through -
 * a BTHome sensor the platform reads, or an integration's of kind `bluetooth` - which the hub's
 * {@link BluetoothBroker} keeps.
 *
 * One connection for every device, keyed `bluetooth`. A device is told apart by its address,
 * which is its device key and its external id, so an instance is bound to its device by the id it
 * was proposed with, its configuration empty. An instance follows its address
 * (`{ op: 'follow', args: { address } }`) and is delivered each advertisement heard from it, by any
 * scanner, as `{ deviceKey: address, payload: advert }`. A request is GATT on the local adapter -
 * `gatt.read`, `gatt.write`, `gatt.notify` - refused when only proxies hear the device; a followed
 * characteristic's values are delivered as `{ service, characteristic, data }`.
 */
import { z } from 'zod';

import { bluetoothAddressSchema, BLUETOOTH_TRANSPORT } from '@nebulahome/contracts';
import {
  defineTransport,
  type TransportConnection,
  type TransportContext,
  type TransportRequest,
  type TransportSubscription,
} from '@nebulahome/package-runtime';

import type { BluetoothBroker } from '../bluetooth/broker.js';

/** A device's configuration: nothing, as it is bound by its address. */
const bluetoothConfigSchema = z.object({});

/** What a `follow` subscription holds. */
const followArgsSchema = z.object({ address: bluetoothAddressSchema });

/**
 * Builds the transport over the house's Bluetooth broker.
 *
 * @param broker - The broker: what it hears, and the local adapter.
 * @returns The transport.
 */
export function createBluetoothTransport(broker: BluetoothBroker) {
  return defineTransport({
    id: BLUETOOTH_TRANSPORT,
    configSchema: bluetoothConfigSchema,

    /**
     * Every device is reached through the one broker.
     *
     * @returns The one key.
     */
    connectionKey: () => BLUETOOTH_TRANSPORT,

    /**
     * Delivers what the followed addresses advertise.
     *
     * @param config - Nothing: the devices are the broker's.
     * @param context - Where deliveries go.
     * @returns The connection.
     */
    connect: (config, context: TransportContext): Promise<TransportConnection> => {
      let followed: ReadonlySet<string> = new Set();
      const stop = broker.onAdvert((advert) => {
        if (followed.has(advert.address)) {
          context.deliver({
            connectionKey: BLUETOOTH_TRANSPORT,
            deviceKey: advert.address,
            payload: advert,
          });
        }
      });

      context.report('up');

      return Promise.resolve({
        key: BLUETOOTH_TRANSPORT,

        /**
         * Reads, writes or follows a characteristic on the local adapter.
         *
         * @param request - A `gatt.*` op.
         * @returns What the op answers.
         */
        send: async (request: TransportRequest): Promise<unknown> =>
          broker.gatt(request, (payload) => {
            context.deliver({
              connectionKey: BLUETOOTH_TRANSPORT,
              deviceKey: request.deviceKey,
              payload,
            });
          }),

        /**
         * Follows exactly these addresses.
         *
         * @param subscriptions - One `follow` per device.
         * @returns Once applied.
         */
        apply: (subscriptions: readonly TransportSubscription[]): Promise<void> => {
          followed = new Set(
            subscriptions.flatMap((subscription) => {
              const parsed = followArgsSchema.safeParse(subscription.args);

              return subscription.op === 'follow' && parsed.success ? [parsed.data.address] : [];
            }),
          );
          broker.follow(followed);

          return Promise.resolve();
        },

        /**
         * Stops delivering.
         *
         * @returns Once stopped.
         */
        close: (): Promise<void> => {
          stop();
          broker.follow(new Set());
          context.report('down');

          return Promise.resolve();
        },
      });
    },

    /**
     * Yields every address as each driver that recognises it, for identification to take the one
     * an instance is bound to.
     *
     * @yields {Discovered} Each address, as one driver.
     */
    scan: async function* () {
      // The broker answers from memory; awaited only to be the generator the contract asks for.
      for (const device of await Promise.resolve(broker.snapshots())) {
        yield { deviceKey: device.deviceKey, payload: device };
      }
    },

    /**
     * Says how many addresses the broker recognises.
     *
     * @returns A sentence.
     */
    probe: (): Promise<string> =>
      Promise.resolve(`${String(broker.snapshots().length)} Bluetooth devices recognised`),
  });
}
