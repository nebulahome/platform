/**
 * The house's Matter fabric, held by the controller of Home Assistant's Matter Server.
 *
 * `@matter-server/ws-controller` is that server's controller as a library, on matter.js: the
 * fabric's keys and the nodes in a folder, their attributes cached and subscribed to, reconnection,
 * the CSA's DCL for vendors, certificates and firmware. Its own WebSocket server is not run: the
 * hub drives the controller in-process, and this file is the only one that knows the library -
 * the rest of the hub sees {@link MatterFabric}, which a test fakes.
 *
 * Its README calls the package internal to that server, so its version is pinned exactly and moved
 * on purpose. The controller listens on Matter's own UDP port, 5540, which the library does not let
 * be changed: another Matter controller on the same host - a Home Assistant's - takes it first.
 */
import { createRequire } from 'node:module';

import { Millis, NodeId } from '@matter/main';
import { AttributeId, ClusterId, EndpointNumber } from '@matter/main/types';
import {
  buildAttributePath,
  ConfigStorage,
  Environment,
  LogDestination,
  Logger,
  LogLevel,
  MatterController,
} from '@matter-server/ws-controller';

import type { PlatformLogger } from '@nebulahome/logging';
import type { MatterNodeSnapshot, MatterUpdateOffer } from '@nebulahome/package-runtime';

/** The log destination commissioning steps are read from while one runs. */
const STEPS_DESTINATION = 'commissioning-steps';

/** One command, on one endpoint's cluster. */
export type MatterInvoke = {
  readonly endpoint: number;
  readonly cluster: number;

  /** As matter.js names it: `moveToLevelWithOnOff`. */
  readonly command: string;
  readonly payload: Readonly<Record<string, unknown>>;

  /** How long a timed command is given; absent for an ordinary one. */
  readonly timedMs?: number | undefined;
};

/** One attribute written, on one endpoint's cluster. */
export type MatterWrite = {
  readonly endpoint: number;
  readonly cluster: number;
  readonly attribute: number;
  readonly value: unknown;
};

/** What the fabric says as it happens. */
export type MatterFabricEvents = {
  /**
   * Attributes of a node changed, or - with null - the node is to be read again whole: it came,
   * went, or changed shape.
   *
   * @param nodeId - The node.
   * @param paths - The attributes that changed, or null.
   */
  readonly onNode: (nodeId: string, paths: readonly string[] | null) => void;

  /** A node was added to the fabric or left it. */
  readonly onNodes: () => void;
};

/** One node, and when it joined the fabric. */
export type FabricNode = MatterNodeSnapshot & {
  /** When it joined, as the controller recorded it; null when it did not say. */
  readonly commissionedAt: Date | null;
};

/** The fabric, as the hub drives it. */
export type MatterFabric = {
  /** The fabric's id, in hex. */
  readonly fabricId: string;

  /** Every node, in the order they were commissioned. */
  readonly nodes: () => FabricNode[];

  /** One node, or undefined when the fabric has none of that id. */
  readonly node: (nodeId: string) => FabricNode | undefined;

  /**
   * Commissions a node shared by another app, over the network.
   *
   * @param code - Its manual pairing code or QR text.
   * @param onStep - Told the number of each commissioning step as it starts.
   * @returns The new node's id.
   */
  readonly commission: (code: string, onStep?: (step: number) => void) => Promise<string>;

  /** Takes a node off the fabric. */
  readonly decommission: (nodeId: string) => Promise<void>;

  readonly invoke: (nodeId: string, request: MatterInvoke) => Promise<void>;
  readonly write: (nodeId: string, request: MatterWrite) => Promise<void>;

  /** Asks the DCL whether newer firmware is on offer for a node. */
  readonly checkUpdate: (nodeId: string) => Promise<MatterUpdateOffer>;

  /** Has a node fetch and apply a firmware version. */
  readonly installUpdate: (nodeId: string, softwareVersion: number) => Promise<void>;

  readonly stop: () => Promise<void>;
};

/** What opening the fabric needs. */
export type MatterFabricOptions = {
  /** Where the fabric's keys and nodes are kept: `<data>/hub/matter`. */
  readonly storageDir: string;

  readonly logger: PlatformLogger;

  /** The platform's version, which the controller's own node says it runs. */
  readonly version: string;

  readonly events: MatterFabricEvents;

  /**
   * Whether devices with a test certificate are commissioned too. The engine knows no answer per
   * device: the whole controller accepts them or none, so it is opened this way only to add the
   * one the owner said yes to.
   */
  readonly acceptTestCertificates?: boolean;
};

