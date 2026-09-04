/**
 * The envelope every message on the bus is wrapped in.
 *
 * One shape for every subject, so that tracing, correlation and version checking are written
 * once rather than per message type. A service that cannot parse an envelope rejects the message
 * without ever looking at the payload.
 *
 * Defined in ARCHITECTURE.md 7.3.
 */
import { z } from 'zod';

/**
 * The bus contract version.
 *
 * Carried in the envelope and repeated as the `v1` segment of every subject. The two must agree:
 * the subject segment is what lets a v2 service subscribe without receiving v1 traffic, and the
 * envelope field is what lets a receiver reject a mismatch it somehow still got.
 */
export const BUS_VERSION = 1;

/**
 * A ULID, as used for message identifiers.
 *
 * Crockford base32, which excludes I, L, O and U so that a human transcribing an id from a log
 * cannot produce a different valid one by mistake.
 */
export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Validates a ULID. */
export const ulidSchema = z.string().regex(ULID_PATTERN, 'Must be a ULID');

/** The fields every message carries, whatever its subject. */
export const busEnvelopeHeaderSchema = z.object({
  /** Unique per message. Time-ordered, so a log sorted by id is in publication order. */
  id: ulidSchema,

  /** When the message was published, ISO 8601 in UTC. */
  ts: z.iso.datetime(),

  /** The bus contract version. Always {@link BUS_VERSION} for messages this build publishes. */
  version: z.literal(BUS_VERSION),

  /** The publishing service or package id. */
  source: z.string().min(1).max(64),

  /**
   * Propagated end to end, and equal to the `X-Trace-Id` header of the request that started it.
   *
   * This is what makes one failure reassemblable from several log streams, so it is required
   * rather than optional: a message published without one breaks the chain for everything
   * downstream of it.
   */
  traceId: z.string().min(1).max(64),

  /** Pairs a reply with its request. Absent on fire-and-forget events. */
  correlationId: z.string().min(1).max(64).optional(),
});

/** The fields every message carries, whatever its subject. */
export type BusEnvelopeHeader = z.output<typeof busEnvelopeHeaderSchema>;

/**
 * Builds the envelope schema for one subject's payload.
 *
 * @param payloadSchema - The schema the subject's payload is validated against.
 * @returns A schema for the full envelope carrying that payload.
 */
export function busEnvelopeSchema<TPayload extends z.ZodType>(
  payloadSchema: TPayload,
): z.ZodObject<{ payload: TPayload } & typeof busEnvelopeHeaderSchema.shape> {
  return busEnvelopeHeaderSchema.extend({ payload: payloadSchema });
}

/** A message on the bus: the common header plus a subject-specific payload. */
export type BusEnvelope<TPayload> = BusEnvelopeHeader & {
  /** The subject's payload, already validated against that subject's schema. */
  payload: TPayload;
};

/**
 * How an error is reported back through a request/reply exchange.
 *
 * A raw stack never crosses the bus. The receiver gets the code it can act on and the trace id
 * it can search the logs with, and the stack stays where it was thrown, under that same id.
 */
export const busErrorSchema = z.object({
  code: z.string().min(1).max(64),
  message: z.string().min(1).max(1024),
  details: z.record(z.string(), z.unknown()).default({}),
});

/** How an error is reported back through a request/reply exchange. */
export type BusError = z.output<typeof busErrorSchema>;
