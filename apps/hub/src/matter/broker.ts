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
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  ConflictError,
  DeviceUnavailableError,
  type MatterCommissioning,
  type MatterControllerState,
  type MatterStatus,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';
import {
  CLUSTER,
  deviceSnapshotOf,
  matterDeviceKey,
  scopesOf,
  serves,
  type MatterDeviceSnapshot,
  type MatterNodeSnapshot,
  type MatterUpdateOffer,
} from '@nebulahome/package-runtime';

import type { MatterFabric, MatterInvoke, MatterWrite, OpenMatterFabric } from './fabric.js';

/** How often the DCL is asked for firmware on offer. */
const UPDATE_CHECK_MS = 24 * 60 * 60 * 1000;

/** How long after the start the first ask waits: the nodes are still connecting. */
const FIRST_UPDATE_CHECK_MS = 2 * 60 * 1000;

/** The file the devices removed from the house are remembered in. */
const REMOVED_FILE = 'removed.json';

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
};

/**
 * What is thrown when something is asked of a fabric that is not there.
 *
 * @param state - Where the broker stands.
 * @param error - Why it failed, if it did.
 * @returns The error, saying why.
 */
function notRunning(state: MatterControllerState, error: string | null): Error {
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
  #fabric: MatterFabric | undefined;
  #state: MatterControllerState;
  #error: string | null = null;
  #job: MatterCommissioning | null = null;

  /**
   * Keeps the options; nothing opens until {@link MatterBroker.start}.
   *
   * @param options - See {@link MatterBrokerOptions}.
   */
  public constructor(options: MatterBrokerOptions) {
    this.#options = options;
    this.#state = options.open === undefined ? 'disabled' : 'starting';
  }

  /**
   * Opens the fabric, and starts asking for firmware. A fabric that does not open leaves the
   * broker failed, with why, and the hub running.
   *
   * @returns Once it is open or has failed.
   */
  public async start(): Promise<void> {
    const { open, storageDir, logger, version } = this.#options;

    if (open === undefined) {
      return;
    }

    try {
      await mkdir(storageDir, { recursive: true });
      await this.#readRemoved();
      this.#fabric = await open({
        storageDir,
        logger,
        version,
        events: {
          /**
           * Hands a node's change on.
           *
           * @param nodeId - The node.
           * @param paths - What changed, or null for all of it.
           */
          onNode: (nodeId, paths) => {
            this.#tellNode(nodeId, paths);
          },

          /** Tells discovery the nodes changed. */
          onNodes: () => {
            this.#tellNodes();
          },
        },
      });
      this.#state = 'running';
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
    await this.#fabric?.stop();
    this.#fabric = undefined;
  }

  /**
   * Where the broker stands.
   *
   * @returns Its state, for the Brokers page.
   */
  public status(): MatterStatus {
    const nodes = this.nodes();

    return {
      state: this.#state,
      error: this.#error,
      fabricId: this.#fabric?.fabricId ?? null,
      isLanReachable: this.#options.isLanReachable,
      nodes: { total: nodes.length, online: nodes.filter((node) => node.isAvailable).length },
      commissioning: this.#job,
    };
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
  public nodes(): MatterNodeSnapshot[] {
    return this.#fabric?.nodes() ?? [];
  }

  /**
   * One node.
   *
   * @param nodeId - The node.
   * @returns It, or undefined.
   */
  public node(nodeId: string): MatterNodeSnapshot | undefined {
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
   * Starts commissioning a node shared by another app.
   *
   * @param code - Its pairing code, already checked.
   * @returns The job, running.
   * @throws {Error} When the fabric is not open, or a commissioning runs already.
   */
  public commission(code: string): MatterCommissioning {
    const fabric = this.#require();

    if (this.#job?.state === 'running') {
      throw new ConflictError('A device is being added already; wait for it to finish');
    }

    const job: MatterCommissioning = {
      id: randomUUID(),
      state: 'running',
      startedAt: new Date(),
      finishedAt: null,
      nodeId: null,
      error: null,
    };

    this.#job = job;
    this.#options.logger.info({ job: job.id }, 'Commissioning a Matter device');

    fabric
      .commission(code)
      .then((nodeId) => {
        this.#job = { ...job, state: 'succeeded', finishedAt: new Date(), nodeId };
        this.#options.logger.info({ job: job.id, nodeId }, 'A Matter device was commissioned');
        this.#tellNodes();
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);

        this.#job = {
          ...job,
          state: 'failed',
          finishedAt: new Date(),
          error: message.slice(0, 2048),
        };
        this.#options.logger.warn(
          { err: error, job: job.id },
          'Commissioning a Matter device failed',
        );
      });

    return job;
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
    const node = this.node(nodeId);

    if (node === undefined) {
      return;
    }

    const isGone = scopesOf(node.attributes).every((scope) =>
      this.#removed.has(matterDeviceKey(nodeId, scope.endpoint)),
    );

    if (isGone) {
      this.decommission(nodeId).catch((error: unknown) => {
        // It stays removed, and the page offers to take it off the fabric again.
        this.#options.logger.warn({ err: error, nodeId }, 'A Matter node did not leave the fabric');
      });
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
