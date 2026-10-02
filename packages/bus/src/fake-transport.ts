/**
 * An in-memory broker, for tests.
 *
 * Published from `@nebulahome/bus/testing` rather than from the package root, so that nothing
 * in a running service can import it by accident.
 *
 * It implements the same {@link BusTransport} the real client does, with NATS' subject matching
 * rules - including the one that actually bites: `*` matches a single token, so a pattern over
 * an entity id has to end in `>`. A fake that matched loosely would let a test pass on a
 * subscription that receives nothing in production.
 */
import type {
  BusTransport,
  TransportMessage,
  TransportSubscribeOptions,
  TransportSubscription,
} from './transport.js';

/**
 * Decides whether a subject is delivered to a subscription.
 *
 * @param pattern - The subscription's subject, possibly containing `*` or a trailing `>`.
 * @param subject - The subject a message was published on.
 * @returns True when the pattern matches the subject under NATS' rules.
 */
export function subjectMatches(pattern: string, subject: string): boolean {
  const patternTokens = pattern.split('.');
  const subjectTokens = subject.split('.');

  for (const [index, token] of patternTokens.entries()) {
    // `>` matches one or more remaining tokens, never zero.
    if (token === '>') {
      return subjectTokens.length > index;
    }

    if (index >= subjectTokens.length) {
      return false;
    }

    if (token !== '*' && token !== subjectTokens[index]) {
      return false;
    }
  }

  return patternTokens.length === subjectTokens.length;
}

/** An async queue that a subscription is read through. */
class MessageQueue implements AsyncIterable<TransportMessage> {
  #buffered: TransportMessage[] = [];
  #waiting: ((result: IteratorResult<TransportMessage>) => void)[] = [];
  #isClosed = false;

  /**
   * Delivers one message, waking a reader if one is blocked.
   *
   * @param message - The message to deliver.
   */
  public push(message: TransportMessage): void {
    if (this.#isClosed) {
      return;
    }

    const waiter = this.#waiting.shift();

    if (waiter === undefined) {
      this.#buffered.push(message);
    } else {
      waiter({ value: message, done: false });
    }
  }

  /** Ends the iteration, releasing anything blocked on it. */
  public close(): void {
    this.#isClosed = true;

    for (const waiter of this.#waiting) {
      waiter({ value: undefined, done: true });
    }

    this.#waiting = [];
  }

  /**
   * Reads messages until the queue is closed.
   *
   * @returns An iterator over the delivered messages.
   */
  public [Symbol.asyncIterator](): AsyncIterator<TransportMessage> {
    return {
      /**
       * Produces the next message, waiting for one if the queue is empty.
       *
       * @returns The next message, or a completion once the queue is closed and drained.
       */
      next: async (): Promise<IteratorResult<TransportMessage>> => {
        const buffered = this.#buffered.shift();

        if (buffered !== undefined) {
          return { value: buffered, done: false };
        }

        if (this.#isClosed) {
          return { value: undefined, done: true };
        }

        return new Promise<IteratorResult<TransportMessage>>((resolve) => {
          this.#waiting.push(resolve);
        });
      },
    };
  }
}

/** One registered subscription. */
type FakeSubscription = {
  /** The subject or pattern it receives on. */
  readonly pattern: string;

  /** Its queue group, when it shares load. */
  readonly queue: string | undefined;

  /** Where its messages are delivered. */
  readonly messages: MessageQueue;
};

/** An in-memory broker with the same delivery rules as the real one. */
export class FakeTransport implements BusTransport {
  readonly #subscriptions = new Set<FakeSubscription>();
  readonly #published: { subject: string; data: Uint8Array }[] = [];
  #nextQueueMember = 0;

  /**
   * Every message published through this transport, in order, for assertions.
   *
   * @returns The published messages, oldest first.
   */
  public get published(): readonly { subject: string; data: Uint8Array }[] {
    return this.#published;
  }

  /**
   * Delivers a message to every matching subscription.
   *
   * @param subject - Where it was published.
   * @param data - The encoded envelope.
   */
  public publish(subject: string, data: Uint8Array): void {
    this.#published.push({ subject, data });
    this.#deliver(subject, data, undefined);
  }

