/**
 * Turning any thrown value into the one error body the API is allowed to return.
 *
 * RULES.md 8.3 fixes a single envelope for every non-2xx response. The work here is making sure
 * nothing escapes it: a Zod failure, a platform error, a Fastify 404 and an unexpected crash all
 * leave through this file, so a client never has to parse two different failure shapes.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { ERROR_CODES, isNebulaError, type ApiError, type ErrorCode } from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

/** The status returned when nothing more specific applies. */
const INTERNAL_STATUS = 500;

/** The status Fastify's own body parser and validation failures come in with. */
const BAD_REQUEST_STATUS = 400;

/**
 * What the client is told when the failure was not one of ours.
 *
 * The real message stays in the log. An unexpected error's text is written for a developer and
 * frequently names a table, a column or a file path, none of which an unauthenticated caller
 * should learn from a 500.
 */
const INTERNAL_MESSAGE = 'The request could not be completed';

/** One field that failed validation. */
type ValidationIssue = {
  /** Where in the body, query or path the problem is. */
  readonly path: string;

  /** What is wrong with it. */
  readonly message: string;
};

/**
 * Flattens a Zod failure into something a form can highlight.
 *
 * @param error - The failure Zod produced.
 * @returns One entry per offending field.
 */
export function toValidationIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/** A failure, reduced to what the response needs. */
type ErrorShape = {
  /** The HTTP status to send. */
  readonly status: number;

  /** The stable code the client branches on. */
  readonly code: ErrorCode;

  /** English, for a developer reading a log. */
  readonly message: string;

  /** Structured context. Never carries secrets or personal data. */
  readonly details: Readonly<Record<string, unknown>>;
};

/**
 * Reads whatever was thrown as a status, a code and a message.
 *
 * @param error - The caught value, of unknown shape.
 * @returns The four things the envelope needs.
 */
export function toErrorShape(error: unknown): ErrorShape {
  if (isNebulaError(error)) {
    return {
      status: error.httpStatus,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  if (error instanceof z.ZodError) {
    return {
      status: BAD_REQUEST_STATUS,
      code: ERROR_CODES.VALIDATION,
      message: 'Request failed validation',
      details: { issues: toValidationIssues(error) },
    };
  }

  // Fastify attaches `statusCode` to the failures it raises itself: a 404 for an unknown route,
  // a 413 for an oversized body, a 429 from the rate limiter. Those already carry a status that
  // is more useful than 500, so it is kept.
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const status = error.statusCode;
    const message = 'message' in error ? String((error as { message: unknown }).message) : '';

    if (typeof status === 'number' && status >= 400 && status < 500) {
      return {
        status,
        code: status === 404 ? ERROR_CODES.NOT_FOUND : ERROR_CODES.VALIDATION,
        message: message === '' ? 'Request rejected' : message,
        details: {},
      };
    }
  }

  return {
    status: INTERNAL_STATUS,
    code: ERROR_CODES.INTERNAL,
    message: INTERNAL_MESSAGE,
    details: {},
  };
}

/**
 * Builds the response body.
 *
 * @param shape - The failure, already reduced.
 * @param traceId - The request's trace id, echoed so a screenshot is enough to find the log line.
 * @returns The envelope, exactly as RULES.md 8.3 specifies it.
 */
export function toErrorBody(shape: ErrorShape, traceId: string): ApiError {
  return {
    error: {
      code: shape.code,
      message: shape.message,
      details: shape.details,
      traceId,
    },
  };
}

/**
 * Builds the handler every unhandled failure in a route reaches.
 *
 * It takes the platform logger rather than using `request.log`, and that is not a preference.
 * The server is built with Fastify's own logging switched off, so `request.log` is a stub whose
 * calls go nowhere - a 500 would answer the caller correctly and leave no trace of why, which is
 * precisely what happened the first time a route in this service threw.
 *
 * @param logger - Where failures are reported.
 * @returns The error handler to install.
 */
export function createErrorHandler(
  logger: PlatformLogger,
): (error: unknown, request: FastifyRequest, reply: FastifyReply) => void {
  return (error: unknown, request: FastifyRequest, reply: FastifyReply): void => {
    const shape = toErrorShape(error);

    // A 5xx is a bug or an outage and needs the stack; a 4xx is a caller doing something the API
    // already told them not to do, and logging a stack for each one buries the real failures.
    if (shape.status >= INTERNAL_STATUS) {
      logger.error(
        { err: error, status: shape.status, traceId: request.traceId, path: request.url },
        'Request failed',
      );
    } else {
      logger.debug(
        { code: shape.code, status: shape.status, traceId: request.traceId },
        'Request rejected',
      );
    }

    void reply.status(shape.status).send(toErrorBody(shape, request.traceId));
  };
}

/**
 * The handler an unknown route reaches.
 *
 * Fastify's default 404 body is not the envelope, and a client that has to special-case one
 * response shape ends up special-casing several.
 *
 * @param request - The request that matched nothing.
 * @param reply - The reply to write the envelope to.
 */
export function handleNotFound(request: FastifyRequest, reply: FastifyReply): void {
  void reply.status(404).send(
    toErrorBody(
      {
        status: 404,
        code: ERROR_CODES.NOT_FOUND,
        message: `No route for ${request.method} ${request.url}`,
        details: {},
      },
      request.traceId,
    ),
  );
}
