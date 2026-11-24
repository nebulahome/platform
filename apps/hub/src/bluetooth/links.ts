/**
 * The links the Bluetooth broker opens to devices through proxies, and the order every GATT
 * request to an address goes in.
 *
 * One request at a time per address, in the order they came, whichever way it goes: a proxy's
 * firmware carries out one operation a device at a time, and a conversation's steps must not
 * cross. A request ends with its caller's signal, waiting or under way.
 *
 * A link through a proxy is opened by the broker and counted against the proxy's connections - as
 * it last said them, one taken at once on each connect - and let go of 5 s after its last request
 * unless notifications are on: the device's battery and the proxy's slot are freed, and a
 * conversation's next step or a second command soon after still finds it open. A link the proxy
 * reports lost, or every link of a proxy that went, fails the requests already waiting for it;
 * notifications are not turned on again until the driver asks. Nothing of it is written down.
 *
 * A proxy connects with the services the broker remembers for the device (`gatt-databases.ts`),
 * which skips the search; with none, it searches and the broker remembers what it found. A failure
 * on a link that used them forgets them. A request the device refused as not matching them, before
 * anything was done on the link, is carried out once more on a link that searched; never one after,
 * which would break a conversation the device keeps for the link.
 *
 * The server's adapter keeps its own links (BlueZ, `host.ts`), let go of after the same 5 s.
 */
import {
  BLUETOOTH_GATT_STALE,
  BLUETOOTH_PROXY_GATT_OPS,
  bluetoothGattDatabaseSchema,
  bluetoothGattValueSchema,
  DeviceUnavailableError,
  type JsonObject,
} from '@nebulahome/contracts';

import {
  DATABASE_HASH_TARGET,
  GattDatabases,
  hasDatabaseHash,
  type KnownDatabase,
} from './gatt-databases.js';
import { shortUuid } from './host.js';

/** How long a link with nothing following it is kept open. */
export const LINK_IDLE_MS = 5000;

/** How long a disconnect sent outside any command may take. */
const DISCONNECT_TIMEOUT_MS = 10_000;

/** Sends a reserved op to a proxy: within some milliseconds, or until a signal aborts. */
export type SendToProxy = (
  deviceId: string,
  op: string,
  args: JsonObject,
  within: number | AbortSignal,
) => Promise<unknown>;

/** A link open through a proxy. */
type Link = {
  readonly deviceId: string;

  /** Whether the proxy connected with the services the broker remembers, without searching. */
  readonly isCached: boolean;

  /** Whether a request on it was answered: one refused after that is never carried out again. */
  hasAnswered: boolean;

  /** Where each followed characteristic's values go, by `service characteristic`. */
  readonly notifications: Map<string, (data: string) => void>;
  idle: NodeJS.Timeout | undefined;
};

/** A proxy's connections: how many it holds at most, and how many are free. */
type Slots = { free: number; readonly limit: number };

/**
 * Whether a proxy refused a request as not matching the services it was connected with.
 *
 * @param error - What the request failed with.
 * @returns Whether.
 */
function isStale(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === BLUETOOTH_GATT_STALE;
}

/**
 * Settles as a promise does, or rejects once a signal aborts.
 *
 * @param promise - What is waited for.
 * @param signal - Ends the wait.
 * @returns What it settled with.
 */
async function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    /** Gives up. */
    const abort = (): void => {
      reject(signal.reason as Error);
    };

    if (signal.aborted) {
      abort();
    }

    signal.addEventListener('abort', abort, { once: true });
    void promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort);
    });
  });
}

/** The broker's links through proxies, and its queue of requests by address. */
export class BluetoothLinks {
  readonly #send: SendToProxy;
  readonly #onChange: () => void;
  readonly #links = new Map<string, Link>();
  readonly #slots = new Map<string, Slots>();

  /** The last request of each address's queue, settled or not. */
  readonly #queues = new Map<string, Promise<void>>();

  /** How many times each address's link was lost, and why the last time. */
  readonly #losses = new Map<string, { readonly count: number; readonly why: string }>();

  /** The services remembered for each address. */
  readonly #databases = new GattDatabases();

  /**
   * Prepares the links.
   *
   * @param send - Reaches a proxy.
   * @param onChange - Told when a link or a proxy's connections changed, for the page.
   */
  constructor(send: SendToProxy, onChange: () => void) {
    this.#send = send;
    this.#onChange = onChange;
  }

