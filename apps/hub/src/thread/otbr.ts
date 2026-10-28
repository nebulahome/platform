/**
 * The REST API of an OpenThread Border Router: the platform's own on loopback, or the owner's
 * external one.
 *
 * `OtbrRestClient` from `@matter/thread-br-client` makes the calls it knows: the node's state
 * and address, the active dataset as TLVs, the radio's version, turning Thread on and off,
 * joining by TLVs, the device collection. What it does not know is written here with `fetch`, in
 * the JSON the pinned ot-br-posix (`cb4bdae`, `src/rest/json.cpp`) speaks, keys in camelCase: the
 * active dataset read as JSON, a network formed from a few fields, a change sent as a pending
 * dataset with a delay. What comes back is checked: an external border router is the owner's
 * device on the network, and answers whatever it answers.
 */
import { OtbrRestClient } from '@matter/thread-br-client';
import { z } from 'zod';

import { THREAD_NODE_STATES, type ThreadNetwork } from '@nebulahome/contracts';

/** How long a call may take, unless it says otherwise. */
const TIMEOUT_MS = 10_000;

/**
 * How long a pending dataset may take: OTBR registers it with the leader and waits up to 30 s
 * for its answer.
 */
const PENDING_TIMEOUT_MS = 35_000;

/** A Thread timestamp, as the REST API writes it. */
const timestampSchema = z.object({
  seconds: z.number().int().min(0),
  ticks: z.number().int().min(0).default(0),
  authoritative: z.boolean().default(false),
});

/** The active dataset, as `GET /node/dataset/active` answers it in JSON. */
const activeDatasetSchema = z.object({
  activeTimestamp: timestampSchema.optional(),
  networkKey: z.string().regex(/^[0-9A-Fa-f]{32}$/u),
  networkName: z.string().max(16),
  extPanId: z.string().regex(/^[0-9A-Fa-f]{16}$/u),
  meshLocalPrefix: z.string().max(64),
  panId: z.number().int().min(0).max(0xffff),
  channel: z.number().int().min(0).max(255),
});

/** The active dataset. */
export type OtbrActiveDataset = z.output<typeof activeDatasetSchema>;

/** One item of the device collection (`/api/devices`), as far as it is read. */
const deviceSchema = z.object({
  extAddress: z.string().regex(/^[0-9A-Fa-f]{16}$/u),
  role: z.string().max(32).optional(),
  mode: z.object({ rxOnWhenIdle: z.boolean().optional() }).optional(),
});

/** A node the border router discovered. */
export type OtbrDevice = {
  /** Sixteen lower-case hex digits. */
  readonly extAddress: string;

  /** `leader`, `router`, `child`…, as OpenThread names it. */
  readonly role: string | null;

  /** An end device whose radio sleeps between polls of its parent. */
  readonly isSleepy: boolean;
};

/** What a new network is formed with; the border router makes up what is left out. */
export type OtbrNewNetwork = {
  readonly networkName: string;
  readonly channel: number | null;
};

/**
 * A new network's secrets, which the border router keeps: a network key, a PSKc, an extended PAN
 * ID, a PAN ID and a mesh-local prefix, all random. Sent whole, so forming a network on a border
 * router that had one before does not keep its old key.
 *
 * @param network - Its name, and its channel when one was picked.
 * @param random - Random bytes.
 * @returns The active dataset to send, as JSON.
 */
export function newNetworkOf(
  network: OtbrNewNetwork,
  random: (size: number) => Buffer,
): Record<string, unknown> {
  const prefix = random(7).toString('hex');

  return {
    activeTimestamp: { seconds: 1, ticks: 0, authoritative: false },
    networkKey: random(16).toString('hex'),
    pskc: random(16).toString('hex'),
    extPanId: random(8).toString('hex'),
    // 0xFFFF is the broadcast PAN.
    panId: random(2).readUInt16BE() % 0xffff,
    meshLocalPrefix: `fd${prefix.slice(0, 2)}:${prefix.slice(2, 6)}:${prefix.slice(6, 10)}:${prefix.slice(10, 14)}::/64`,
    networkName: network.networkName,
    ...(network.channel === null ? {} : { channel: network.channel }),
  };
}

/**
 * The network as the pages show it, from the active dataset and the node's role.
 *
 * @param dataset - The active dataset.
 * @param role - This border router's role.
 * @returns The network, without its key.
 */
export function networkOf(dataset: OtbrActiveDataset, role: ThreadNetwork['role']): ThreadNetwork {
  return {
    name: dataset.networkName,
    channel: dataset.channel,
    panId: `0x${dataset.panId.toString(16).padStart(4, '0')}`,
    extPanId: dataset.extPanId.toLowerCase(),
    meshLocalPrefix: dataset.meshLocalPrefix,
    role,
  };
}

/** One border router's REST API. */
export class Otbr {
  readonly #url: URL;
  readonly #timeoutMs: number;
  readonly #client: OtbrRestClient;

