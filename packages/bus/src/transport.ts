/**
 * The seam between the platform and NATS.
 *
 * Everything above this file speaks in subjects, envelopes and schemas; only this file knows
 * that the broker is NATS. The seam exists for two reasons. It keeps the client testable
 * without a broker - {@link FakeTransport} implements the same four methods in memory - and it
 * means that the one place to look when a NATS API changes is here, rather than in every
 * service that publishes a message.
 */
import type { Msg, NatsConnection, Subscription } from 'nats';

/** One message as it arrived from the broker. */
export type TransportMessage = {
  /** The subject it was published on, with every wildcard already resolved. */
  readonly subject: string;

  /** The raw body. Decoding it is {@link decodeEnvelope}'s job, not the transport's. */
  readonly data: Uint8Array;

  /**
   * Sends a reply, when the message came from a request.
   *
   * @param data - The encoded reply.
   * @returns True when a reply subject was present and the reply was sent.
   */
  respond: (data: Uint8Array) => boolean;
};

/** A live subscription, iterated to receive messages and cancelled by unsubscribing. */
export type TransportSubscription = AsyncIterable<TransportMessage> & {
  /** Stops delivery and ends the iteration. */
  unsubscribe: () => void;
};

/** How a subscription is placed. */
export type TransportSubscribeOptions = {
  /**
   * Queue group name.
   *
   * Subscribers sharing a group receive one message each rather than all of them, which is what
   * makes a second instance of a service share the load instead of duplicating the work.
   */
  readonly queue?: string;
};

/** The four operations the platform needs from a broker. */
export type BusTransport = {
  /**
   * Publishes one message, fire and forget.
   *
   * @param subject - Where to publish it.
   * @param data - The encoded envelope.
   */
  publish: (subject: string, data: Uint8Array) => void;

  /**
   * Starts receiving messages on a subject or pattern.
   *
   * @param subject - The subject or wildcard pattern to receive on.
   * @param options - Queue group, when the subscription shares load.
   * @returns The subscription, iterable until it is unsubscribed.
   */
  subscribe: (subject: string, options?: TransportSubscribeOptions) => TransportSubscription;

  /**
   * Sends a request and waits for one reply.
   *
   * @param subject - Where to send it.
   * @param data - The encoded envelope.
   * @param timeoutMs - How long to wait before giving up.
   * @returns The reply message.
   * @throws {Error} When no reply arrives within the timeout, or no subscriber exists.
   */
  request: (subject: string, data: Uint8Array, timeoutMs: number) => Promise<TransportMessage>;

  /**
   * Delivers what is already queued, then closes.
   *
   * @returns A promise that settles once the connection is closed.
   */
  drain: () => Promise<void>;

  /**
   * Closes immediately, discarding anything not yet delivered.
   *
   * @returns A promise that settles once the connection is closed.
   */
  close: () => Promise<void>;
};

/**
 * Presents one NATS message through the transport's own shape.
 *
 * @param message - The message the NATS client delivered.
 * @returns The same message, with only the three things the platform uses on it.
 */
function adaptMessage(message: Msg): TransportMessage {
  return {
    subject: message.subject,
    data: message.data,

    /**
     * Sends a reply.
     *
     * @param data - The encoded reply.
     * @returns True when the message carried a reply subject.
     */
    respond: (data: Uint8Array): boolean => message.respond(data),
  };
}

/**
 * Presents one NATS subscription through the transport's own shape.
 *
 * @param subscription - The subscription the NATS client returned.
 * @returns The same subscription, yielding adapted messages.
 */
function adaptSubscription(subscription: Subscription): TransportSubscription {
  return {
    /**
     * Reads the underlying subscription, adapting each message as it arrives.
     *
     * @returns An iterator over the adapted messages.
     */
    [Symbol.asyncIterator]: (): AsyncIterator<TransportMessage> => {
      const messages = subscription[Symbol.asyncIterator]();

      return {
        /**
         * Produces the next adapted message.
         *
         * @returns The next message, or a completion once the subscription ends.
         */
        next: async (): Promise<IteratorResult<TransportMessage>> => {
          const result = await messages.next();

          return result.done === true
            ? { value: undefined, done: true }
            : { value: adaptMessage(result.value), done: false };
        },
      };
    },

    /** Stops delivery. */
    unsubscribe: (): void => {
      subscription.unsubscribe();
    },
  };
}

/**
 * Wraps a connected NATS client as a transport.
 *
 * Written out rather than relying on the two types happening to be structurally compatible: the
 * NATS signatures carry optional parameters the platform never passes, and an accidental match
 * today is not a contract tomorrow.
 *
 * @param connection - A connected NATS client.
 * @returns The transport the bus client is built on.
 */
export function fromNatsConnection(connection: NatsConnection): BusTransport {
  return {
    /**
     * Publishes one message.
     *
     * @param subject - Where to publish it.
     * @param data - The encoded envelope.
     */
    publish: (subject: string, data: Uint8Array): void => {
      connection.publish(subject, data);
    },

    /**
     * Starts a subscription.
     *
     * @param subject - The subject or pattern to receive on.
     * @param options - Queue group, when the subscription shares load.
     * @returns The adapted subscription.
     */
    subscribe: (subject: string, options?: TransportSubscribeOptions): TransportSubscription =>
      adaptSubscription(
        options?.queue === undefined
          ? connection.subscribe(subject)
          : connection.subscribe(subject, { queue: options.queue }),
      ),

    /**
     * Sends a request and waits for the reply.
     *
     * @param subject - Where to send it.
     * @param data - The encoded envelope.
     * @param timeoutMs - How long to wait.
     * @returns The adapted reply.
     */
    request: async (
      subject: string,
      data: Uint8Array,
      timeoutMs: number,
    ): Promise<TransportMessage> =>
      adaptMessage(await connection.request(subject, data, { timeout: timeoutMs })),

    /**
     * Drains and closes.
     *
     * @returns A promise that settles once the connection is closed.
     */
    drain: async (): Promise<void> => {
      await connection.drain();
    },

    /**
     * Closes immediately.
     *
     * @returns A promise that settles once the connection is closed.
     */
    close: async (): Promise<void> => {
      await connection.close();
    },
  };
}
