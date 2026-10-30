/**
 * The packages' live topics this tab follows (`usePackageLive`), the last message heard on each,
 * and the socket they travel on (API.md 7).
 *
 * One follow per topic however many components draw it: a dashboard of five cards of one package
 * is one subscription, and the message each receives is the same object. A topic is followed
 * again every time the socket comes back, so the retained message arrives again too; until it
 * does, what was heard before the drop stands.
 */
import type { JsonValue, WsClientMessage, WsServerMessage } from '@nebulahome/contracts';

/** Sends one message on the socket. */
export type LiveSender = (message: WsClientMessage) => void;

/**
 * How one package's topic is kept: neither a package id nor a topic can hold a space.
 *
 * @param packageId - The package.
 * @param topic - The topic.
 * @returns The key.
 */
function keyOf(packageId: string, topic: string): string {
  return `${packageId} ${topic}`;
}

/**
 * Reads a key back.
 *
 * @param key - What {@link keyOf} wrote.
 * @returns The package and the topic.
 */
function partsOf(key: string): { readonly packageId: string; readonly topic: string } {
  const space = key.indexOf(' ');

  return { packageId: key.slice(0, space), topic: key.slice(space + 1) };
}

/** The packages' live topics of one tab. */
export class PackageLive {
  /** Who listens to each followed topic. */
  readonly #listeners = new Map<string, Set<() => void>>();

  /** The last message heard on each followed topic. */
  readonly #data = new Map<string, JsonValue>();

  /** The socket, while it is authenticated. */
  #send: LiveSender | undefined;

  /**
   * Starts sending on an authenticated socket, and follows every topic followed again: a new
   * socket follows nothing.
   *
   * @param send - Sends on it.
   */
  public attach(send: LiveSender): void {
    this.#send = send;

    for (const key of this.#listeners.keys()) {
      send({ type: 'package_subscribe', ...partsOf(key) });
    }
  }

  /** Stops sending: the socket dropped. What was heard stays until it comes back. */
  public detach(): void {
    this.#send = undefined;
  }

  /**
   * Follows a topic for one listener; the first follows it on the socket.
   *
   * @param packageId - The package.
   * @param topic - The topic.
   * @param listener - Told whenever a message arrives on it.
   * @returns What stops listening; the last one leaves the topic.
   */
  public follow(packageId: string, topic: string, listener: () => void): () => void {
    const key = keyOf(packageId, topic);
    const listeners = this.#listeners.get(key) ?? new Set<() => void>();

    if (listeners.size === 0) {
      this.#listeners.set(key, listeners);
      this.#send?.({ type: 'package_subscribe', packageId, topic });
    }

    listeners.add(listener);

    return (): void => {
      listeners.delete(listener);

      if (listeners.size === 0 && this.#listeners.get(key) === listeners) {
        this.#listeners.delete(key);
        this.#data.delete(key);
        this.#send?.({ type: 'package_unsubscribe', packageId, topic });
      }
    };
  }

  /**
   * The last message heard on a topic.
   *
   * @param packageId - The package.
   * @param topic - The topic.
   * @returns It, or undefined before the first.
   */
  public read(packageId: string, topic: string): JsonValue | undefined {
    return this.#data.get(keyOf(packageId, topic));
  }

  /**
   * Sends a package's server a message; one sent while the socket is down is lost, as the SDK
   * says.
   *
   * @param packageId - The package.
   * @param topic - The topic.
   * @param data - The message.
   */
  public send(packageId: string, topic: string, data: JsonValue): void {
    this.#send?.({ type: 'package_send', packageId, topic, data });
  }

  /**
   * Keeps a message on a followed topic and tells its listeners. Anything else is not this
   * registry's business.
   *
   * @param message - What the server sent.
   */
  public apply(message: WsServerMessage): void {
    if (message.type !== 'package_message') {
      return;
    }

    const key = keyOf(message.packageId, message.topic);
    const listeners = this.#listeners.get(key);

    if (listeners === undefined) {
      return;
    }

    this.#data.set(key, message.data);

    for (const listener of listeners) {
      listener();
    }
  }

  /** Forgets every message, for whoever signs out; the listeners go with their components. */
  public reset(): void {
    this.#send = undefined;
    this.#data.clear();
  }
}

/** The tab's one registry. */
export const packageLive = new PackageLive();
