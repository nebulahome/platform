/**
 * `modbus`: the platform transport every Modbus device is reached through - one the owner added
 * through a template, or an integration's of kind `modbus` - which the hub's {@link ModbusBroker}
 * keeps.
 *
 * One connection for every device, keyed `modbus`: the sockets themselves are the
 * {@link ModbusPool}'s, one per server, shared with everything else in the hub that speaks Modbus.
 * A device is told apart by its key - `modbus-<row>` - which is also its external id, so an
 * instance is bound to its device by the id it was proposed with, its configuration empty.
 *
 * Each device is polled at its own pace for the blocks its template plans; what a poll read is
 * delivered as the registers by table and address, or as the reason the device did not answer.
 * A slow device is never asked twice at once. A command is a write, after which the device is
 * read again at once: the new state is what it says, not what was asked.
 */
import { z } from 'zod';

import { MODBUS_FRAMINGS, MODBUS_TRANSPORT } from '@nebulahome/contracts';
import {
  defineTransport,
  modbusKeyOf,
  type TransportConnection,
  type TransportContext,
  type TransportRequest,
  type TransportSubscription,
} from '@nebulahome/package-runtime';

import type { ModbusBroker } from '../modbus/broker.js';
import type { ModbusAddress, ModbusClient, ModbusPool } from '../modbus/client.js';

/** A device's configuration: nothing, as it is bound by its id. */
const modbusConfigSchema = z.object({});

/** Where a device is. */
const serverShape = {
  host: z.string().min(1).max(253),
  port: z.int().min(1).max(65_535),
  unitId: z.int().min(1).max(247),
  framing: z.enum(MODBUS_FRAMINGS),
};

/** What a `poll` subscription holds: the device, how often, and the blocks to read. */
const pollArgsSchema = z.object({
  ...serverShape,
  deviceKey: z.string().min(1).max(160),
  everyMs: z.int().min(1000),
  blocks: z.array(
    z.object({
      function: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
      start: z.int().min(0).max(0xffff),
      count: z.int().min(1).max(125),
    }),
  ),
});

/** A device's poll. */
type Poll = z.output<typeof pollArgsSchema>;

/** What a `write` request holds. */
const writeArgsSchema = z.object({
  ...serverShape,
  function: z.union([z.literal(5), z.literal(6), z.literal(15), z.literal(16)]),
  address: z.int().min(0).max(0xffff),
  values: z.array(z.int().min(0).max(0xffff)).min(1).max(123),
});

/** A poll running: its timer, and the server it holds. */
type Running = {
  readonly timer: NodeJS.Timeout;
  readonly client: ModbusClient;
  readonly poll: Poll;
};

/**
 * Builds the transport over the house's Modbus client.
 *
 * @param broker - The broker, for its devices and to hear how each poll went.
 * @param pool - The hub's clients.
 * @returns The transport.
 */
