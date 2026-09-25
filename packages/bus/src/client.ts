/**
 * The typed client every service uses to talk to every other service.
 *
 * Four operations: publish an event, subscribe to events, send a request, answer requests. Each
 * one takes the schema its payload must satisfy, so a subject cannot be read as the wrong shape
 * and a malformed message cannot reach a handler.
 *
 * Delivery semantics are the ones in ARCHITECTURE.md 7.4: commands are request/reply with an
 * explicit timeout, events are fire-and-forget fan-out, and a subscriber that missed events
 * while it was restarting recovers with a snapshot rather than by replaying a durable log.
 */
import { z } from 'zod';

import {
  busErrorSchema,
  DeviceUnavailableError,
  ValidationError,
  type BusEnvelope,
  type BusEnvelopeHeader,
} from '@nebula-home/contracts';
import { withTraceId, type PlatformLogger } from '@nebula-home/logging';

import { createEnvelope, decodeEnvelope, encodeEnvelope, peekEnvelopeHeader } from './codec.js';
import { fromBusError, toBusError } from './error-mapping.js';
import type { BusTransport, TransportMessage, TransportSubscription } from './transport.js';
import { ulid } from './ulid.js';

/**
 * Default ceiling on a request.
 *
 * Five seconds, from ARCHITECTURE.md 7.4. Long enough for a device on a congested Zigbee mesh,
 * short enough that a user pressing a button in the interface is told the light is unreachable
 * rather than left watching a spinner.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

/** How a client identifies itself and where it publishes. */
export type BusClientOptions = {
  /** The connected transport. */
  readonly transport: BusTransport;

  /** Service or package id, stamped on every envelope this client publishes. */
  readonly source: string;

  /** Where the client reports rejected messages and failed handlers. */
  readonly logger: PlatformLogger;

  /** Ceiling on a request that does not specify its own. */
  readonly requestTimeoutMs?: number;
};

/** Trace propagation for one published message. */
export type PublishOptions = {
  /** The unit of work this message belongs to. A new identifier is minted when absent. */
  readonly traceId?: string;

  /** Pairs a reply with its request. Set by the request machinery, rarely by a caller. */
  readonly correlationId?: string;
};

/** What a handler is told about the message it is handling, beyond the payload. */
export type MessageContext = {
  /** The subject it arrived on, with wildcards resolved to the actual entity or service. */
  readonly subject: string;

  /** The envelope header, carrying the publisher, the trace identifier and the message id. */
  readonly header: BusEnvelopeHeader;

  /** The service logger, already bound to this message's trace identifier. */
  readonly logger: PlatformLogger;
};

/** How a subscription is placed and when it ends. */
export type SubscribeOptions = {
  /** Queue group, so that a second instance of a service shares the load rather than duplicating it. */
  readonly queue?: string;

  /** Ends the subscription when it aborts. */
  readonly signal?: AbortSignal;

  /**
   * How many messages may be in the handler at once. One, the default, handles them strictly in
   * arrival order, which is what state reports need: two reports for one entity applied out of
   * order leave it wrong. A handler that waits on something slow and independent per message - a
   * command waiting on the one device it is for - takes more, so one device that does not answer
   * does not hold up every other command in the house.
   */
  readonly concurrency?: number;
};

/** A live subscription. */
export type BusSubscription = {
  /** Stops delivery. */
  unsubscribe: () => void;
};

/** Handles one received event. */
export type MessageHandler<TPayload> = (
  payload: TPayload,
  context: MessageContext,
) => void | Promise<void>;

/** Answers one received request. */
export type RequestHandler<TRequest, TResponse> = (
  payload: TRequest,
  context: MessageContext,
) => TResponse | Promise<TResponse>;

/**
 * The two shapes a reply can take.
 *
 * A responder has to be able to report a failure as data, because the requester is in another
 * process and cannot catch anything it throws. The value is left as `unknown` here and validated
 * against the caller's schema afterwards: folding the caller's generic into this union makes the
 * discriminant undecidable for the compiler, and a union it cannot narrow is a union that buys
 * nothing.
 */
const replyPayloadSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('error'), error: busErrorSchema }),
  z.object({ status: z.literal('ok'), value: z.unknown() }),
]);

/**
 * The bus client.
 *
 * One per service. It owns no connection of its own - {@link connectBus} supplies the transport
 * and keeps it connected - so a reconnect does not invalidate anything held here.
 */
export class BusClient {
  readonly #transport: BusTransport;
  readonly #source: string;
  readonly #logger: PlatformLogger;
  readonly #requestTimeoutMs: number;

