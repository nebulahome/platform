/**
 * `infrared`: the platform transport every remote the house learned is reached through, which the
 * hub's {@link InfraredBroker} keeps.
 *
 * One connection for every remote, keyed `infrared`. A remote is told apart by its device key -
 * `infrared-<remoteId>` - which is also its external id, so an instance is bound to its remote by
 * the id it was proposed with, its configuration empty. Nothing is subscribed: each remote is
 * delivered `{ isAvailable }` whenever its blaster comes or goes, and every remote again whenever
 * the connection applies, which is when an instance on it was bound. A request is `press`
 * (`{ buttonId }`), which the broker sends through the remote's blaster.
 */
import { z } from 'zod';

import { INFRARED_TRANSPORT } from '@nebulahome/contracts';
import {
  defineTransport,
  type TransportConnection,
  type TransportContext,
  type TransportRequest,
} from '@nebulahome/package-runtime';

import type { InfraredBroker } from '../infrared/broker.js';

/** A remote's configuration: nothing, as it is bound by its key. */
const infraredConfigSchema = z.object({});

/** What a `press` request holds. */
const pressArgsSchema = z.object({ buttonId: z.uuid() });

/**
 * Builds the transport over the house's Infrared broker.
 *
 * @param broker - The broker: the remotes, and their blasters.
 * @returns The transport.
 */
export function createInfraredTransport(broker: InfraredBroker) {
  return defineTransport({
    id: INFRARED_TRANSPORT,
    configSchema: infraredConfigSchema,

    /**
     * Every remote is reached through the one broker.
     *
     * @returns The one key.
     */
    connectionKey: () => INFRARED_TRANSPORT,

    /**
     * Says whether each remote's blaster can send, and hands the presses to the broker.
     *
     * @param config - Nothing: the remotes are the broker's.
     * @param context - Where deliveries go.
     * @returns The connection.
     */
    connect: (config, context: TransportContext): Promise<TransportConnection> => {
      /**
       * Tells one remote whether its blaster can send.
       *
       * @param deviceKey - The remote.
       * @param isAvailable - Whether it can.
       */
      const deliver = (deviceKey: string, isAvailable: boolean): void => {
        context.deliver({ connectionKey: INFRARED_TRANSPORT, deviceKey, payload: { isAvailable } });
      };
      const stop = broker.onAvailability(deliver);

      context.report('up');

      return Promise.resolve({
        key: INFRARED_TRANSPORT,

        /**
         * Sends a button pressed.
         *
         * @param request - A `press`.
         * @returns Nothing the driver reads.
         */
        send: async (request: TransportRequest): Promise<unknown> => {
          if (request.op !== 'press') {
            throw new Error(`The ${INFRARED_TRANSPORT} transport has no ${request.op} operation`);
          }

          await broker.pressKey(request.deviceKey, pressArgsSchema.parse(request.args).buttonId);

          return null;
        },

        /**
         * Tells every remote whether its blaster can send: an instance was just bound.
         *
         * @returns Once told.
         */
        apply: (): Promise<void> => {
          for (const each of broker.availability()) {
            deliver(each.deviceKey, each.isAvailable);
          }

          return Promise.resolve();
        },

        /**
         * Stops delivering.
         *
         * @returns Once stopped.
         */
        close: (): Promise<void> => {
          stop();
          context.report('down');

          return Promise.resolve();
        },
      });
    },

    /**
     * Yields every remote the broker keeps, for identification to take the one an instance is
     * bound to.
     *
     * @yields {Discovered} Each remote, with its buttons.
     */
    scan: async function* () {
      // The broker answers from memory; awaited only to be the generator the contract asks for.
      for (const sighting of await Promise.resolve(broker.devices())) {
        yield { deviceKey: sighting.deviceKey, payload: sighting.device };
      }
    },

    /**
     * Says how many remotes the broker keeps.
     *
     * @returns A sentence.
     */
    probe: (): Promise<string> =>
      Promise.resolve(`${String(broker.devices().length)} infrared remotes`),
  });
}
