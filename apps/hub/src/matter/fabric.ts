/**
 * The house's Matter fabric, held by the controller of the open-source Matter Server.
 *
 * `@matter-server/ws-controller` is that server's controller as a library, on matter.js: the
 * fabric's keys and the nodes in a folder, their attributes cached and subscribed to, reconnection,
 * the CSA's DCL for vendors, certificates and firmware. Its own WebSocket server is not run: the
 * hub drives the controller in-process, and this file is the only one that knows the library -
 * the rest of the hub sees {@link MatterFabric}, which a test fakes.
 *
 * Its README calls the package internal to that server, so its version is pinned exactly and moved
 * on purpose. The controller listens on Matter's own UDP port, 5540, which the library does not let
 * be changed: another Matter controller on the same host takes it first.
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
  type CommissioningRequest,
} from '@matter-server/ws-controller';

import type {
  MATTER_DEVICE_NETWORKS,
  MATTER_LINK_STRENGTHS,
  MATTER_NETWORK_KINDS,
  MATTER_NETWORKS,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';
import type { MatterNodeSnapshot, MatterUpdateOffer } from '@nebulahome/package-runtime';

/** The log destination commissioning steps are read from while one runs. */
const STEPS_DESTINATION = 'commissioning-steps';

/** The network a new device joins. */
export type MatterDeviceNetwork = (typeof MATTER_DEVICE_NETWORKS)[number];

/**
 * What a new device - never set up, or reset - is commissioned with: found over Bluetooth, then
 * given the house's Wi-Fi or Thread network, whichever it takes.
 */
export type MatterNewDevice = {
  /** The Wi-Fi saved or typed; null when there is none. */
  readonly wifi: { readonly ssid: string; readonly password: string } | null;

  /** The house's Thread network's active dataset, as TLV hex; null when Matter has none. */
  readonly threadDataset: string | null;

  /** Told the network the device takes, once the controller says. */
  readonly onNetwork: (network: MatterDeviceNetwork) => void;
};

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

/** One direction of a link, as the end that saw it reported it. */
type TopologyDirection = { readonly lqi?: number; readonly rssi?: number };

/**
 * The fabric's network as the controller works it out from what its nodes report - Thread
 * neighbour tables, Wi-Fi BSSIDs - in the controller's own names.
 */
