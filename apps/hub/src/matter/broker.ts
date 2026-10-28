/**
 * The house's Matter broker, as the hub runs it: the fabric, what is commissioned into it, and what
 * the owner took out of the house.
 *
 * It opens the fabric once the hub starts - and the hub starts without it when it cannot, the
 * Brokers page then saying why - and hands the rest of the hub what it needs: every device of
 * every node for discovery to propose, each node's attributes as they change for the `matter`
 * transport, commissioning for the page, and the firmware on offer, asked of the DCL once a day.
 *
 * **Removed is remembered.** A device the owner removes from the house leaves the house's list
 * of devices; its node stays on the fabric while another device of it - another endpoint behind
 * the bridge - is still in the house, and leaves the fabric with the last of them. Until then the
 * hub remembers it as removed (`removed.json`, beside the fabric), so discovery does not add it
 * back on its own, and the page can bring it back.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ManualPairingCodeCodec, QrPairingCodeCodec } from '@matter/main/types';

import {
  ConflictError,
  DeviceUnavailableError,
  MATTER_COMMISSIONING_STEPS,
  MATTER_NEW_DEVICE_STEPS,
  MATTER_PORT,
  type MatterCommissioning,
  type MatterCommissioningStep,
  type MatterCommissionMode,
  type BrokerState,
  type MatterNetwork,
  type MatterNetworks,
  type MatterNetworksSaveRequest,
  type MatterQuestion,
  type MatterStatus,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';
import {
  attributeOf,
  CLUSTER,
  deviceSnapshotOf,
  matterDeviceKey,
  scopesOf,
  serves,
  type MatterAttributes,
  type MatterDeviceSnapshot,
  type MatterUpdateOffer,
} from '@nebulahome/package-runtime';

import type { BluetoothBroker } from '../bluetooth/broker.js';
import type { MatterNetworksStore, MatterWifi } from '../persistence/matter.js';

import {
  isMissingNetworkFailure,
  isTestCertificateFailure,
  MATTER_ENGINE,
  type FabricNode,
  type MatterDeviceNetwork,
  type MatterFabric,
  type MatterInvoke,
  type MatterNewDevice,
  type MatterWrite,
  type OpenMatterFabric,
} from './fabric.js';

/** How often the DCL is asked for firmware on offer. */
const UPDATE_CHECK_MS = 24 * 60 * 60 * 1000;

/** How long after the start the first ask waits: the nodes are still connecting. */
const FIRST_UPDATE_CHECK_MS = 2 * 60 * 1000;

/** The file the devices removed from the house are remembered in. */
const REMOVED_FILE = 'removed.json';

/** The file the fabric's own facts are kept in: when this hub made it. */
const FABRIC_FILE = 'fabric.json';

/** How long a pairing code is kept for the owner to answer about a test certificate. */
const ANSWER_WITHIN_MS = 10 * 60 * 1000;

/** How long a device on the fabric has to be in the house before its job ends anyway. */
const IN_HOUSE_WITHIN_MS = 2 * 60 * 1000;

/** Network Commissioning, and its list of networks: `{ 0: network id, 1: connected }`. */
const NETWORK_COMMISSIONING = 49;
const NETWORKS = 1;

/** Thread Network Diagnostics, and its channel. */
const THREAD_DIAGNOSTICS = 53;
const THREAD_CHANNEL = 0;

/** Wi-Fi Network Diagnostics, and its channel. */
const WIFI_DIAGNOSTICS = 54;
const WIFI_CHANNEL = 3;

/**
 * The Wi-Fi network a station is connected to: for Wi-Fi the network id is the SSID, which the
 * controller hands over as base64.
 *
 * @param attributes - The station's.
 * @returns The SSID, or null when it does not say.
 */
export function ssidOf(attributes: MatterAttributes): string | null {
  const networks = attributeOf(attributes, 0, NETWORK_COMMISSIONING, NETWORKS);
  const connected = Array.isArray(networks)
    ? (networks as unknown[]).find(
        (network) => (network as Record<string, unknown> | null)?.['1'] === true,
      )
    : undefined;
  const id = (connected as Record<string, unknown> | undefined)?.['0'];

  return typeof id === 'string' && id !== '' ? Buffer.from(id, 'base64').toString('utf8') : null;
}

/** Why a new device cannot be paired over the server's Bluetooth, in words. */
const BLE_PROBLEMS: Readonly<Record<NonNullable<MatterStatus['ble']>['reason'] & string, string>> =
  {
    'no-adapter': 'this server has no Bluetooth adapter',
    'adapter-off': "the server's Bluetooth adapter is off",
    'proxies-only': 'Bluetooth proxies cannot pair devices',
    desktop: 'Docker Desktop passes no Bluetooth through',
  };

/**
 * The steps of a commissioning, as the job starts: the code read and the device being looked
 * for on the network; or, a new device, looked for over Bluetooth.
 *
 * @param code - The pairing code, checked.
 * @param mode - By a shared code, or a new device.
 * @returns The steps.
 */
function freshSteps(code: string, mode: MatterCommissionMode): MatterCommissioningStep[] {
  const isQrCode = code.startsWith('MT:');
  const first = mode === 'new' ? 'looking' : 'code';
  const running = mode === 'new' ? 'looking' : 'found';

  return (mode === 'new' ? MATTER_NEW_DEVICE_STEPS : MATTER_COMMISSIONING_STEPS).map((id) => ({
    id,
    state: id === running ? 'running' : id === 'code' ? 'done' : 'pending',
    detail: {
      discriminator: id === first ? discriminatorOf(code) : null,
      isQrCode: id === first && isQrCode,
      address: null,
      product: null,
      vendorId: null,
      productId: null,
    },
  }));
}

/**
 * The discriminator a pairing code carries: the device's whole one in a QR code's text, the upper
 * four bits of it in a manual code.
 *
 * @param code - The code, checked.
 * @returns The discriminator, or null when the code does not decode.
 */
export function discriminatorOf(code: string): number | null {
  try {
    if (code.startsWith('MT:')) {
      return QrPairingCodeCodec.decode(code)[0]?.discriminator ?? null;
    }

    const manual = ManualPairingCodeCodec.decode(code);

    return (
      manual.discriminator ??
      (manual.shortDiscriminator === undefined ? null : manual.shortDiscriminator << 8)
    );
  } catch {
    return null;
  }
}

