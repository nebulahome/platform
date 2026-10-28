/**
 * The house's Thread broker, as the hub runs it: the Thread network, through an OpenThread Border
 * Router - the platform's own on a radio of this server, or the owner's external one.
 *
 * **Local.** The radio's port is held through the Serial broker, as `thread`. Before the border
 * router is given it, the radio is asked over Spinel which firmware it runs, so a Zigbee stick
 * fails here with a sentence rather than in `otbr-agent`'s log. The hub then writes
 * `<data>/hub/thread/otbr.conf` - the radio's URL and the interface of the default route, the only
 * two lines the `otbr` service takes - and asks the supervisor to restart the service. Leaving
 * local mode removes the file before stopping the service: it starts with the container and reads
 * the file each time.
 *
 * **External.** An OTBR elsewhere, by the URL of its REST API.
 *
 * Either way the network is the border router's: its key is never kept by the platform, and is
 * read from it on demand. Devices come from the Matter fabric's view of the network - Thread
 * devices are Matter devices in practice - and from the border router's own discovery, for
 * nodes the house does not have.
 */
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import type { z } from 'zod';

import {
  ConflictError,
  serialLineSchema,
  THREAD_LOCAL_REST_URL,
  THREAD_RCP_BAUD_RATE,
  THREAD_SETUP_STEPS,
  type MatterNetwork,
  type PlatformServiceRequest,
  type SerialUsb,
  type ThreadBorderRouter,
  type ThreadDevice,
  type ThreadDeviceRole,
  type ThreadRadio,
  type ThreadSetupJob,
  type ThreadSetupRequest,
  type ThreadStatus,
  type threadRadioCheckReplySchema,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';
import type { MdnsAnnouncement } from '@nebulahome/package-runtime';

import type { MdnsSource } from '../discovery/mdns-source.js';
import type { BluetoothInstance } from '../persistence/bluetooth.js';
import type { ThreadSettings, ThreadStore } from '../persistence/thread.js';
import type { SerialBroker } from '../serial/broker.js';

import type { ThreadHost } from './host.js';
import { newNetworkOf, networkOf, Otbr, type OtbrActiveDataset } from './otbr.js';
import { probeRcp } from './spinel.js';

/** The service type border routers announce themselves under. */
const MESHCOP = '_meshcop._udp';

/** How an RCP radio is spoken: 460 800 8N1. */
const RCP_LINE = serialLineSchema.parse({ baudRate: THREAD_RCP_BAUD_RATE });

/** How long a read for the status may take: the page polls it. */
const STATUS_TIMEOUT_MS = 2500;

/** How long the supervisor's answer about the network is kept. */
const BLOCKED_TTL_MS = 60_000;

/**
 * How long the nodes are given to hear of a change of name or channel before it applies: a
 * sleepy device polls its parent rarely.
 */
const PENDING_DELAY_MS = 5 * 60_000;

/** How often the border router is asked to discover the network again, at most. */
const DISCOVER_EVERY_MS = 60_000;

/** What a radio that does not speak Spinel is. */
const OTHER_FIRMWARE =
  'This radio runs other firmware (Zigbee?): flash the OpenThread RCP firmware first';

/** Why Thread cannot be set up here. */
const BLOCKED_SENTENCE = "Thread needs the host's network on Linux (NEBULA_NETWORK=host)";

/** Where the makers of the radios the platform recognises keep their flashers, by USB id. */
const FLASHERS: Readonly<Record<string, string>> = {
  '10c4:ea60': 'https://toolbox.openhomefoundation.org/',
  '1915:cafe': 'https://www.nordicsemi.com/Products/Development-tools/nRF-Connect-for-Desktop',
};

/** How long the steps of a setup wait, and how often they look. */
export type ThreadWaits = {
  /** For the border router's REST API to answer after a restart. */
  readonly borderRouterMs: number;

  /** For the border router to be leader or router of the network. */
  readonly roleMs: number;
  readonly pollMs: number;

  /** For border routers to answer an mDNS question. */
  readonly browseMs: number;

  /** For a radio to answer the firmware question. */
  readonly probeMs: number;
};

/** How long the steps of a setup wait. */
const WAITS: ThreadWaits = {
  borderRouterMs: 60_000,
  roleMs: 3 * 60_000,
  pollMs: 2000,
  browseMs: 1500,
  probeMs: 3000,
};

/** What the broker asks of the supervisor. */
export type ThreadSupervisor = {
  /** How the platform runs: its network, and whether Docker is Docker Desktop. */
  readonly status: () => Promise<{
    readonly platformNetwork: string | null;
    readonly isDesktop?: boolean | undefined;
  }>;

  /** Starts, stops or restarts the `otbr` service. */
  readonly service: (action: PlatformServiceRequest['action']) => Promise<void>;
};

/** What the broker needs. */
export type ThreadBrokerOptions = {
  readonly store: ThreadStore;
  readonly host: ThreadHost;
  readonly serial: Pick<
    SerialBroker,
    'claimForBroker' | 'releaseBroker' | 'openForBroker' | 'ports' | 'onPlugged'
  >;
  readonly supervisor: ThreadSupervisor;

  /** A browser of its own for `_meshcop._udp`, started the first time border routers are asked. */
  readonly mdns: MdnsSource;
  readonly logger: PlatformLogger;

  /** The Matter fabric's network: the house's Thread devices, their roles and links. */
  readonly matterNetwork: () => MatterNetwork;

  /** The house's instances, for the device each Matter node is. */
  readonly instances: () => Promise<readonly BluetoothInstance[]>;

  /** Told when Thread was set up or removed, so Matter reads the network again. */
  readonly onChange?: () => void;

  /** The platform's border router's REST API; {@link THREAD_LOCAL_REST_URL} unless a test says. */
  readonly localUrl?: string;
  readonly waits?: Partial<ThreadWaits>;
};

/** Which firmware a radio runs, or why it could not be asked. */
type ThreadRadioCheckReply = z.output<typeof threadRadioCheckReplySchema>;

/** One node, and whether it answers. */
type Node = { readonly device: ThreadDevice; readonly isOnline: boolean };

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
 * The role the Devices tab chips, from the controller's or the border router's name for it.
 *
 * @param role - `leader`, `router`, `end_device`, `sleepy_end_device`, `child`…
 * @param isSleepy - Whether the border router says its radio sleeps.
 * @returns The role.
 */
function roleOf(role: string | null | undefined, isSleepy = false): ThreadDeviceRole {
  if (role === 'leader' || role === 'router') {
    return role;
  }

  return role === 'sleepy_end_device' || isSleepy ? 'sleepy' : 'end-device';
}

/**
 * A `_meshcop._udp` value as sixteen hex digits: the source gives a binary value as hex, and one
 * whose bytes happened to read as text as that text.
 *
 * @param value - The TXT value.
 * @returns The hex, or null.
 */
function hex64Of(value: string | undefined): string | null {
  if (value === undefined || value === '') {
    return null;
  }

  const hex = /^[0-9a-f]{16}$/iu.test(value) ? value : Buffer.from(value, 'utf8').toString('hex');

  return hex.length === 16 ? hex.toLowerCase() : null;
}

/**
 * The maker's flasher for a radio the platform recognises.
 *
 * @param usb - What its adapter says.
 * @returns The URL, or null.
 */
function flasherOf(usb: SerialUsb | null): string | null {
  return usb === null ? null : (FLASHERS[`${usb.vendorId}:${usb.productId}`] ?? null);
}

/** The house's Thread broker. */
export class ThreadBroker {
  readonly #options: ThreadBrokerOptions;
  readonly #waits: ThreadWaits;
  readonly #localUrl: string;
  #settings: ThreadSettings = {
    mode: 'none',
    externalUrl: null,
    radioPortId: null,
    useForMatter: true,
  };

  #error: string | null = null;
  #job: ThreadSetupJob | null = null;
  #agentVersion: Promise<string | null> | undefined;
  #blocked: { readonly at: number; readonly value: ThreadStatus['setupBlockedBy'] } | undefined;
  #isBrowsing = false;
  readonly #heard = new Map<string, MdnsAnnouncement>();
  #discoveredAt = 0;
  #unplug: (() => void) | undefined;

  /**
   * Prepares the broker; nothing is read until it starts.
   *
   * @param options - What it needs.
   */
  constructor(options: ThreadBrokerOptions) {
    this.#options = options;
    this.#waits = { ...WAITS, ...options.waits };
    this.#localUrl = options.localUrl ?? THREAD_LOCAL_REST_URL;
  }

  /**
   * Reads the settings, and follows the radio's port. Never throws: a failure shows on the page.
   *
   * @returns Once read.
   */
  async start(): Promise<void> {
    try {
      this.#settings = await this.#options.store.settings();
      this.#error = null;
    } catch (error: unknown) {
      this.#error = messageOf(error);
      this.#options.logger.error({ err: error }, 'The Thread broker could not read its settings');
    }

    this.#unplug = this.#options.serial.onPlugged((port) => {
      // The service retries a missing radio every few seconds; this opens it at once.
      if (this.#settings.mode === 'local' && port.id === this.#settings.radioPortId) {
        void this.#options.supervisor.service('restart').catch((error: unknown) => {
          this.#options.logger.warn({ err: error }, 'Could not restart the border router');
        });
      }
    });
  }

  /**
   * Stops browsing for border routers.
   *
   * @returns Once stopped.
   */
  async stop(): Promise<void> {
    this.#unplug?.();

    if (this.#isBrowsing) {
      this.#isBrowsing = false;
      await this.#options.mdns.stop();
    }
  }

  /**
   * Whether Thread is set up: the Matter fabric then opens with Thread's diagnostics.
   *
   * @returns True with a border router, local or external.
   */
  isSetUp(): boolean {
    return this.#settings.mode !== 'none';
  }

  /**
   * Where the broker stands.
   *
   * @returns Its status.
   */
  async status(): Promise<ThreadStatus> {
    const settings = this.#settings;
    const [setupBlockedBy, ipv6] = await Promise.all([this.#blockedBy(), this.#ipv6()]);
    const base = {
      mode: settings.mode,
      setupBlockedBy,
      ipv6,
      useForMatter: settings.useForMatter,
      setup: this.#job,
    };
    const isSettingUp = this.#job?.state === 'running';
    const url = this.#url();

    if (url === null || this.#error !== null) {
      const radios = await this.radios().catch((): ThreadRadio[] => []);

      return {
        ...base,
        state:
          this.#error !== null
            ? 'failed'
            : isSettingUp
              ? 'starting'
              : radios.length > 0
                ? 'disabled'
                : 'unavailable',
        error: this.#error,
        borderRouter: null,
        radio: null,
        network: null,
        devices: { routers: 0, endDevices: 0, sleepy: 0, total: 0, online: 0 },
      };
    }

    const otbr = new Otbr(url, STATUS_TIMEOUT_MS);
    const isLocal = settings.mode === 'local';
    const [role, dataset, firmware, version, nodes, radio] = await Promise.all([
      otbr.role().catch((error: unknown) => new Error(messageOf(error))),
      otbr.activeDataset().catch(() => null),
      isLocal ? otbr.coprocessorVersion().catch(() => null) : null,
      isLocal ? this.#version() : null,
      this.#nodes(otbr).catch((): Node[] => []),
      isLocal ? this.#radioPort(settings.radioPortId) : null,
    ]);
    const isRunning = !(role instanceof Error);
    const error = isRunning
      ? radio !== null && !radio.isConnected
        ? 'The radio is unplugged'
        : null
      : `The border router does not answer: ${role.message}`;
    const devices = nodes.map((node) => node.device);

    return {
      ...base,
      state: isSettingUp ? 'starting' : error === null ? 'running' : 'failed',
      error,
      borderRouter: { isRunning, version, url },
      radio: radio === null ? null : { ...radio, firmware },
      network: isRunning && dataset !== null ? networkOf(dataset, role) : null,
      devices: {
        routers: devices.filter((device) => device.role === 'leader' || device.role === 'router')
          .length,
        endDevices: devices.filter((device) => device.role === 'end-device').length,
        sleepy: devices.filter((device) => device.role === 'sleepy').length,
        total: devices.filter((device) => device.deviceId !== null).length,
        online: nodes.filter((node) => node.device.deviceId !== null && node.isOnline).length,
      },
    };
  }

  /**
   * The ports a radio may be on: plugged into this server, and free or Thread's own; the radios
   * the platform recognises first.
   *
   * @returns Them.
   */
  async radios(): Promise<ThreadRadio[]> {
    const ports = await this.#options.serial.ports();

    return ports
      .filter(
        (port) =>
          port.kind !== 'network' &&
          port.isConnected &&
          (port.holder === null || port.holder.broker === 'thread'),
      )
      .map((port) => {
        // Thread is the one broker that claims ports.
        const claim = port.claims.find((each) => each.kind === 'broker');

        return {
          portId: port.id,
          name: port.name,
          path: port.path,
          model: claim?.model ?? null,
          flasherUrl: claim === undefined ? null : flasherOf(port.usb),
        };
      })
      .sort(
        (left, right) =>
          Number(right.model !== null) - Number(left.model !== null) ||
          left.name.localeCompare(right.name),
      );
  }

  /**
   * Asks a radio which firmware it runs. The platform's border router answers for the radio it
   * holds; any other is held for the question and let go of after.
   *
   * @param portId - The port.
   * @returns The firmware, or why it could not be asked.
   * @throws {ConflictError} While Thread is being set up, or when another holder has the port.
   * @throws {NotFoundError} When there is no such port, from the Serial broker.
   */
  async checkRadio(portId: string): Promise<ThreadRadioCheckReply> {
    const settings = this.#settings;

    if (settings.mode === 'local' && settings.radioPortId === portId) {
      try {
        const version = await new Otbr(this.#localUrl, STATUS_TIMEOUT_MS).coprocessorVersion();

        return { firmware: 'openthread-rcp', version, error: null };
      } catch (error: unknown) {
        return { firmware: 'unknown', version: null, error: messageOf(error) };
      }
    }

    if (this.#job?.state === 'running') {
      throw new ConflictError('Thread is being set up; wait for it to finish');
    }

    await this.#options.serial.claimForBroker('thread', portId, RCP_LINE);

    try {
      const version = await this.#probe(portId);

      return version === null
        ? { firmware: 'zigbee', version: null, error: OTHER_FIRMWARE }
        : { firmware: 'openthread-rcp', version, error: null };
    } catch (error: unknown) {
      return { firmware: 'unknown', version: null, error: messageOf(error) };
    } finally {
      await this.#holdOwnRadio();
    }
  }

  /**
   * Starts setting Thread up: the border router, its radio, the network, the hand-off to Matter.
   * The job is followed in the status.
   *
   * @param request - Whose border router, which network, and whether Matter takes it.
   * @returns Where the broker stands, the job running.
   * @throws {ConflictError} While a setup runs, or when this server cannot run Thread.
   */
  async setup(request: ThreadSetupRequest): Promise<ThreadStatus> {
    if (this.#job?.state === 'running') {
      throw new ConflictError('Thread is being set up already; wait for it to finish');
    }

    if ((await this.#blockedBy(true)) !== null) {
      throw new ConflictError(BLOCKED_SENTENCE);
    }

    const job: ThreadSetupJob = {
      id: randomBytes(8).toString('hex'),
      state: 'running',
      startedAt: new Date(),
      finishedAt: null,
      error: null,
      steps: THREAD_SETUP_STEPS.map((id) => ({ id, state: 'pending', message: null })),
    };

    this.#job = job;
    this.#options.logger.info({ job: job.id, mode: request.border.mode }, 'Setting Thread up');
    void this.#runSetup(job.id, request);

    return this.status();
  }

  /**
   * Saves the owner's settings: a new name or channel goes to the network as a pending dataset.
   *
   * @param request - What changes.
   * @param request.name - The network's name.
   * @param request.channel - Its channel.
   * @param request.useForMatter - Whether Matter is handed the network.
   * @returns Where the broker stands.
   * @throws {ConflictError} When a name or channel is given and there is no network.
   */
  async saveSettings(request: {
    name?: string | undefined;
    channel?: number | undefined;
    useForMatter?: boolean | undefined;
  }): Promise<ThreadStatus> {
    if (request.name !== undefined || request.channel !== undefined) {
      const otbr = this.#otbr();
      const active = await this.#activeOf(otbr);
      const change = {
        networkName: request.name === active.networkName ? undefined : request.name,
        channel: request.channel === active.channel ? undefined : request.channel,
      };

      if (change.networkName !== undefined || change.channel !== undefined) {
        await otbr.schedule(change, active.activeTimestamp?.seconds ?? 0, PENDING_DELAY_MS);
        this.#options.logger.info(change, 'Changing the Thread network');
      }
    }

    if (
      request.useForMatter !== undefined &&
      request.useForMatter !== this.#settings.useForMatter
    ) {
      await this.#save({ ...this.#settings, useForMatter: request.useForMatter });
    }

    return this.status();
  }

  /**
   * Joins another network by its dataset, leaving the current one.
   *
   * @param dataset - The dataset as TLV hex.
   * @returns Where the broker stands.
   * @throws {ConflictError} When Thread is not set up.
   */
  async join(dataset: string): Promise<ThreadStatus> {
    const otbr = this.#otbr();

    await otbr.enable(false);
    await otbr.join(dataset);
    await otbr.enable(true);
    this.#options.logger.info('Joined another Thread network');

    return this.status();
  }

  /**
   * Restarts the platform's border router.
   *
   * @returns Where the broker stands.
   * @throws {ConflictError} When the border router is not the platform's.
   */
  async restart(): Promise<ThreadStatus> {
    if (this.#settings.mode !== 'local') {
      throw new ConflictError(
        this.#settings.mode === 'none'
          ? 'Thread is not set up'
          : 'An external border router is restarted where it runs',
      );
    }

    await this.#options.supervisor.service('restart');

    return this.status();
  }

  /**
   * Removes the border router: the platform's stops and lets go of its radio; an external one is
   * forgotten, and left as it is.
   *
   * @returns Whether there was one.
   * @throws {ConflictError} While Thread is being set up.
   */
  async remove(): Promise<{ isRemoved: boolean }> {
    if (this.#settings.mode === 'none') {
      return { isRemoved: false };
    }

    if (this.#job?.state === 'running') {
      throw new ConflictError('Thread is being set up; wait for it to finish');
    }

    if (this.#settings.mode === 'local') {
      await this.#leaveLocal();
    }

    await this.#save({
      mode: 'none',
      externalUrl: null,
      radioPortId: null,
      useForMatter: this.#settings.useForMatter,
    });
    this.#options.logger.info('Removed the Thread border router');
    this.#options.onChange?.();

    return { isRemoved: true };
  }

  /**
   * Reads the network key from the border router; it is never kept.
   *
   * @returns The key, 32 hex digits.
   * @throws {ConflictError} When Thread is not set up, or there is no network.
   */
  async networkKey(): Promise<{ networkKey: string }> {
    return { networkKey: (await this.#activeOf(this.#otbr())).networkKey.toLowerCase() };
  }

  /**
   * Reads the active dataset from the border router; it is never kept.
   *
   * @returns The dataset as TLV hex.
   * @throws {ConflictError} When Thread is not set up, or there is no network.
   */
  async dataset(): Promise<{ dataset: string }> {
    const tlvs = await this.#otbr().datasetTlvs();

    if (tlvs === null) {
      throw new ConflictError('The border router has no network yet');
    }

    return { dataset: tlvs };
  }

  /**
   * The dataset Matter gives a new Thread device, when the network is handed to it.
   *
   * @returns The TLV hex, or null.
   */
  async matterDataset(): Promise<string | null> {
    const url = this.#url();

    return url === null || !this.#settings.useForMatter
      ? null
      : new Otbr(url, STATUS_TIMEOUT_MS).datasetTlvs().catch(() => null);
  }

  /**
   * The network Matter's Settings show, when it is handed to Matter.
   *
   * @returns Its name and channel, or null.
   */
  async matterNetwork(): Promise<{ networkName: string; channel: number } | null> {
    const url = this.#url();

    if (url === null || !this.#settings.useForMatter) {
      return null;
    }

    const dataset = await new Otbr(url, STATUS_TIMEOUT_MS).activeDataset().catch(() => null);

    return dataset === null ? null : { networkName: dataset.networkName, channel: dataset.channel };
  }

  /**
   * The border routers heard on the network, this server's first.
   *
   * @returns Them.
   */
  async borderRouters(): Promise<ThreadBorderRouter[]> {
    const { mdns } = this.#options;

    if (!this.#isBrowsing) {
      this.#isBrowsing = true;
      mdns.start([MESHCOP], (announcement) => {
        this.#heard.set(announcement.instance, announcement);
      });
    }

    // What is still remembered is told again at once; what answers anew, in a moment.
    this.#heard.clear();
    mdns.query();
    await delay(this.#waits.browseMs);

    const url = this.#url();
    const otbr = url === null ? null : new Otbr(url, STATUS_TIMEOUT_MS);
    const [ours, dataset] = await Promise.all([
      otbr?.extAddress().catch(() => null) ?? null,
      otbr?.activeDataset().catch(() => null) ?? null,
    ]);
    const extPanId = dataset?.extPanId.toLowerCase() ?? null;

    return [...this.#heard.values()]
      .map((heard): ThreadBorderRouter => {
        const xp = hex64Of(heard.txt['xp']);

        return {
          id: heard.instance.slice(0, 256),
          name: heard.instance.slice(0, 256),
          vendor: heard.txt['vn']?.slice(0, 128) ?? null,
          model: heard.txt['mn']?.slice(0, 128) ?? null,
          networkName: heard.txt['nn']?.slice(0, 16) ?? null,
          extPanId: xp,
          address: heard.address.slice(0, 64),
          isThisServer: ours !== null && hex64Of(heard.txt['xa']) === ours,
          isSameNetwork: extPanId !== null && xp === extPanId,
        };
      })
      .sort(
        (left, right) =>
          Number(right.isThisServer) - Number(left.isThisServer) ||
          left.name.localeCompare(right.name),
      );
  }

  /**
   * The nodes of the network: the house's devices first, then those it does not have.
   *
   * @returns Them.
   */
  async devices(): Promise<ThreadDevice[]> {
    const url = this.#url();

    return url === null ? [] : (await this.#nodes(new Otbr(url))).map((node) => node.device);
  }

  /**
   * The nodes, from the Matter fabric's view of the network and the border router's device
   * collection, which it is asked to fill again once a minute at most.
   *
   * @param otbr - The border router.
   * @returns Every node, and whether it answers.
   */
  async #nodes(otbr: Otbr): Promise<Node[]> {
    const network = this.#options.matterNetwork();
    const [instances, ours, discovered] = await Promise.all([
      this.#options.instances(),
      otbr.extAddress().catch(() => null),
      otbr.devices().catch(() => []),
    ]);

    if (Date.now() - this.#discoveredAt > DISCOVER_EVERY_MS) {
      this.#discoveredAt = Date.now();
      void otbr.discover().catch((error: unknown) => {
        this.#options.logger.debug({ err: error }, 'The border router did not take discovery');
      });
    }

    const points = new Map(network.nodes.map((point) => [point.id, point]));
    const nodes: Node[] = [];
    const seen = new Set<string>();

    for (const point of network.nodes) {
      const extAddress = point.extAddress?.toLowerCase() ?? null;

      if (
        point.network !== 'thread' ||
        point.kind === 'border_router' ||
        extAddress === null ||
        extAddress === ours ||
        seen.has(extAddress)
      ) {
        continue;
      }

      seen.add(extAddress);

      const { nodeId } = point;
      const instance =
        nodeId === null
          ? undefined
          : instances.find(
              (each) =>
                each.transport === 'matter' &&
                (each.externalId === nodeId || each.externalId?.startsWith(`${nodeId}:`) === true),
            );
      const role = roleOf(point.role);
      const links = network.links
        .filter(
          (link) => link.network === 'thread' && [link.source, link.target].includes(point.id),
        )
        .map((link) => ({
          link,
          other: points.get(link.source === point.id ? link.target : link.source),
        }));
      const parent =
        role === 'end-device' || role === 'sleepy'
          ? links.find(({ other }) => other?.role === 'router' || other?.role === 'leader')
          : undefined;
      const best =
        parent ??
        [...links].sort((left, right) => (right.link.lqi ?? -1) - (left.link.lqi ?? -1))[0];
      const parentName =
        parent?.other?.nodeId === null || parent?.other?.nodeId === undefined
          ? null
          : (instances.find(
              (each) => each.transport === 'matter' && each.externalId === parent.other?.nodeId,
            )?.name ?? null);

      nodes.push({
        device: {
          extAddress,
          deviceId: instance?.id ?? null,
          name: instance?.name.slice(0, 256) ?? null,
          areaId: instance?.areaId ?? null,
          role,
          parentExtAddress: parent?.other?.extAddress?.toLowerCase() ?? null,
          parentName,
          linkQuality:
            best?.link.lqi === null || best?.link.lqi === undefined
              ? null
              : Math.max(0, Math.min(3, best.link.lqi)),
          rssi:
            best?.link.rssi === null || best?.link.rssi === undefined
              ? null
              : Math.max(-127, Math.min(20, best.link.rssi)),
          lastSeenAt: point.isAvailable === true ? network.collectedAt : null,
        },
        isOnline: point.isAvailable === true,
      });
    }

    for (const device of discovered) {
      if (device.extAddress === ours || seen.has(device.extAddress)) {
        continue;
      }

      seen.add(device.extAddress);
      nodes.push({
        device: {
          extAddress: device.extAddress,
          deviceId: null,
          name: null,
          areaId: null,
          role: roleOf(device.role, device.isSleepy),
          parentExtAddress: null,
          parentName: null,
          linkQuality: null,
          rssi: null,
          lastSeenAt: null,
        },
        isOnline: true,
      });
    }

    return nodes.sort(
      (left, right) =>
        Number(right.device.deviceId !== null) - Number(left.device.deviceId !== null) ||
        (left.device.name ?? '').localeCompare(right.device.name ?? '') ||
        left.device.extAddress.localeCompare(right.device.extAddress),
    );
  }

  /**
   * Runs a setup, step by step; a step that fails ends it with its line.
   *
   * @param jobId - The job.
   * @param request - What was asked.
   * @returns Once it ended.
   */
  async #runSetup(jobId: string, request: ThreadSetupRequest): Promise<void> {
    const { border } = request;

    try {
      await this.#step(jobId, 'border-router', async () =>
        border.mode === 'local'
          ? this.#startLocal(border.portId, request.useForMatter)
          : this.#useExternal(border.url, request.useForMatter),
      );

      const otbr = this.#otbr();

      await this.#step(jobId, 'radio', async () =>
        border.mode === 'local'
          ? `RCP ${await otbr.coprocessorVersion()}`
          : 'Managed by the external border router',
      );
      await this.#step(jobId, 'network', async () => this.#joinNetwork(otbr, request.network));
      await this.#step(jobId, 'matter', async () => {
        if (!request.useForMatter) {
          return 'Not handed to Matter';
        }

        if ((await otbr.datasetTlvs()) === null) {
          throw new Error('The border router has no dataset to hand to Matter');
        }

        return 'Handed to Matter';
      });
      this.#endJob(jobId, null);
      this.#options.logger.info({ job: jobId }, 'Thread is set up');
    } catch (error: unknown) {
      this.#endJob(jobId, messageOf(error));
      this.#options.logger.warn({ err: error, job: jobId }, 'Setting Thread up failed');
    } finally {
      this.#options.onChange?.();
    }
  }

  /**
   * Runs one step of the setup, keeping the job up to date.
   *
   * @param jobId - The job.
   * @param stepId - The step.
   * @param work - What it does; resolves with what it found.
   * @returns Once done.
   * @throws {Error} What the step threw, after marking it failed with it.
   */
  async #step(
    jobId: string,
    stepId: ThreadSetupJob['steps'][number]['id'],
    work: () => Promise<string | null>,
  ): Promise<void> {
    /**
     * Marks the step.
     *
     * @param state - How it stands.
     * @param message - What it found, or the line it failed on.
     */
    const mark = (state: 'running' | 'done' | 'failed', message: string | null): void => {
      if (this.#job?.id === jobId) {
        this.#job = {
          ...this.#job,
          steps: this.#job.steps.map((step) =>
            step.id === stepId
              ? { ...step, state, message: message?.slice(0, 2048) ?? null }
              : step,
          ),
        };
      }
    };

    mark('running', null);

    try {
      mark('done', await work());
    } catch (error: unknown) {
      mark('failed', messageOf(error));
      throw error;
    }
  }

  /**
   * Ends the job.
   *
   * @param jobId - The job.
   * @param error - Why it failed; null when it did not.
   */
  #endJob(jobId: string, error: string | null): void {
    if (this.#job?.id === jobId) {
      this.#job = {
        ...this.#job,
        state: error === null ? 'succeeded' : 'failed',
        finishedAt: new Date(),
        error,
      };
    }
  }

  /**
   * Starts the platform's border router on a radio: the radio held and asked its firmware, the
   * service's file written, the service restarted and its REST API answering.
   *
   * @param portId - The radio's port.
   * @param useForMatter - Whether Matter is handed the network.
   * @returns What the step says: the border router's version.
   * @throws {Error} When any of it fails, with why.
   */
  async #startLocal(portId: string, useForMatter: boolean): Promise<string | null> {
    const { serial, supervisor, host } = this.#options;

    // The border router lets go of the radio it had before anything opens it again.
    if (this.#settings.mode === 'local') {
      await supervisor.service('stop');
    }

    const { stablePath } = await serial.claimForBroker('thread', portId, RCP_LINE);

    if (!stablePath.startsWith('/dev/')) {
      throw new Error("The radio must be on a serial port of this server's");
    }

    const version = await this.#probe(portId);

    if (version === null) {
      await this.#holdOwnRadio();
      throw new Error(OTHER_FIRMWARE);
    }

    const infraIf = await host.defaultInterface();

    if (infraIf === null || !/^[A-Za-z0-9_.-]{1,15}$/u.test(infraIf)) {
      throw new Error('This server has no default route for the border router to join Thread to');
    }

    await host.writeConfig({
      radioUrl: `spinel+hdlc+uart://${stablePath}?uart-baudrate=${String(THREAD_RCP_BAUD_RATE)}`,
      infraIf,
    });
    await this.#save({ mode: 'local', externalUrl: null, radioPortId: portId, useForMatter });
    await supervisor.service('restart');
    await this.#waitFor(
      async () => {
        await new Otbr(this.#localUrl, STATUS_TIMEOUT_MS).role();

        return true;
      },
      this.#waits.borderRouterMs,
      'The border router did not start: its log is the otbr service’s',
    );

    const agent = await this.#version();

    return agent === null ? null : `OTBR ${agent}`;
  }

  /**
   * Takes an external border router: it must answer.
   *
   * @param url - Its REST API.
   * @param useForMatter - Whether Matter is handed the network.
   * @returns What the step says.
   * @throws {Error} When it does not answer.
   */
  async #useExternal(url: string, useForMatter: boolean): Promise<string> {
    try {
      await new Otbr(url, STATUS_TIMEOUT_MS * 2).role();
    } catch (error: unknown) {
      throw new Error(`The border router at ${url} does not answer: ${messageOf(error)}`, {
        cause: error,
      });
    }

    if (this.#settings.mode === 'local') {
      await this.#leaveLocal();
    }

    await this.#save({ mode: 'external', externalUrl: url, radioPortId: null, useForMatter });

    return `External · ${new URL(url).host}`;
  }

  /**
   * Gives the border router its network - a new one, one joined, or the one it has - and waits
   * for it to lead or route in it.
   *
   * @param otbr - The border router.
   * @param network - What was asked.
   * @returns What the step says: its role.
   * @throws {Error} When the network is refused, or the border router does not attach in time.
   */
  async #joinNetwork(otbr: Otbr, network: ThreadSetupRequest['network']): Promise<string> {
    if (network.action === 'keep') {
      if ((await otbr.activeDataset()) === null) {
        throw new Error('The border router has no network yet: create one or join one');
      }
    } else {
      // The active dataset is only taken while Thread is off.
      await otbr.enable(false);
      await (network.action === 'create'
        ? otbr.form(
            newNetworkOf({ networkName: network.name, channel: network.channel }, randomBytes),
          )
        : otbr.join(network.dataset));
    }

    await otbr.enable(true);

    const role = await this.#waitFor(
      async () => {
        const now = await otbr.role();

        return now === 'leader' || now === 'router' ? now : undefined;
      },
      this.#waits.roleMs,
      'The border router did not join the network in time',
    );

    return role === 'leader' ? 'Leader' : 'Router';
  }

  /**
   * Stops the platform's border router for good: its file first, which it would read at the next
   * start, then the service, then the radio.
   *
   * @returns Once stopped.
   */
  async #leaveLocal(): Promise<void> {
    await this.#options.host.removeConfig();
    await this.#options.supervisor.service('stop');
    await this.#options.serial.releaseBroker('thread');
  }

  /**
   * Asks the radio Thread holds for its firmware.
   *
   * @param portId - Its port.
   * @returns The version, or null when it did not speak Spinel.
   */
  async #probe(portId: string): Promise<string | null> {
    const session = await this.#options.serial.openForBroker('thread', portId, RCP_LINE);

    try {
      return await probeRcp(session, this.#waits.probeMs);
    } finally {
      await session.close();
    }
  }

  /**
   * Holds the radio of the platform's border router again, or none: after a question to another
   * port, the claim is the border router's again.
   *
   * @returns Once held.
   */
  async #holdOwnRadio(): Promise<void> {
    const { radioPortId, mode } = this.#settings;

    await (mode === 'local' && radioPortId !== null
      ? this.#options.serial.claimForBroker('thread', radioPortId, RCP_LINE)
      : this.#options.serial.releaseBroker('thread'));
  }

  /**
   * Waits until something says yes.
   *
   * @param check - Resolves with the answer, undefined for not yet; a throw counts as not yet.
   * @param timeoutMs - How long to wait.
   * @param failure - What is thrown when the time is up.
   * @returns The answer.
   * @throws {Error} When the time is up, with the last failure.
   */
  async #waitFor<TResult>(
    check: () => Promise<TResult | undefined>,
    timeoutMs: number,
    failure: string,
  ): Promise<TResult> {
    const until = Date.now() + timeoutMs;
    let last: unknown;

    for (;;) {
      try {
        // eslint-disable-next-line no-await-in-loop -- one look after another
        const answer = await check();

        if (answer !== undefined) {
          return answer;
        }
      } catch (error: unknown) {
        last = error;
      }

      if (Date.now() >= until) {
        throw new Error(last === undefined ? failure : `${failure}: ${messageOf(last)}`);
      }

      // eslint-disable-next-line no-await-in-loop -- see above
      await delay(this.#waits.pollMs);
    }
  }

  /**
   * The radio's port, as the Radio card shows it.
   *
   * @param portId - The port.
   * @returns It, or null when the Serial broker has forgotten it.
   */
  async #radioPort(
    portId: string | null,
  ): Promise<Omit<NonNullable<ThreadStatus['radio']>, 'firmware'> | null> {
    const port = (await this.#options.serial.ports().catch(() => [])).find(
      (each) => each.id === portId,
    );

    return port === undefined
      ? null
      : { portId: port.id, name: port.name, path: port.path, isConnected: port.isConnected };
  }

  /**
   * Why Thread cannot be set up here: a container on a bridge network, or Docker Desktop.
   *
   * @param isFresh - Whether to ask the supervisor again rather than read what it last said.
   * @returns The reason, or null; null too when the supervisor does not answer.
   */
  async #blockedBy(isFresh = false): Promise<ThreadStatus['setupBlockedBy']> {
    if (!isFresh && this.#blocked !== undefined && Date.now() - this.#blocked.at < BLOCKED_TTL_MS) {
      return this.#blocked.value;
    }

    try {
      const status = await this.#options.supervisor.status();
      const value =
        status.isDesktop === true
          ? 'desktop'
          : status.platformNetwork === 'bridge'
            ? 'bridge'
            : null;

      this.#blocked = { at: Date.now(), value };

      return value;
    } catch {
      return this.#blocked?.value ?? null;
    }
  }

  /**
   * Whether the server takes the routes a border router announces: the interface of the default
   * route must accept router advertisements while forwarding (`accept_ra` 2) and their route
   * information up to a /64.
   *
   * @returns The check, with the settings to fix.
   */
  async #ipv6(): Promise<ThreadStatus['ipv6']> {
    const { host } = this.#options;
    const iface = await host.defaultInterface();

    if (iface === null) {
      return { isOk: false, interface: null, fixes: [] };
    }

    const [acceptRa, maxPlen, forwarding] = await Promise.all([
      host.ipv6Setting(iface, 'accept_ra'),
      host.ipv6Setting(iface, 'accept_ra_rt_info_max_plen'),
      host.ipv6Setting(iface, 'forwarding'),
    ]);
    const fixes: ThreadStatus['ipv6']['fixes'] = [];

    if (acceptRa !== '2' && !(acceptRa === '1' && forwarding === '0')) {
      fixes.push({ key: `net.ipv6.conf.${iface}.accept_ra`, current: acceptRa, wanted: '2' });
    }

    if (!(Number(maxPlen ?? '0') >= 64)) {
      fixes.push({
        key: `net.ipv6.conf.${iface}.accept_ra_rt_info_max_plen`,
        current: maxPlen,
        wanted: '64',
      });
    }

    return { isOk: fixes.length === 0, interface: iface.slice(0, 32), fixes };
  }

  /**
   * The version of the platform's `otbr-agent`, asked once.
   *
   * @returns It, or null where there is none.
   */
  async #version(): Promise<string | null> {
    this.#agentVersion ??= this.#options.host.agentVersion();

    return this.#agentVersion;
  }

  /**
   * The active dataset, which must be there.
   *
   * @param otbr - The border router.
   * @returns It.
   * @throws {ConflictError} When there is no network yet.
   */
  async #activeOf(otbr: Otbr): Promise<OtbrActiveDataset> {
    const active = await otbr.activeDataset();

    if (active === null) {
      throw new ConflictError('The border router has no network yet');
    }

    return active;
  }

  /**
   * The border router's REST API.
   *
   * @returns Its URL, or null while Thread is not set up.
   */
  #url(): string | null {
    const { mode, externalUrl } = this.#settings;

    return mode === 'local' ? this.#localUrl : mode === 'external' ? externalUrl : null;
  }

  /**
   * The border router, which must be there.
   *
   * @returns It.
   * @throws {ConflictError} While Thread is not set up.
   */
  #otbr(): Otbr {
    const url = this.#url();

    if (url === null) {
      throw new ConflictError('Thread is not set up');
    }

    return new Otbr(url);
  }

  /**
   * Saves the settings, and keeps them.
   *
   * @param next - The settings.
   * @returns Once saved.
   */
  async #save(next: ThreadSettings): Promise<void> {
    await this.#options.store.saveSettings(next);
    this.#settings = next;
  }
}