  /**
   * Binds a client to a transport.
   *
   * @param options - Transport, publisher identity, logger and default request timeout.
   */
  public constructor(options: BusClientOptions) {
    this.#transport = options.transport;
    this.#source = options.source;
    this.#logger = options.logger;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /**
   * Publishes an event, fire and forget.
   *
   * There is no acknowledgement by design: an event says something already happened, and a
   * publisher that waited for its subscribers would make the speed of the whole fan-out the
   * speed of its slowest listener.
   *
   * @param subject - Where to publish, built with `busSubjects`.
   * @param payload - The event body.
   * @param options - Trace propagation.
   */
  public publish(subject: string, payload: unknown, options: PublishOptions = {}): void {
    this.#transport.publish(subject, encodeEnvelope(this.#envelope(payload, options)));
  }

  /**
   * Subscribes to a subject or pattern.
   *
   * Messages are handled **one at a time, in arrival order** unless `options.concurrency` says
   * otherwise. Concurrency here would mean two reports for the same entity being applied in an
   * order nobody chose, which is exactly the race the single-writer design exists to remove
   * (ARCHITECTURE.md 4.1) - so a state subscriber never asks for it.
   *
   * @param subject - The subject or wildcard pattern. Patterns spanning an entity id must end
   * in `>`, which is why `BUS_PATTERNS` exists rather than each caller writing one.
   * @param payloadSchema - What the payload must satisfy to reach the handler.
   * @param handler - Called once per valid message.
   * @param options - Queue group, cancellation and concurrency.
   * @returns The subscription, to unsubscribe from.
   */
  public subscribe<TSchema extends z.ZodType>(
    subject: string,
    payloadSchema: TSchema,
    handler: MessageHandler<z.output<TSchema>>,
    options: SubscribeOptions = {},
  ): BusSubscription {
    return this.#consume(subject, options, async (message) => {
      const envelope = decodeEnvelope(message.data, message.subject, payloadSchema);

      await handler(envelope.payload, this.#context(message.subject, envelope));
    });
  }

