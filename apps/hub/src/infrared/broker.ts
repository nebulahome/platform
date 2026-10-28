/**
 * The house's Infrared broker: the remotes the house learned, their buttons, and the IR blasters
 * the integrations provide to send them through.
 *
 * A blaster is a device whose driver's profile declares `infrared` - the signals it sends and
 * whether it can learn - and it is online while its instance runs. The broker drives it with the
 * reserved `infrared.*` ops over that instance's own connection: `send` a code, `learn` one,
 * `sweep` for an RF button's frequency, `cancel` either. Codes cross that boundary in the
 * platform's shape, so a remote moves to another blaster, of another brand even, without learning
 * again; a blaster's integration converts with the SDK's codec.
 *
 * A remote is a device of the platform's own `infrared` vendor (driver `infrared/remote`, device
 * key `infrared-<remoteId>`), each button a `button` entity. The broker hands every remote to
 * discovery with its buttons, which adds it at once, as a Modbus device is; its instance reaches
 * it over the platform transport `infrared`, which hears from the broker whether the remote's
 * blaster can send and hands it the presses. When a remote's buttons change, its device is
 * identified again, so its entities follow. A remote whose blaster is gone keeps its buttons,
 * unavailable until the owner picks another blaster.
 *
 * Learning is a job, one per blaster: ready, sweeping (RF only), listening, then captured, failed
 * or cancelled. Saving what it captured is an ordinary button save.
 */
import { randomUUID } from 'node:crypto';

import {
  ConflictError,
  INFRARED_MAXIMUM_BUTTONS,
  INFRARED_OPS,
  INFRARED_REMOTE_KIND,
  INFRARED_TRANSPORT,
  infraredCodeSchema,
  infraredDeviceKeyOf,
  infraredSweepResultSchema,
  NotFoundError,
  ValidationError,
  type BrokerState,
  type InfraredBlaster,
  type InfraredButton,
  type InfraredButtonSaveRequest,
  type InfraredCode,
  type InfraredLearnJob,
  type InfraredProfile,
  type InfraredRemote,
  type InfraredRemoteDetail,
  type InfraredRemoteSaveRequest,
  type InfraredSignal,
  type InfraredStatus,
  type JsonObject,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';
import {
  withInfraredProtocol,
  type InfraredRemoteSnapshot,
  type LoadedVendor,
} from '@nebulahome/package-runtime';

import type { BluetoothInstance } from '../persistence/bluetooth.js';
import type {
  InfraredStore,
  StoredInfraredButton,
  StoredInfraredRemote,
} from '../persistence/infrared.js';

/** How long a blaster may take to send a code, or to stop listening. */
const OP_TIMEOUT_MS = 10_000;

/** How much longer than it listens a blaster is waited for: its own timeout should end it first. */
const LEARN_GRACE_MS = 5000;

/** How long saving a new remote waits for its device to be in the house, and how often it looks. */
const ADD_WAIT_MS = 15_000;
const ADD_POLL_MS = 500;

/** How long an ended learn job is kept for its dialog to read. */
const JOB_KEEP_MS = 60 * 60_000;

/** The highest cell of a keypad. */
const LAST_CELL = 1023;

/** A remote as discovery and identification take it: its buttons, as its device describes them. */
export type InfraredSighting = {
  readonly deviceKey: string;
  readonly device: InfraredRemoteSnapshot;
};

/** How the broker reaches the blasters of the house. */
export type InfraredRoles = {
  /**
   * Sends an op to a device over its instance's connection.
   *
   * @throws {Error} When the device is not running, or its integration refused.
   */
  send: (deviceId: string, op: string, args: JsonObject, timeoutMs: number) => Promise<unknown>;
};

/** What the broker needs. */
export type InfraredBrokerOptions = {
  readonly store: InfraredStore;
  readonly logger: PlatformLogger;

  /** The vendors loaded: the profiles that declare blasters. */
  readonly vendors: () => readonly LoadedVendor[];

  /** The instances of the house: the blasters, and the remotes' devices. */
  readonly instances: () => Promise<BluetoothInstance[]>;
  readonly roles: InfraredRoles;

  /** How long saving a new remote waits for its device; 15 s unless a test says. */
  readonly addWaitMs?: number;

  /** The clock, in milliseconds. */
  readonly now?: () => number;
};

/** A blaster, as last read from the instances. */
type Blaster = {
  readonly deviceId: string;
  readonly name: string;
  readonly vendorId: string;
  readonly vendorName: string;
  readonly areaId: string | null;
  readonly isOnline: boolean;
  readonly profile: InfraredProfile;
};

/** The device a remote is in the house. */
type RemoteDevice = { readonly deviceId: string; readonly areaId: string | null };

/** A learn job, as the broker changes it. */
type Job = { -readonly [Key in keyof InfraredLearnJob]: InfraredLearnJob[Key] };

/** The last button sent. */
type LastSent = {
  readonly remoteId: string;
  readonly remoteName: string;
  readonly buttonId: string;
  readonly buttonName: string;
  readonly blasterId: string | null;
  readonly at: Date;
};

/**
 * A failure in a sentence, for the page.
 *
 * @param error - Whatever was thrown.
 * @returns Its message, cut.
 */
function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}

