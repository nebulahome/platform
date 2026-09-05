/**
 * Giving every request a trace id.
 *
 * The property itself is declared in `fastify.d.ts`, for the reason given there. This file is
 * the hook that fills it in.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { newTraceId } from '@nebula-home/bus';
import { TRACE_ID_HEADER } from '@nebula-home/contracts';

/** The longest trace id accepted from a caller. */
const MAX_TRACE_ID_LENGTH = 64;

/** What a caller-supplied trace id may contain. */
const TRACE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Registers the hook that gives every request a trace id and echoes it back.
 *
 * A caller-supplied value is validated before being trusted: it ends up in log records and in
 * bus envelopes, and an unbounded string from the outside would be a way to write arbitrary
 * content into both.
 *
 * @param server - The instance to register on.
 */
export function registerTracing(server: FastifyInstance): void {
  server.addHook('onRequest', (request: FastifyRequest, reply: FastifyReply, done: () => void) => {
    const supplied = request.headers[TRACE_ID_HEADER];
    const candidate = Array.isArray(supplied) ? supplied[0] : supplied;

    request.traceId =
      typeof candidate === 'string' &&
      candidate.length <= MAX_TRACE_ID_LENGTH &&
      TRACE_ID_PATTERN.test(candidate)
        ? candidate
        : newTraceId();

    void reply.header(TRACE_ID_HEADER, request.traceId);
    done();
  });
}
