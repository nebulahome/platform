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
  MATTER_PORT,
  type MatterCommissioning,
  type MatterCommissioningStep,
  type MatterCommissioningStepId,
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
  type MatterUpdateOffer,
} from '@nebulahome/package-runtime';

import {
  isTestCertificateFailure,
  MATTER_ENGINE,
  type FabricNode,
  type MatterFabric,
  type MatterInvoke,
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

/**
 * The steps of a commissioning, as the job starts: the code read, the device being looked for.
 *
 * @param code - The pairing code, checked.
 * @returns The steps.
 */
function freshSteps(code: string): MatterCommissioningStep[] {
  const isQrCode = code.startsWith('MT:');

  return MATTER_COMMISSIONING_STEPS.map((id) => ({
    id,
    state: id === 'code' ? 'done' : id === 'found' ? 'running' : 'pending',
    detail: {
      discriminator: id === 'code' ? discriminatorOf(code) : null,
      isQrCode: id === 'code' && isQrCode,
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
  running: MatterCommissioningStepId,
): MatterCommissioningStep[] {
  const at = MATTER_COMMISSIONING_STEPS.indexOf(running);

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
 * @returns The step the page shows, or undefined for one it does not.
 */
function stepOf(step: number): MatterCommissioningStepId {
  // Up to the attestation (step 10), the device was found and its certificate is being checked;
  // after it, it is joining the fabric.
  return step <= 10 ? 'certificate' : 'joining';
}

/** A commissioning stopped on a test certificate, waiting for the owner. */
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

  /** Since when each node has not answered, as this hub saw it. */
  readonly #offlineSince = new Map<string, Date>();
  #fabric: MatterFabric | undefined;
  #state: MatterControllerState;
  #error: string | null = null;
  #job: MatterCommissioning | null = null;
  #pending: Pending | undefined;
  #startedAt: Date | null = null;
  #fabricCreatedAt: Date | null = null;

  /** When the job's device joined the fabric, to give it a while to be in the house. */
  #joinedAt: Date | null = null;

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

    return open({
      storageDir,
      logger,
      version,
      acceptTestCertificates,
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
    const reading = job.steps.find((step) => step.id === 'reading');

    if (node !== undefined && reading?.state === 'running') {
      const [root] = scopesOf(node.attributes);
      const product =
        root === undefined ? null : (deviceSnapshotOf(node, root).identity.productName ?? null);

      this.#job = {
        ...job,
        steps: advance(job.steps, 'in-house').map((step) =>
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
          step.id === 'in-house' ? { ...step, state: 'failed' } : step,
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

    if (this.#job?.state === 'running' || this.#job?.state === 'needs-answer') {
      throw new ConflictError('A device is being added already; wait for it to finish');
    }

    const job: MatterCommissioning = {
      id: randomUUID(),
      state: 'running',
      startedAt: new Date(),
      finishedAt: null,
      nodeId: null,
      error: null,
      steps: freshSteps(code),
      deviceId: null,
    };

    this.#job = job;
    this.#joinedAt = null;
    this.#options.logger.info({ job: job.id }, 'Commissioning a Matter device');
    void this.#run(job.id, code, fabric, false);

    return job;
  }

  /**
   * Answers the question a commissioning stopped on: whether to add a device whose certificate
   * is a test one. Yes opens the controller again taking test certificates, adds the device with
   * the same code, and opens it again as it was; meanwhile the house's Matter devices are out of
   * reach for a few seconds.
   *
   * @param jobId - The job.
   * @param isAccepted - Whether to add it anyway.
   * @returns The job, as it now stands.
   * @throws {ConflictError} When nothing waits for that answer.
   */
  public answer(jobId: string, isAccepted: boolean): MatterCommissioning {
    const job = this.#job;
    const pending = this.#pending;

    if (job?.id !== jobId || job.state !== 'needs-answer' || pending?.jobId !== jobId) {
      throw new ConflictError('Nothing waits for that answer');
    }

    clearTimeout(pending.timer);
    this.#pending = undefined;

    if (!isAccepted) {
      this.#job = {
        ...job,
        state: 'failed',
        finishedAt: new Date(),
        error: 'Not added: its certificate is a test one',
      };

      return this.#job;
    }

    this.#job = { ...job, state: 'running', steps: advance(job.steps, 'joining') };
    void this.#withTestCertificates(jobId, pending.code);

    return this.#job;
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
      await this.#run(jobId, code, this.#require(), true);
    } catch (error: unknown) {
      this.#fail(jobId, error);
    } finally {
      await this.#reopen(false).catch((error: unknown) => {
        this.#state = 'failed';
        this.#error = error instanceof Error ? error.message : String(error);
        this.#options.logger.error({ err: error }, 'The Matter fabric did not open again');
      });
    }
  }

  /**
   * Closes the fabric and opens it again.
   *
   * @param acceptTestCertificates - Whether devices with a test certificate are taken.
   * @returns Once it is open.
   */
  async #reopen(acceptTestCertificates: boolean): Promise<void> {
    await this.#fabric?.stop();
    this.#fabric = undefined;
    this.#fabric = await this.#open(acceptTestCertificates);
    this.#tellNodes();
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
    try {
      const nodeId = await fabric.commission(code, (step) => {
        this.#update(jobId, (job) => ({ ...job, steps: advance(job.steps, stepOf(step)) }));
      });

      this.#joinedAt = new Date();
      this.#update(jobId, (job) => ({ ...job, nodeId, steps: advance(job.steps, 'reading') }));
      this.#options.logger.info({ job: jobId, nodeId }, 'A Matter device was commissioned');
      this.#tellNodes();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      if (!isAcceptingTest && isTestCertificateFailure(message)) {
        this.#pending = {
          jobId,
          code,
          timer: setTimeout(() => {
            this.#pending = undefined;
            this.#fail(
              jobId,
              new Error("No answer came in time: share it again from the maker's app"),
            );
          }, ANSWER_WITHIN_MS),
        };
        this.#pending.timer.unref();
        this.#update(jobId, (job) => ({
          ...job,
          state: 'needs-answer',
          steps: job.steps.map((step) => {
            if (step.id === 'found') {
              return { ...step, state: 'done' };
            }

            if (step.id === 'certificate') {
              return { ...step, state: 'warning' };
            }

            return step.state === 'running' ? { ...step, state: 'pending' } : step;
          }),
        }));
        this.#options.logger.info({ job: jobId }, 'A Matter device has a test certificate');

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
   * Changes the job, when it is still the one.
   *
   * @param jobId - The job.
   * @param change - What becomes of it.
   */
  #update(jobId: string, change: (job: MatterCommissioning) => MatterCommissioning): void {
    if (this.#job?.id === jobId) {
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