/**
 * The steps after one started: those before it done, it running.
 *
 * @param steps - The steps as they were.
 * @param running - The step that started.
 * @returns The steps as they are.
 */
function advance(
  steps: readonly MatterCommissioningStep[],
  running: MatterCommissioningStep['id'],
): MatterCommissioningStep[] {
  const at = steps.findIndex((step) => step.id === running);

  if (at === -1) {
    return [...steps];
  }

  return steps.map((step, index) => {
    if (index < at) {
      // A test certificate accepted stays said.
      return step.state === 'warning' ? step : { ...step, state: 'done' };
    }

    return index === at ? { ...step, state: 'running' } : step;
  });
}

/**
 * Which step a step of matter.js's commissioning is.
 *
 * @param step - Its number.
 * @param mode - By a shared code, or a new device.
 * @returns The step the page shows.
 */
function stepOf(step: number, mode: MatterCommissionMode): MatterCommissioningStep['id'] {
  if (mode === 'new') {
    // Any step means the device answered over Bluetooth; step 16 gives it its network, and from
    // step 18 on it is reached on that network, joining the fabric.
    return step < 16 ? 'found' : step < 18 ? 'network' : 'joining';
  }

  // Up to the attestation (step 10), the device was found and its certificate is being checked;
  // after it, it is joining the fabric.
  return step <= 10 ? 'certificate' : 'joining';
}

/** A commissioning stopped on a question, waiting for the owner. */
type Pending = { readonly jobId: string; readonly code: string; readonly timer: NodeJS.Timeout };

/** One device of a node, for discovery. */
export type MatterSighting = {
  /** `<node>` or `<node>:<endpoint>`: the device's external id. */
  readonly deviceKey: string;
  readonly device: MatterDeviceSnapshot;
};

/** Something the broker tells as it happens. */
type NodeListener = (nodeId: string, paths: readonly string[] | null) => void;

/** What the broker needs. */
export type MatterBrokerOptions = {
  /** Opens the fabric; undefined where the deployment runs no Matter. */
  readonly open: OpenMatterFabric | undefined;

  /** Where the fabric is kept. */
  readonly storageDir: string;

  readonly logger: PlatformLogger;
  readonly version: string;

  /** Whether the hub hears the house's network, which Matter needs. */
  readonly isLanReachable: boolean;

  /** The external ids of the Matter devices the house has, removed ones included until they go. */
  readonly inHouse: () => Promise<ReadonlySet<string>>;

  /** The server's Bluetooth, which pairs new devices; none where it is not given. */
  readonly bluetooth?: Pick<BluetoothBroker, 'canConnect' | 'markPairing' | 'onAdapterOff'>;

  /** The Wi-Fi a new device is given. */
  readonly networks?: MatterNetworksStore;

  /** The house's Thread network, as the Thread broker hands it to Matter. */
  readonly thread?: {
    /** Whether Thread is set up: the controller then looks for border routers. */
    readonly isSetUp: () => boolean;

    /** The active dataset, TLV hex; null when Matter is not handed the network. */
    readonly dataset: () => Promise<string | null>;

    /** Its name and channel, for Matter's Settings; null when Matter is not handed it. */
    readonly network: () => Promise<{ networkName: string; channel: number } | null>;
  };
};

/** What the controller was opened with, besides test certificates. */
type OpenedWith = { readonly ble: boolean; readonly threadDiagnostics: boolean };

/**
 * What is thrown when something is asked of a fabric that is not there.
 *
 * @param state - Where the broker stands.
 * @param error - Why it failed, if it did.
 * @returns The error, saying why.
 */
function notRunning(state: BrokerState, error: string | null): Error {
  return new ConflictError(
    state === 'disabled'
      ? 'Matter is off on this installation'
      : `Matter is not running${error === null ? '' : `: ${error}`}`,
  );
}

/** The house's Matter broker. */
export class MatterBroker {
  readonly #options: MatterBrokerOptions;
  readonly #nodeListeners = new Set<NodeListener>();
  readonly #nodesListeners = new Set<() => void>();
  readonly #removed = new Set<string>();
  readonly #offers = new Map<string, MatterUpdateOffer>();
  readonly #timers: NodeJS.Timeout[] = [];

  /** The nodes leaving the fabric, so a second ask joins the first. */
  readonly #leaving = new Map<string, Promise<boolean>>();

  /** Since when each node has not answered, as this hub saw it. */
  readonly #offlineSince = new Map<string, Date>();
  #fabric: MatterFabric | undefined;
  #state: BrokerState;
  #error: string | null = null;
  #job: MatterCommissioning | null = null;
  #pending: Pending | undefined;
  #startedAt: Date | null = null;
  #fabricCreatedAt: Date | null = null;

  /** When the job's device joined the fabric, to give it a while to be in the house. */
  #joinedAt: Date | null = null;

  /** The last time the controller was opened again, so the next waits for it. */
  #reopening: Promise<void> = Promise.resolve();

  /** What the open controller was opened with; undefined while none is. */
  #openedWith: OpenedWith | undefined;

  /** The Wi-Fi the owner typed for the job of a new device, which its next run is given. */
  #typedWifi: MatterWifi | null = null;

  /**
   * Keeps the options; nothing opens until {@link MatterBroker.start}.
   *
   * @param options - See {@link MatterBrokerOptions}.
   */
  public constructor(options: MatterBrokerOptions) {
    this.#options = options;
    this.#state = options.open === undefined ? 'disabled' : 'starting';
    options.bluetooth?.onAdapterOff(() => {
      void this.refresh();
    });
  }

