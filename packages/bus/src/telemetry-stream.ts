/**
 * The durable telemetry stream.
 *
 * Everything else on the bus is fire-and-forget, because a subscriber that missed a state change
 * recovers by asking for a snapshot. Telemetry has no snapshot to ask for: a reading that was
 * dropped while `core` was restarting is a hole in a series that nothing can fill in later.
 * So readings go to a JetStream stream, and `core` pulls from it with a durable consumer that
 * remembers where it got to (ARCHITECTURE.md 7.4).
 *
 * Messages are pulled in batches and acknowledged **after** they are safely stored, not when
 * they are received. Acknowledging on receipt would give exactly the data loss the stream exists
 * to prevent, one crash later.
 */
import {
  AckPolicy,
  DeliverPolicy,
  DiscardPolicy,
  nanos,
  RetentionPolicy,
  StorageType,
  type JsMsg,
  type NatsConnection,
} from 'nats';

import {
  BUS_PATTERNS,
  telemetryReadingSchema,
  type BusEnvelopeHeader,
  type TelemetryReading,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

import { decodeEnvelope } from './codec.js';
import { toBusError } from './error-mapping.js';

/** Name of the stream every telemetry reading is retained in. */
export const TELEMETRY_STREAM = 'NEBULA_TELEMETRY';

/**
 * How long the stream holds a reading before the server drops it.
 *
 * This is a **safety net, not the retention policy**. Owner-configurable retention lives in
 * `system.settings` and is applied to the hypertables by TimescaleDB; this bound only stops the
 * stream growing without limit if nothing has consumed it for a day, which means something is
 * badly wrong and the right response is to lose readings rather than the disk.
 */
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** How long the server waits for an acknowledgement before redelivering a reading. */
const DEFAULT_ACK_WAIT_MS = 30_000;

/** How many unacknowledged readings one consumer may hold. */
const DEFAULT_MAX_ACK_PENDING = 10_000;

/**
 * Shortest wait the server accepts on a pull.
 *
 * NATS rejects anything below a second outright, because a tighter poll is a client stressing
 * the server rather than a client being responsive. Clamping here means a caller that asks for
 * less gets a slower pull rather than an exception in the middle of the flush loop.
 */
const MIN_PULL_EXPIRY_MS = 1000;

/** One reading, with the envelope it arrived in. */
export type TelemetryDelivery = {
  /** The validated reading. */
  readonly reading: TelemetryReading;

  /** Who published it and under which trace identifier. */
  readonly header: BusEnvelopeHeader;
};

/** A batch of readings, acknowledged or returned as a unit. */
export type TelemetryBatch = {
  /** The readings, in the order the stream delivered them. */
  readonly deliveries: readonly TelemetryDelivery[];

  /** Confirms every reading in the batch was stored. */
  readonly ack: () => void;

  /**
   * Returns every reading in the batch for redelivery.
   *
   * @param delayMs - How long the server should wait before redelivering.
   */
  readonly nak: (delayMs?: number) => void;
};

/** How the stream is created, if it does not exist yet. */
export type EnsureTelemetryStreamOptions = {
  /** A connected NATS client. */
  readonly connection: NatsConnection;

  /** The safety-net age bound. Defaults to a day. */
  readonly maxAgeMs?: number;

  /** Where the outcome is reported. */
  readonly logger: PlatformLogger;
};

/**
 * Creates the telemetry stream, or leaves it alone if it is already there.
 *
 * Called by `core` at startup rather than by an adapter: the stream is part of the platform's
 * shape, and a device package should not be able to decide how long readings are kept.
 *
 * @param options - Connection, age bound and logger.
 * @returns A promise that settles once the stream exists.
 */
export async function ensureTelemetryStream(options: EnsureTelemetryStreamOptions): Promise<void> {
  const manager = await options.connection.jetstreamManager();

  const config = {
    name: TELEMETRY_STREAM,
    subjects: [BUS_PATTERNS.allTelemetry],
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    discard: DiscardPolicy.Old,
    max_age: nanos(options.maxAgeMs ?? DEFAULT_MAX_AGE_MS),
  };

  try {
    await manager.streams.info(TELEMETRY_STREAM);
    await manager.streams.update(TELEMETRY_STREAM, config);
    options.logger.debug({ stream: TELEMETRY_STREAM }, 'Telemetry stream is up to date');
  } catch {
    // `info` throws when the stream does not exist, which on a fresh installation is the normal
    // case rather than a failure.
    await manager.streams.add(config);
    options.logger.info({ stream: TELEMETRY_STREAM }, 'Telemetry stream created');
  }
}

/** How a service attaches to the stream to read from it. */
export type TelemetryConsumerOptions = {
  /** A connected NATS client. */
  readonly connection: NatsConnection;

  /**
   * Durable consumer name.
   *
   * Durable is the point: the server remembers this consumer's position, so a restart resumes
   * where the previous process stopped instead of replaying the whole stream or skipping to the
   * end.
   */
  readonly durableName: string;

  /** Where rejected readings are reported. */
  readonly logger: PlatformLogger;

  /** How long the server waits for an acknowledgement. */
  readonly ackWaitMs?: number;
};

/** A durable reader of the telemetry stream. */
export type TelemetryConsumer = {
  /**
   * Pulls up to `maxMessages` readings, waiting no longer than `expiresMs` for them.
   *
   * @param maxMessages - Largest batch to return.
   * @param expiresMs - How long to wait when fewer than that are available. Raised to
   * {@link MIN_PULL_EXPIRY_MS} when it is below what the server accepts.
   * @returns The batch, possibly empty when nothing arrived in time.
   */
  readonly pull: (maxMessages: number, expiresMs: number) => Promise<TelemetryBatch>;
};

/**
 * Decodes one delivered message, or discards it permanently.
 *
 * A reading that does not validate will never validate, however many times it is redelivered,
 * so it is terminated rather than negatively acknowledged. Naking it would put a single
 * malformed publish in front of every subsequent reading, forever.
 *
 * @param message - The delivered message.
 * @param logger - Where the rejection is reported.
 * @returns The decoded delivery, or null when the message was rejected and terminated.
 */
function decodeDelivery(message: JsMsg, logger: PlatformLogger): TelemetryDelivery | null {
  try {
    const envelope = decodeEnvelope(message.data, message.subject, telemetryReadingSchema);

    return { reading: envelope.payload, header: envelope };
  } catch (error: unknown) {
    logger.warn(
      { subject: message.subject, error: toBusError(error) },
      'Discarded an unreadable telemetry reading',
    );
    message.term();

    return null;
  }
}

/**
 * Creates or attaches to the durable consumer `core` reads telemetry through.
 *
 * @param options - Connection, durable name, logger and acknowledgement window.
 * @returns The consumer, ready to pull batches.
 */
export async function createTelemetryConsumer(
  options: TelemetryConsumerOptions,
): Promise<TelemetryConsumer> {
  const manager = await options.connection.jetstreamManager();

  try {
    await manager.consumers.info(TELEMETRY_STREAM, options.durableName);
  } catch {
    // Absent on first start, and on every start after the consumer was deleted by hand.
    await manager.consumers.add(TELEMETRY_STREAM, {
      durable_name: options.durableName,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      ack_wait: nanos(options.ackWaitMs ?? DEFAULT_ACK_WAIT_MS),
      max_ack_pending: DEFAULT_MAX_ACK_PENDING,
    });
  }

  const consumer = await options.connection
    .jetstream()
    .consumers.get(TELEMETRY_STREAM, options.durableName);

  return {
    /**
     * Pulls one batch.
     *
     * @param maxMessages - Largest batch to return.
     * @param expiresMs - How long to wait for it.
     * @returns The batch, possibly empty.
     */
    pull: async (maxMessages: number, expiresMs: number): Promise<TelemetryBatch> => {
      const messages = await consumer.fetch({
        max_messages: maxMessages,
        expires: Math.max(expiresMs, MIN_PULL_EXPIRY_MS),
      });

      const accepted: JsMsg[] = [];
      const deliveries: TelemetryDelivery[] = [];

      for await (const message of messages) {
        const delivery = decodeDelivery(message, options.logger);

        if (delivery !== null) {
          accepted.push(message);
          deliveries.push(delivery);
        }
      }

      return {
        deliveries,

        /** Confirms the whole batch. */
        ack: (): void => {
          for (const message of accepted) {
            message.ack();
          }
        },

        /**
         * Returns the whole batch for redelivery.
         *
         * @param delayMs - How long the server waits before redelivering.
         */
        nak: (delayMs?: number): void => {
          for (const message of accepted) {
            message.nak(delayMs);
          }
        },
      };
    },
  };
}