/**
 * Whether a learn job is still going.
 *
 * @param job - The job.
 * @returns True while ready, sweeping or listening.
 */
function isRunning(job: Job): boolean {
  return job.phase === 'ready' || job.phase === 'sweeping' || job.phase === 'listening';
}

/**
 * A code as an op's arguments carry it.
 *
 * @param code - The code.
 * @returns The same code, as JSON.
 */
function jsonOf(code: InfraredCode): JsonObject {
  return JSON.parse(JSON.stringify(code)) as JsonObject;
}

/**
 * The latest of some times.
 *
 * @param times - The times; null for never.
 * @returns The latest, or null.
 */
function latest(times: readonly (Date | null)[]): Date | null {
  return times.reduce<Date | null>(
    (best, at) => (at !== null && (best === null || at > best) ? at : best),
    null,
  );
}

/** The house's Infrared broker. */
export class InfraredBroker {
  readonly #options: InfraredBrokerOptions;

  #state: BrokerState = 'starting';
  #error: string | null = null;
  #remotes = new Map<string, StoredInfraredRemote>();
  #buttons = new Map<string, StoredInfraredButton>();

  /** The blasters and the remotes' devices, as last read from the instances. */
  #blasters = new Map<string, Blaster>();
  #house = new Map<string, RemoteDevice>();

  /** When each blaster last sent, tests included. */
  readonly #sentAt = new Map<string, Date>();
  #lastSent: LastSent | null = null;
  readonly #jobs = new Map<string, Job>();

  /** Whether each remote was last said to be able to send, by its device key. */
  readonly #delivered = new Map<string, boolean>();
  readonly #availabilityListeners = new Set<(deviceKey: string, isAvailable: boolean) => void>();
  readonly #deviceListeners = new Set<() => void>();
  readonly #savedListeners = new Set<(deviceIds: readonly string[]) => void>();
  #refreshing: Promise<void> = Promise.resolve();

  /**
   * Prepares the broker; nothing is read until it starts.
   *
   * @param options - What it needs.
   */
  constructor(options: InfraredBrokerOptions) {
    this.#options = options;
  }

  /**
   * Reads what is kept and the blasters. Never throws: a failure shows on the Brokers page.
   *
   * @returns Once started, or failed.
   */
  async start(): Promise<void> {
    const { store } = this.#options;

    try {
      const [remotes, buttons] = await Promise.all([store.remotes(), store.buttons()]);

      this.#remotes = new Map(remotes.map((remote) => [remote.id, remote]));
      this.#buttons = new Map(buttons.map((button) => [button.id, button]));
      this.#noteKeptPresses(buttons);
      this.#state = 'running';
      this.#error = null;
    } catch (error: unknown) {
      this.#state = 'failed';
      this.#error = messageOf(error);
      this.#options.logger.error(
        { err: error },
        'The Infrared broker could not read what it keeps',
      );

      return;
    }

