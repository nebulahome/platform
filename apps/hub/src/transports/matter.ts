/**
 * `matter`: the platform transport every Matter device is reached through - the house's fabric,
 * which the hub's {@link MatterBroker} holds.
 *
 * One connection for every device, keyed `matter`: the fabric is one place. Each device of each
 * node - the node itself, an endpoint behind a bridge - is told apart by its key, `<node>` or
 * `<node>:<endpoint>`, which is also its external id, so an instance is bound to its device the
 * way Zigbee2MQTT's are: by the id the device was proposed with, its configuration empty.
 *
 * What it delivers is the device whole - its attributes, whether it answers - with the paths
 * that changed, or none to say everything is to be read again: the driver, the platform's Matter
 * mapping, computes every state from every field it needs.
 */
import { z } from 'zod';

import { MATTER_TRANSPORT } from '@nebulahome/contracts';
import {
  defineTransport,
  deviceSnapshotOf,
  matterDeviceKey,
  scopeOfEndpoint,
  scopesOf,
  splitPath,
  type MatterInbound,
  type TransportConnection,
  type TransportContext,
  type TransportRequest,
} from '@nebulahome/package-runtime';

import type { MatterBroker } from '../matter/broker.js';

/** A Matter device's configuration: nothing, as it is bound by its id. */
const matterConfigSchema = z.object({});

/** What a request's arguments hold, by its operation. */
const invokeArgsSchema = z.object({
  endpoint: z.int().min(0),
  cluster: z.int().min(0),
  command: z.string().min(1).max(64),
  payload: z.record(z.string(), z.unknown()).default({}),
  timedMs: z.int().min(1).max(60_000).optional(),
});
const writeArgsSchema = z.object({
  endpoint: z.int().min(0),
  cluster: z.int().min(0),
  attribute: z.int().min(0),
  value: z.unknown(),
});

/**
 * The node a device key names.
 *
 * @param deviceKey - `<node>` or `<node>:<endpoint>`.
 * @returns The node.
 */
function nodeIdOf(deviceKey: string): string {
  return deviceKey.split(':')[0] ?? deviceKey;
}

/**
 * Delivers one node's devices: each of them whole, with the paths of its own that changed.
 *
 * @param broker - The broker.
 * @param context - Where deliveries go.
 * @param nodeId - The node.
 * @param paths - What changed, or null for all of it.
 */
function deliverNode(
  broker: MatterBroker,
  context: TransportContext,
  nodeId: string,
  paths: readonly string[] | null,
): void {
  const node = broker.node(nodeId);

  if (node === undefined) {
    return;
  }

  const scopes = scopesOf(node.attributes);
  const touched = new Map<number | null, string[] | null>();

  if (paths === null) {
    for (const scope of scopes) {
      touched.set(scope.endpoint, null);
    }
  } else {
    for (const each of paths) {
      const split = splitPath(each);

      if (split !== undefined) {
        const { endpoint } = scopeOfEndpoint(scopes, split.endpoint);

        touched.set(endpoint, [...(touched.get(endpoint) ?? []), each]);
      }
    }
  }

  for (const scope of scopes) {
    const changed = touched.get(scope.endpoint);

    if (changed === undefined) {
      continue;
    }

    const offer = scope.endpoint === null ? broker.offer(nodeId) : undefined;
    const payload: MatterInbound = {
      device: deviceSnapshotOf(node, scope),
      changed,
      ...(offer === undefined ? {} : { update: offer }),
    };

    context.deliver({
      connectionKey: MATTER_TRANSPORT,
      deviceKey: matterDeviceKey(nodeId, scope.endpoint),
      payload,
    });
  }
}

/**
 * Builds the transport over the house's fabric.
 *
 * @param broker - The broker that holds the fabric.
 * @returns The transport.
 */
export function createMatterTransport(broker: MatterBroker) {
  return defineTransport({
    id: MATTER_TRANSPORT,
    configSchema: matterConfigSchema,

    /**
     * Every device is on the one fabric.
     *
     * @returns The one key.
     */
    connectionKey: () => MATTER_TRANSPORT,

    /**
     * Follows the fabric for every device on it.
     *
     * @param config - Nothing: the fabric is the broker's.
     * @param context - Where deliveries go.
     * @returns The connection.
     * @throws {Error} When the fabric is not open, with why.
     */
    connect: (config, context): Promise<TransportConnection> => {
      broker.probe();

      const stop = broker.onNode((nodeId, paths) => {
        deliverNode(broker, context, nodeId, paths);
      });

      context.report('up');

      return Promise.resolve({
        key: MATTER_TRANSPORT,

        /**
         * Performs one request on the node its device is on.
         *
         * @param request - What the driver asked.
         * @returns Nothing the driver reads.
         */
        send: async (request: TransportRequest): Promise<unknown> => {
          const nodeId = nodeIdOf(request.deviceKey);

          switch (request.op) {
            case 'invoke': {
              const args = invokeArgsSchema.parse(request.args);

              await broker.invoke(nodeId, args);

              return null;
            }
            case 'write': {
              await broker.write(nodeId, writeArgsSchema.parse(request.args));

              return null;
            }
            case 'update':
              await broker.installUpdate(nodeId);

              return null;
            default:
              throw new Error(`The matter transport has no ${request.op} operation`);
          }
        },

        /**
         * Delivers every device whole: what an instance that started reads first.
         *
         * @returns Once delivered.
         */
        // shortcut: delivers the whole fabric to every instance that starts, so N devices cost N²
        // deliveries at a start; deliver only the starting instance's once the pool says which.
        apply: (): Promise<void> => {
          for (const node of broker.nodes()) {
            deliverNode(broker, context, node.nodeId, null);
          }

          return Promise.resolve();
        },

        /**
         * Stops following the fabric.
         *
         * @returns Once stopped.
         */
        close: (): Promise<void> => {
          stop();

          return Promise.resolve();
        },
      });
    },

    /**
     * Yields every device on the fabric not removed from the house, for identification to take
     * the one an instance is bound to.
     *
     * @yields {Discovered} Each device, whole.
     */
    scan: async function* () {
      // The fabric answers from memory; awaited only to be the generator the contract asks for.
      for (const sighting of await Promise.resolve(broker.devices())) {
        yield { deviceKey: sighting.deviceKey, payload: sighting.device };
      }
    },

    /**
     * Says whether the fabric is open.
     *
     * @returns How many nodes it holds.
     * @throws {Error} When it is not open, with why.
     */
    probe: (): Promise<string> => Promise.resolve(broker.probe()),
  });
}