  /**
   * Sends a request and waits for one reply.
   *
   * @param subject - Where to send it.
   * @param payload - The request body.
   * @param replySchema - What a successful reply must satisfy.
   * @param options - Trace propagation and a per-call timeout.
   * @returns The reply value, already validated.
   * @throws {DeviceUnavailableError} When no reply arrives in time or nobody is listening. Both
   * are reported as unavailability rather than as a transport failure, because from the caller's
   * side they are the same fact: the thing being addressed did not answer.
   * @throws {NebulaError} Whatever the responder threw, rebuilt as the same class it threw.
   * @throws {ValidationError} When the reply does not match `replySchema`.
   */
  public async request<TSchema extends z.ZodType>(
    subject: string,
    payload: unknown,
    replySchema: TSchema,
    options: PublishOptions & { readonly timeoutMs?: number } = {},
  ): Promise<z.output<TSchema>> {
    const timeoutMs = options.timeoutMs ?? this.#requestTimeoutMs;
    const envelope = this.#envelope(payload, options);

    let reply: TransportMessage;

    try {
      reply = await this.#transport.request(subject, encodeEnvelope(envelope), timeoutMs);
    } catch (cause: unknown) {
      throw new DeviceUnavailableError(`No reply on ${subject} within ${String(timeoutMs)}ms`, {
        cause,
        details: { subject, timeoutMs, traceId: envelope.traceId },
      });
    }

    const decoded = decodeEnvelope(reply.data, subject, replyPayloadSchema);

    if (decoded.payload.status === 'error') {
      throw fromBusError(decoded.payload.error, subject);
    }

    const value = replySchema.safeParse(decoded.payload.value);

    if (!value.success) {
      throw new ValidationError(`Reply from ${subject} does not match its schema`, {
        cause: value.error,
        details: {
          subject,
          issues: value.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
    }

    return value.data;
  }

  /**
   * Answers requests on a subject or pattern.
   *
   * A handler that throws does not kill the subscription and does not leave the requester
   * waiting for a timeout: the failure is converted to a bus error and sent back, so the caller
   * learns what went wrong five seconds sooner and with a code it can branch on. Requests are
   * answered one at a time unless `options.concurrency` allows more.
   *
   * @param subject - The subject or pattern to answer on.
   * @param requestSchema - What the request payload must satisfy.
   * @param handler - Produces the reply value.
   * @param options - Queue group, cancellation and concurrency.
   * @returns The subscription, to unsubscribe from.
   */
  public serve<TSchema extends z.ZodType, TResponse>(
    subject: string,
    requestSchema: TSchema,
    handler: RequestHandler<z.output<TSchema>, TResponse>,
    options: SubscribeOptions = {},
  ): BusSubscription {
    return this.#consume(subject, options, async (message) => {
      let header: BusEnvelopeHeader | null = null;

      try {
        const envelope = decodeEnvelope(message.data, message.subject, requestSchema);

        header = envelope;

        const value = await handler(envelope.payload, this.#context(message.subject, envelope));

        message.respond(
          encodeEnvelope(
            this.#envelope(
              { status: 'ok', value },
              { traceId: envelope.traceId, correlationId: envelope.id },
            ),
          ),
        );
      } catch (error: unknown) {
        const known = header ?? peekEnvelopeHeader(message.data);

        this.#loggerFor(known).warn(
          { subject: message.subject, error: toBusError(error) },
          'Request handler failed',
        );

        message.respond(
          encodeEnvelope(
            this.#envelope(
              { status: 'error', error: toBusError(error) },
              known === null ? {} : { traceId: known.traceId, correlationId: known.id },
            ),
          ),
        );
      }
    });
  }

  /**
   * Delivers what is already queued, then closes the connection.
   *
   * Called on graceful shutdown, so that events published in the last moments of a service's
   * life still reach their subscribers (RULES.md 9).
   *
   * @returns A promise that settles once the connection is closed.
   */
  public async drain(): Promise<void> {
    await this.#transport.drain();
  }

  /**
   * Closes the connection immediately.
   *
   * @returns A promise that settles once the connection is closed.
   */
  public async close(): Promise<void> {
    await this.#transport.close();
  }

  /**
   * Wraps a payload in an envelope stamped with this client's identity.
   *
   * @param payload - The message body.
   * @param options - Trace propagation.
   * @returns The envelope, ready to encode.
   */
  #envelope(payload: unknown, options: PublishOptions): BusEnvelope<unknown> {
    return createEnvelope(payload, {
      source: this.#source,
      ...(options.traceId === undefined ? {} : { traceId: options.traceId }),
      ...(options.correlationId === undefined ? {} : { correlationId: options.correlationId }),
    });
  }

  /**
   * Builds what a handler is told about the message it is handling.
   *
   * @param subject - The resolved subject.
   * @param header - The decoded envelope header.
   * @returns The handler's context, with a logger already bound to the trace identifier.
   */
  #context(subject: string, header: BusEnvelopeHeader): MessageContext {
    return { subject, header, logger: withTraceId(this.#logger, header.traceId) };
  }

  /**
   * Returns a logger bound to a message's trace identifier, when one could be recovered.
   *
   * @param header - The decoded header, or null when the message was too malformed to read one.
   * @returns The bound logger, or the plain service logger.
   */
  #loggerFor(header: BusEnvelopeHeader | null): PlatformLogger {
    return header === null ? this.#logger : withTraceId(this.#logger, header.traceId);
  }

  /**
   * Subscribes and pumps messages through a handler until it ends: one at a time by default, or
   * up to `options.concurrency` at once.
   *
   * A message that throws is logged and skipped. Letting it end the subscription would mean one
   * malformed publish from one misbehaving adapter silently stopping every state report in the
   * house, with nothing in the logs to say the subscription was gone.
   *
   * @param subject - The subject or pattern to receive on.
   * @param options - Queue group, cancellation and how many messages may be handled at once.
   * @param onMessage - What to do with each message.
   * @returns The subscription.
   */
  #consume(
    subject: string,
    options: SubscribeOptions,
    onMessage: (message: TransportMessage) => Promise<void>,
  ): BusSubscription {
    const subscription: TransportSubscription = this.#transport.subscribe(
      subject,
      options.queue === undefined ? {} : { queue: options.queue },
    );

    const logger = this.#logger;
    const limit = Math.max(1, Math.floor(options.concurrency ?? 1));
    const inFlight = new Set<Promise<void>>();

    /**
     * Handles one message, logging rather than throwing what it rejects.
     *
     * @param message - The message.
     * @returns A promise that settles once the handler has finished with it.
     */
    const handle = async (message: TransportMessage): Promise<void> => {
      try {
        await onMessage(message);
      } catch (error: unknown) {
        logger.warn(
          { subject: message.subject, error: toBusError(error) },
          'Rejected a message on the bus',
        );
      }
    };

    /**
     * Reads the subscription to exhaustion, waiting for a free slot before taking the next
     * message, so a burst waits in the broker's buffer rather than piling up in this process.
     *
     * @returns A promise that settles when the subscription ends.
     */
    const pump = async (): Promise<void> => {
      for await (const message of subscription) {
        if (limit === 1) {
          await handle(message);
          continue;
        }

        const running: Promise<void> = handle(message).finally(() => {
          inFlight.delete(running);
        });

        inFlight.add(running);

        if (inFlight.size >= limit) {
          await Promise.race(inFlight);
        }
      }
    };

    // Deliberately not awaited: a subscription lives for as long as the service does, and
    // awaiting it here would mean `subscribe` never returning.
    void pump().catch((error: unknown) => {
      logger.error({ subject, error: toBusError(error) }, 'Subscription ended unexpectedly');
    });

    if (options.signal !== undefined) {
      options.signal.addEventListener(
        'abort',
        () => {
          subscription.unsubscribe();
        },
        { once: true },
      );
    }

    return {
      /** Stops delivery. */
      unsubscribe: (): void => {
        subscription.unsubscribe();
      },
    };
  }
}

/**
 * Mints a trace identifier for a chain of work that has nothing upstream of it.
 *
 * Used where work starts inside the platform rather than arriving from a request: a scheduled
 * automation, a startup resynchronisation, a periodic flush.
 *
 * @returns A new trace identifier.
 */
export function newTraceId(): string {
  return ulid();
}
