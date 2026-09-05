/**
 * Turning a payload into bytes and back, with validation on the way in.
 *
 * Nothing reaches a handler without having been through the subject's schema. A message that
 * does not validate is rejected before any code looks at its contents, which is the property
 * that makes "every boundary is validated" (ARCHITECTURE.md 1) true of the bus rather than
 * aspirational.
 */
import type { z } from 'zod';

import {
  busEnvelopeHeaderSchema,
  busEnvelopeSchema,
  BUS_VERSION,
  ValidationError,
  type BusEnvelope,
  type BusEnvelopeHeader,
} from '@nebula-home/contracts';

import { ulid } from './ulid.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Who is publishing, and which unit of work the message belongs to. */
export type EnvelopeOptions = {
  /** The publishing service or package id, recorded as `source`. */
  readonly source: string;

  /**
   * Identifier of the request, command or job this message belongs to.
   *
   * Omitted only by whatever starts a chain of work with nothing upstream of it - a scheduled
   * automation, a device report nobody asked for - in which case a new one is minted here.
   */
  readonly traceId?: string;

  /** Pairs a reply with its request. Set by the request/reply machinery, not by callers. */
  readonly correlationId?: string;
};

/**
 * Wraps a payload in the envelope every subject shares.
 *
 * @param payload - The subject's payload, already the right shape for its schema.
 * @param options - Publisher identity and trace propagation.
 * @returns The envelope, stamped with a fresh message id and the current time.
 */
export function createEnvelope<TPayload>(
  payload: TPayload,
  options: EnvelopeOptions,
): BusEnvelope<TPayload> {
  const header: BusEnvelopeHeader = {
    id: ulid(),
    ts: new Date().toISOString(),
    version: BUS_VERSION,
    source: options.source,
    traceId: options.traceId ?? ulid(),
    ...(options.correlationId === undefined ? {} : { correlationId: options.correlationId }),
  };

  return { ...header, payload };
}

/**
 * Serialises an envelope for the wire.
 *
 * @param envelope - The envelope to send.
 * @returns Its UTF-8 JSON encoding.
 */
export function encodeEnvelope<TPayload>(envelope: BusEnvelope<TPayload>): Uint8Array {
  return encoder.encode(JSON.stringify(envelope));
}

/**
 * Reads the raw JSON of a message without validating anything.
 *
 * Split out so that a decode failure can say *why*: unparseable bytes and a well-formed message
 * that failed its schema are different faults with different fixes, and a single try/catch
 * around both would report them identically.
 *
 * @param data - The raw message body.
 * @param subject - The subject it arrived on, for the error message.
 * @returns The parsed JSON, of unknown shape.
 * @throws {ValidationError} When the body is not valid JSON.
 */
function parseJson(data: Uint8Array, subject: string): unknown {
  try {
    return JSON.parse(decoder.decode(data));
  } catch (cause: unknown) {
    throw new ValidationError(`Message on ${subject} is not valid JSON`, {
      cause,
      details: { subject },
    });
  }
}

/**
 * Reports the bus contract version a raw message claims, when it claims one at all.
 *
 * @param raw - The parsed message body.
 * @returns The version, or null when the message does not carry a numeric one.
 */
function readClaimedVersion(raw: unknown): number | null {
  if (typeof raw !== 'object' || raw === null || !('version' in raw)) {
    return null;
  }

  const { version } = raw;

  return typeof version === 'number' ? version : null;
}

/**
 * Decodes a message and validates it against the subject's payload schema.
 *
 * @param data - The raw message body.
 * @param subject - The subject it arrived on, reported in any failure.
 * @param payloadSchema - The schema the payload must satisfy.
 * @returns The validated envelope.
 * @throws {ValidationError} When the body is not JSON, when it was published under a different
 * bus contract version, or when the envelope or its payload does not match the schema. A
 * version mismatch is called out by name rather than left as a failed `version` field, because
 * the fix is to deploy a matching build and no amount of staring at a Zod issue says that.
 */
export function decodeEnvelope<TSchema extends z.ZodType>(
  data: Uint8Array,
  subject: string,
  payloadSchema: TSchema,
): BusEnvelope<z.output<TSchema>> {
  const raw = parseJson(data, subject);
  const claimedVersion = readClaimedVersion(raw);

  if (claimedVersion !== null && claimedVersion !== BUS_VERSION) {
    throw new ValidationError(
      `Message on ${subject} uses bus contract version ${String(claimedVersion)}, this build speaks ${String(BUS_VERSION)}`,
      { details: { subject, expected: BUS_VERSION, actual: claimedVersion } },
    );
  }

  const result = busEnvelopeSchema(payloadSchema).safeParse(raw);

  if (!result.success) {
    throw new ValidationError(`Message on ${subject} does not match its schema`, {
      cause: result.error,
      details: {
        subject,
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
  }

  return result.data as BusEnvelope<z.output<TSchema>>;
}

/**
 * Decodes only the header of a message, leaving the payload alone.
 *
 * Used where the header is needed before the payload's schema is known - to recover the trace
 * identifier of a message that failed validation, so the rejection is logged under the same id
 * as the work that produced it.
 *
 * @param data - The raw message body.
 * @returns The header, or null when the message is not a well-formed envelope at all.
 */
export function peekEnvelopeHeader(data: Uint8Array): BusEnvelopeHeader | null {
  try {
    const result = busEnvelopeHeaderSchema.safeParse(JSON.parse(decoder.decode(data)));

    return result.success ? result.data : null;
  } catch {
    // Unparseable bytes have no header to recover; the caller logs without a trace id.
    return null;
  }
}