export type FabricTopology = {
  /** When it was put together, in epoch milliseconds. */
  readonly collected_at: number;
  readonly nodes: readonly {
    readonly id: string;
    readonly kind: (typeof MATTER_NETWORK_KINDS)[number];
    readonly network_type: (typeof MATTER_NETWORKS)[number];
    readonly node_id?: number | string;
    readonly role?: string;
    readonly available?: boolean;
    readonly is_bridge?: boolean;
    readonly ext_address?: string;

    /** The Thread network's name, or a Wi-Fi access point's BSSID. */
    readonly network_name?: string;
  }[];
  readonly connections: readonly {
    readonly source: string;
    readonly target: string;
    readonly network: 'thread' | 'wifi';
    readonly strength: (typeof MATTER_LINK_STRENGTHS)[number];
    readonly source_to_target?: TopologyDirection;
    readonly target_to_source?: TopologyDirection;
  }[];
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
   * Commissions a node: one shared by another app, over the network it is on; or a new device,
   * over Bluetooth, onto a network.
   *
   * @param code - Its manual pairing code or QR text.
   * @param onStep - Told the number of each commissioning step as it starts.
   * @param newDevice - For a new device, the networks it may be given.
   * @returns The new node's id.
   */
  readonly commission: (
    code: string,
    onStep?: (step: number) => void,
    newDevice?: MatterNewDevice,
  ) => Promise<string>;

  /** Takes a node off the fabric. */
  readonly decommission: (nodeId: string) => Promise<void>;

  readonly invoke: (nodeId: string, request: MatterInvoke) => Promise<void>;
  readonly write: (nodeId: string, request: MatterWrite) => Promise<void>;

  /** Asks the DCL whether newer firmware is on offer for a node. */
  readonly checkUpdate: (nodeId: string) => Promise<MatterUpdateOffer>;

  /** Has a node fetch and apply a firmware version. */
  readonly installUpdate: (nodeId: string, softwareVersion: number) => Promise<void>;

  /** The network as the nodes last reported it: read from the cache, nothing is asked of them. */
  readonly topology: () => FabricTopology;

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

  /**
   * Whether the controller may look for devices over Bluetooth: only while the server's adapter
   * can connect. noble reaches BlueZ over D-Bus (`NOBLE_BINDINGS=dbus`), beside the Bluetooth
   * broker.
   */
  readonly ble?: boolean;

  /** Whether the house has Thread: the controller then looks for border routers for the map. */
  readonly threadDiagnostics?: boolean;
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
 * Which network a line of matter.js's commissioning log says the device takes: the one it is
 * configured on, or the other of the one it does not support.
 *
 * shortcut: read from matter.js's debug log, since the engine says nothing else of the device's
 * network interfaces before it fails; upgrade when ws-controller reports them.
 *
 * @param text - The line.
 * @returns The network, or undefined for any other line.
 */
export function deviceNetworkOf(text: string): MatterDeviceNetwork | undefined {
  if (/Configuring WiFi network|does not support any Thread network interface/u.test(text)) {
    return 'wifi';
  }

  return /Configuring Thread network|does not support any WiFi network interface/u.test(text)
    ? 'thread'
    : undefined;
}

/**
 * Whether a commissioning failed because the device was given no network to join.
 *
 * @param message - Why it failed.
 * @returns True when no Wi-Fi or Thread credentials were configured.
 */
export function isMissingNetworkFailure(message: string): boolean {
  return /No Wi-Fi\/Thread network credentials are configured/iu.test(message);
}

/**
 * What the controller is asked to commission: a shared device over the network only; a new one
 * over Bluetooth as well, with the networks there are for it.
 *
 * @param nodeId - The node id it gets.
 * @param code - Its pairing code.
 * @param newDevice - For a new device, its networks.
 * @returns The request.
 */
export function commissionRequestOf(
  nodeId: NodeId,
  code: string,
  newDevice?: Pick<MatterNewDevice, 'wifi' | 'threadDataset'>,
): CommissioningRequest {
  const request = code.startsWith('MT:') ? { qrCode: code } : { manualCode: code };

  if (newDevice === undefined) {
    return { nodeId, onNetworkOnly: true, ...request };
  }

  return {
    nodeId,
    onNetworkOnly: false,
    ...request,
    ...(newDevice.wifi === null
      ? {}
      : {
          wifiCredentials: {
            wifiSsid: newDevice.wifi.ssid,
            wifiCredentials: newDevice.wifi.password,
          },
        }),
    ...(newDevice.threadDataset === null
      ? {}
      : { threadCredentials: { operationalDataset: newDevice.threadDataset } }),
  };
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

/** What the controller says of a node, as {@link readNode} reads it. */
type NodeDetails = {
  readonly node_id: unknown;
  readonly available: boolean;
  readonly attributes: unknown;
  readonly date_commissioned: string;
};

/**
 * One node, as the hub reads it. A node the controller cannot describe - one still being set up
 * has no commissioning state yet, and its details throw - is listed unavailable, with nothing read,
 * rather than breaking every other node.
 *
 * @param nodeId - The node, in decimal.
 * @param details - Reads the controller's details of it.
 * @param onFailure - Told why, when they did not read.
 * @returns The node.
 */
export function readNode(
  nodeId: string,
  details: () => NodeDetails,
  onFailure: (error: unknown) => void,
): FabricNode {
  try {
    const read = details();
    const commissionedAt = new Date(read.date_commissioned);

    return {
      nodeId: String(read.node_id),
      isAvailable: read.available,
      attributes: jsonSafe(read.attributes) as Record<string, unknown>,
      commissionedAt: Number.isNaN(commissionedAt.getTime()) ? null : commissionedAt,
    };
  } catch (error: unknown) {
    onFailure(error);

    return { nodeId, isAvailable: false, attributes: {}, commissionedAt: null };
  }
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
  // Set either way: the environment is the process's, and outlives a controller opened with it.
  environment.vars.set('ble.enable', options.ble === true);

  const config = await ConfigStorage.create(environment);
  const controller = await MatterController.create(environment, config, {
    serverVersion: version,
    // Without Thread, no border router to look for, and nothing to probe for one.
    disableThreadDiagnostics: options.threadDiagnostics !== true,
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

  /** The nodes whose details did not read, said once each. */
  const unreadable = new Set<string>();

  /**
   * One node, as the hub reads it.
   *
   * @param nodeId - The node.
   * @returns It, or undefined when the fabric has none of that id.
   */
  const nodeOf = (nodeId: NodeId): FabricNode | undefined =>
    handler.hasNode(nodeId)
      ? readNode(
          String(nodeId),
          () => handler.getNodeDetails(nodeId),
          (error) => {
            if (!unreadable.has(String(nodeId))) {
              unreadable.add(String(nodeId));
              logger.warn(
                { err: error, nodeId: String(nodeId) },
                "A Matter node's details did not read",
              );
            }
          },
        )
      : undefined;

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
     * Commissions a node, with an id of its own.
     *
     * @param code - Its pairing code.
     * @param onStep - Told each step as it starts.
     * @param newDevice - For a new device, its networks, and who to tell which it takes.
     * @returns The node's id.
     */
    commission: async (code, onStep, newDevice) => {
      const nodeId = NodeId(
        await config.allocateNodeId((candidate) => handler.isNodeIdInUse(NodeId(candidate))),
      );

      // The certificates load from the DCL behind the start, which waits for none of it; an
      // attestation before they did fails with "DclCertificateService is still initializing".
      await controller.certificateService();

      // Heard only while it runs: matter.js says a line a packet at info. The commissioner's own
      // lines at debug say which network a new device takes.
      Logger.destinations[STEPS_DESTINATION] = LogDestination({
        name: STEPS_DESTINATION,
        level: LogLevel.INFO,
        facilityLevels: newDevice === undefined ? {} : { ControllerCommissioner: LogLevel.DEBUG },

        /**
         * Reads a step, or a new device's network, out of a line.
         *
         * @param text - The line.
         */
        write: (text) => {
          const step = commissioningStepOf(text);
          const network = newDevice === undefined ? undefined : deviceNetworkOf(text);

          if (step !== undefined) {
            onStep?.(step);
          }

          if (network !== undefined) {
            newDevice?.onNetwork(network);
          }
        },
      });

      try {
        const committed = await handler.commissionNode(
          commissionRequestOf(nodeId, code, newDevice),
        );

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
     * Works the network out from the nodes' cached diagnostics; the service behind it is made the
     * first time it is asked for, and closes with the controller.
     *
     * @returns The network.
     */
    topology: () => jsonSafe(controller.networkTopology.getTopology()) as FabricTopology,

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