  /**
   * Opens the fabric, and starts asking for firmware. A fabric that does not open leaves the
   * broker failed, with why, and the hub running.
   *
   * @returns Once it is open or has failed.
   */
  public async start(): Promise<void> {
    const { open, storageDir, logger } = this.#options;

    if (open === undefined) {
      return;
    }

    try {
      await mkdir(storageDir, { recursive: true });

      // A folder holding nothing of the controller's is a fabric about to be made here.
      const isNew = (await readdir(storageDir)).every(
        (name) => name === REMOVED_FILE || name === FABRIC_FILE,
      );

      await this.#readRemoved();
      this.#fabric = await this.#open(false);
      this.#state = 'running';
      this.#startedAt = new Date();
      this.#fabricCreatedAt = await this.#readFabricDate(isNew);
      logger.info(
        { fabricId: this.#fabric.fabricId, nodes: this.#fabric.nodes().length },
        'The Matter fabric is open',
      );
    } catch (error: unknown) {
      this.#state = 'failed';
      this.#error = error instanceof Error ? error.message : String(error);
      logger.error({ err: error }, 'The Matter fabric did not open; Matter devices are off');

      return;
    }

    const first = setTimeout(() => {
      void this.#checkUpdates();
    }, FIRST_UPDATE_CHECK_MS);
    const daily = setInterval(() => {
      void this.#checkUpdates();
    }, UPDATE_CHECK_MS);

    first.unref();
    daily.unref();
    this.#timers.push(first, daily);
    this.#tellNodes();

    // A node removed while the fabric was closed, or that did not answer then, leaves it now.
    for (const node of this.nodes()) {
      void this.#leaveIfGone(node.nodeId);
    }
  }

  /**
   * Opens the fabric through the controller.
   *
   * @param acceptTestCertificates - Whether devices with a test certificate are taken too.
   * @returns The fabric.
   * @throws {Error} When there is no controller to open.
   */
  async #open(acceptTestCertificates: boolean): Promise<MatterFabric> {
    const { open, storageDir, logger, version } = this.#options;

    if (open === undefined) {
      throw notRunning(this.#state, this.#error);
    }

    const wanted = this.#wanted();
    const fabric = await open({
      storageDir,
      logger,
      version,
      acceptTestCertificates,
      ble: wanted.ble,
      threadDiagnostics: wanted.threadDiagnostics,
      events: {
        /**
         * Hands a node's change on.
         *
         * @param nodeId - The node.
         * @param paths - What changed, or null for all of it.
         */
        onNode: (nodeId, paths) => {
          this.#tellNode(nodeId, paths);

          // Answering again, a node removed while it did not can leave the fabric now.
          if (paths === null) {
            void this.#leaveIfGone(nodeId);
          }
        },

        /** Tells discovery the nodes changed. */
        onNodes: () => {
          this.#tellNodes();
        },
      },
    });

    this.#openedWith = wanted;

    return fabric;
  }

  /**
   * What the controller should be opened with now: Bluetooth while the server's adapter can
   * connect, Thread's diagnostics once Thread is set up.
   *
   * @returns The options.
   */
  #wanted(): OpenedWith {
    return {
      ble: this.bleStatus().isAvailable,
      threadDiagnostics: this.#options.thread?.isSetUp() === true,
    };
  }

  /**
   * Opens the controller again when what it was opened with is no longer what it should be: the
   * adapter came or went, Thread was set up or removed. Never under a device being added, but for
   * the job that asks.
   *
   * @param isForJob - Whether the job under way asks, before it pairs over Bluetooth.
   * @returns Once open again, or left as it was; never throws.
   */
  public async refresh(isForJob = false): Promise<void> {
    const wanted = this.#wanted();
    const opened = this.#openedWith;
    const isBusy = this.#job?.state === 'running' || this.#job?.state === 'needs-answer';

    if (
      this.#fabric === undefined ||
      opened === undefined ||
      (opened.ble === wanted.ble && opened.threadDiagnostics === wanted.threadDiagnostics) ||
      (isBusy && !isForJob)
    ) {
      return;
    }

    this.#options.logger.info(wanted, 'Opening the Matter controller again with what it can use');
    await this.#reopenAsWas();
  }

  /**
   * Whether a new device can be paired over the server's Bluetooth now.
   *
   * @returns The answer, and why not.
   */
  public bleStatus(): NonNullable<MatterStatus['ble']> {
    return this.#options.bluetooth?.canConnect() ?? { isAvailable: false, reason: 'no-adapter' };
  }

  /**
   * The networks a new device is given: the Wi-Fi saved, never its password, and the house's
   * Thread network when it is handed to Matter.
   *
   * @returns Them.
   */
  public async networks(): Promise<MatterNetworks> {
    const [wifi, thread] = await Promise.all([
      this.#options.networks?.wifi() ?? null,
      this.#options.thread?.network() ?? null,
    ]);

    return {
      wifi: { ssid: wifi?.ssid ?? null, hasPassword: (wifi?.password ?? null) !== null },
      thread,
    };
  }

  /**
   * Saves the Wi-Fi a new device is given, or forgets it.
   *
   * @param request - The Wi-Fi; a password left out keeps the saved one; null forgets it.
   * @returns The networks, as they now are.
   * @throws {ConflictError} Where the hub keeps no networks.
   */
  public async saveNetworks(request: MatterNetworksSaveRequest): Promise<MatterNetworks> {
    if (this.#options.networks === undefined) {
      throw new ConflictError('Networks for new devices are not kept here');
    }

    await this.#options.networks.saveWifi(request.wifi);

    return this.networks();
  }