export function createModbusTransport(broker: ModbusBroker, pool: ModbusPool) {
  return defineTransport({
    id: MODBUS_TRANSPORT,
    configSchema: modbusConfigSchema,

    /**
     * Every device is reached through the one pool.
     *
     * @returns The one key.
     */
    connectionKey: () => MODBUS_TRANSPORT,

    /**
     * Polls every device the instances on it ask for.
     *
     * @param config - Nothing: the devices are the broker's.
     * @param context - Where deliveries go.
     * @returns The connection.
     */
    connect: (config, context: TransportContext): Promise<TransportConnection> => {
      const running = new Map<string, Running>();
      const busy = new Set<string>();

      /**
       * Reads a device's blocks one after the other and delivers what they hold.
       *
       * @param poll - The device's poll.
       * @returns Once delivered.
       */
      const read = async (poll: Poll): Promise<void> => {
        if (busy.has(poll.deviceKey)) {
          return;
        }

        busy.add(poll.deviceKey);

        const address: ModbusAddress = { host: poll.host, port: poll.port, framing: poll.framing };
        const registers: Record<string, number> = {};

        try {
          for (const block of poll.blocks) {
            const spec = {
              unitId: poll.unitId,
              function: block.function,
              address: block.start,
              count: block.count,
            };

            try {
              // One block at a time, by design: the server answers one request at a time.
              // eslint-disable-next-line no-await-in-loop -- see above
              const result = await pool.read(address, spec).catch(async (error: unknown) => {
                // Asked once more on silence: a gateway drops a request now and then.
                if (error instanceof Error && error.name === 'ModbusSilence') {
                  return pool.read(address, spec);
                }

                throw error;
              });

              result.values.forEach((value, offset) => {
                registers[modbusKeyOf(block.function, block.start + offset)] = value;
              });
            } catch (error: unknown) {
              // A block the unit refused is left out - its entities keep what they had - and
              // the others are still read; any other failure is the device not answering.
              if (!(error instanceof Error && error.name === 'ModbusException')) {
                throw error;
              }
            }
          }

          broker.notePoll(poll.deviceKey, null);
          context.deliver({
            connectionKey: MODBUS_TRANSPORT,
            deviceKey: poll.deviceKey,
            payload: { registers },
          });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);

          broker.notePoll(poll.deviceKey, message);
          context.deliver({
            connectionKey: MODBUS_TRANSPORT,
            deviceKey: poll.deviceKey,
            payload: { error: message },
          });
        } finally {
          busy.delete(poll.deviceKey);
        }
      };

      /**
       * Stops one device's poll and lets go of its server.
       *
       * @param key - The poll's key.
       */
      const stop = (key: string): void => {
        const each = running.get(key);

        if (each !== undefined) {
          clearInterval(each.timer);
          pool.release(each.client);
          running.delete(key);
        }
      };

      context.report('up');

      return Promise.resolve({
        key: MODBUS_TRANSPORT,

        /**
         * Writes what a command says, then reads the device again.
         *
         * @param request - What the driver asked.
         * @returns Nothing the driver reads.
         */
        send: async (request: TransportRequest): Promise<unknown> => {
          if (request.op !== 'write') {
            throw new Error(`The ${MODBUS_TRANSPORT} transport has no ${request.op} operation`);
          }

          const args = writeArgsSchema.parse(request.args);

          await pool.write(args, {
            unitId: args.unitId,
            function: args.function,
            address: args.address,
            values: args.values,
          });

          const poll = [...running.values()].find(
            (each) => each.poll.deviceKey === request.deviceKey,
          )?.poll;

          if (poll !== undefined) {
            void read(poll);
          }

          return null;
        },

        /**
         * Polls exactly these devices: new ones start, gone ones stop, changed ones start over.
         *
         * @param subscriptions - Every device's poll.
         * @returns Once applied.
         */
        apply: (subscriptions: readonly TransportSubscription[]): Promise<void> => {
          const wanted = new Map<string, Poll>();

          for (const subscription of subscriptions) {
            const parsed = pollArgsSchema.safeParse(subscription.args);

            if (subscription.op === 'poll' && parsed.success) {
              wanted.set(JSON.stringify(parsed.data), parsed.data);
            }
          }

          for (const key of running.keys()) {
            if (!wanted.has(key)) {
              stop(key);
            }
          }

          for (const [key, poll] of wanted) {
            if (running.has(key)) {
              continue;
            }

            const timer = setInterval(() => {
              void read(poll);
            }, poll.everyMs);

            timer.unref();
            running.set(key, {
              timer,
              client: pool.acquire({ host: poll.host, port: poll.port, framing: poll.framing }),
              poll,
            });
            void read(poll);
          }

          return Promise.resolve();
        },

        /**
         * Stops every poll.
         *
         * @returns Once stopped.
         */
        close: (): Promise<void> => {
          for (const key of [...running.keys()]) {
            stop(key);
          }

          context.report('down');

          return Promise.resolve();
        },
      });
    },

    /**
     * Yields every device the broker keeps, for identification to take the one an instance is
     * bound to.
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
     * Says how many devices the broker keeps.
     *
     * @returns A sentence.
     */
    probe: (): Promise<string> =>
      Promise.resolve(`${String(broker.devices().length)} Modbus devices`),
  });
}
