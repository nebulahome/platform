import { BUS_VERSION, ValidationError } from '@nebula-home/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createEnvelope, decodeEnvelope, encodeEnvelope, peekEnvelopeHeader } from './codec.js';

const payloadSchema = z.object({ entityId: z.string(), level: z.number() });
const encoder = new TextEncoder();

describe('createEnvelope', () => {
  it('stamps the source, a fresh id and the contract version', () => {
    const envelope = createEnvelope({ ok: true }, { source: 'core' });

    expect(envelope.source).toBe('core');
    expect(envelope.version).toBe(BUS_VERSION);
    expect(envelope.id).toHaveLength(26);
    expect(envelope.payload).toStrictEqual({ ok: true });
  });

  it('mints a trace id when the work has nothing upstream of it', () => {
    expect(createEnvelope({}, { source: 'core' }).traceId).toHaveLength(26);
  });

  it('propagates the trace id it was given', () => {
    const envelope = createEnvelope({}, { source: 'core', traceId: 'trace-from-the-api' });

    expect(envelope.traceId).toBe('trace-from-the-api');
  });

  it('omits the correlation id rather than sending it as null', () => {
    expect('correlationId' in createEnvelope({}, { source: 'core' })).toBe(false);
  });
});

describe('decodeEnvelope', () => {
  it('round-trips a payload', () => {
    const sent = createEnvelope({ entityId: 'light.kitchen', level: 40 }, { source: 'pkg-mqtt' });
    const received = decodeEnvelope(encodeEnvelope(sent), 'nebula.v1.x', payloadSchema);

    expect(received.payload).toStrictEqual({ entityId: 'light.kitchen', level: 40 });
    expect(received.id).toBe(sent.id);
    expect(received.traceId).toBe(sent.traceId);
  });

  it('rejects a payload that does not match the subject schema', () => {
    const sent = createEnvelope({ entityId: 'light.kitchen' }, { source: 'pkg-mqtt' });

    expect(() => decodeEnvelope(encodeEnvelope(sent), 'nebula.v1.x', payloadSchema)).toThrow(
      ValidationError,
    );
  });

  it('names the offending field, so the log says what to fix', () => {
    const sent = createEnvelope({ entityId: 'light.kitchen' }, { source: 'pkg-mqtt' });

    try {
      decodeEnvelope(encodeEnvelope(sent), 'nebula.v1.x', payloadSchema);
      expect.unreachable('should have rejected the payload');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(JSON.stringify((error as ValidationError).details)).toContain('payload.level');
    }
  });

  it('calls a version mismatch by its name', () => {
    // The fix for this is deploying a matching build, and no Zod issue on a `version` field
    // says that.
    const fromTheFuture = encoder.encode(
      JSON.stringify({ ...createEnvelope({}, { source: 'core' }), version: 2 }),
    );

    expect(() => decodeEnvelope(fromTheFuture, 'nebula.v1.x', z.object({}))).toThrow(
      /bus contract version 2/,
    );
  });

  it('separates unparseable bytes from a schema failure', () => {
    expect(() => decodeEnvelope(encoder.encode('not json'), 'nebula.v1.x', payloadSchema)).toThrow(
      /not valid JSON/,
    );
  });

  it('accepts a date that arrived as an ISO string', () => {
    // What every timestamp becomes once it has been through JSON, and the reason
    // `timestampSchema` exists.
    const schema = z.object({ observedAt: z.union([z.date(), z.iso.datetime()]) });
    const sent = createEnvelope(
      { observedAt: new Date('2026-09-04T10:35:19.852Z') },
      {
        source: 'pkg-mqtt',
      },
    );

    const received = decodeEnvelope(encodeEnvelope(sent), 'nebula.v1.x', schema);

    expect(received.payload.observedAt).toBe('2026-09-04T10:35:19.852Z');
  });
});

describe('peekEnvelopeHeader', () => {
  it('recovers the trace id of a message whose payload is wrong', () => {
    // So the rejection is logged under the same identifier as the work that produced it.
    const sent = createEnvelope({ nonsense: true }, { source: 'pkg-mqtt' });
    const header = peekEnvelopeHeader(encodeEnvelope(sent));

    expect(header?.traceId).toBe(sent.traceId);
  });

  it('returns nothing rather than throwing on bytes that are not an envelope', () => {
    expect(peekEnvelopeHeader(encoder.encode('{{{'))).toBeNull();
    expect(peekEnvelopeHeader(encoder.encode('{"unrelated":1}'))).toBeNull();
  });
});