/**
 * Which commissioning step a line of matter.js's log says started.
 *
 * shortcut: the steps are read from matter.js's log, since the engine reports none; upgrade when
 * ws-controller says how a commissioning goes.
 *
 * @param text - The line.
 * @returns The step's number, or undefined for any other line.
 */
export function commissioningStepOf(text: string): number | undefined {
  const match = /Executing commissioning step (\d+)\.\d+:/u.exec(text);

  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/**
 * Whether a commissioning failed because the device's certificate is a test one.
 *
 * shortcut: told by the engine's sentence, which is all it says; upgrade when ws-controller lets
 * the hub answer the attestation itself.
 *
 * @param message - Why it failed.
 * @returns True for a test certificate.
 */
export function isTestCertificateFailure(message: string): boolean {
  return /test\/development certificate|test certificate/iu.test(message);
}

/** The engine under the controller, as the Brokers page names it: `matter.js 0.17`. */
export const MATTER_ENGINE = ((): string => {
  try {
    const require = createRequire(import.meta.url);
    const { version } = require('@matter/main/package.json') as { version: string };

    return `matter.js ${version.split('.').slice(0, 2).join('.')}`;
  } catch {
    return 'matter.js';
  }
})();

/** Opens the fabric. */
export type OpenMatterFabric = (options: MatterFabricOptions) => Promise<MatterFabric>;

/**
 * A value as JSON carries it, as the Matter Server's own socket sends it: a 64-bit number as a
 * number while it fits, as text when it does not. The controller leaves a struct's absent field
 * `undefined`, which the socket's JSON drops and a claim, stored as JSON, refuses.
 *
 * @param value - What the controller cached.
 * @returns The same value, through JSON.
 */
export function jsonSafe(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, item: unknown) => {
      if (typeof item !== 'bigint') {
        return item;
      }

      return item <= BigInt(Number.MAX_SAFE_INTEGER) && item >= BigInt(Number.MIN_SAFE_INTEGER)
        ? Number(item)
        : item.toString();
    }),
  ) as unknown;
}

/**
 * Sends matter.js's own log into the hub's, at notice and above: what it says at info is a line a
 * packet.
 *
 * @param logger - The hub's.
 */
function routeLogs(logger: PlatformLogger): void {
  Logger.destinations['default'] = LogDestination({
    name: 'default',
    level: LogLevel.NOTICE,

    /**
     * Writes one line.
     *
     * @param text - The line, formatted.
     * @param message - What it says, with its level and facility.
     */
    write: (text, message) => {
      const fields = { facility: message.facility };

      if (message.level >= LogLevel.ERROR) {
        logger.error(fields, text);
      } else if (message.level >= LogLevel.WARN) {
        logger.warn(fields, text);
      } else {
        logger.info(fields, text);
      }
    },
  });
}

/**
 * Opens the house's fabric: the controller, its storage, its subscriptions to every node.
 *
 * @param options - Where to keep it, and who to tell.
 * @returns The fabric, every node it holds connecting.
 */