  /**
   * Registers a subscription.
   *
   * @param subject - The subject or pattern to receive on.
   * @param options - Queue group, when the subscription shares load.
   * @returns The subscription, iterable until it is unsubscribed.
   */
  public subscribe(
    subject: string,
    options: TransportSubscribeOptions = {},
  ): TransportSubscription {
    const subscription: FakeSubscription = {
      pattern: subject,
      queue: options.queue,
      messages: new MessageQueue(),
    };

    this.#subscriptions.add(subscription);

    return {
      /**
       * Yields each delivered message.
       *
       * @returns An iterator over the subscription's messages.
       */
      [Symbol.asyncIterator]: (): AsyncIterator<TransportMessage> =>
        subscription.messages[Symbol.asyncIterator](),

      /** Stops delivery. */
      unsubscribe: (): void => {
        this.#subscriptions.delete(subscription);
        subscription.messages.close();
      },
    };
  }

  /**
   * Sends a request and waits for the first reply.
   *
   * @param subject - Where to send it.
   * @param data - The encoded envelope.
   * @param timeoutMs - How long to wait.
   * @returns The reply.
   * @throws {Error} When nothing is subscribed, or nothing replies in time - the two failures
   * the real transport produces, so a test exercises the same error path.
   */
  public async request(
    subject: string,
    data: Uint8Array,
    timeoutMs: number,
  ): Promise<TransportMessage> {
    this.#published.push({ subject, data });

    return new Promise<TransportMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`No reply on ${subject} within ${String(timeoutMs)}ms`));
      }, timeoutMs);

      /**
       * Completes the request with the responder's reply.
       *
       * @param reply - The encoded reply.
       * @returns True, always: a fake request always has somewhere to send the reply.
       */
      const respond = (reply: Uint8Array): boolean => {
        clearTimeout(timer);
        resolve({
          subject,
          data: reply,

          /**
           * Replies to a reply, which nothing does.
           *
           * @returns False, since a reply carries no reply subject.
           */
          respond: (): boolean => false,
        });

        return true;
      };

      if (!this.#deliver(subject, data, respond)) {
        clearTimeout(timer);
        reject(new Error(`No responder on ${subject}`));
      }
    });
  }

  /**
   * Ends every subscription.
   *
   * @returns A promise that settles immediately.
   */
  public async drain(): Promise<void> {
    await this.close();
  }

  /**
   * Ends every subscription.
   *
   * @returns A promise that settles immediately.
   */
  public async close(): Promise<void> {
    for (const subscription of this.#subscriptions) {
      subscription.messages.close();
    }

    this.#subscriptions.clear();

    await Promise.resolve();
  }

  /**
   * Delivers one message to the subscriptions that match it.
   *
   * Subscriptions sharing a queue group receive it once between them, chosen round-robin, which
   * is what makes a test of two service instances behave like two service instances.
   *
   * @param subject - Where the message was published.
   * @param data - The encoded envelope.
   * @param respond - How a subscriber replies, when the message is a request.
   * @returns True when at least one subscription received it.
   */
  #deliver(
    subject: string,
    data: Uint8Array,
    respond: ((reply: Uint8Array) => boolean) | undefined,
  ): boolean {
    const matching = [...this.#subscriptions].filter((subscription) =>
      subjectMatches(subscription.pattern, subject),
    );

    const groups = new Map<string, FakeSubscription[]>();
    const direct: FakeSubscription[] = [];

    for (const subscription of matching) {
      if (subscription.queue === undefined) {
        direct.push(subscription);
      } else {
        groups.set(subscription.queue, [...(groups.get(subscription.queue) ?? []), subscription]);
      }
    }

    const chosen = [...direct];

    for (const members of groups.values()) {
      this.#nextQueueMember += 1;

      const member = members[this.#nextQueueMember % members.length];

      if (member !== undefined) {
        chosen.push(member);
      }
    }

    for (const subscription of chosen) {
      subscription.messages.push({
        subject,
        data,

        /**
         * Sends a reply, when the message was a request.
         *
         * @param reply - The encoded reply.
         * @returns True when the message came from a request.
         */
        respond: (reply: Uint8Array): boolean => respond?.(reply) ?? false,
      });
    }

    return chosen.length > 0;
  }
}