  /**
   * Closes the fabric.
   *
   * @returns Once it is closed.
   */
  public async stop(): Promise<void> {
    for (const timer of this.#timers) {
      clearTimeout(timer);
    }

    this.#timers.length = 0;

    if (this.#pending !== undefined) {
      clearTimeout(this.#pending.timer);
      this.#pending = undefined;
    }

    await this.#fabric?.stop();
    this.#fabric = undefined;
    this.#openedWith = undefined;
  }

  /**
   * Closes the controller and opens it again, as the hub's start does.
   *
   * @returns Once it is open or has failed.
   * @throws {ConflictError} While a device is being added.
   */
  public async restart(): Promise<void> {
    if (this.#job?.state === 'running' || this.#job?.state === 'needs-answer') {
      throw new ConflictError('A device is being added; wait for it to finish');
    }

    await this.#reopening;
    await this.stop();

    if (this.#options.open !== undefined) {
      this.#state = 'starting';
      this.#error = null;
    }

    await this.start();
  }

  /**
   * Where the broker stands, the job of a device being added brought up to date: on the fabric
   * and read, it is in the house once a device was added for it.
   *
   * @param deviceOf - The device added for a node, if any, by its id.
   * @returns Its state, for the Brokers page.
   */
  public status(deviceOf: (nodeId: string) => string | undefined = () => undefined): MatterStatus {
    const nodes = this.nodes();

    this.#settle(deviceOf);

    return {
      state: this.#state,
      error: this.#error,
      fabricId: this.#fabric?.fabricId ?? null,
      isLanReachable: this.#options.isLanReachable,
      nodes: { total: nodes.length, online: nodes.filter((node) => node.isAvailable).length },
      commissioning: this.#job,
      startedAt: this.#state === 'running' ? this.#startedAt : null,
      controllerVersion: MATTER_ENGINE,
      port: MATTER_PORT,
      fabricCreatedAt: this.#fabricCreatedAt,
      ble: this.bleStatus(),
    };
  }

  /**
   * Since when a node has not answered, as this hub saw it.
   *
   * @param nodeId - The node.
   * @returns When it went quiet, or null while it answers.
   */
  public offlineSince(nodeId: string): Date | null {
    return this.#offlineSince.get(nodeId) ?? null;
  }

  /**
   * Brings the job of a device being added up to date with the fabric and the house.
   *
   * @param deviceOf - The device added for a node, if any.
   */
  #settle(deviceOf: (nodeId: string) => string | undefined): void {
    const job = this.#job;

    if (job?.state !== 'running' || job.nodeId === null) {
      return;
    }

    const node = this.node(job.nodeId);
    const isNew = job.mode === 'new';
    const reading = job.steps.find((step) => step.id === (isNew ? 'added' : 'reading'));
    const found = job.steps.find((step) => step.id === 'found');

    if (node !== undefined && reading?.state === 'running' && found?.detail.product === null) {
      const [root] = scopesOf(node.attributes);
      const product =
        root === undefined ? null : (deviceSnapshotOf(node, root).identity.productName ?? null);

      // A new device's last step is its being added; a shared one's, its being in the house.
      this.#job = {
        ...job,
        steps: (isNew ? job.steps : advance(job.steps, 'in-house')).map((step) =>
          step.id === 'found' ? { ...step, detail: { ...step.detail, product } } : step,
        ),
      };
    }

    const deviceId = deviceOf(job.nodeId);
    const current = this.#job;

    if (current === null) {
      return;
    }