  /**
   * Runs a request to an address once those before it ended, and lets an idle link go after it.
   *
   * @param address - The device.
   * @param signal - Ends the request, waiting or under way: the next one then goes.
   * @param work - The request.
   * @returns What it answered.
   * @throws {DeviceUnavailableError} When the link it waited behind was lost.
   */
  async run<T>(address: string, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    const losses = this.#losses.get(address)?.count ?? 0;

    return this.#enqueue(address, signal, async () => {
      const lost = this.#losses.get(address);

      // It came during a conversation whose link is gone: the device lost what it was told.
      if (lost !== undefined && lost.count !== losses) {
        throw new DeviceUnavailableError(`${address} lost its link (${lost.why})`, {
          details: { address },
        });
      }

      const link = this.#links.get(address);

      if (link !== undefined) {
        clearTimeout(link.idle);
        link.idle = undefined;
      }

      try {
        return await work();
      } finally {
        this.#idleLater(address);
      }
    });
  }

  /**
   * Runs something for an address once what came before it ended.
   *
   * @param address - The device.
   * @param signal - Ends it, waiting or under way: the next one then goes.
   * @param work - What to run.
   * @returns What it answered.
   */
  async #enqueue<T>(address: string, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    const before = this.#queues.get(address) ?? Promise.resolve();
    const turn = before.then(async () => {
      signal.throwIfAborted();

      return work();
    });
    const answer = untilAborted(turn, signal);
    // The next one waits for this one's turn to come, then for it to end or be given up on.
    const tail = before
      .then(async () => answer)
      .then(
        () => undefined,
        () => undefined,
      );

    this.#queues.set(address, tail);
    void tail.then(() => {
      if (this.#queues.get(address) === tail) {
        this.#queues.delete(address);
      }
    });

    return answer;
  }

  /**
   * The proxy an address has a link through.
   *
   * @param address - The device.
   * @returns Its id, or undefined.
   */
  proxyOf(address: string): string | undefined {
    return this.#links.get(address)?.deviceId;
  }

  /**
   * The addresses linked through a proxy.
   *
   * @returns Them.
   */
  connected(): string[] {
    return [...this.#links.keys()];
  }

  /**
   * A proxy's connections, as it last said them less those taken since.
   *
   * @param deviceId - The proxy.
   * @returns Them; undefined for one that only listens.
   */
  slotsOf(deviceId: string): Readonly<Slots> | undefined {
    return this.#slots.get(deviceId);
  }

  /**
   * A proxy's connections, as the Scanners page shows them.
   *
   * @param deviceId - The proxy.
   * @returns How many are used, of how many; null for one that only listens.
   */
  connections(deviceId: string): { used: number; max: number } | null {
    const slots = this.#slots.get(deviceId);

    return slots === undefined ? null : { used: slots.limit - slots.free, max: slots.limit };
  }

  /**
   * Keeps what a proxy said of its connections.
   *
   * @param deviceId - The proxy.
   * @param slots - Them; null for one that only listens.
   */
  setSlots(deviceId: string, slots: { free: number; limit: number } | null): void {
    if (slots === null) {
      this.#slots.delete(deviceId);
    } else {
      this.#slots.set(deviceId, { free: Math.min(slots.free, slots.limit), limit: slots.limit });
    }

    this.#onChange();
  }

  /**
   * Opens a link to an address through a proxy, one of its connections taken at once: with the
   * services remembered for it, checked by their hash when the device has one, else searching
   * them and remembering what was found.
   *
   * @param address - The device.
   * @param deviceId - The proxy.
   * @param signal - Ends the attempt.
   * @returns Once linked.
   * @throws {Error} When the proxy has no free connection, or did not connect.
   */
  async connect(address: string, deviceId: string, signal: AbortSignal): Promise<void> {
    const known = this.#databases.trusted(address);
    const reply = await this.#open(address, deviceId, known, signal);
    const found = bluetoothGattDatabaseSchema.safeParse(
      (reply as { database?: unknown } | null)?.database,
    );

    if (found.success) {
      const kept = this.#databases.keep(address, found.data);

      if (hasDatabaseHash(found.data)) {
        kept.hash = await this.#hashOf(address, deviceId, signal);
      }

      return;
    }

    // The device changed since, or its hash cannot be read on these handles: search again, once.
    if (
      typeof known?.hash === 'string' &&
      this.#links.get(address)?.isCached === true &&
      (await this.#hashOf(address, deviceId, signal)) !== known.hash
    ) {
      this.#databases.forget(address);
      await this.#reopen(address, signal);
    }
  }

  /**
   * Carries a request out over an address's link; one the device refused as not matching the
   * services remembered, before anything was answered on the link, once more on a link that
   * searched them.
   *
   * @param address - The device.
   * @param op - A {@link BLUETOOTH_PROXY_GATT_OPS} op.
   * @param args - Its arguments.
   * @param signal - The command's deadline.
   * @returns What the proxy answered.
   * @throws {DeviceUnavailableError} When the address has no link.
   */
  async request(
    address: string,
    op: string,
    args: JsonObject,
    signal: AbortSignal,
  ): Promise<unknown> {
    const link = this.#linkOf(address);

    try {
      const answer = await this.#send(link.deviceId, op, args, signal);

      link.hasAnswered = true;

      return answer;
    } catch (error: unknown) {
      if (!link.isCached) {
        throw error;
      }

      // Whatever went wrong may be stale services: the next link searches them.
      this.#databases.forget(address);

      if (!isStale(error) || link.hasAnswered || this.#links.get(address) !== link) {
        throw error;
      }

      await this.#reopen(address, signal);

      const again = this.#linkOf(address);
      const answer = await this.#send(again.deviceId, op, args, signal);

      again.hasAnswered = true;

      return answer;
    }
  }

  /**
   * Notes a characteristic followed on a link, or no longer.
   *
   * @param address - The device.
   * @param service - The service.
   * @param characteristic - The characteristic.
   * @param listener - Where each value goes; null stops.
   */
  follow(
    address: string,
    service: string,
    characteristic: string,
    listener: ((data: string) => void) | null,
  ): void {
    const notifications = this.#links.get(address)?.notifications;
    const key = `${shortUuid(service)} ${shortUuid(characteristic)}`;

    if (listener === null) {
      notifications?.delete(key);
    } else {
      notifications?.set(key, listener);
    }
  }

  /**
   * Hands a value a proxy reported to the driver that turned its characteristic on.
   *
   * @param deviceId - The proxy.
   * @param address - The device.
   * @param service - The service.
   * @param characteristic - The characteristic.
   * @param data - The value, in hex.
   */
  notification(
    deviceId: string,
    address: string,
    service: string,
    characteristic: string,
    data: string,
  ): void {
    const link = this.#links.get(address);

    if (link?.deviceId === deviceId) {
      link.notifications.get(`${shortUuid(service)} ${shortUuid(characteristic)}`)?.(data);
    }
  }

  /**
   * Closes a link a proxy lost: the requests waiting for it fail.
   *
   * @param deviceId - The proxy.
   * @param address - The device.
   * @param why - What happened, for their message.
   */
  lost(deviceId: string, address: string, why: string): void {
    const link = this.#links.get(address);

    if (link?.deviceId !== deviceId) {
      return;
    }

    this.#drop(address, link);
    this.#losses.set(address, { count: (this.#losses.get(address)?.count ?? 0) + 1, why });
  }

  /**
   * Forgets a proxy that went - restarted, its connection lost, no longer one: its links with it.
   *
   * @param deviceId - The proxy.
   */
  forget(deviceId: string): void {
    for (const [address, link] of this.#links) {
      if (link.deviceId === deviceId) {
        this.lost(deviceId, address, 'the proxy went away');
      }
    }

    this.#slots.delete(deviceId);
    this.#onChange();
  }

  /** Stops every timer: the broker stops. */
  close(): void {
    for (const link of this.#links.values()) {
      clearTimeout(link.idle);
    }
  }

  /**
   * Takes one of a proxy's connections and connects through it.
   *
   * @param address - The device.
   * @param deviceId - The proxy.
   * @param known - The services remembered for the device, when trusted.
   * @param signal - Ends the attempt.
   * @returns What the proxy answered.
   * @throws {Error} When the proxy has no free connection, or did not connect.
   */
  async #open(
    address: string,
    deviceId: string,
    known: KnownDatabase | undefined,
    signal: AbortSignal,
  ): Promise<unknown> {
    const slots = this.#slots.get(deviceId);

    if (slots === undefined || slots.free < 1) {
      throw new Error(slots === undefined ? 'it cannot connect' : 'no free connection');
    }

    slots.free -= 1;
    this.#onChange();

    let reply: unknown;

    try {
      reply = await this.#send(
        deviceId,
        BLUETOOTH_PROXY_GATT_OPS.connect,
        known === undefined ? { address } : { address, database: known.database },
        signal,
      );
    } catch (error: unknown) {
      this.#free(deviceId);
      // It may have connected after all, and hold the slot.
      void this.#send(
        deviceId,
        BLUETOOTH_PROXY_GATT_OPS.disconnect,
        { address },
        DISCONNECT_TIMEOUT_MS,
      ).catch(() => undefined);
      throw error;
    }

    this.#links.set(address, {
      deviceId,
      // A proxy that searched anyway answers with what it found.
      isCached:
        known !== undefined && (reply as { database?: unknown } | null)?.database === undefined,
      hasAnswered: false,
      notifications: new Map(),
      idle: undefined,
    });
    this.#onChange();

    return reply;
  }

  /**
   * Lets go of an address's link and connects again through the same proxy, searching: not a
   * link lost, so the requests waiting for it go on.
   *
   * @param address - The device.
   * @param signal - The command's deadline.
   * @throws {Error} When it did not connect again.
   */
  async #reopen(address: string, signal: AbortSignal): Promise<void> {
    const link = this.#linkOf(address);

    this.#drop(address, link);
    // Waited for: the proxy frees the connection only once the device is let go.
    await this.#send(link.deviceId, BLUETOOTH_PROXY_GATT_OPS.disconnect, { address }, signal).catch(
      () => undefined,
    );
    await this.connect(address, link.deviceId, signal);
  }

  /**
   * Reads a device's Database Hash over its link.
   *
   * @param address - The device.
   * @param deviceId - The proxy.
   * @param signal - The command's deadline.
   * @returns It, in hex; null when it could not be read.
   */
  async #hashOf(address: string, deviceId: string, signal: AbortSignal): Promise<string | null> {
    try {
      const answer = await this.#send(
        deviceId,
        BLUETOOTH_PROXY_GATT_OPS.read,
        { address, ...DATABASE_HASH_TARGET },
        signal,
      );

      return bluetoothGattValueSchema.parse(answer).data;
    } catch {
      return null;
    }
  }

  /**
   * An address's link.
   *
   * @param address - The device.
   * @returns It.
   * @throws {DeviceUnavailableError} When it has none.
   */
  #linkOf(address: string): Link {
    const link = this.#links.get(address);

    if (link === undefined) {
      throw new DeviceUnavailableError(`${address} is not linked through a proxy`, {
        details: { address },
      });
    }

    return link;
  }

  /**
   * Lets go of an address's link 5 s from now, unless notifications are on or a request comes.
   *
   * @param address - The device.
   */
  #idleLater(address: string): void {
    const link = this.#links.get(address);

    if (link === undefined || link.notifications.size > 0) {
      return;
    }

    clearTimeout(link.idle);

    const timer = setTimeout(() => {
      void this.#enqueue(address, AbortSignal.timeout(DISCONNECT_TIMEOUT_MS), async () => {
        // A request since started the clock again.
        if (this.#links.get(address) !== link || link.idle !== timer) {
          return;
        }

        this.#drop(address, link);
        await this.#send(
          link.deviceId,
          BLUETOOTH_PROXY_GATT_OPS.disconnect,
          { address },
          DISCONNECT_TIMEOUT_MS,
        ).catch(() => undefined);
      }).catch(() => undefined);
    }, LINK_IDLE_MS);

    timer.unref();
    link.idle = timer;
  }

  /**
   * Forgets a link, and gives its connection back to its proxy.
   *
   * @param address - The device.
   * @param link - Its link.
   */
  #drop(address: string, link: Link): void {
    clearTimeout(link.idle);
    this.#links.delete(address);
    this.#free(link.deviceId);
  }

  /**
   * Gives a connection back to a proxy.
   *
   * @param deviceId - The proxy.
   */
  #free(deviceId: string): void {
    const slots = this.#slots.get(deviceId);

    if (slots !== undefined) {
      slots.free = Math.min(slots.limit, slots.free + 1);
    }

    this.#onChange();
  }
}