    await this.refresh();
    this.#changed();
  }

  /** Stops answering for the remotes; a learn job under way ends with its blaster. */
  stop(): void {
    this.#state = 'disabled';
  }

  /**
   * Reads the blasters and the remotes' devices again, and tells the remotes whose blaster came
   * or went: after an instance started or stopped, or the vendors changed.
   *
   * @returns Once read; a failure is logged.
   */
  async refresh(): Promise<void> {
    this.#refreshing = this.#refreshing
      .then(async () => this.#read())
      .catch((error: unknown) => {
        this.#options.logger.warn(
          { err: error },
          'The Infrared broker could not read the blasters',
        );
      });

    return this.#refreshing;
  }

  /**
   * Where the broker stands.
   *
   * @returns Its status.
   */
  async status(): Promise<InfraredStatus> {
    if (this.#state === 'running') {
      await this.#read();
    }

    const blasters = [...this.#blasters.values()];
    const remotes = [...this.#remotes.values()];
    const last = this.#lastSent;

    return {
      state: this.#state === 'running' && blasters.length === 0 ? 'unavailable' : this.#state,
      error: this.#error,
      blasters: {
        total: blasters.length,
        online: blasters.filter((blaster) => blaster.isOnline).length,
      },
      remotes: remotes.length,
      lastSent:
        last === null
          ? null
          : {
              remoteId: last.remoteId,
              remoteName: last.remoteName,
              buttonId: last.buttonId,
              buttonName: last.buttonName,
              blasterName:
                last.blasterId === null ? null : (this.#blasters.get(last.blasterId)?.name ?? null),
              at: last.at,
            },
      learning: [...this.#jobs.values()]
        .filter(isRunning)
        .map((job) => ({ jobId: job.id, blasterId: job.blasterId, blasterName: job.blasterName }))
        .slice(0, 64),
      devices: {
        total: remotes.length,
        online: remotes.filter((remote) => this.#isAvailable(remote)).length,
      },
    };
  }

  /**
   * Every blaster.
   *
   * @returns The blasters, by name.
   */
  async blasters(): Promise<InfraredBlaster[]> {
    await this.#read();

    return [...this.#blasters.values()]
      .map((blaster): InfraredBlaster => ({
        deviceId: blaster.deviceId,
        name: blaster.name,
        vendorId: blaster.vendorId,
        vendorName: blaster.vendorName,
        areaId: blaster.areaId,
        isOnline: blaster.isOnline,
        signals: [...blaster.profile.signals],
        receives: blaster.profile.receives,
        lastSentAt: this.#sentAt.get(blaster.deviceId) ?? null,
        remotes: [...this.#remotes.values()].filter(
          (remote) => remote.blasterId === blaster.deviceId,
        ).length,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /**
   * Every remote, without its buttons.
   *
   * @returns The remotes, by name.
   */
  async remotes(): Promise<InfraredRemote[]> {
    await this.#read();

    return [...this.#remotes.values()]
      .map((remote) => this.#remoteView(remote))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /**
   * One remote, with its buttons.
   *
   * @param id - The remote.
   * @returns It, its buttons by cell.
   * @throws {NotFoundError} When there is no such remote.
   */
  async remote(id: string): Promise<InfraredRemoteDetail> {
    await this.#read();

    const remote = this.#requireRemote(id);

    return {
      ...this.#remoteView(remote),
      buttons: this.#buttonsOf(remote.id).map((button) => this.#buttonView(button)),
    };
  }

  /**
   * Saves a remote, new or changed. A new one is handed to discovery and waited for until its
   * device is in the house; another blaster sends its codes as they are.
   *
   * @param request - The remote.
   * @returns It, its device once added; null when it was not added in time.
   * @throws {NotFoundError} When there is no such remote, or the blaster is not one.
   */
  async saveRemote(request: InfraredRemoteSaveRequest): Promise<InfraredRemote> {
    const previous = request.id === undefined ? undefined : this.#requireRemote(request.id);

    if (request.blasterId !== null && request.blasterId !== previous?.blasterId) {
      await this.#read();
      this.#requireBlaster(request.blasterId);
    }

    const before = previous === undefined ? undefined : this.#signatureOf(previous.id);
    const saved = await this.#options.store.saveRemote({
      id: previous?.id,
      name: request.name,
      kind: request.kind,
      blasterId: request.blasterId,
      columns: request.columns,
    });

    this.#remotes.set(saved.id, saved);
    this.#deliver();
    this.#changed();

    if (before === undefined) {
      await this.#waitForDevice(saved.id);
    } else {
      this.#saved(saved.id, before);
    }

    return this.#remoteView(saved);
  }

  /**
   * Removes a remote and its buttons. Its device is `api`'s to remove from the house first.
   *
   * @param id - The remote.
   * @returns Whether there was one.
   */
  async removeRemote(id: string): Promise<boolean> {
    const isRemoved = await this.#options.store.removeRemote(id);

    for (const button of this.#buttonsOf(id)) {
      this.#buttons.delete(button.id);
    }

    this.#remotes.delete(id);
    this.#delivered.delete(infraredDeviceKeyOf(id));
    this.#changed();

    return isRemoved;
  }

  /**
   * Lets go of a remote whose device was removed from the house: its row goes, so it is not added
   * back.
   *
   * @param deviceKey - The device.
   * @returns Once gone.
   */
  async release(deviceKey: string): Promise<void> {
    const remote = [...this.#remotes.values()].find(
      (each) => infraredDeviceKeyOf(each.id) === deviceKey,
    );

    if (remote !== undefined) {
      await this.removeRemote(remote.id);
    }
  }

  /**
   * Forgets a blaster removed from the house: its remotes keep their buttons and wait for another
   * (the database lets go of it with the instance's row), and a job on it fails.
   *
   * @param deviceId - The device.
   */
  releaseInstance(deviceId: string): void {
    for (const remote of this.#remotes.values()) {
      if (remote.blasterId === deviceId) {
        this.#remotes.set(remote.id, { ...remote, blasterId: null });
      }
    }

    for (const job of this.#jobs.values()) {
      if (job.blasterId === deviceId && isRunning(job)) {
        job.error = 'The blaster was removed';
        this.#finish(job, 'failed');
      }
    }

    this.#blasters.delete(deviceId);
    this.#sentAt.delete(deviceId);
    this.#deliver();
  }

  /**
   * Saves a button, new or changed: a new one goes in the first empty cell unless one is said.
   *
   * @param request - The button.
   * @returns It, saved.
   * @throws {NotFoundError} When there is no such remote, or button of it.
   * @throws {ConflictError} When the cell holds another button, or the remote is full.
   */
  async saveButton(request: InfraredButtonSaveRequest): Promise<InfraredButton> {
    const remote = this.#requireRemote(request.remoteId);
    const previous = request.id === undefined ? undefined : this.#requireButton(request.id);

    if (previous !== undefined && previous.remoteId !== remote.id) {
      throw new NotFoundError(`${remote.name} has no button ${previous.id}`, {
        details: { remoteId: remote.id, id: previous.id },
      });
    }

    if (previous === undefined) {
      this.#requireRoom(remote, 1);
    }

    if (request.cell !== undefined) {
      this.#requireEmpty(remote.id, request.cell, previous?.id);
    }

    const before = this.#signatureOf(remote.id);
    const saved = await this.#options.store.saveButton({
      id: previous?.id,
      remoteId: remote.id,
      name: request.name,
      icon: request.icon,
      cell: request.cell ?? previous?.cell ?? this.#freeCells(remote.id, 1)[0] ?? 0,
      code: request.code,
    });

    this.#buttons.set(saved.id, saved);
    this.#saved(remote.id, before);

    return this.#buttonView(saved);
  }

  /**
   * Moves a button to an empty cell of its remote's keypad; one held is refused, never swapped.
   *
   * @param id - The button.
   * @param cell - The cell.
   * @returns It, moved.
   * @throws {NotFoundError} When there is no such button.
   * @throws {ConflictError} When the cell holds another button.
   */
  async moveButton(id: string, cell: number): Promise<InfraredButton> {
    const button = this.#requireButton(id);

    if (button.cell === cell) {
      return this.#buttonView(button);
    }

    this.#requireEmpty(button.remoteId, cell, button.id);

    const saved = await this.#options.store.saveButton({ ...button, cell });

    this.#buttons.set(saved.id, saved);

    return this.#buttonView(saved);
  }

  /**
   * Removes a button.
   *
   * @param id - The button.
   * @returns Whether there was one.
   */
  async removeButton(id: string): Promise<boolean> {
    const button = this.#buttons.get(id);
    const before = button === undefined ? undefined : this.#signatureOf(button.remoteId);
    const isRemoved = await this.#options.store.removeButton(id);

    this.#buttons.delete(id);

    if (button !== undefined && before !== undefined) {
      this.#saved(button.remoteId, before);
    }

    return isRemoved;
  }

  /**
   * Sends a button's code through its remote's blaster.
   *
   * @param id - The button.
   * @returns When it was sent.
   * @throws {NotFoundError} When there is no such button.
   * @throws {ConflictError} When the remote has no blaster, it is offline, or it refused.
   */
  async press(id: string): Promise<{ pressedAt: Date }> {
    const button = this.#requireButton(id);
    const remote = this.#requireRemote(button.remoteId);

    if (remote.blasterId === null) {
      throw new ConflictError(`${remote.name} has no blaster: pick another one`, {
        details: { remoteId: remote.id },
      });
    }

    await this.#send(remote.blasterId, button.code);

    const at = new Date(this.#now());

    this.#buttons.set(button.id, { ...button, lastPressedAt: at });
    this.#lastSent = {
      remoteId: remote.id,
      remoteName: remote.name,
      buttonId: button.id,
      buttonName: button.name,
      blasterId: remote.blasterId,
      at,
    };
    // Sent is sent: a press not noted down is not a press that failed.
    await this.#options.store.notePressed(button.id, at).catch((error: unknown) => {
      this.#options.logger.warn({ err: error, buttonId: button.id }, 'Could not note a press');
    });

    return { pressedAt: at };
  }

  /**
   * Sends a button pressed as an entity of the house: the transport's `press`.
   *
   * @param deviceKey - The remote's device.
   * @param buttonId - The button.
   * @returns When it was sent.
   * @throws {NotFoundError} When the remote has no such button.
   */
  async pressKey(deviceKey: string, buttonId: string): Promise<{ pressedAt: Date }> {
    const button = this.#buttons.get(buttonId);

    if (button === undefined || infraredDeviceKeyOf(button.remoteId) !== deviceKey) {
      throw new NotFoundError(`${deviceKey} has no button ${buttonId}`, {
        details: { deviceKey, buttonId },
      });
    }

    return this.press(buttonId);
  }

  /**
   * Sends a code not saved yet, as Learn's and Import's Test do.
   *
   * @param blasterId - The blaster.
   * @param code - The code.
   * @returns When it was sent.
   * @throws {NotFoundError} When the device is not a blaster.
   * @throws {ValidationError} When it cannot send the code's signal.
   * @throws {ConflictError} When it is offline, or refused.
   */
  async test(blasterId: string, code: InfraredCode): Promise<{ pressedAt: Date }> {
    await this.#send(blasterId, code);

    return { pressedAt: new Date(this.#now()) };
  }

  /**
   * Starts learning a code on a blaster; the job running on it already, when one does.
   *
   * @param blasterId - The blaster.
   * @param signal - Infrared, or radio.
   * @param timeoutMs - How long it listens, and sweeps.
   * @returns The job.
   * @throws {NotFoundError} When the device is not a blaster.
   * @throws {ValidationError} When it cannot learn, or not that signal.
   * @throws {ConflictError} When it is offline.
   */
  learn(blasterId: string, signal: InfraredSignal, timeoutMs: number): InfraredLearnJob {
    const blaster = this.#requireBlaster(blasterId);

    if (!blaster.profile.receives) {
      throw new ValidationError(`${blaster.name} cannot learn codes`, { details: { blasterId } });
    }

    this.#requireSignal(blaster, signal);

    if (!blaster.isOnline) {
      throw new ConflictError(`${blaster.name} is offline`, { details: { blasterId } });
    }

    const running = [...this.#jobs.values()].find(
      (job) => job.blasterId === blasterId && isRunning(job),
    );

    if (running !== undefined) {
      return { ...running };
    }

    this.#pruneJobs();

    const job: Job = {
      id: randomUUID(),
      blasterId,
      blasterName: blaster.name,
      signal,
      phase: 'ready',
      startedAt: new Date(this.#now()),
      finishedAt: null,
      endsAt: null,
      frequencyHz: null,
      code: null,
      error: null,
    };

    this.#jobs.set(job.id, job);
    void this.#runJob(job, timeoutMs);

    return { ...job };
  }

  /**
   * Reads a learn job.
   *
   * @param jobId - The job.
   * @returns It.
   * @throws {NotFoundError} When there is no such job.
   */
  job(jobId: string): InfraredLearnJob {
    return { ...this.#requireJob(jobId) };
  }

  /**
   * Stops a learn job before it captured anything, and tells its blaster to stop listening.
   *
   * @param jobId - The job.
   * @returns It, cancelled; as it ended when it had already.
   * @throws {NotFoundError} When there is no such job.
   */
  async cancel(jobId: string): Promise<InfraredLearnJob> {
    const job = this.#requireJob(jobId);

    if (isRunning(job)) {
      this.#finish(job, 'cancelled');

      try {
        await this.#options.roles.send(job.blasterId, INFRARED_OPS.cancel, {}, OP_TIMEOUT_MS);
      } catch (error: unknown) {
        this.#options.logger.debug(
          { err: error, blasterId: job.blasterId },
          'A blaster did not stop listening',
        );
      }
    }

    return { ...job };
  }

  /**
   * Adds codes to a remote as buttons, each in the next empty cell.
   *
   * @param remoteId - The remote.
   * @param items - The codes, named.
   * @returns The remote, with its buttons.
   * @throws {NotFoundError} When there is no such remote.
   * @throws {ConflictError} When the remote has no room for them all; none is added.
   */
  async importButtons(
    remoteId: string,
    items: readonly { name: string; icon: string | null; code: InfraredCode }[],
  ): Promise<InfraredRemoteDetail> {
    const remote = this.#requireRemote(remoteId);

    this.#requireRoom(remote, items.length);

    const cells = this.#freeCells(remote.id, items.length);
    const before = this.#signatureOf(remote.id);

    try {
      for (const [index, item] of items.entries()) {
        // One after another, in the order the owner kept them: the keypad fills in that order.
        // eslint-disable-next-line no-await-in-loop -- see above
        const saved = await this.#options.store.saveButton({
          remoteId: remote.id,
          name: item.name,
          icon: item.icon,
          cell: cells[index] ?? 0,
          code: item.code,
        });

        this.#buttons.set(saved.id, saved);
      }
    } finally {
      this.#saved(remote.id, before);
    }

    return this.remote(remote.id);
  }

  /**
   * Every remote with its buttons, as discovery and the transport take them.
   *
   * @returns The remotes.
   */
  devices(): InfraredSighting[] {
    return [...this.#remotes.values()].map((remote) => {
      const device = this.#snapshotOf(remote);

      return { deviceKey: device.deviceKey, device };
    });
  }

  /**
   * Whether each remote's blaster can send now, for the transport to say when it applies.
   *
   * @returns Each remote's device key, and whether it can.
   */
  availability(): { deviceKey: string; isAvailable: boolean }[] {
    return [...this.#remotes.values()].map((remote) => ({
      deviceKey: infraredDeviceKeyOf(remote.id),
      isAvailable: this.#isAvailable(remote),
    }));
  }

  /**
   * Says when a remote's blaster comes or goes.
   *
   * @param listener - Called with the remote's device key and whether it can send.
   * @returns Stops it.
   */
  onAvailability(listener: (deviceKey: string, isAvailable: boolean) => void): () => void {
    this.#availabilityListeners.add(listener);

    return () => this.#availabilityListeners.delete(listener);
  }

  /**
   * Says when the remotes change - one saved or removed - for discovery.
   *
   * @param listener - Called after each change.
   * @returns Stops it.
   */
  onDevices(listener: () => void): () => void {
    this.#deviceListeners.add(listener);

    return () => this.#deviceListeners.delete(listener);
  }

  /**
   * Says which remotes' devices describe something else now - a button added, renamed, given
   * another icon or removed, the remote renamed - so they are identified again.
   *
   * @param listener - Called with their devices.
   * @returns Stops it.
   */
  onSaved(listener: (deviceIds: readonly string[]) => void): () => void {
    this.#savedListeners.add(listener);

    return () => this.#savedListeners.delete(listener);
  }

  /**
   * Reads the blasters and the remotes' devices from the instances, and tells the remotes whose
   * blaster came or went.
   *
   * @returns Once read.
   */
  async #read(): Promise<void> {
    const instances = await this.#options.instances();
    const blasters = new Map<string, Blaster>();
    const house = new Map<string, RemoteDevice>();

    for (const instance of instances) {
      const role = this.#profileOf(instance.kind);

      if (role !== undefined) {
        blasters.set(instance.id, {
          deviceId: instance.id,
          name: instance.name.slice(0, 256),
          vendorId: role.vendorId,
          vendorName: role.vendorName.slice(0, 128),
          areaId: instance.areaId,
          isOnline: instance.state === 'running',
          profile: role.profile,
        });
      }

      if (instance.transport === INFRARED_TRANSPORT && instance.externalId !== null) {
        house.set(instance.externalId, { deviceId: instance.id, areaId: instance.areaId });
      }
    }

    this.#blasters = blasters;
    this.#house = house;
    this.#deliver();
  }

  /**
   * The profile a driver declares a blaster with, and its vendor.
   *
   * @param kind - The driver, `vendor/driver`.
   * @returns Them; undefined for a driver whose devices are no blasters.
   */
  #profileOf(
    kind: string,
  ): { profile: InfraredProfile; vendorId: string; vendorName: string } | undefined {
    const [vendorId = ''] = kind.split('/');
    const vendor = this.#options.vendors().find((each) => each.manifest.id === vendorId);
    const profile = vendor?.drivers.find((driver) => driver.manifest.id === kind)?.infrared;

    return vendor === undefined || profile === undefined
      ? undefined
      : { profile, vendorId, vendorName: vendor.manifest.name };
  }

  /**
   * Sends a code through a blaster.
   *
   * @param blasterId - The blaster.
   * @param code - The code.
   * @returns Once sent.
   * @throws {NotFoundError} When the device is not a blaster.
   * @throws {ValidationError} When it cannot send the code's signal.
   * @throws {ConflictError} When it is offline, or refused.
   */
  async #send(blasterId: string, code: InfraredCode): Promise<void> {
    const blaster = this.#requireBlaster(blasterId);

    this.#requireSignal(blaster, code.signal);

    if (!blaster.isOnline) {
      throw new ConflictError(`${blaster.name} is offline`, { details: { blasterId } });
    }

    try {
      await this.#options.roles.send(
        blasterId,
        INFRARED_OPS.send,
        { code: jsonOf(code) },
        OP_TIMEOUT_MS,
      );
    } catch (error: unknown) {
      throw new ConflictError(messageOf(error), { details: { blasterId } });
    }

    this.#sentAt.set(blasterId, new Date(this.#now()));
  }

  /**
   * Runs a learn job: the RF sweep first for a radio code, then listening, until a code comes,
   * it fails or it is cancelled.
   *
   * @param job - The job.
   * @param timeoutMs - How long the blaster listens, and sweeps.
   * @returns Once it ended; it never rejects.
   */
  async #runJob(job: Job, timeoutMs: number): Promise<void> {
    const { roles } = this.#options;
    let since = this.#now();

    try {
      if (job.signal === 'rf') {
        this.#enter(job, 'sweeping', timeoutMs);

        const swept = infraredSweepResultSchema.safeParse(
          await roles.send(
            job.blasterId,
            INFRARED_OPS.sweep,
            { timeoutMs },
            timeoutMs + LEARN_GRACE_MS,
          ),
        );

        if (job.phase !== 'sweeping') {
          return;
        }

        if (!swept.success) {
          throw new Error(`${job.blasterName} found no frequency it said`);
        }

        job.frequencyHz = swept.data.frequencyHz;
      }

      this.#enter(job, 'listening', timeoutMs);
      since = this.#now();

      const answer = infraredCodeSchema.safeParse(
        await roles.send(
          job.blasterId,
          INFRARED_OPS.learn,
          { signal: job.signal, timeoutMs },
          timeoutMs + LEARN_GRACE_MS,
        ),
      );

      if (job.phase !== 'listening') {
        return;
      }

      if (!answer.success || answer.data.signal !== job.signal) {
        throw new Error(`${job.blasterName} answered with something that is not a code`);
      }

      const code = answer.data;

      job.code = withInfraredProtocol(
        code.signal === 'rf' && code.frequencyHz === undefined && job.frequencyHz !== null
          ? { ...code, frequencyHz: job.frequencyHz }
          : code,
      );
      this.#finish(job, 'captured');
    } catch (error: unknown) {
      // Cancelled, or its blaster removed: it ended already.
      if (!isRunning(job)) {
        return;
      }

      const isSilence =
        (error instanceof Error &&
          (error.name === 'TimeoutError' || error.name === 'AbortError')) ||
        this.#now() - since >= timeoutMs;

      job.error = isSilence
        ? `Nothing reached the blaster in ${String(Math.round(timeoutMs / 1000))} s.`
        : messageOf(error);
      this.#finish(job, 'failed');
    }
  }

  /**
   * Moves a job on to sweeping or listening.
   *
   * @param job - The job.
   * @param phase - Which.
   * @param timeoutMs - How long it lasts at most, for the countdown.
   */
  #enter(job: Job, phase: 'sweeping' | 'listening', timeoutMs: number): void {
    job.phase = phase;
    job.endsAt = new Date(this.#now() + timeoutMs);
  }

  /**
   * Ends a job.
   *
   * @param job - The job.
   * @param phase - How it ended.
   */
  #finish(job: Job, phase: 'captured' | 'failed' | 'cancelled'): void {
    job.phase = phase;
    job.finishedAt = new Date(this.#now());
    job.endsAt = null;
  }

  /** Forgets the jobs that ended more than an hour ago. */
  #pruneJobs(): void {
    const now = this.#now();

    for (const [id, job] of this.#jobs) {
      if (job.finishedAt !== null && now - job.finishedAt.getTime() > JOB_KEEP_MS) {
        this.#jobs.delete(id);
      }
    }
  }

  /**
   * Waits until a new remote's device is in the house: discovery proposes it, `api` adds it, and
   * only the instances say when.
   *
   * @param remoteId - The remote.
   * @returns Once it is, or the wait ran out; the remote stays saved either way.
   */
  async #waitForDevice(remoteId: string): Promise<void> {
    const looks = Math.ceil((this.#options.addWaitMs ?? ADD_WAIT_MS) / ADD_POLL_MS) + 1;
    const deviceKey = infraredDeviceKeyOf(remoteId);

    // Polled: discovery proposes it, `api` adds it, and only the registry says when.
    for (let look = 1; look <= looks; look += 1) {
      // eslint-disable-next-line no-await-in-loop -- see above
      await this.#read().catch(() => undefined);

      if (this.#house.has(deviceKey) || !this.#remotes.has(remoteId)) {
        return;
      }

      if (look < looks) {
        // eslint-disable-next-line no-await-in-loop -- see above
        await new Promise((resolve) => setTimeout(resolve, ADD_POLL_MS));
      }
    }

    this.#options.logger.warn({ remoteId }, 'A new remote was not added to the house in time');
  }

  /** Tells the remotes whose blaster came or went. */
  #deliver(): void {
    for (const remote of this.#remotes.values()) {
      const deviceKey = infraredDeviceKeyOf(remote.id);
      const isAvailable = this.#isAvailable(remote);

      if (this.#delivered.get(deviceKey) !== isAvailable) {
        this.#delivered.set(deviceKey, isAvailable);

        for (const listener of this.#availabilityListeners) {
          listener(deviceKey, isAvailable);
        }
      }
    }
  }

  /**
   * Whether a remote's blaster can send now.
   *
   * @param remote - The remote.
   * @returns True while it has one, and it runs.
   */
  #isAvailable(remote: StoredInfraredRemote): boolean {
    return remote.blasterId !== null && this.#blasters.get(remote.blasterId)?.isOnline === true;
  }

  /**
   * A remote as its device describes it.
   *
   * @param remote - The remote.
   * @returns Its snapshot.
   */
  #snapshotOf(remote: StoredInfraredRemote): InfraredRemoteSnapshot {
    return {
      deviceKey: infraredDeviceKeyOf(remote.id),
      kind: INFRARED_REMOTE_KIND,
      name: remote.name,
      buttons: this.#buttonsOf(remote.id).map((button) => ({
        id: button.id,
        name: button.name,
        icon: button.icon,
      })),
    };
  }

  /**
   * What a remote's device describes, to tell whether a change changed it.
   *
   * @param remoteId - The remote.
   * @returns Its snapshot as text; empty for a remote not there.
   */
  #signatureOf(remoteId: string): string {
    const remote = this.#remotes.get(remoteId);

    return remote === undefined ? '' : JSON.stringify(this.#snapshotOf(remote));
  }

  /**
   * Has a remote's device identified again when what it describes changed.
   *
   * @param remoteId - The remote.
   * @param before - What it described before the change.
   */
  #saved(remoteId: string, before: string): void {
    if (this.#signatureOf(remoteId) === before) {
      return;
    }

    this.#changed();

    const device = this.#house.get(infraredDeviceKeyOf(remoteId));

    if (device !== undefined) {
      for (const listener of this.#savedListeners) {
        listener([device.deviceId]);
      }
    }
  }

  /** Tells discovery the remotes changed. */
  #changed(): void {
    for (const listener of this.#deviceListeners) {
      listener();
    }
  }

  /**
   * A remote as the page lists it.
   *
   * @param remote - The remote.
   * @returns Its view.
   */
  #remoteView(remote: StoredInfraredRemote): InfraredRemote {
    const blaster = remote.blasterId === null ? undefined : this.#blasters.get(remote.blasterId);
    const device = this.#house.get(infraredDeviceKeyOf(remote.id));
    const buttons = this.#buttonsOf(remote.id);

    return {
      id: remote.id,
      name: remote.name,
      kind: remote.kind,
      blasterId: remote.blasterId,
      blasterName: blaster?.name ?? null,
      isBlasterOnline: blaster?.isOnline === true,
      // A profile sends `['ir']` or `['ir', 'rf']`.
      canRf: blaster?.profile.signals[1] === 'rf',
      columns: remote.columns,
      deviceId: device?.deviceId ?? null,
      areaId: device?.areaId ?? null,
      buttonCount: buttons.length,
      lastPressedAt: latest(buttons.map((button) => button.lastPressedAt)),
    };
  }

  /**
   * A button as the page shows it.
   *
   * @param button - The button.
   * @returns Its view.
   */
  #buttonView(button: StoredInfraredButton): InfraredButton {
    return {
      id: button.id,
      remoteId: button.remoteId,
      name: button.name,
      icon: button.icon,
      cell: button.cell,
      code: button.code,
      lastPressedAt: button.lastPressedAt,
    };
  }

  /**
   * A remote's buttons.
   *
   * @param remoteId - The remote.
   * @returns Them, by cell.
   */
  #buttonsOf(remoteId: string): StoredInfraredButton[] {
    return [...this.#buttons.values()]
      .filter((button) => button.remoteId === remoteId)
      .sort((left, right) => left.cell - right.cell);
  }

  /**
   * The first empty cells of a remote's keypad.
   *
   * @param remoteId - The remote.
   * @param count - How many.
   * @returns Them, in order.
   */
  #freeCells(remoteId: string, count: number): number[] {
    const held = new Set(this.#buttonsOf(remoteId).map((button) => button.cell));
    const cells: number[] = [];

    for (let cell = 0; cell <= LAST_CELL && cells.length < count; cell += 1) {
      if (!held.has(cell)) {
        cells.push(cell);
      }
    }

    return cells;
  }

  /**
   * Notes, from the presses kept, the last button sent and when each blaster last sent.
   *
   * @param buttons - Every button.
   */
  #noteKeptPresses(buttons: readonly StoredInfraredButton[]): void {
    for (const button of buttons) {
      const remote = this.#remotes.get(button.remoteId);
      const at = button.lastPressedAt;

      if (remote === undefined || at === null) {
        continue;
      }

      if (this.#lastSent === null || at > this.#lastSent.at) {
        this.#lastSent = {
          remoteId: remote.id,
          remoteName: remote.name,
          buttonId: button.id,
          buttonName: button.name,
          blasterId: remote.blasterId,
          at,
        };
      }

      const sent = remote.blasterId === null ? undefined : this.#sentAt.get(remote.blasterId);

      if (remote.blasterId !== null && (sent === undefined || at > sent)) {
        this.#sentAt.set(remote.blasterId, at);
      }
    }
  }

  /**
   * A remote by its id.
   *
   * @param id - The remote.
   * @returns It.
   * @throws {NotFoundError} When there is no such remote.
   */
  #requireRemote(id: string): StoredInfraredRemote {
    const remote = this.#remotes.get(id);

    if (remote === undefined) {
      throw new NotFoundError(`There is no infrared remote ${id}`, { details: { id } });
    }

    return remote;
  }

  /**
   * A button by its id.
   *
   * @param id - The button.
   * @returns It.
   * @throws {NotFoundError} When there is no such button.
   */
  #requireButton(id: string): StoredInfraredButton {
    const button = this.#buttons.get(id);

    if (button === undefined) {
      throw new NotFoundError(`There is no infrared button ${id}`, { details: { id } });
    }

    return button;
  }

  /**
   * A blaster by its device.
   *
   * @param deviceId - The device.
   * @returns It, as last read.
   * @throws {NotFoundError} When the device is not a blaster.
   */
  #requireBlaster(deviceId: string): Blaster {
    const blaster = this.#blasters.get(deviceId);

    if (blaster === undefined) {
      throw new NotFoundError(`${deviceId} is not an IR blaster`, { details: { deviceId } });
    }

    return blaster;
  }

  /**
   * A learn job by its id.
   *
   * @param jobId - The job.
   * @returns It.
   * @throws {NotFoundError} When there is no such job.
   */
  #requireJob(jobId: string): Job {
    const job = this.#jobs.get(jobId);

    if (job === undefined) {
      throw new NotFoundError(`There is no infrared learn job ${jobId}`, { details: { jobId } });
    }

    return job;
  }

  /**
   * Checks that a blaster sends a signal.
   *
   * @param blaster - The blaster.
   * @param signal - The signal.
   * @throws {ValidationError} When it does not.
   */
  #requireSignal(blaster: Blaster, signal: InfraredSignal): void {
    if (!(blaster.profile.signals as readonly InfraredSignal[]).includes(signal)) {
      throw new ValidationError(`${blaster.name} cannot send radio codes`, {
        details: { blasterId: blaster.deviceId, signal },
      });
    }
  }

  /**
   * Checks that a remote has room for more buttons.
   *
   * @param remote - The remote.
   * @param count - How many more.
   * @throws {ConflictError} When it has not.
   */
  #requireRoom(remote: StoredInfraredRemote, count: number): void {
    const room = INFRARED_MAXIMUM_BUTTONS - this.#buttonsOf(remote.id).length;

    if (count > room) {
      throw new ConflictError(`${remote.name} has room for ${String(room)} more buttons`, {
        details: { remoteId: remote.id, room },
      });
    }
  }

  /**
   * Checks that a cell of a keypad is empty, or holds the button itself.
   *
   * @param remoteId - The remote.
   * @param cell - The cell.
   * @param self - The button moving there, which may already be.
   * @throws {ConflictError} When another button is in it.
   */
  #requireEmpty(remoteId: string, cell: number, self: string | undefined): void {
    const holder = this.#buttonsOf(remoteId).find(
      (button) => button.cell === cell && button.id !== self,
    );

    if (holder !== undefined) {
      throw new ConflictError(
        `Cell ${String(cell)} holds ${holder.name}: a button moves only to an empty cell`,
        { details: { remoteId, cell, buttonId: holder.id } },
      );
    }
  }

  /**
   * The time now.
   *
   * @returns Milliseconds.
   */
  #now(): number {
    return this.#options.now?.() ?? Date.now();
  }
}