export const openMatterFabric: OpenMatterFabric = async (options) => {
  const { storageDir, logger, version, events } = options;

  routeLogs(logger);

  const environment = Environment.default;

  environment.vars.set('storage.path', storageDir);

  const config = await ConfigStorage.create(environment);
  const controller = await MatterController.create(environment, config, {
    serverVersion: version,
    // No Thread here: no border router to look for, and nothing to probe for one.
    disableThreadDiagnostics: true,
    ...(options.acceptTestCertificates === true ? { enableTestNetDcl: true } : {}),
  });
  const handler = controller.commandHandler;

  handler.events.attributeChanged.on((nodeId, data) => {
    const { endpointId, clusterId, attributeId } = data.path;

    events.onNode(String(nodeId), [buildAttributePath(endpointId, clusterId, attributeId)]);
  });

  for (const each of [
    handler.events.nodeAvailabilityChanged,
    handler.events.nodeStructureChanged,
    handler.events.nodeEndpointAdded,
    handler.events.nodeEndpointRemoved,
  ]) {
    each.on((nodeId: NodeId) => {
      events.onNode(String(nodeId), null);
    });
  }

  handler.events.nodeAdded.on(() => {
    events.onNodes();
  });
  handler.events.nodeDecommissioned.on(() => {
    events.onNodes();
  });

  await handler.start();
  await handler.initializeNodes();

  const fabric = await handler.getCommissionerFabricData();

  /**
   * One node, as the hub reads it.
   *
   * @param nodeId - The node.
   * @returns It, or undefined when the fabric has none of that id.
   */
  const nodeOf = (nodeId: NodeId): FabricNode | undefined => {
    if (!handler.hasNode(nodeId)) {
      return undefined;
    }

    const details = handler.getNodeDetails(nodeId);
    const commissionedAt = new Date(details.date_commissioned);

    return {
      nodeId: String(details.node_id),
      isAvailable: details.available,
      attributes: jsonSafe(details.attributes) as Record<string, unknown>,
      commissionedAt: Number.isNaN(commissionedAt.getTime()) ? null : commissionedAt,
    };
  };

  return {
    fabricId: fabric.fabricId.toString(16),

    /**
     * Lists the nodes.
     *
     * @returns Every node the fabric holds.
     */
    nodes: () =>
      handler.getNodeIds().flatMap((nodeId) => {
        const found = nodeOf(nodeId);

        return found === undefined ? [] : [found];
      }),

    /**
     * Reads one node.
     *
     * @param nodeId - The node, in decimal.
     * @returns It, or undefined.
     */
    node: (nodeId) => nodeOf(NodeId(BigInt(nodeId))),

    /**
     * Commissions a node over the network, with an id of its own.
     *
     * @param code - Its pairing code.
     * @param onStep - Told each step as it starts.
     * @returns The node's id.
     */
    commission: async (code, onStep) => {
      const nodeId = NodeId(
        await config.allocateNodeId((candidate) => handler.isNodeIdInUse(NodeId(candidate))),
      );
      const request = code.startsWith('MT:') ? { qrCode: code } : { manualCode: code };

      // Heard only while it runs: matter.js says a line a packet at info.
      Logger.destinations[STEPS_DESTINATION] = LogDestination({
        name: STEPS_DESTINATION,
        level: LogLevel.INFO,

        /**
         * Reads a step out of a line.
         *
         * @param text - The line.
         */
        write: (text) => {
          const step = commissioningStepOf(text);

          if (step !== undefined) {
            onStep?.(step);
          }
        },
      });

      try {
        const committed = await handler.commissionNode({ nodeId, onNetworkOnly: true, ...request });

        return String(committed.nodeId);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- one named destination
        delete Logger.destinations[STEPS_DESTINATION];
      }
    },

    /**
     * Takes a node off the fabric.
     *
     * @param nodeId - The node.
     * @returns Once it left.
     */
    decommission: async (nodeId) => {
      await handler.decommissionNode(NodeId(BigInt(nodeId)));
    },

    /**
     * Invokes a command.
     *
     * @param nodeId - The node.
     * @param request - The command.
     * @returns Once the node accepted it.
     */
    invoke: async (nodeId, request) => {
      await handler.handleInvoke({
        nodeId: NodeId(BigInt(nodeId)),
        endpointId: EndpointNumber(request.endpoint),
        clusterId: ClusterId(request.cluster),
        commandName: request.command,
        data: request.payload,
        ...(request.timedMs === undefined
          ? {}
          : { timedInteractionTimeoutMs: Millis(request.timedMs) }),
      });
    },

    /**
     * Writes an attribute.
     *
     * @param nodeId - The node.
     * @param request - The attribute.
     * @returns Once the node accepted it.
     */
    write: async (nodeId, request) => {
      await handler.handleWriteAttribute({
        nodeId: NodeId(BigInt(nodeId)),
        endpointId: EndpointNumber(request.endpoint),
        clusterId: ClusterId(request.cluster),
        attributeId: AttributeId(request.attribute),
        value: request.value,
      });
    },

    /**
     * Asks for firmware on offer.
     *
     * @param nodeId - The node.
     * @returns The offer, or null for nothing newer.
     */
    checkUpdate: async (nodeId) => {
      const found = await handler.checkNodeUpdate(NodeId(BigInt(nodeId)));

      return found === null
        ? null
        : {
            softwareVersion: found.software_version,
            softwareVersionString: found.software_version_string,
          };
    },

    /**
     * Has a node install a version.
     *
     * @param nodeId - The node.
     * @param softwareVersion - The version.
     * @returns Once it started.
     */
    installUpdate: async (nodeId, softwareVersion) => {
      await handler.updateNode(NodeId(BigInt(nodeId)), softwareVersion);
    },

    /**
     * Closes the controller and its storage.
     *
     * @returns Once closed.
     */
    stop: async () => {
      await controller.stop();
      await config.close();
    },
  };
};