  /**
   * Points at a border router.
   *
   * shortcut: `OtbrRestClient` speaks plain HTTP at a host and port, which is all OTBR serves; an
   * `https` URL or one under a path reaches the client's calls without either.
   *
   * @param url - Its REST API: `http://127.0.0.1:8081`.
   * @param timeoutMs - How long a call may take.
   */
  constructor(url: string, timeoutMs = TIMEOUT_MS) {
    this.#url = new URL(url);
    this.#timeoutMs = timeoutMs;
    this.#client = new OtbrRestClient({
      host: this.#url.hostname,
      port: this.#url.port === '' ? 80 : Number(this.#url.port),
      timeoutMs,
    });
  }

  /**
   * This border router's role in the network.
   *
   * @returns The role; `disabled` for one OpenThread does not name.
   */
  async role(): Promise<ThreadNetwork['role']> {
    const state = await this.#client.getState();

    return (THREAD_NODE_STATES as readonly string[]).includes(state)
      ? (state as ThreadNetwork['role'])
      : 'disabled';
  }

  /**
   * This border router's extended address.
   *
   * @returns Sixteen lower-case hex digits.
   */
  async extAddress(): Promise<string> {
    return Buffer.from(await this.#client.getExtAddress())
      .toString('hex')
      .toLowerCase();
  }

  /**
   * The radio's firmware, as the border router asked it.
   *
   * @returns Its version string.
   */
  async coprocessorVersion(): Promise<string> {
    return (await this.#client.getCoprocessorVersion()).slice(0, 128);
  }

  /**
   * The active dataset, as JSON.
   *
   * @returns It, or null when the border router has none (204).
   * @throws {Error} When it does not answer, or answers something else.
   */
  async activeDataset(): Promise<OtbrActiveDataset | null> {
    const response = await this.#fetch('GET', '/node/dataset/active', { accept: true });

    return response.status === 204
      ? null
      : activeDatasetSchema.parse(JSON.parse(await response.text()));
  }

  /**
   * The active dataset, as TLV hex: what another border router or a commissioner takes.
   *
   * @returns The TLVs in lower case, or null when the border router has none.
   */
  async datasetTlvs(): Promise<string | null> {
    const { activeHex } = await this.#client.getDataset();

    return activeHex === undefined || activeHex.trim() === ''
      ? null
      : activeHex.trim().toLowerCase();
  }

  /**
   * Turns Thread on or off on the border router.
   *
   * @param isEnabled - Which.
   * @returns Once done.
   */
  async enable(isEnabled: boolean): Promise<void> {
    await this.#client.setState(isEnabled);
  }

  /**
   * Forms a new network: the active dataset, whole. Thread must be off.
   *
   * @param dataset - The dataset, as {@link newNetworkOf} makes it.
   * @returns Once the border router took it.
   */
  async form(dataset: Record<string, unknown>): Promise<void> {
    await this.#fetch('PUT', '/node/dataset/active', { json: dataset });
  }

  /**
   * Joins a network by its dataset. Thread must be off.
   *
   * @param tlvs - The dataset as TLV hex.
   * @returns Once the border router took it.
   */
  async join(tlvs: string): Promise<void> {
    await this.#client.setActiveDataset(tlvs);
  }

  /**
   * Changes the network's name or channel as a pending dataset, which every node applies once its
   * delay runs out: a newer active timestamp, so the change wins, and the rest kept.
   *
   * @param change - The name, the channel, or both.
   * @param change.networkName - The new name.
   * @param change.channel - The new channel.
   * @param activeSeconds - The current active timestamp's seconds.
   * @param delayMs - How long the nodes are given to hear of it.
   * @returns Once the leader took it.
   */
  async schedule(
    change: { networkName?: string | undefined; channel?: number | undefined },
    activeSeconds: number,
    delayMs: number,
  ): Promise<void> {
    await this.#fetch(
      'PUT',
      '/node/dataset/pending',
      {
        json: {
          activeDataset: {
            activeTimestamp: { seconds: activeSeconds + 1, ticks: 0, authoritative: false },
            ...(change.networkName === undefined ? {} : { networkName: change.networkName }),
            ...(change.channel === undefined ? {} : { channel: change.channel }),
          },
          delay: delayMs,
        },
      },
      PENDING_TIMEOUT_MS,
    );
  }

  /**
   * The nodes in the border router's device collection, as its last discovery left it.
   *
   * @returns Them; those that do not read are left out.
   */
  async devices(): Promise<OtbrDevice[]> {
    return (await this.#client.listDevices()).flatMap((item) => {
      const attributes = (item as { attributes?: unknown } | null)?.attributes ?? item;
      const device = deviceSchema.safeParse(attributes);

      return device.success
        ? [
            {
              extAddress: device.data.extAddress.toLowerCase(),
              role: device.data.role ?? null,
              isSleepy: device.data.mode?.rxOnWhenIdle === false,
            },
          ]
        : [];
    });
  }

  /**
   * Asks the border router to discover the network again, filling the device collection.
   *
   * @returns Once it took the task; it runs behind.
   */
  async discover(): Promise<void> {
    await this.#client.postAction('updateDeviceCollectionTask', {
      maxAge: 30,
      deviceCount: 256,
      timeout: 60,
    });
  }

  /**
   * Makes one call the client does not know.
   *
   * @param method - The method.
   * @param route - The path.
   * @param body - JSON to send, or that JSON is wanted back.
   * @param body.json - What to send.
   * @param body.accept - Whether JSON is asked for.
   * @param timeoutMs - How long it may take.
   * @returns The response, a success.
   * @throws {Error} When it does not answer in time, or answers with a failure.
   */
  async #fetch(
    method: 'GET' | 'PUT',
    route: string,
    body: { json?: unknown; accept?: boolean },
    timeoutMs = this.#timeoutMs,
  ): Promise<Response> {
    const response = await fetch(new URL(route, this.#url), {
      method,
      headers: {
        ...(body.accept === true ? { Accept: 'application/json' } : {}),
        ...(body.json === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body.json === undefined ? {} : { body: JSON.stringify(body.json) }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200);

      throw new Error(
        `${method} ${route} answered ${String(response.status)}${detail === '' ? '' : `: ${detail}`}`,
      );
    }

    return response;
  }
}