    if (deviceId !== undefined) {
      this.#job = {
        ...current,
        state: 'succeeded',
        finishedAt: new Date(),
        deviceId,
        steps: current.steps.map((step) =>
          step.state === 'warning' ? step : { ...step, state: 'done' },
        ),
      };
    } else if (
      this.#joinedAt !== null &&
      Date.now() - this.#joinedAt.getTime() > IN_HOUSE_WITHIN_MS
    ) {
      // On the fabric, and no device came of it: the job ends, saying which step did not.
      this.#job = {
        ...current,
        state: 'succeeded',
        finishedAt: new Date(),
        steps: current.steps.map((step) =>
          step.id === (isNew ? 'added' : 'in-house') ? { ...step, state: 'failed' } : step,
        ),
      };
    }
  }

  /**
   * Says whether the fabric is open, as a transport's test does.
   *
   * @returns How many nodes it holds.
   * @throws {Error} When it is not open, with why.
   */
  public probe(): string {
    const nodes = this.#require().nodes();

    return `The house's Matter fabric is open with ${String(nodes.length)} node${nodes.length === 1 ? '' : 's'}`;
  }

  /**
   * Every node of the fabric.
   *
   * @returns Them; none while the fabric is not open.
   */
  public nodes(): FabricNode[] {
    const nodes = this.#fabric?.nodes() ?? [];

    // Kept as they are read: the page asks since when a node has not answered.
    for (const node of nodes) {
      if (node.isAvailable) {
        this.#offlineSince.delete(node.nodeId);
      } else if (!this.#offlineSince.has(node.nodeId)) {
        this.#offlineSince.set(node.nodeId, new Date());
      }
    }

    return nodes;
  }

  /**
   * One node.
   *
   * @param nodeId - The node.
   * @returns It, or undefined.
   */
  public node(nodeId: string): FabricNode | undefined {
    return this.#fabric?.node(nodeId);
  }

  /**
   * Every device of every node, but those removed from the house.
   *
   * @returns The devices.
   */
  public devices(): MatterSighting[] {
    return this.nodes().flatMap((node) =>
      scopesOf(node.attributes).flatMap((scope): MatterSighting[] => {
        const deviceKey = matterDeviceKey(node.nodeId, scope.endpoint);

        return this.#removed.has(deviceKey)
          ? []
          : [{ deviceKey, device: deviceSnapshotOf(node, scope) }];
      }),
    );
  }

  /**
   * Whether a device was removed from the house.
   *
   * @param deviceKey - The device.
   * @returns True while its node is on the fabric and it is not back.
   */
  public isRemoved(deviceKey: string): boolean {
    return this.#removed.has(deviceKey);
  }

  /**
   * The fabric's network as the controller works it out, with what the nodes' own diagnostics add:
   * the channel each is on, and the Wi-Fi network a station joined.
   *
   * @returns It; empty while the fabric is not open.
   */
  public network(): MatterNetwork {
    const topology = this.#fabric?.topology();

    if (topology === undefined) {
      return { collectedAt: null, nodes: [], links: [] };
    }

    return {
      collectedAt: new Date(topology.collected_at),
      nodes: topology.nodes.map((point) => {
        const nodeId = point.node_id === undefined ? null : String(point.node_id);
        const attributes = nodeId === null ? undefined : this.node(nodeId)?.attributes;
        const isWifi = point.network_type === 'wifi';
        const channel =
          attributes === undefined
            ? undefined
            : isWifi
              ? attributeOf(attributes, 0, WIFI_DIAGNOSTICS, WIFI_CHANNEL)
              : attributeOf(attributes, 0, THREAD_DIAGNOSTICS, THREAD_CHANNEL);

        return {
          id: point.id,
          kind: point.kind,
          network: point.network_type,
          nodeId,
          role: point.role ?? null,
          isAvailable: point.available ?? null,
          isBridge: point.is_bridge === true,
          networkName: point.kind === 'wifi_ap' ? null : (point.network_name ?? null),
          channel: typeof channel === 'number' ? channel : null,
          ssid: attributes !== undefined && isWifi ? ssidOf(attributes) : null,
          bssid: point.kind === 'wifi_ap' ? (point.network_name ?? null) : null,
          extAddress: point.ext_address ?? null,
        };
      }),
      links: topology.connections.map((link) => {
        // The end that measured more is the one shown; Thread's LQI is reported from either side.
        const [seen] = [link.source_to_target, link.target_to_source]
          .filter((each) => each !== undefined)
          .sort((one, other) => (other.rssi ?? -999) - (one.rssi ?? -999));

        return {
          source: link.source,
          target: link.target,
          network: link.network,
          strength: link.strength,
          lqi: seen?.lqi ?? null,
          rssi: seen?.rssi ?? null,
        };
      }),
    };
  }

  /**
   * The firmware on offer for a node.
   *
   * @param nodeId - The node.
   * @returns What the DCL offers, null for nothing newer, undefined before it was asked.
   */
  public offer(nodeId: string): MatterUpdateOffer | undefined {
    return this.#offers.get(nodeId);
  }

  /**
   * Follows every node's changes: what the transport delivers.
   *
   * @param listener - Called with the node and the paths that changed, or null for all of it.
   * @returns What stops following.
   */
  public onNode(listener: NodeListener): () => void {
    this.#nodeListeners.add(listener);

    return () => {
      this.#nodeListeners.delete(listener);
    };
  }

  /**
   * Follows nodes coming and going: what discovery reads again.
   *
   * @param listener - Called when they change.
   * @returns What stops following.
   */
  public onNodes(listener: () => void): () => void {
    this.#nodesListeners.add(listener);

    return () => {
      this.#nodesListeners.delete(listener);
    };
  }

  /**
   * Starts commissioning a node: shared by another app, over the network it is on; or a new
   * device, over the server's Bluetooth, onto the house's Wi-Fi or Thread network.
   *
   * @param code - Its pairing code, already checked.
   * @param mode - By a shared code, or a new device.
   * @returns The job, running.
   * @throws {Error} When the fabric is not open, or a commissioning runs already.
   * @throws {ConflictError} For a new device, when the server's Bluetooth cannot pair it.
   */
  public commission(code: string, mode: MatterCommissionMode = 'shared'): MatterCommissioning {
    const fabric = this.#require();

    if (this.#job?.state === 'running' || this.#job?.state === 'needs-answer') {
      throw new ConflictError('A device is being added already; wait for it to finish');
    }

    const ble = this.bleStatus();

    if (mode === 'new' && !ble.isAvailable) {
      throw new ConflictError(
        `A new device pairs over this server's Bluetooth, and ${BLE_PROBLEMS[ble.reason ?? 'no-adapter']}`,
      );
    }

    const job: MatterCommissioning = {
      id: randomUUID(),
      state: 'running',
      mode,
      startedAt: new Date(),
      finishedAt: null,
      nodeId: null,
      error: null,
      steps: freshSteps(code, mode),
      deviceId: null,
    };

    this.#job = job;
    this.#joinedAt = null;
    this.#typedWifi = null;
    this.#options.logger.info({ job: job.id, mode }, 'Commissioning a Matter device');
    void (mode === 'new' ? this.#runNew(job.id, code) : this.#run(job.id, code, fabric, false));

    return job;
  }

  /**
   * Answers the question a commissioning stopped on. A test certificate: yes opens the controller
   * again taking test certificates, adds the device with the same code, and opens it again as it
   * was; meanwhile the house's Matter devices are out of reach for a few seconds. A new device's
   * Wi-Fi: the network typed, with which it is looked for again. Thread not set up: only no.
   *
   * @param jobId - The job.
   * @param isAccepted - Whether to add it anyway, or with the Wi-Fi given.
   * @param wifi - The Wi-Fi typed, for a device that needs one.
   * @param wifi.ssid - Its name.
   * @param wifi.password - Its password.
   * @param wifi.isSaved - Whether it is kept for the next device.
   * @returns The job, as it now stands.
   * @throws {ConflictError} When nothing waits for that answer.
   */
  public answer(
    jobId: string,
    isAccepted: boolean,
    wifi?: { ssid: string; password: string; isSaved: boolean },
  ): MatterCommissioning {
    const job = this.#job;
    const pending = this.#pending;

    if (job?.id !== jobId || job.state !== 'needs-answer' || pending?.jobId !== jobId) {
      throw new ConflictError('Nothing waits for that answer');
    }

    clearTimeout(pending.timer);
    this.#pending = undefined;

    const { question, ...asked } = job;

    if (question === 'needs-wifi' || question === 'needs-thread') {
      if (!isAccepted || question === 'needs-thread' || wifi === undefined) {
        this.#job = { ...asked, state: 'cancelled', finishedAt: new Date() };

        return this.#job;
      }

      this.#typedWifi = { ssid: wifi.ssid, password: wifi.password };
      this.#job = { ...asked, state: 'running', steps: advance(asked.steps, 'network') };
      void this.#withWifi(jobId, pending.code, wifi.isSaved);

      return this.#job;
    }

    if (!isAccepted) {
      this.#job = {
        ...asked,
        state: 'failed',
        finishedAt: new Date(),
        error: 'Not added: its certificate is a test one',
      };

      return this.#job;
    }

    this.#job = { ...asked, state: 'running', steps: advance(asked.steps, 'joining') };
    void this.#withTestCertificates(jobId, pending.code);

    return this.#job;
  }

  /**
   * Stops adding a device before it joined the fabric. A question waiting is answered no; a
   * commissioning under way is cut off by opening the controller again, and the device, never
   * told it is done, rolls back once its fail-safe runs out. Once it joined, it carries on.
   *
   * @param jobId - The job.
   * @returns The job, as it now stands.
   * @throws {ConflictError} When that job is not the one under way.
   */
  public cancel(jobId: string): MatterCommissioning {
    const job = this.#job;

    if (job?.id !== jobId) {
      throw new ConflictError('No such device is being added');
    }

    if (job.state === 'needs-answer') {
      return this.answer(jobId, false);
    }

    if (job.state !== 'running' || job.nodeId !== null) {
      return job;
    }

    this.#job = {
      ...job,
      state: 'cancelled',
      finishedAt: new Date(),
      steps: job.steps.map((step) =>
        step.state === 'running' ? { ...step, state: 'pending' } : step,
      ),
    };
    this.#options.logger.info({ job: jobId }, 'Adding a Matter device was cancelled');
    void this.#reopenAsWas();

    return this.#job;
  }

  /**
   * Whether a job was stopped under its commissioning: cancelled, or cut off on a question.
   *
   * @param jobId - The job.
   * @returns True when it is the broker's job, cancelled or waiting for an answer.
   */
  #isStopped(jobId: string): boolean {
    return (
      this.#job?.id === jobId &&
      (this.#job.state === 'cancelled' || this.#job.state === 'needs-answer')
    );
  }

  /**
   * Adds a device with the controller taking test certificates, then opens it again as it was.
   *
   * @param jobId - The job.
   * @param code - The device's pairing code.
   * @returns Once the controller is as it was.
   */
  async #withTestCertificates(jobId: string, code: string): Promise<void> {
    try {
      await this.#reopen(true);

      if (!this.#isStopped(jobId)) {
        await this.#run(jobId, code, this.#require(), true);
      }
    } catch (error: unknown) {
      this.#fail(jobId, error);
    } finally {
      await this.#reopenAsWas();
    }
  }

  /**
   * Adds a new device: the controller opened with Bluetooth first, when it was not.
   *
   * @param jobId - The job.
   * @param code - The device's pairing code.
   * @returns Once the device joined, failed, or waits for the owner's answer.
   */
  async #runNew(jobId: string, code: string): Promise<void> {
    try {
      await this.refresh(true);

      if (!this.#isStopped(jobId)) {
        await this.#run(jobId, code, this.#require(), false);
      }
    } catch (error: unknown) {
      this.#fail(jobId, error);
    }
  }

  /**
   * Looks for a new device again with the Wi-Fi the owner typed, once the controller cut off for
   * the question is open again; saved first when they asked.
   *
   * @param jobId - The job.
   * @param code - The device's pairing code.
   * @param isSaved - Whether the Wi-Fi is kept for the next device.
   * @returns Once the device joined, failed, or waits for another answer.
   */
  async #withWifi(jobId: string, code: string, isSaved: boolean): Promise<void> {
    const wifi = this.#typedWifi;

    if (isSaved && wifi !== null) {
      // Not saving it does not stop this device: it is told again next time.
      await this.#options.networks
        ?.saveWifi({ ssid: wifi.ssid, password: wifi.password ?? undefined })
        .catch((error: unknown) => {
          this.#options.logger.warn({ err: error }, 'Could not save the Wi-Fi for new devices');
        });
    }

    await this.#reopening;
    await this.#runNew(jobId, code);
  }

  /**
   * Stops a job on a question for the owner, kept for a while for their answer.
   *
   * @param jobId - The job.
   * @param code - Its pairing code, to commission again with.
   * @param question - What it asks.
   * @param steps - How its steps stand while it waits.
   */
  #ask(
    jobId: string,
    code: string,
    question: MatterQuestion,
    steps: (step: MatterCommissioningStep) => MatterCommissioningStep,
  ): void {
    this.#pending = {
      jobId,
      code,
      timer: setTimeout(() => {
        this.#pending = undefined;
        this.#fail(
          jobId,
          new Error(
            question === 'test-certificate'
              ? "No answer came in time: share it again from the maker's app"
              : 'No answer came in time: add the device again',
          ),
        );
      }, ANSWER_WITHIN_MS),
    };
    this.#pending.timer.unref();
    this.#update(jobId, (job) => ({
      ...job,
      state: 'needs-answer',
      question,
      steps: job.steps.map((step) => {
        const changed = steps(step);

        return changed === step && step.state === 'running'
          ? { ...step, state: 'pending' }
          : changed;
      }),
    }));
    this.#options.logger.info({ job: jobId, question }, 'A Matter commissioning asks the owner');
  }

  /**
   * Hears which network a new device takes: the Found step says it, and a device needing a
   * network Matter has none of is cut off with a question.
   *
   * @param jobId - The job.
   * @param code - Its pairing code.
   * @param network - The network the device takes.
   * @param given - What the commissioning was given.
   */
  #onNetwork(
    jobId: string,
    code: string,
    network: MatterDeviceNetwork,
    given: Pick<MatterNewDevice, 'wifi' | 'threadDataset'>,
  ): void {
    const job = this.#job;
    const found = job?.steps.find((step) => step.id === 'found');

    if (job?.id !== jobId || job.state !== 'running' || found?.detail.network !== undefined) {
      return;
    }

    const isMissing = network === 'wifi' ? given.wifi === null : given.threadDataset === null;
    const said = job.steps.map((step) =>
      step.id === 'found'
        ? { ...step, state: 'done' as const, detail: { ...step.detail, network } }
        : step,
    );

    this.#job = { ...job, steps: isMissing ? said : advance(said, 'network') };

    if (isMissing) {
      this.#ask(jobId, code, network === 'wifi' ? 'needs-wifi' : 'needs-thread', (step) => step);
      // The device would wait for a network it is not given: the commissioning is cut off.
      void this.#reopenAsWas();
    }
  }

  /**
   * Opens the controller again as it was, taking no test certificates; one that does not open
   * leaves the broker failed, with why.
   *
   * @returns Once it is open or has failed.
   */
  async #reopenAsWas(): Promise<void> {
    await this.#reopen(false).catch((error: unknown) => {
      this.#state = 'failed';
      this.#error = error instanceof Error ? error.message : String(error);
      this.#options.logger.error({ err: error }, 'The Matter fabric did not open again');
    });
  }

  /**
   * Closes the fabric and opens it again, once the last time it was is done: two at once would
   * both take the controller's port.
   *
   * @param acceptTestCertificates - Whether devices with a test certificate are taken.
   * @returns Once it is open.
   */
  async #reopen(acceptTestCertificates: boolean): Promise<void> {
    const reopened = this.#reopening.then(async () => {
      await this.#fabric?.stop();
      this.#fabric = undefined;
      this.#fabric = await this.#open(acceptTestCertificates);
      this.#tellNodes();
    });

    this.#reopening = reopened.catch(() => undefined);

    return reopened;
  }

  /**
   * Runs a commissioning, keeping its job up to date.
   *
   * @param jobId - The job.
   * @param code - The pairing code.
   * @param fabric - The fabric to add the device to.
   * @param isAcceptingTest - Whether the controller takes test certificates this time.
   * @returns Once the device joined, failed, or waits for the owner's answer.
   */
  async #run(
    jobId: string,
    code: string,
    fabric: MatterFabric,
    isAcceptingTest: boolean,
  ): Promise<void> {
    const mode = this.#job?.mode ?? 'shared';
    const { bluetooth } = this.#options;
    let given: Pick<MatterNewDevice, 'wifi' | 'threadDataset'> = {
      wifi: null,
      threadDataset: null,
    };

    try {
      if (mode === 'new') {
        const [saved, threadDataset] = await Promise.all([
          this.#typedWifi ?? this.#options.networks?.wifi() ?? null,
          this.#options.thread?.dataset() ?? null,
        ]);

        // A Wi-Fi with no password is not one matter.js gives a device.
        given = {
          wifi:
            saved?.password === null || saved?.password === undefined
              ? null
              : { ssid: saved.ssid, password: saved.password },
          threadDataset,
        };
        bluetooth?.markPairing(true);
      }

      const nodeId = await fabric
        .commission(
          code,
          (step) => {
            this.#update(jobId, (job) => ({
              ...job,
              steps: advance(job.steps, stepOf(step, mode)),
            }));
          },
          mode === 'new'
            ? {
                ...given,
                /**
                 * Hears which network the device takes.
                 *
                 * @param network - Which.
                 */
                onNetwork: (network) => {
                  this.#onNetwork(jobId, code, network, given);
                },
              }
            : undefined,
        )
        .finally(() => {
          if (mode === 'new') {
            bluetooth?.markPairing(false);
          }
        });

      if (this.#isStopped(jobId)) {
        // Cut off too late: it joined all the same, and leaves again.
        this.#options.logger.info({ job: jobId, nodeId }, 'A cancelled Matter device joined');
        await this.#reopening;
        await this.decommission(nodeId).catch((error: unknown) => {
          this.#options.logger.warn(
            { err: error, nodeId },
            'A Matter node did not leave the fabric',
          );
        });

        return;
      }

      this.#joinedAt = new Date();
      this.#update(jobId, (job) => ({
        ...job,
        nodeId,
        steps: advance(job.steps, mode === 'new' ? 'added' : 'reading'),
      }));
      this.#options.logger.info({ job: jobId, nodeId }, 'A Matter device was commissioned');
      this.#tellNodes();
    } catch (error: unknown) {
      if (this.#isStopped(jobId)) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);

      if (!isAcceptingTest && isTestCertificateFailure(message)) {
        this.#ask(jobId, code, 'test-certificate', (step) => {
          if (step.id === 'found') {
            return { ...step, state: 'done' };
          }

          return step.id === 'certificate' ? { ...step, state: 'warning' } : step;
        });

        return;
      }

      // Given no network at all, the device did not say which it takes: Wi-Fi is asked for, and a
      // Thread device says so the next time.
      if (mode === 'new' && given.wifi === null && isMissingNetworkFailure(message)) {
        this.#ask(jobId, code, 'needs-wifi', (step) =>
          step.id === 'looking' || step.id === 'found' ? { ...step, state: 'done' } : step,
        );

        return;
      }

      this.#fail(jobId, error);
    }
  }

  /**
   * Ends a job as failed, the step that was running with it.
   *
   * @param jobId - The job.
   * @param error - Why.
   */
  #fail(jobId: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);

    this.#update(jobId, (job) => ({
      ...job,
      state: 'failed',
      finishedAt: new Date(),
      error: message.slice(0, 2048),
      steps: job.steps.map((step) =>
        step.state === 'running' ? { ...step, state: 'failed' } : step,
      ),
    }));
    this.#options.logger.warn({ err: error, job: jobId }, 'Commissioning a Matter device failed');
  }

  /**
   * Changes the job, when it is still the one and was not cancelled.
   *
   * @param jobId - The job.
   * @param change - What becomes of it.
   */
  #update(jobId: string, change: (job: MatterCommissioning) => MatterCommissioning): void {
    if (this.#job?.id === jobId && this.#job.state !== 'cancelled') {
      this.#job = change(this.#job);
    }
  }

  /**
   * Takes a node off the fabric, whatever of it is in the house.
   *
   * @param nodeId - The node.
   * @returns Whether it was on the fabric and left it.
   * @throws {Error} When the fabric is not open, or the node does not answer.
   */
  public async decommission(nodeId: string): Promise<boolean> {
    const leaving = this.#leaving.get(nodeId);

    if (leaving !== undefined) {
      return leaving;
    }

    const started = this.#decommission(nodeId).finally(() => {
      this.#leaving.delete(nodeId);
    });

    this.#leaving.set(nodeId, started);

    return started;
  }

  /**
   * Takes a node off the fabric, once: see {@link MatterBroker.decommission}.
   *
   * @param nodeId - The node.
   * @returns Whether it was on the fabric and left it.
   */
  async #decommission(nodeId: string): Promise<boolean> {
    const fabric = this.#require();

    if (fabric.node(nodeId) === undefined) {
      return false;
    }

    try {
      await fabric.decommission(nodeId);
    } catch (error: unknown) {
      throw new DeviceUnavailableError(
        `The Matter device did not leave the house's fabric: ${error instanceof Error ? error.message : String(error)}`,
        { details: { nodeId } },
      );
    }

    this.#offers.delete(nodeId);

    for (const key of [...this.#removed]) {
      if (key === nodeId || key.startsWith(`${nodeId}:`)) {
        this.#removed.delete(key);
      }
    }

    await this.#writeRemoved();
    this.#tellNodes();

    return true;
  }

  /**
   * Remembers that a device left the house, and takes its node off the fabric once none of it is
   * left in the house.
   *
   * @param deviceKey - The device's external id.
   * @returns Once remembered; leaving the fabric goes on behind, as a node may take a while.
   */
  public async release(deviceKey: string): Promise<void> {
    this.#removed.add(deviceKey);
    await this.#writeRemoved();
    // Discovery drops it now: told later, it would offer the device back before the node leaves.
    this.#tellNodes();

    const [nodeId = deviceKey] = deviceKey.split(':');

    void this.#leaveIfGone(nodeId);
  }

  /**
   * Takes a node off the fabric when something of it was removed from the house and nothing of it
   * is left there - devices behind a bridge never added count as gone. A node that does not answer
   * waits: the controller would forget it without telling it, and the device would keep the
   * house's fabric. It is asked again when it answers, and when the fabric opens.
   *
   * @param nodeId - The node.
   * @returns Once it left, or it stays; never throws.
   */
  async #leaveIfGone(nodeId: string): Promise<void> {
    const node = this.node(nodeId);

    if (node?.isAvailable !== true) {
      return;
    }

    const keys = scopesOf(node.attributes).map((scope) => matterDeviceKey(nodeId, scope.endpoint));

    // A node nobody removed anything of stays, in the house or not.
    if (!keys.some((key) => this.#removed.has(key))) {
      return;
    }

    try {
      const inHouse = await this.#options.inHouse();

      if (keys.some((key) => inHouse.has(key) && !this.#removed.has(key))) {
        return;
      }

      await this.decommission(nodeId);
    } catch (error: unknown) {
      // It stays removed, and the page offers to take it off the fabric again.
      this.#options.logger.warn({ err: error, nodeId }, 'A Matter node did not leave the fabric');
    }
  }

  /**
   * Brings back a device removed from the house: discovery adds it again.
   *
   * @param deviceKey - The device's external id.
   * @returns Whether it was removed.
   */
  public async restore(deviceKey: string): Promise<boolean> {
    if (!this.#removed.delete(deviceKey)) {
      return false;
    }

    await this.#writeRemoved();
    this.#tellNodes();

    return true;
  }

  /**
   * Invokes a command on a node.
   *
   * @param nodeId - The node.
   * @param request - The command.
   * @returns Once the node accepted it.
   */
  public async invoke(nodeId: string, request: MatterInvoke): Promise<void> {
    await this.#require().invoke(nodeId, request);
  }

  /**
   * Writes an attribute of a node.
   *
   * @param nodeId - The node.
   * @param request - The attribute and its value.
   * @returns Once the node accepted it.
   */
  public async write(nodeId: string, request: MatterWrite): Promise<void> {
    await this.#require().write(nodeId, request);
  }

  /**
   * Has a node install the firmware on offer.
   *
   * @param nodeId - The node.
   * @returns Once it started.
   * @throws {Error} When nothing newer is on offer.
   */
  public async installUpdate(nodeId: string): Promise<void> {
    const fabric = this.#require();
    const offer = this.#offers.get(nodeId) ?? (await fabric.checkUpdate(nodeId));

    if (offer === null) {
      throw new ConflictError('No newer firmware is on offer for this device');
    }

    await fabric.installUpdate(nodeId, offer.softwareVersion);
  }

  /**
   * The open fabric.
   *
   * @returns It.
   * @throws {Error} When it is not open.
   */
  #require(): MatterFabric {
    if (this.#fabric === undefined) {
      throw notRunning(this.#state, this.#error);
    }

    return this.#fabric;
  }

  /**
   * Asks the DCL for firmware on offer for every node that can take one, one node after another.
   *
   * @returns Once every node was asked.
   */
  async #checkUpdates(): Promise<void> {
    const fabric = this.#fabric;

    for (const node of fabric?.nodes() ?? []) {
      if (fabric === undefined || !serves(node.attributes, 0, CLUSTER.otaRequestor)) {
        continue;
      }

      try {
        // One at a time: the DCL is the internet's, and the house has no hurry.
        // eslint-disable-next-line no-await-in-loop -- see above
        const offer = await fabric.checkUpdate(node.nodeId);

        if (JSON.stringify(offer) !== JSON.stringify(this.#offers.get(node.nodeId))) {
          this.#offers.set(node.nodeId, offer);
          this.#tellNode(node.nodeId, null);
        }
      } catch (error: unknown) {
        this.#options.logger.debug({ err: error, nodeId: node.nodeId }, 'No firmware answer');
      }
    }
  }

  /**
   * Tells every follower of nodes that one changed.
   *
   * @param nodeId - The node.
   * @param paths - What changed, or null for all of it.
   */
  #tellNode(nodeId: string, paths: readonly string[] | null): void {
    for (const listener of this.#nodeListeners) {
      listener(nodeId, paths);
    }
  }

  /** Tells every follower that the nodes changed. */
  #tellNodes(): void {
    for (const listener of this.#nodesListeners) {
      listener();
    }
  }

  /**
   * Reads the devices remembered as removed.
   *
   * @returns Once read; none when the file is not there yet.
   */
  async #readRemoved(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(path.join(this.#options.storageDir, REMOVED_FILE), 'utf8'),
      );

      for (const key of Array.isArray(parsed) ? parsed : []) {
        if (typeof key === 'string') {
          this.#removed.add(key);
        }
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Reads when this hub made the fabric, writing it down when it was made just now.
   *
   * @param isNew - Whether the fabric was made at this start.
   * @returns The date, or null for a fabric made before the hub kept it.
   */
  async #readFabricDate(isNew: boolean): Promise<Date | null> {
    const file = path.join(this.#options.storageDir, FABRIC_FILE);

    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as { createdAt?: unknown };
      const date = typeof parsed.createdAt === 'string' ? new Date(parsed.createdAt) : null;

      return date === null || Number.isNaN(date.getTime()) ? null : date;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !isNew) {
        return null;
      }
    }

    const now = new Date();

    await writeFile(file, JSON.stringify({ createdAt: now.toISOString() }), 'utf8');

    return now;
  }

  /**
   * Writes the devices remembered as removed.
   *
   * @returns Once written.
   */
  async #writeRemoved(): Promise<void> {
    await writeFile(
      path.join(this.#options.storageDir, REMOVED_FILE),
      JSON.stringify([...this.#removed].sort()),
      'utf8',
    );
  }
}
